extends CanvasLayer
class_name AstrixObservatory
## THE ASTRIX OBSERVATORY — the human's window onto the Steward.
##
## Presentation only. Every value shown here comes from an authoritative source:
##   world facts   <- GameClient.astrix_state_received       (Core snapshot)
##   agent state   <- GameClient.astrix_agent_status_received (/astrix/agent/status)
##   approvals     <- the pendingApproval inside agent status
## Nothing is invented. Before the first snapshot arrives every field renders as
## "—" rather than a plausible-looking default, and the approval panel only ever
## shows a REAL pending proposal.
##
## Layout discipline (the world is the subject, not the UI):
##   top-left     WORLD strip     — day / season / population / food
##   top-right    AGENT badge     — lifecycle state + last action + consequence
##   bottom-left  ACTIVITY feed   — observable facts, never chain-of-thought
##   centre       APPROVAL panel  — only when a real approval is pending
## In portrait the strip and feed narrow and stack instead of shrinking.

## MobileHUD owns the bottom control band; the feed reads its footprint from
## the script so the two layouts cannot drift apart.
const MobileHUDScript := preload("res://scripts/MobileHUD.gd")

const UNKNOWN := "—"

## Steward LoopStates in which NO run is live. The server binds the world clock to
## stewardship (see startWorldClock in src/server/index.ts), so in these states the
## day counter is deliberately held and the HUD has to SAY SO — a frozen DAY with
## no explanation is exactly what made an idle deployment look broken.
##
## Deliberately a closed list of the not-live states rather than a list of live
## ones: display names that are not LoopStates at all (EXECUTING, VERIFYING, and
## the rest of STATE_COLORS) then keep reading as a live run, and a LoopState added
## later fails toward "running" instead of falsely claiming the clock is stopped.
##
## AWAITING_APPROVAL is in the list on the authority of the composed tick itself:
## `src/astrix/server.ts` returns early from tick() while the loop is
## AWAITING_APPROVAL, so world time really does stop the moment the gate opens.
## Leaving it out made the deployed HUD show a frozen DAY with no explanation for
## the one case where the freeze is the whole point -- a human decision is owed.
const UNMANAGED_STATES := ["IDLE", "COMPLETED", "STOPPED", "FAILED", "AWAITING_APPROVAL", UNKNOWN, ""]

# Lifecycle states the Steward can be in, with their display colour.
const STATE_COLORS := {
    "OBSERVING": Color("8fd3c7"),
    "PLANNING": Color("9db8e8"),
    "THINKING": Color("9db8e8"),
    "PROPOSING": Color("ffd166"),
    "AWAITING APPROVAL": Color("ff8fa3"),
    "AWAITING_APPROVAL": Color("ff8fa3"),
    "EXECUTING": Color("f4a261"),
    "VERIFYING": Color("8fd3c7"),
    "ADAPTING": Color("c9a0ff"),
    "IDLE": Color("9aa7bd"),
}

var _world_row: RichTextLabel
var _pressure_row: RichTextLabel
var _chain_row: RichTextLabel
var _chain: Dictionary = {}
var _chain_timer: Timer
## Client-side receipt time (ticks): compared against ticks, never against the
## server's wall clock — the two clocks share no epoch and must never meet.
var _chain_rx_at := -1
var _agent_panel: PanelContainer
var _agent_state: RichTextLabel
var _agent_action: RichTextLabel
var _feed: RichTextLabel
var _approval_panel: PanelContainer
var _approval_headline: RichTextLabel
var _approval_body: RichTextLabel
var _approve_btn: Button
var _reject_btn: Button
var _approval_progress: RichTextLabel
## Full-screen scrim behind the approval panel: the world stays visible but stops
## competing with the decision the human has to make.
var _approval_scrim: ColorRect

var _lines: Array[String] = []
## Last authoritative snapshot, kept only so a later steward-status update can
## re-render the world strip without waiting for the next snapshot poll.
var _world: Dictionary = {}
var _clock_held := false
## Why the clock is held: "idle" (no run) or "approval" (a live run is blocked on a
## human decision). Two very different facts, so they get two different sentences.
var _clock_held_reason := "idle"
var _pending_id := ""
var _last_action := ""
var _last_status := ""
var _consequence := ""
## Previous authoritative values, for consequence detection.
var _prev := {"day": -1, "food": -1, "pop": -1, "season": "", "buildings": -1, "crops": -1}
var _approval_stage := ""   # PROPOSED -> APPROVED -> EXECUTING -> VERIFIED
## Authoritative resource stock, mirrored so an approval can state affordability.
var _resources: Dictionary = {}
## Write authority from GameClient (observer mode disables the gate controls).
var _has_authority := true

