extends CanvasLayer
## Presentation-only console for the ASTrix World Steward.
## Consumes the server's structured agent status (GameClient polls
## /astrix/agent/status) plus the authoritative world snapshot
## (GameClient polls /astrix/state). No authority lives here — this is a
## mirror of what the server reports. Approve/Reject buttons call the real
## /astrix/approval/respond endpoint through GameClient.

var panel: PanelContainer
var log_label: RichTextLabel
var world_label: Label
var final_label: RichTextLabel
var approve_button: Button
var reject_button: Button
var _status_text := "WORLD STEWARD // awaiting server"
var _world_text := ""
var _lines: Array[String] = []
var _pending_approval_id := ""
var _prev_day := 0
var _prev_food := -1
var _prev_pop := -1
var _prev_season := ""
var _final_state_shown := false

func _ready() -> void:
    layer = 20
    panel = PanelContainer.new()
    panel.name = "AgentConsolePanel"
    panel.position = Vector2(24, 480)
    panel.size = Vector2(560, 190)
    panel.visible = false
    add_child(panel)

    var box := VBoxContainer.new()
    box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    box.add_theme_constant_override("separation", 4)
    panel.add_child(box)

    log_label = RichTextLabel.new()
    log_label.bbcode_enabled = true
    log_label.fit_content = false
    log_label.size_flags_vertical = Control.SIZE_EXPAND_FILL
    box.add_child(log_label)

    world_label = Label.new()
    world_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
    world_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    box.add_child(world_label)

    final_label = RichTextLabel.new()
    final_label.bbcode_enabled = true
    final_label.fit_content = false
    final_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    final_label.visible = false
    box.add_child(final_label)

    var buttons := HBoxContainer.new()
    box.add_child(buttons)
    approve_button = Button.new()
    approve_button.text = "APPROVE"
    approve_button.visible = false
    approve_button.pressed.connect(_on_approve)
    buttons.add_child(approve_button)
    reject_button = Button.new()
    reject_button.text = "REJECT"
    reject_button.visible = false
    reject_button.pressed.connect(_on_reject)
    buttons.add_child(reject_button)

    var bus := get_node_or_null("/root/GameCommandBus")
    if bus:
        bus.command_completed.connect(_on_command_completed)
    if Engine.has_singleton("GameClient"):
        GameClient.astrix_agent_status_received.connect(_on_agent_status)
        GameClient.astrix_state_received.connect(_on_world_state)

func _on_agent_status(status: Dictionary) -> void:
    panel.visible = true
    var state := str(status.get("state", "UNKNOWN"))
    var turn := int(status.get("turn", 0))
    var objective := str(status.get("objective", "")).strip_edges()
    _status_text = "[color=#ffd166]WORLD STEWARD[/color] // %s // turn %d" % [state, turn]
    if objective != "":
        _status_text += "\n[color=#b9c7d8]objective:[/color] %s" % objective
    var current: Variant = status.get("currentAction")
    if current is Dictionary:
        var tool := str(current.get("tool", ""))
        var exec_state := str(current.get("executionState", ""))
        if tool != "":
            _status_text += "\n[color=#8fd3c7]activity:[/color] %s (%s)" % [tool, exec_state]
    var pending: Variant = status.get("pendingApproval")
    if pending is Dictionary:
        _pending_approval_id = str(pending.get("approvalId", ""))
        var action: Variant = pending.get("action", {})
        var tool := ""
        if action is Dictionary:
            tool = str(action.get("tool", ""))
        _status_text += "\n[color=#ff8fa3]⚠ HUMAN APPROVAL REQUIRED[/color] %s (%s)" % [_pending_approval_id, tool]
        # World time is frozen while the gate is open: the human really is
        # deciding whether this world changes, not watching it drift past.
        _status_text += "\n[color=#ff8fa3]WORLD TIME: PAUSED[/color]"
        approve_button.visible = _pending_approval_id != ""
        reject_button.visible = _pending_approval_id != ""
    else:
        _pending_approval_id = ""
        approve_button.visible = false
        reject_button.visible = false
    var events: Variant = status.get("lastEvents")
    if events is Array:
        var feed: Array[String] = []
        for event in events:
            if event is Dictionary:
                var type_name := str(event.get("type", ""))
                var data: Variant = event.get("data", {})
                var detail := ""
                if data is Dictionary:
                    detail = str(data.get("tool", data.get("decision", data.get("error", ""))))
                feed.append("[color=#b9c7d8]%s[/color] %s %s" % [type_name, detail, _time_label(int(event.get("at", 0)))])
        _lines = feed
    _render()