func _ready() -> void:
    layer = 20
    _build_world_strip()
    _build_agent_badge()
    _build_feed()
    _build_approval_panel()
    # The read-out panels must not eat pointer input. Setting MOUSE_FILTER_IGNORE
    # on the PanelContainer alone was not enough: its VBoxContainer inherits
    # Control's default MOUSE_FILTER_STOP, and this console sits on layer 20 above
    # the controls on layer 10. Measured with tools/probe_controls.gd on an 820x1180
    # portrait frame, WorldStrip's VBoxContainer spanned the full width of the top
    # of the screen and swallowed EVERY press on the PAUSE button.
    # The approval panel is deliberately excluded — its APPROVE / REJECT buttons
    # are the one part of this layer that must stay interactive.
    for readout in [_world_panel, _agent_panel, _feed_panel]:
        _make_non_interactive(readout)
    _reposition()
    get_viewport().size_changed.connect(_reposition)

    if root_has_client():
        GameClient.astrix_state_received.connect(_on_world_state)
        GameClient.astrix_agent_status_received.connect(_on_agent_status)
        GameClient.astrix_approval_requested.connect(_on_approval_requested)
        GameClient.write_authority_changed.connect(_on_write_authority)
        GameClient.astrix_chain_received.connect(_on_chain)
        _chain_timer = Timer.new()
        _chain_timer.wait_time = 20.0
        _chain_timer.timeout.connect(_poll_chain)
        add_child(_chain_timer)
        _chain_timer.start()
        _poll_chain()
    var bus := get_node_or_null("/root/GameCommandBus")
    if bus:
        bus.command_completed.connect(_on_command_completed)
        # Server-side rejections (cost, capacity, connectivity, bounds) arrive
        # here: the client owns no game values, so Core's verdict is the only
        # affordability/validity signal, and it must stay visible, never silent.
        bus.command_failed.connect(_on_command_failed)
    _render_world({})
    _render_agent()

## Recursively opt a subtree out of pointer input, so controls on a lower
## CanvasLayer stay reachable through it.
static func _make_non_interactive(node: Node) -> void:
    if node == null:
        return
    if node is Control:
        (node as Control).mouse_filter = Control.MOUSE_FILTER_IGNORE
    for child in node.get_children():
        _make_non_interactive(child)

func root_has_client() -> bool:
    return get_node_or_null("/root/GameClient") != null

# ---------------------------------------------------------------------------
# CHROME
# ---------------------------------------------------------------------------
func _panel_style(alpha: float = 0.72) -> StyleBoxFlat:
    var box := StyleBoxFlat.new()
    box.bg_color = Color(0.043, 0.055, 0.082, alpha)
    box.border_color = Color(0.22, 0.27, 0.36, 0.9)
    box.set_border_width_all(1)
    box.set_corner_radius_all(10)
    box.content_margin_left = 12
    box.content_margin_right = 12
    box.content_margin_top = 9
    # Bottom padding matches the top: collapsing panels to content height left
    # the last text line flush against the border, which read as clipped.
    box.content_margin_bottom = 11
    return box

## A HUD text label.
##
## `wrap` matters more than it looks: a RichTextLabel with `fit_content` and no
## width constraint wraps to ZERO columns and its minimum HEIGHT explodes, which
## is what produced a tall narrow grey bar down the left edge of the frame. Single
## line rows therefore turn wrapping OFF so their minimum size is the text width;
## only genuinely multi-line prose (objective, approval reason) wraps.
func _label(size: int = 14, wrap: bool = false) -> RichTextLabel:
    var label := RichTextLabel.new()
    label.bbcode_enabled = true
    label.fit_content = true
    label.scroll_active = false
    label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART if wrap else TextServer.AUTOWRAP_OFF
    label.add_theme_font_size_override("normal_font_size", size)
    label.add_theme_font_size_override("bold_font_size", size)
    label.mouse_filter = Control.MOUSE_FILTER_IGNORE
    return label

var _world_panel: PanelContainer
func _build_world_strip() -> void:
    _world_panel = PanelContainer.new()
    _world_panel.name = "WorldStrip"
    _world_panel.add_theme_stylebox_override("panel", _panel_style())
    _world_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
    add_child(_world_panel)
    var body := VBoxContainer.new()
    body.add_theme_constant_override("separation", 2)
    _world_panel.add_child(body)
    var title := _label(11)
    title.text = "[color=#6f7d95]ASTRIX OBSERVATORY[/color]"
    body.add_child(title)
    _world_row = _label(15)
    body.add_child(_world_row)
    _pressure_row = _label(12)
    body.add_child(_pressure_row)
    _chain_row = _label(12)
    body.add_child(_chain_row)

func _build_agent_badge() -> void:
    _agent_panel = PanelContainer.new()
    _agent_panel.name = "AgentBadge"
    _agent_panel.add_theme_stylebox_override("panel", _panel_style())
    _agent_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
    add_child(_agent_panel)
    var box := VBoxContainer.new()
    box.add_theme_constant_override("separation", 2)
    _agent_panel.add_child(box)
    var title := _label(11)
    title.text = "[color=#6f7d95]WORLD STEWARD[/color]"
    box.add_child(title)
    _agent_state = _label(16)
    box.add_child(_agent_state)
    _agent_action = _label(12, true)
    box.add_child(_agent_action)

func _build_feed() -> void:
    var panel := PanelContainer.new()
    panel.name = "ActivityFeed"
    panel.add_theme_stylebox_override("panel", _panel_style(0.62))
    panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
    add_child(panel)
    _feed_panel = panel
    var box := VBoxContainer.new()
    box.add_theme_constant_override("separation", 2)
    panel.add_child(box)
    var title := _label(11)
    title.text = "[color=#6f7d95]ACTIVITY[/color]"
    box.add_child(title)
    _feed = _label(12, true)
    box.add_child(_feed)

var _feed_panel: PanelContainer

func _build_approval_panel() -> void:
    # Scrim: dims the WORLD only. It is moved to index 0 so it draws beneath the
    # Observatory panels — added last it covered the very activity log that
    # explains the proposal.
    _approval_scrim = ColorRect.new()
    _approval_scrim.name = "ApprovalScrim"
    _approval_scrim.color = Color(0.02, 0.03, 0.05, 0.5)
    _approval_scrim.mouse_filter = Control.MOUSE_FILTER_IGNORE
    _approval_scrim.visible = false
    add_child(_approval_scrim)
    move_child(_approval_scrim, 0)

    _approval_panel = PanelContainer.new()
    _approval_panel.name = "ApprovalPanel"
    var style := _panel_style(0.97)
    style.border_color = Color("ff8fa3")
    style.set_border_width_all(2)
    style.content_margin_left = 20
    style.content_margin_right = 20
    style.content_margin_top = 16
    style.content_margin_bottom = 18
    _approval_panel.add_theme_stylebox_override("panel", style)
    _approval_panel.visible = false
    add_child(_approval_panel)

    var box := VBoxContainer.new()
    box.add_theme_constant_override("separation", 8)
    _approval_panel.add_child(box)

    # Eyebrow label, then the SUBJECT as the largest text. The header used to be
    # the biggest thing on the card, out-shouting the action being decided.
    var title := _label(11)
    title.text = "[color=#ff8fa3]⚠  STEWARD PROPOSAL — HUMAN APPROVAL REQUIRED[/color]"
    box.add_child(title)

    _approval_headline = _label(22)
    box.add_child(_approval_headline)

    _approval_body = _label(14, true)
    box.add_child(_approval_body)

    # Pipeline sits directly under the facts, separated from the action row.
    _approval_progress = _label(12)
    box.add_child(_approval_progress)

    var spacer := Control.new()
    spacer.custom_minimum_size = Vector2(0, 6)
    box.add_child(spacer)

    var buttons := HBoxContainer.new()
    buttons.add_theme_constant_override("separation", 26)
    buttons.alignment = BoxContainer.ALIGNMENT_CENTER
    box.add_child(buttons)

    # EMPHASIS: the SAFE action carries the visual weight. Approving is
    # irreversible, so it is the outlined button and it never sits under the
    # default keyboard focus.
    _reject_btn = _decision_button("REJECT", Color("f4c878"), Color("f4c878"), Color("3a2400"))
    _reject_btn.pressed.connect(_on_reject)
    buttons.add_child(_reject_btn)

    _approve_btn = _decision_button("APPROVE", Color("2a1d22"), Color("ff8fa3"), Color("ffd9de"))
    _approve_btn.pressed.connect(_on_approve)
    buttons.add_child(_approve_btn)

## A filled, bordered, obviously-clickable decision button.
func _decision_button(text: String, fill: Color, border: Color, ink: Color) -> Button:
    var button := Button.new()
    button.text = text
    button.custom_minimum_size = Vector2(168, 46)
    button.add_theme_color_override("font_color", ink)
    button.add_theme_color_override("font_hover_color", ink)
    button.add_theme_color_override("font_pressed_color", ink)
    button.add_theme_font_size_override("font_size", 16)
    for state in ["normal", "hover", "pressed", "disabled"]:
        var style := StyleBoxFlat.new()
        style.bg_color = fill if state != "hover" else fill.lightened(0.12)
        if state == "disabled":
            style.bg_color = fill.darkened(0.4)
        style.border_color = border
        style.set_border_width_all(2)
        style.set_corner_radius_all(999)
        style.content_margin_left = 22
        style.content_margin_right = 22
        style.content_margin_top = 10
        style.content_margin_bottom = 10
        button.add_theme_stylebox_override(state, style)
    return button