func _on_world_state(world: Dictionary) -> void:
    var day := int(world.get("day", 0))
    var season := str(world.get("season", "?"))
    var population := int(world.get("population", 0))
    var food := int(world.get("food", 0))
    var pressure := str(world.get("foodPressureLevel", "?"))
    var days_left := int(world.get("daysOfFoodRemaining", 0))
    var per_day := int(world.get("foodPerDay", 0))
    var farmland: Variant = world.get("farmland")
    var farm_parts: Array[String] = []
    if farmland is Array:
        for f in farmland:
            if f is Dictionary:
                farm_parts.append("%s %d/%d" % [str(f.get("islandId", "?")), int(f.get("used", 0)), int(f.get("capacity", 0))])
    var farm_summary := "" if farm_parts.is_empty() else "  farms: " + ", ".join(farm_parts)
    var color := "#ff8fa3" if pressure == "critical" else "#ffd166" if pressure == "high" else "#8fd3c7"
    _world_text = "day %d / 30   %s   population %d   food %d   [color=%s]pressure: %s[/color]  (%d days left @ %d/day)" % [
        day, season, population, food, color, pressure.to_upper(), days_left, per_day,
    ]
    _world_text += "\n" + farm_summary
    _detect_consequences(day, season, population, food)
    _render()

# Presentation-only consequence feed: translates authoritative world deltas into
# a short, judge-readable line (starvation / harvest / season). It never invents
# events that didn't happen in authoritative state — every line is derived from
# a day-over-day comparison of the server snapshot.
func _detect_consequences(day: int, season: String, population: int, food: int) -> void:
    if day > _prev_day and _prev_day > 0:
        append_log("[color=#8fd3c7]DAY %d BEGINS[/color]" % day)
    if season != _prev_season and _prev_season != "":
        append_log("[color=#c9a0ff]%s -> %s[/color]  season changed" % [_prev_season.to_upper(), season.to_upper()])
        if season == "winter":
            append_log("❄ [color=#dce7f2]WINTER HAS ARRIVED — CROPS HAVE STOPPED GROWING[/color]")
    if _prev_food >= 0 and population < _prev_pop:
        var starved := _prev_pop - population
        append_log("[color=#ffd166]FOOD SHORTAGE[/color] %d villager%s starved" % [starved, "s" if starved != 1 else ""])
    elif _prev_food >= 0 and food > _prev_food + 4:
        append_log("[color=#8fd3c7]HARVEST COMPLETE[/color] food %d -> %d (+%d)" % [_prev_food, food, food - _prev_food])
    if food > 0 and _prev_food == 0:
        append_log("[color=#8fd3c7]FOOD RESTORED[/color] vital production resumed")
    _prev_day = day
    _prev_food = food
    _prev_pop = population
    _prev_season = season
    # Final-state banner at day 30 (survived) or population collapse (failed).
    if not _final_state_shown and (day >= 30 or population <= 0):
        _final_state_shown = true
        var survived := day >= 30 and population > 0
        var headline := "ASTrix — 30 DAYS SURVIVED" if survived else "VILLAGE COLLAPSED"
        var cause := "The village endured all 30 days under the steward's control." if survived else "Starvation — food reserves ran out before the next harvest."
        var details := "Population: %d   Food: %d   Season: %s" % [population, food, season]
        final_label.text = "[color=%s]%s[/color]\n%s\n%s" % ["#7bc443" if survived else "#ff8fa3", headline, details, cause]
        final_label.visible = true
        append_log("[color=%s]%s[/color]" % ["#7bc443" if survived else "#ff8fa3", headline])

func _on_command_completed(command_name: String, result: Dictionary) -> void:
    _lines.append("[color=#ffd166]TOOL[/color] %s → %s" % [command_name, str(result.get("ok", false))])
    if _lines.size() > 12:
        _lines.remove_at(0)
    _render()

func append_log(message: String) -> void:
    _lines.append(message)
    if _lines.size() > 12:
        _lines.remove_at(0)
    _render()

func _on_approve() -> void:
    if _pending_approval_id != "" and Engine.has_singleton("GameClient"):
        GameClient.respond_to_astrix_approval(_pending_approval_id, "approve")
        append_log("approval %s -> APPROVED (human)" % _pending_approval_id)

func _on_reject() -> void:
    if _pending_approval_id != "" and Engine.has_singleton("GameClient"):
        GameClient.respond_to_astrix_approval(_pending_approval_id, "reject")
        append_log("approval %s -> REJECTED (human)" % _pending_approval_id)

func _render() -> void:
    if log_label == null:
        return
    var body := _status_text
    if _world_text != "":
        body += "\n" + _world_text
    for line in _lines.slice(maxi(0, _lines.size() - 8)):
        body += "\n" + line
    log_label.text = body

func _time_label(at_ms: int) -> String:
    if at_ms <= 0:
        return ""
    var seconds := int(at_ms / 1000)
    var mins := seconds / 60
    var secs := seconds % 60
    return "[%02d:%02d]" % [mins, secs]