func _reposition() -> void:
    var v := get_viewport().get_visible_rect().size
    var portrait := (v.x / maxf(1.0, v.y)) < 1.05
    var margin := 14.0
    var strip_w: float = (v.x - margin * 2.0) if portrait else minf(430.0, v.x * 0.36)

    # Panels are sized by their CONTENT: reset_size() collapses each card to its
    # minimum height. Without it a PanelContainer keeps whatever height it was
    # last given, which left a ~200px empty void hanging over the settlement.
    #
    # In landscape the WIDTH is content-driven too (min 0): forcing a 430px strip
    # left a bare dark panel extending past the text, which review reported as "a
    # stray grey rectangle overlapping the panel".
    if is_instance_valid(_world_panel):
        _world_panel.custom_minimum_size = Vector2(strip_w if portrait else 0.0, 0)
        _world_panel.reset_size()
        _world_panel.position = Vector2(margin, margin)
    var world_bottom: float = margin + (_world_panel.size.y if is_instance_valid(_world_panel) else 80.0)

    if is_instance_valid(_agent_panel):
        var agent_w: float = strip_w if portrait else minf(340.0, v.x * 0.3)
        _agent_panel.custom_minimum_size = Vector2(agent_w, 0)
        _agent_action.custom_minimum_size = Vector2(agent_w - 30.0, 0)
        _agent_panel.reset_size()
        # Portrait stacks the badge under the world strip; landscape puts it top
        # right, clear of the pause button.
        _agent_panel.position = Vector2(margin, world_bottom + 8.0) if portrait \
            else Vector2(v.x - agent_w - margin - 70.0, margin)

    if is_instance_valid(_feed_panel):
        # The operator pad now occupies the bottom-left corner in EVERY camera
        # mode (it used to appear only in FOLLOW), so the feed can no longer sit
        # flush in that corner. Landscape slides it right of the pad and keeps it
        # on the bottom edge; portrait has no room beside the pad, so it lifts
        # above the whole control band. Both offsets come from MobileHUD's own
        # constants rather than a copied magic number.
        var pad_w: float = MobileHUDScript.CONTROL_PAD_W + margin * 2.0
        var feed_w: float = strip_w if portrait else minf(400.0, maxf(240.0, v.x * 0.32 - pad_w * 0.5))
        _feed_panel.custom_minimum_size = Vector2(feed_w, 0)
        _feed.custom_minimum_size = Vector2(feed_w - 30.0, 0)
        _feed_panel.reset_size()
        # Anchored to the BOTTOM edge so the world keeps the middle band and the
        # feed never floats with dead space beneath it.
        var feed_h: float = _feed_panel.size.y
        if portrait:
            _feed_panel.position = Vector2(margin, v.y - feed_h - margin - MobileHUDScript.CONTROL_BAND_H)
        else:
            _feed_panel.position = Vector2(pad_w, v.y - feed_h - margin)

    if is_instance_valid(_approval_scrim):
        _approval_scrim.position = Vector2.ZERO
        _approval_scrim.size = v
    if is_instance_valid(_approval_panel):
        var panel_w: float = minf(540.0, v.x - margin * 2.0)
        _approval_panel.custom_minimum_size = Vector2(panel_w, 0)
        _approval_body.custom_minimum_size = Vector2(panel_w - 44.0, 0)
        _approval_panel.reset_size()
        # Landscape offsets the card to the LEFT of centre so the channel between
        # the islands — where a proposed bridge would actually go — stays visible
        # on the right. Portrait keeps it centred.
        var panel_h: float = _approval_panel.size.y
        var panel_x: float = (v.x - panel_w) * 0.5 if portrait else v.x * 0.5 - panel_w - 8.0
        _approval_panel.position = Vector2(
            maxf(margin, panel_x),
            clampf(v.y * 0.5 - panel_h * 0.5, margin + 96.0, v.y - panel_h - margin))

# ---------------------------------------------------------------------------
# AUTHORITATIVE WORLD
# ---------------------------------------------------------------------------
func _on_world_state(world: Dictionary) -> void:
    if world.get("resources") is Dictionary:
        _resources = (world["resources"] as Dictionary).duplicate()
    _world = world
    _render_world(world)
    _detect_consequences(world)

func _render_world(world: Dictionary) -> void:
    var ready_now := not world.is_empty()
    var day := _fact(world, "day", ready_now)
    var season := _fact(world, "season", ready_now).to_upper() if ready_now else UNKNOWN
    var season_color := "#c9a0ff"
    match season.to_lower():
        "spring": season_color = "#8fd36f"
        "summer": season_color = "#ffd166"
        "autumn": season_color = "#f4a261"
        "winter": season_color = "#5cc8f0"   # ice blue: WINTER must read as cold
    var pop := _fact(world, "population", ready_now)
    var food := _fact(world, "food", ready_now)
    var per_day := _fact(world, "foodPerDay", ready_now)
    var days_left := _fact(world, "daysOfFoodRemaining", ready_now)

    _world_row.text = "[color=#e8ecf4]DAY %s[/color]  [color=%s]%s[/color]   [color=#b9c7d8]POP[/color] %s   [color=#b9c7d8]FOOD[/color] %s" % [
        day, season_color, season, pop, food,
    ]
    # A held clock is announced next to DAY, because DAY is where a reader looks
    # to decide whether anything is happening at all.
    if _clock_held:
        _world_row.text += "   [color=#ffd166]%s[/color]" % (
            "CLOCK HELD — AWAITING YOUR DECISION" if _clock_held_reason == "approval" else "CLOCK HELD")
    var pressure := str(world.get("foodPressureLevel", "")) if ready_now else ""
    var pressure_color := "#8fd3c7"
    if pressure == "critical":
        pressure_color = "#ff8fa3"
    elif pressure == "high":
        pressure_color = "#ffd166"
    var pressure_text := pressure.to_upper() if pressure != "" else UNKNOWN
    # Days-of-food reads "<1" rather than "0" when there is still food in store:
    # "0 days" next to a non-zero FOOD figure looked like a bug.
    var days_label := days_left
    if ready_now and int(world.get("daysOfFoodRemaining", -1)) == 0 and int(world.get("food", 0)) > 0:
        days_label = "<1"
    # The days-of-food figure IS the alarm, so it carries the pressure colour —
    # as muted grey it was the quietest element on the panel while being the most
    # urgent fact in the world.
    var days_color := "#8a97ad"
    if pressure == "critical" or pressure == "high":
        days_color = pressure_color
    _pressure_row.text = "[color=#8a97ad]%s/day ·[/color] [color=%s]%s days of food[/color] [color=#8a97ad]·[/color] [color=%s]PRESSURE %s[/color]" % [
        per_day, days_color, days_label, pressure_color, pressure_text,
    ]
    _render_chain_row()

## Chain row: the Solana side of the world clock. Every value comes from
## GET /astrix/chain; before the first successful poll (or when the chain is
## unreachable) the row says so explicitly instead of guessing. Fresh =
## updated within the last two minutes; anything older, or any error, reads
## as stale/unreachable in grey. The row asserts nothing about what the chain
## *means* — Core owns semantics; this is the independently readable fact.
func _poll_chain() -> void:
    var client := get_node_or_null("/root/GameClient")
    if client and client.has_method("get_astrix_chain_once"):
        client.get_astrix_chain_once()

func _on_chain(chain: Dictionary) -> void:
    _chain = chain
    _chain_rx_at = Time.get_ticks_msec()
    _render_chain_row()

func _render_chain_row() -> void:
    if not is_instance_valid(_chain_row):
        return
    if _chain.is_empty() or not bool(_chain.get("configured", false)):
        _chain_row.text = "[color=#5f6d84]⛓ CHAIN — awaiting first read[/color]"
        return
    # JSON null arrives as GDScript null, NOT as "" — str(null) is the four
    # characters "null", which would read as a permanent error. Coerce first:
    # only a real non-empty string counts as an error. (Caught by an honest
    # end-to-end render: every success payload carries "error": null.)
    var err_raw: Variant = _chain.get("error", "")
    var err := "" if err_raw == null else str(err_raw)
    # Fresh means "read successfully within the last 5 minutes": chain data
    # moves on heartbeat timescales, so the window is generous by design. A
    # tighter window turned ordinary devnet hiccups into a flickering row.
    var fresh := err.is_empty() and _chain_rx_at > 0 and (Time.get_ticks_msec() - _chain_rx_at) < 300000
    if not fresh:
        if not err.is_empty():
            # Sanitized: server error text must never inject BBCode into HUD.
            var clean := err.replace("[", "(").replace("]", ")").left(48)
            _chain_row.text = "[color=#5f6d84]⛓ CHAIN STALE — %s[/color]" % clean
        else:
            _chain_row.text = "[color=#5f6d84]⛓ CHAIN STALE — last read failed or aged out[/color]"
        return
    var day := str(_chain.get("chainDay", "—"))
    var beats := (_chain.get("heartbeats", []) as Array).size()
    var owner := str(_chain.get("owner", ""))
    var custody := "DELEGATED" if owner == "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh" else "BASE"
    var last_sig := ""
    var hb: Array = _chain.get("heartbeats", [])
    if not hb.is_empty():
        last_sig = str((hb[hb.size() - 1] as Dictionary).get("commitSig", "")).left(8)
    var tail := " · COMMIT %s" % last_sig if last_sig != "" else ""
    _chain_row.text = "[color=#8fd3c7]⛓ CHAIN DAY %s[/color] [color=#8a97ad]·[/color] [color=#e8ecf4]%d HEARTBEATS[/color] [color=#8a97ad]·[/color] [color=#e8ecf4]%s[/color]%s" % [
        day, beats, custody, (" [color=#8a97ad]%s[/color]" % tail) if tail != "" else "",
    ]

## Authoritative value or the unknown marker — never a fabricated default.
##
## Formatting only: JSON has one number type, so Godot parses every figure from
## /astrix/state as a float and a bare str() rendered the LIVE world as
## "DAY 355.0  POP 0.0  FOOD 0.0". The fixtures hid it because GDScript literals
## keep their int-ness. Whole numbers therefore print as integers; a genuinely
## fractional figure keeps one decimal rather than being rounded away.
func _fact(world: Dictionary, key: String, ready_now: bool) -> String:
    if not ready_now or not world.has(key):
        return UNKNOWN
    return _number(world[key])

## Render an authoritative number the way a reader expects to see it.
static func _number(value: Variant) -> String:
    if value is int:
        return str(value)
    if value is float:
        var f: float = value
        return str(int(round(f))) if absf(f - round(f)) < 0.001 else "%.1f" % f
    return str(value)

## Consequence detection from authoritative day-over-day deltas. Every line here
## is derived from a real change in Core state; nothing is predicted or invented.
func _detect_consequences(world: Dictionary) -> void:
    var day := int(world.get("day", -1))
    var food := int(world.get("food", -1))
    var pop := int(world.get("population", -1))
    var season := str(world.get("season", ""))
    var buildings := (world.get("buildings", []) as Array).size() if world.get("buildings") is Array else -1
    var crops := (world.get("crops", []) as Array).size() if world.get("crops") is Array else -1

    if _prev["day"] > 0 and day > int(_prev["day"]):
        _log("[color=#8fd3c7]DAY %d[/color] begins" % day)
    if _prev["season"] != "" and season != str(_prev["season"]):
        _log("[color=#c9a0ff]SEASON → %s[/color]" % season.to_upper())
        if season == "winter":
            _log("[color=#dce7f2]❄ WINTER — crops stop growing[/color]")
            _set_consequence("Winter arrived — crop growth halted")
    if int(_prev["buildings"]) >= 0 and buildings > int(_prev["buildings"]):
        _log("[color=#8fd3c7]STRUCTURE BUILT[/color] (%d total)" % buildings)
        _set_consequence("Structure constructed")
        _advance_approval_stage("VERIFIED")
    if int(_prev["crops"]) >= 0 and crops > int(_prev["crops"]):
        _log("[color=#8fd3c7]CROP PLANTED[/color] (%d growing)" % crops)
        # A seedling is not production: yield exists only after growth and
        # harvest, so the consequence names the planted fact, not its future.
        _set_consequence("Crop planted (%d growing)" % crops)
    if int(_prev["pop"]) >= 0 and pop < int(_prev["pop"]):
        _log("[color=#ffd166]FOOD SHORTAGE[/color] %d lost" % (int(_prev["pop"]) - pop))
        _set_consequence("Population fell — food ran out")
    elif int(_prev["food"]) >= 0 and food > int(_prev["food"]) + 4:
        _log("[color=#8fd3c7]HARVEST[/color] food %d → %d" % [int(_prev["food"]), food])
        _set_consequence("Harvest complete — food increased")

    _prev = {"day": day, "food": food, "pop": pop, "season": season,
             "buildings": buildings, "crops": crops}
    _render_agent()

# ---------------------------------------------------------------------------
# AUTHORITATIVE AGENT STATUS
# ---------------------------------------------------------------------------
func _on_agent_status(status: Dictionary) -> void:
    var state := str(status.get("state", UNKNOWN)).to_upper()
    var turn := int(status.get("turn", 0))
    var objective := str(status.get("objective", "")).strip_edges()

    var current: Variant = status.get("currentAction")
    if current is Dictionary:
        var tool := str(current.get("tool", ""))
        var exec_state := str(current.get("executionState", ""))
        if tool != "":
            _last_action = tool
            _last_status = exec_state

    var pending: Variant = status.get("pendingApproval")
    if pending is Dictionary:
        _show_approval_from_status(pending)
    elif _pending_id != "":
        # The gate closed on the server side: stop showing a stale proposal.
        _pending_id = ""
        _approval_panel.visible = false
        _approval_scrim.visible = false

    var events: Variant = status.get("lastEvents")
    if events is Array:
        var feed: Array[String] = []
        for event in events:
            if not (event is Dictionary):
                continue
            var raw_type := str(event.get("type", ""))
            var type_name := raw_type.replace("_", " ")
            var data: Variant = event.get("data", {})
            var detail := _event_detail(data)
            feed.append("[color=%s]%s[/color] %s" % [_event_class_color(raw_type), type_name, detail])
        if not feed.is_empty():
            _lines = feed

    # Authoritative: taken from the steward's own reported LoopState, never guessed
    # from how long the day counter has sat still.
    var held := UNMANAGED_STATES.has(state)
    var reason := "approval" if (state == "AWAITING_APPROVAL" or _pending_id != "") else "idle"
    if held != _clock_held or reason != _clock_held_reason:
        _clock_held = held
        _clock_held_reason = reason
        _render_world(_world)

    _render_agent(state, turn, objective)

## Event class colours: the feed maps Core's EXISTING event types into causal
## classes (governance pink, executed/verified green, failure red) so the
## lifecycle reads at a glance. No new event types, no invented pipeline.
static func _event_class_color(raw_type: String) -> String:
    match raw_type:
        "APPROVAL_REQUIRED", "APPROVAL_GRANTED", "APPROVAL_REJECTED":
            return "#ff8fa3"
        "ACTION_SUCCEEDED", "VERIFICATION_SUCCEEDED":
            return "#8fd3c7"
        "ACTION_FAILED", "VERIFICATION_FAILED", "TURN_FAILED", "DECISION_RETRY":
            return "#f4a261"
        "TURN_COMPLETED", "PLAN_CREATED", "DECISION_COMPLETED":
            return "#9fd6f0"
        _:
            return "#7f8da3"

## The one legible fact from an event's payload.
##
## The old version looked only for tool/decision/error, so every event outside
## that set rendered as a bare type name — six consecutive "SEASON CHANGED" lines
## with nothing after them, which is what the deployed feed actually showed. Keys
## are tried in order of how much they tell a reader; nothing is invented, and an
## event with no recognised key still renders (as its type alone) rather than
## being dropped.
static func _event_detail(data: Variant) -> String:
    if not (data is Dictionary):
        return ""
    var d: Dictionary = data
    for key in ["error", "tool", "decision", "recommendation", "season", "provider", "objective"]:
        var value := str(d.get(key, "")).strip_edges()
        if value != "":
            # SEASON CHANGED needs the day too, or consecutive winters look identical.
            if key == "season" and d.has("day"):
                return "%s (day %s)" % [value, _number(d["day"])]
            return value
    if d.has("actionsExecuted"):
        return "%s actions" % _number(d["actionsExecuted"])
    if d.has("day"):
        return "day %s" % _number(d["day"])
    return ""

## LAST KNOWN AUTHORITATIVE STEWARD FACTS.
##
## WHY THESE ARE REMEMBERED: two different polls re-render this card. The agent
## poll carries the lifecycle state, the turn number and the objective; the world
## poll carries none of them. Because the render used only its arguments, every
## world poll -- twice a second -- erased the turn number and the objective line,
## and downgraded a live "EXECUTING" badge to "IDLE" via _current_state_text().
## Two frames of the deployed build captured four seconds apart therefore
## disagreed about what the steward was doing, which is exactly the confusion the
## Observatory exists to remove.
##
## This is not fabrication: every value here arrived from Core and is still the
## most recent thing Core said. It is superseded the moment Core says otherwise,
## and _current_state_text() remains the fallback until Core has said anything.
var _agent_state_text := ""
var _agent_turn := -1
var _agent_objective := ""

func _render_agent(state: String = "", turn: int = -1, objective: String = "") -> void:
    if not is_instance_valid(_agent_state):
        return
    if state != "":
        _agent_state_text = state
    if turn >= 0:
        _agent_turn = turn
    if objective != "":
        _agent_objective = objective
    var shown := _agent_state_text if _agent_state_text != "" else _current_state_text()
    # One spelling for one state: the agent poll reports the LoopState verbatim
    # ("AWAITING_APPROVAL") while the world-derived fallback humanises it
    # ("AWAITING APPROVAL"), and alternating between the two read as flicker.
    shown = shown.replace("_", " ")
    var color: Color = STATE_COLORS.get(shown, Color("9aa7bd"))
    var shown_turn := _agent_turn
    var turn_text := "" if shown_turn < 0 else "  [color=#5f6d84]turn %d[/color]" % shown_turn
    _agent_state.text = "[color=#%s]%s[/color]%s" % [color.to_html(false), shown, turn_text]

    var body := ""
    if _pending_id != "":
        # While the gate is open the steward is BLOCKED, so the previous action's
        # execution state is stale — don't report it as still executing.
        _last_status = ""
    if _last_action != "":
        # The lifecycle badge above already shows EXECUTING/VERIFYING, so don't
        # repeat the same word here — show the action, and only a DIFFERENT
        # execution status.
        body += "[color=#8a97ad]LAST ACTION[/color] %s" % _last_action
        if _last_status != "" and _last_status.to_upper() != shown:
            body += "  [color=#8fd3c7]%s[/color]" % _last_status.to_upper()
    if _clock_held:
        var why := "the simulation is paused until you approve or reject the request above" \
            if _clock_held_reason == "approval" \
            else "no steward run is live, so time is not advancing"
        body += "%s[color=#ffd166]WORLD CLOCK HELD[/color] [color=#8a97ad]— %s[/color]" % [
            "\n" if body != "" else "", why]
    if _consequence != "":
        var fresh := "[color=#8fd3c7]● NEW[/color] " if _consequence_fresh_until != 0 else ""
        body += "\n[color=#8a97ad]CONSEQUENCE[/color] %s%s" % [fresh, _consequence]
    if _agent_objective != "":
        body += "\n[color=#5f6d84]%s[/color]" % _agent_objective
    _agent_action.text = body
    _render_feed()
    _relayout()

func _current_state_text() -> String:
    if _pending_id != "":
        return "AWAITING APPROVAL"
    return UNKNOWN if _last_action == "" else "IDLE"

func _render_feed() -> void:
    if not is_instance_valid(_feed):
        return
    var slice := _lines.slice(maxi(0, _lines.size() - 6))
    _feed.text = "\n".join(slice) if not slice.is_empty() else "[color=#5f6d84]awaiting steward…[/color]"
    # Content changed the card's height, so re-solve the layout. Deferred so the
    # container has already recomputed its minimum size.
    _relayout()

## Re-run layout after any text change. Deferred and de-duplicated so a burst of
## snapshot + status + feed updates in one frame costs a single reposition.
var _relayout_queued := false
func _relayout() -> void:
    if _relayout_queued:
        return
    _relayout_queued = true
    _do_relayout.call_deferred()

func _do_relayout() -> void:
    _relayout_queued = false
    _reposition()

func _log(line: String) -> void:
    _lines.append(line)
    if _lines.size() > 24:
        _lines.remove_at(0)
    _render_feed()

## A fresh consequence carries a NEW marker for ~12s so a changed world state
## catches the eye once instead of blending into the panel. Wall-clock time:
## it marks when the OBSERVER learned of the change, not simulation time.
var _consequence_fresh_until := 0

func _set_consequence(text: String) -> void:
    _consequence = text
    _consequence_fresh_until = Time.get_ticks_msec() + 12000

func _process(_delta: float) -> void:
    if _consequence_fresh_until != 0 and Time.get_ticks_msec() >= _consequence_fresh_until:
        _consequence_fresh_until = 0
        _render_agent()

func _on_command_completed(command_name: String, result: Dictionary) -> void:
    var ok := bool(result.get("ok", result.get("success", false)))
    _log("[color=#ffd166]TOOL[/color] %s → %s" % [command_name, "OK" if ok else "REJECTED"])

func _on_command_failed(error: String) -> void:
    _log("[color=#ffd166]TOOL[/color] → [color=#ff8fa3]REJECTED[/color] %s" % error)

func _on_write_authority(has_authority: bool) -> void:
    _has_authority = has_authority
    _approve_btn.disabled = not has_authority
    _reject_btn.disabled = not has_authority
    if not has_authority:
        _log("[color=#5f6d84]observer mode — approval controls disabled[/color]")

# ---------------------------------------------------------------------------
# APPROVAL — always a REAL pending proposal, never fabricated UI state.
# ---------------------------------------------------------------------------
func _show_approval_from_status(pending: Dictionary) -> void:
    var approval_id := str(pending.get("approvalId", pending.get("id", "")))
    if approval_id == "":
        return
    var action: Variant = pending.get("action", {})
    var tool := ""
    var args: Dictionary = {}
    if action is Dictionary:
        tool = str(action.get("tool", ""))
        if action.get("args") is Dictionary:
            args = action.get("args")
    _present_approval(approval_id, tool, str(pending.get("reason", "")), args,
        pending.get("impact") if pending.get("impact") is Dictionary else {})

func _on_approval_requested(request: Dictionary) -> void:
    var impact: Dictionary = request.get("impact") if request.get("impact") is Dictionary else {}
    _present_approval(
        str(request.get("id", "")),
        str(request.get("command", request.get("action", ""))),
        str(request.get("reason", "")),
        {},
        impact)

func _present_approval(approval_id: String, tool: String, reason: String,
        args: Dictionary, impact: Dictionary) -> void:
    _pending_id = approval_id
    _approval_stage = "PROPOSED"

    var headline := tool.replace("_", " ").to_upper()
    var route := ""
    var island_a := str(args.get("island_a", impact.get("islandA", "")))
    var island_b := str(args.get("island_b", impact.get("islandB", "")))
    if island_a != "" and island_b != "":
        route = "%s → %s" % [island_a.capitalize(), island_b.capitalize()]

    var cost_text := ""
    var affordable := true
    if impact.get("cost") is Dictionary:
        var parts: Array[String] = []
        for key in (impact["cost"] as Dictionary).keys():
            var need := int((impact["cost"] as Dictionary)[key])
            var have := int(_resources.get(str(key), -1))
            if have >= 0 and have < need:
                affordable = false
                parts.append("%d %s [color=#ff8fa3](have %d)[/color]" % [need, str(key), have])
            elif have >= 0:
                parts.append("%d %s [color=#5f6d84](of %d)[/color]" % [need, str(key), have])
            else:
                parts.append("%d %s" % [need, str(key)])
        cost_text = ", ".join(parts)
    var risk := str(impact.get("risk", "HIGH" if bool(impact.get("irreversible", false)) else "MEDIUM"))
    var risk_color := "#ff8fa3" if risk.to_upper() == "HIGH" else "#ffd166"

    # SUBJECT first and largest — this is the thing being decided.
    _approval_headline.text = "[color=#e8ecf4]%s[/color]" % headline
    if route != "":
        _approval_headline.text += "\n[color=#b9c7d8]%s[/color]" % route

    var body := ""
    if cost_text != "":
        body += "[color=#8a97ad]COST[/color] %s\n" % cost_text
    body += "[color=#8a97ad]RISK[/color] [color=%s]%s[/color]" % [risk_color, risk.to_upper()]
    if bool(impact.get("irreversible", false)):
        body += "  [color=#ff8fa3](IRREVERSIBLE)[/color]"
    if str(impact.get("unlocks", "")) != "":
        body += "\n[color=#8a97ad]UNLOCKS[/color] %s" % str(impact["unlocks"])
    if reason != "":
        body += "\n\n[color=#b3bfd0]%s[/color]" % reason
    # World time is frozen while the gate is open, so say so: the human should
    # not feel rushed into an irreversible decision.
    body += "\n[color=#9fd6f0]SIMULATION PAUSED — the world is waiting for you[/color]"
    _approval_body.text = body

    # An unaffordable proposal cannot be approved, and the panel says why rather
    # than letting the human click into a server-side rejection.
    _approve_btn.disabled = not affordable or not _has_authority
    _reject_btn.disabled = not _has_authority
    if not affordable:
        _approval_body.text += "\n[color=#ff8fa3]Insufficient resources — cannot approve[/color]"
    # Default focus lands on the SAFE action.
    _reject_btn.grab_focus()

    _approval_panel.visible = true
    _approval_scrim.visible = true
    _render_stage()
    _relayout()
    _log("[color=#ff8fa3]HUMAN APPROVAL REQUIRED[/color] %s" % headline)
    _render_agent("AWAITING APPROVAL")

## PROPOSED → APPROVED → EXECUTING → VERIFIED, shown as a real progress chain.
func _advance_approval_stage(stage: String) -> void:
    if _approval_stage == "":
        return
    _approval_stage = stage
    _render_stage()
    if stage == "VERIFIED":
        # Leave the outcome on screen briefly, then close the panel.
        var timer := get_tree().create_timer(2.5)
        timer.timeout.connect(func() -> void:
            _approval_panel.visible = false
            _approval_scrim.visible = false
            _approval_stage = "")

func _render_stage() -> void:
    if not is_instance_valid(_approval_progress):
        return
    var stages := ["PROPOSED", "APPROVED", "EXECUTING", "VERIFIED"]
    var reached := stages.find(_approval_stage)
    var parts: Array[String] = []
    for i in range(stages.size()):
        var done := reached >= i and reached >= 0
        parts.append("[color=%s]%s[/color]" % ["#8fd3c7" if done else "#4a5670", stages[i]])
    _approval_progress.text = "  →  ".join(parts)

func _on_approve() -> void:
    if _pending_id == "" or not root_has_client():
        return
    GameClient.respond_to_astrix_approval(_pending_id, "approve")
    _log("[color=#8fd3c7]APPROVED by human[/color] %s" % _pending_id)
    _advance_approval_stage("APPROVED")
    _render_agent("EXECUTING")
    # EXECUTING is shown as soon as the approval is accepted; VERIFIED comes only
    # from an authoritative state change (see _detect_consequences).
    var timer := get_tree().create_timer(0.6)
    timer.timeout.connect(func() -> void: _advance_approval_stage("EXECUTING"))

func _on_reject() -> void:
    if _pending_id == "" or not root_has_client():
        return
    GameClient.respond_to_astrix_approval(_pending_id, "reject")
    _log("[color=#ff8fa3]REJECTED by human[/color] %s" % _pending_id)
    _set_consequence("Proposal rejected — steward must adapt")
    _pending_id = ""
    _approval_stage = ""
    _approval_panel.visible = false
    _approval_scrim.visible = false
    _render_agent("ADAPTING")
