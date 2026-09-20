extends CanvasLayer
## Operator controls: a directional pad, a camera cluster, an action button and
## pause.
##
## HISTORY / WHY THIS LOOKS LIKE THIS
## Before this pass the pad and action button were hidden in every mode except
## FOLLOW, and there were no camera controls at all — `World3D.set_camera_mode()`
## had a single caller in the whole repo (tools/screenshot_harness.gd), so on a
## real device the ONLY visible control was the pause disc and there was no way to
## zoom, pan, or reach a wider shot.
##
## Now the pad is always present and CHANGES MEANING with the camera:
##   observer modes -> it pans the camera   (AstrixInput.set_camera_pan)
##   FOLLOW         -> it walks the Overseer (AstrixInput.set_virtual_direction)
## The caption above it says which, so it is never ambiguous. GATHER only exists
## in FOLLOW, because interacting requires a body in the world.
##
## Nothing here mutates the world: the camera is presentation, and GATHER routes
## through the same authoritative path as every other command. Visualization is
## not authority.

const CircleScript := preload("res://scripts/Circle.gd")

const JOY_RADIUS := 82.0
const JOY_THUMB_RADIUS := 38.0
const DEADZONE := 0.18
const ACTION_DISC := 46.0
const SAFE_MARGIN := 20.0
const ZOOM_RADIUS := 33.0
const PILL_SIZE := Vector2(150.0, 44.0)
const CLUSTER_GAP := 8.0
## Four camera modes now, laid out 2x2 inside the SAME cluster footprint the
## single column used (150 wide, 170 tall), so nothing else on screen moves and
## AgentConsole's reserved band stays correct. 71x44 keeps every touch target at
## or above the 44px minimum on all three QA viewports.
const PILL_HALF := Vector2((PILL_SIZE.x - CLUSTER_GAP) * 0.5, PILL_SIZE.y)

## Pill TEXT metrics. The rects above are load-bearing -- mobile hit testing is
## verified against them (tools/probe_controls.gd) -- so when a subject name is
## too wide for its pill, the LABEL adapts and the rect never moves.
## PILL_TEXT_PAD is the inset that keeps glyphs off the rounded rim.
const PILL_FONT := 14
const PILL_FONT_HALF := 12
const PILL_FONT_MIN := 9
const PILL_TEXT_PAD := 10.0

## Bottom band this HUD reserves, and the pad's footprint. AgentConsole reads
## both so the activity feed can never end up underneath a control.
const CONTROL_BAND_H := 196.0
const CONTROL_PAD_W := 164.0

const ACTIVE_TINT := Color("8fd3c7")
const IDLE_TINT := Color(0.05, 0.07, 0.11, 0.62)

var _joystick_zone: Control
var _thumb: Control
var _active_touch := -1
var _stick_origin := Vector2.ZERO
var _pad_caption: Label
var _action_pivot: Control
var _pause_pivot: Control
var _cluster: Control
var _zoom_in: Control
var _zoom_out: Control
var _overview_pill: Control
var _island_pill: Control
var _steward_pill: Control
var _walk_pill: Control
## mode name (as World3D.set_camera_mode_named addresses it) -> pill.
var _pills: Dictionary = {}
var _mode_name := "overview"
var _follow_mode := false
## Held zoom buttons repeat instead of demanding one tap per step.
var _touch_seen := false
var _zoom_held := 0.0
var _zoom_accum := 0.0

func _ready() -> void:
    layer = 10
    # The pause button used to pause ITSELF: a paused tree stops delivering
    # gui_input to inherited nodes, so once paused nothing could unpause. The HUD
    # therefore always processes.
    process_mode = Node.PROCESS_MODE_ALWAYS
    _build_pause()
    _build_joystick()
    _build_camera_cluster()
    _build_action()
    set_camera_mode_name("overview")
    _reposition()
    get_viewport().size_changed.connect(_reposition)

## Called by World3D whenever the camera mode changes. Drives every piece of the
## HUD whose meaning depends on the mode. `subject` is what the mode is currently
## looking at, derived by World3D from authoritative state -- an island id for
## ISLAND, the steward's action target for STEWARD, empty for whole-world modes.
func set_camera_mode_name(mode_name: String, subject := "") -> void:
    _mode_name = mode_name
    var is_follow := mode_name == "follow"
    _follow_mode = is_follow
    if is_instance_valid(_action_pivot):
        _action_pivot.visible = is_follow
    if is_instance_valid(_pad_caption):
        _pad_caption.text = "MOVE" if is_follow else "PAN"
    for mode_key in _pills.keys():
        _tint(_pills[mode_key] as Control, str(mode_key) == mode_name)
    _label_subject(mode_name, subject)
    # Dropping the old intent matters: a pad released in one mode must not leave
    # the other mode's input latched on.
    _release_stick()
    _reposition()

## The active pill names its subject, because "ISLAND" alone does not say WHICH
## island you are looking at and STEWARD alone does not say whether Core actually
## gave the camera anything to point at.
func _label_subject(mode_name: String, subject: String) -> void:
    _set_pill_text(_island_pill, subject if mode_name == "island" and subject != "" else "ISLAND")
    var steward_text := "STEWARD"
    if mode_name == "steward":
        # An empty subject is not a failure to report: Core named no target, so
        # the pill says so and the camera holds the world frame.
        steward_text = subject if subject != "" else "NO TARGET"
    _set_pill_text(_steward_pill, steward_text)

func _set_pill_text(pill: Control, text: String) -> void:
    if not is_instance_valid(pill):
        return
    var label := pill.get_node_or_null("Text") as Label
    if label and label.text != text:
        label.text = text
        # Refit on every relabel, not just at build time: the subject is Core's,
        # so its LENGTH is Core's too. "ISLAND" (6 chars) becomes "MEADOW", and
        # "STEWARD" becomes "NO TARGET" or "MEADOW <-> FROST" (16).
        _fit_pill_label(pill, label)

## Make the text FIT its pill instead of losing its ends to clip_text.
##
## THE DEFECT THIS FIXES, and how it was found: in tablet portrait the STEWARD
## pill read "O TARGE" -- a 5x magnification of
## artifacts/visual-life/tablet-portrait/05-steward.png showed "NO TARGET"
## crossing its own rim and being clipped at BOTH ends. Half-width pills are
## PILL_HALF.x wide (71px) and Label.clip_text was the only guard, so any subject
## wider than the pill silently lost glyphs -- exactly the failure mode where the
## HUD is least readable and most load-bearing (it is naming what the camera is
## pointing at, or admitting that Core named nothing).
##
## The pill RECT cannot change: probe_controls.gd asserts hit targets stay at or
## above 44px and AgentConsole reserves a band computed from PILL_SIZE. So the
## label adapts in two stages, both bounded:
##   1. shrink the font toward PILL_FONT_MIN while the string is too wide;
##   2. if it STILL does not fit -- "MEADOW <-> FROST" at 9px does not fit 61px
##      -- wrap it. AUTOWRAP_WORD_SMART guarantees no line exceeds the width,
##      and two 9px lines sit inside a 44px pill.
## clip_text stays on as the backstop it was: after this, it should never have
## anything left to clip.
func _fit_pill_label(pill: Control, label: Label) -> void:
    var room := pill.size.x - PILL_TEXT_PAD
    if room <= 0.0:
        return
    var font: Font = label.get_theme_font("font")
    if font == null:
        return
    # ALWAYS start from the pill's designed size, never from whatever the last
    # fit left behind: shrinking is one-way, so a pill that had held
    # "MEADOW <-> FROST" would otherwise render the next "ISLAND" at 9px forever.
    var size: int = int(label.get_meta("base_font_size", PILL_FONT))
    while size > PILL_FONT_MIN and font.get_string_size(
            label.text, HORIZONTAL_ALIGNMENT_CENTER, -1.0, size).x > room:
        size -= 1
    label.add_theme_font_size_override("font_size", size)
    var still_wide: bool = font.get_string_size(
        label.text, HORIZONTAL_ALIGNMENT_CENTER, -1.0, size).x > room
    label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART if still_wide else TextServer.AUTOWRAP_OFF

## Retained for callers that only know the old two-mode HUD.
func set_follow_mode(is_follow: bool) -> void:
    set_camera_mode_name("follow" if is_follow else "overview")

func _tint(pill: Control, active: bool) -> void:
    if not is_instance_valid(pill):
        return
    var bg := pill.get_node_or_null("BG") as Panel
    if bg == null:
        return
    var style := bg.get_theme_stylebox("panel") as StyleBoxFlat
    if style == null:
        return
    style.bg_color = Color(ACTIVE_TINT.r, ACTIVE_TINT.g, ACTIVE_TINT.b, 0.88) if active else IDLE_TINT
    style.border_color = Color(1.0, 1.0, 1.0, 0.30 if active else 0.16)
    var label := pill.get_node_or_null("Text") as Label
    if label:
        label.add_theme_color_override("font_color", Color("11201f") if active else Color("dfe6f2"))

func _reposition() -> void:
    var v := get_viewport().get_visible_rect().size
    var portrait := (v.x / maxf(1.0, v.y)) < 1.05
    # Portrait reserves the bottom band for controls and the top for the HUD, so
    # the world keeps the middle of the screen.
    var margin := SAFE_MARGIN + (16.0 if portrait else 0.0)
    if is_instance_valid(_joystick_zone):
        _joystick_zone.position = Vector2(margin, v.y - _joystick_zone.size.y - margin)
        _stick_origin = _joystick_zone.size / 2.0
        if is_instance_valid(_pad_caption):
            # Portrait stacks the activity feed directly above the control band,
            # so a caption above the pad overlapped it (measured: feed ended at
            # y=970, caption ran 960-977). Below the pad there is clear space in
            # portrait; in landscape the feed sits to the RIGHT of the pad, so
            # above is clear there and keeps the caption off the screen edge.
            _pad_caption.position = _joystick_zone.position + (
                Vector2(2.0, _joystick_zone.size.y + 2.0) if portrait else Vector2(0.0, -20.0))
    if is_instance_valid(_cluster):
        _cluster.position = Vector2(v.x - _cluster.size.x - margin, v.y - _cluster.size.y - margin)
    if is_instance_valid(_action_pivot):
        # Left of the camera cluster, so the two never overlap on a narrow screen.
        var cluster_w: float = _cluster.size.x if is_instance_valid(_cluster) else 0.0
        _action_pivot.position = Vector2(
            maxf(margin + CONTROL_PAD_W + 10.0, v.x - cluster_w - margin - _action_pivot.size.x - 12.0),
            v.y - _action_pivot.size.y - margin)
    if is_instance_valid(_pause_pivot):
        _pause_pivot.position = Vector2(v.x - _pause_pivot.size.x - 16.0, 16.0)

# ---------------------------------------------------------------------------
# WIDGET BUILDERS
# ---------------------------------------------------------------------------
func _disc(node_name: String, radius: float, fill: Color) -> Control:
    var pivot := Control.new()
    pivot.name = node_name
    pivot.mouse_filter = Control.MOUSE_FILTER_STOP
    pivot.size = Vector2(radius * 2.0, radius * 2.0)
    var ring := CircleScript.new()
    ring.radius = radius
    ring.color = fill
    ring.size = pivot.size
    ring.mouse_filter = Control.MOUSE_FILTER_IGNORE
    pivot.add_child(ring)
    return pivot

func _glyph(parent: Control, text: String, font_size: int, color: Color) -> Label:
    var label := Label.new()
    label.name = "Text"
    label.text = text
    label.set_anchors_preset(Control.PRESET_FULL_RECT)
    label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
    label.add_theme_font_size_override("font_size", font_size)
    label.add_theme_color_override("font_color", color)
    label.mouse_filter = Control.MOUSE_FILTER_IGNORE
    parent.add_child(label)
    return label

func _pill(node_name: String, text: String, pill_size := PILL_SIZE, font_size := PILL_FONT) -> Control:
    var pivot := Control.new()
    pivot.name = node_name
    pivot.mouse_filter = Control.MOUSE_FILTER_STOP
    pivot.size = pill_size
    var bg := Panel.new()
    bg.name = "BG"
    bg.size = pill_size
    bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
    var style := StyleBoxFlat.new()
    style.bg_color = IDLE_TINT
    style.border_color = Color(1.0, 1.0, 1.0, 0.16)
    style.set_border_width_all(1)
    style.set_corner_radius_all(int(pill_size.y * 0.5))
    bg.add_theme_stylebox_override("panel", style)
    pivot.add_child(bg)
    var label := _glyph(pivot, text, font_size, Color("dfe6f2"))
    # Half-width pills must clip rather than spill their text over the rim. The
    # text box is inset from the pivot so glyphs (and wrap points) stay off the
    # rounded ends WITHOUT shrinking the touch target, which is the pivot.
    label.clip_text = true
    label.set_offset(SIDE_LEFT, PILL_TEXT_PAD * 0.5)
    label.set_offset(SIDE_RIGHT, -PILL_TEXT_PAD * 0.5)
    label.set_meta("base_font_size", font_size)
    _fit_pill_label(pivot, label)
    return pivot

func _build_pause() -> void:
    _pause_pivot = _disc("Pause", 26.0, Color(0.05, 0.07, 0.11, 0.62))
    _pause_pivot.size = Vector2(60, 60)
    _pause_pivot.get_child(0).size = _pause_pivot.size
    _glyph(_pause_pivot, "II", 22, Color("e8ecf4"))
    _pause_pivot.gui_input.connect(_on_pause_input)
    add_child(_pause_pivot)

## Camera cluster: zoom pair on top, mode pills under it. Right-aligned so the
## thumb reaches it on a tablet held in either orientation.
func _build_camera_cluster() -> void:
    _cluster = Control.new()
    _cluster.name = "CameraCluster"
    _cluster.mouse_filter = Control.MOUSE_FILTER_IGNORE
    var disc := ZOOM_RADIUS * 2.0
    # Same footprint as the pre-grid single column: two 44px rows plus one gap.
    _cluster.size = Vector2(PILL_SIZE.x, disc + CLUSTER_GAP + PILL_HALF.y * 2.0 + CLUSTER_GAP)
    add_child(_cluster)

    _zoom_out = _disc("ZoomOut", ZOOM_RADIUS, Color(0.05, 0.07, 0.11, 0.62))
    _glyph(_zoom_out, "–", 30, Color("e8ecf4"))
    _zoom_out.position = Vector2(PILL_SIZE.x - disc * 2.0 - CLUSTER_GAP, 0.0)
    # step > 0 widens the frame.
    _zoom_out.gui_input.connect(_on_zoom_input.bind(1.0))
    _cluster.add_child(_zoom_out)

    _zoom_in = _disc("ZoomIn", ZOOM_RADIUS, Color(0.05, 0.07, 0.11, 0.62))
    _glyph(_zoom_in, "+", 26, Color("e8ecf4"))
    _zoom_in.position = Vector2(PILL_SIZE.x - disc, 0.0)
    _zoom_in.gui_input.connect(_on_zoom_input.bind(-1.0))
    _cluster.add_child(_zoom_in)

    # 2x2: the two framings that answer "what is happening to the civilization?"
    # and "what is happening here?" on top; the two that answer "what is the agent
    # doing?" and "let me walk there myself" underneath.
    var row_a := disc + CLUSTER_GAP
    var row_b := row_a + PILL_HALF.y + CLUSTER_GAP
    var col_b := PILL_HALF.x + CLUSTER_GAP
    _overview_pill = _add_mode_pill("OverviewPill", "WORLD", "overview", Vector2(0.0, row_a))
    _island_pill = _add_mode_pill("IslandPill", "ISLAND", "island", Vector2(col_b, row_a))
    _steward_pill = _add_mode_pill("StewardPill", "STEWARD", "steward", Vector2(0.0, row_b))
    _walk_pill = _add_mode_pill("WalkPill", "WALK", "follow", Vector2(col_b, row_b))

func _add_mode_pill(node_name: String, text: String, mode_name: String, at: Vector2) -> Control:
    var pill := _pill(node_name, text, PILL_HALF, PILL_FONT_HALF)
    pill.position = at
    pill.gui_input.connect(_on_mode_input.bind(mode_name))
    _cluster.add_child(pill)
    _pills[mode_name] = pill
    return pill

func _build_joystick() -> void:
    _pad_caption = Label.new()
    _pad_caption.name = "PadCaption"
    _pad_caption.text = "PAN"
    # Rendering the first overview shot showed this caption was effectively
    # invisible: 11px of #9fb0c6 sits on bright sunlit water. Every HUD label that
    # floats directly over the world needs an outline, not just a colour.
    _pad_caption.add_theme_font_size_override("font_size", 12)
    _pad_caption.add_theme_color_override("font_color", Color("e4edf8"))
    _pad_caption.add_theme_constant_override("outline_size", 5)
    _pad_caption.add_theme_color_override("font_outline_color", Color(0.02, 0.04, 0.07, 0.92))
    _pad_caption.mouse_filter = Control.MOUSE_FILTER_IGNORE
    add_child(_pad_caption)

    _joystick_zone = Control.new()
    _joystick_zone.name = "JoystickZone"
    _joystick_zone.mouse_filter = Control.MOUSE_FILTER_STOP
    _joystick_zone.size = Vector2(JOY_RADIUS * 2.0, JOY_RADIUS * 2.0)
    _joystick_zone.gui_input.connect(_on_joystick_input)
    add_child(_joystick_zone)

    var base := CircleScript.new()
    base.radius = JOY_RADIUS
    base.color = Color(0.04, 0.06, 0.09, 0.42)
    base.size = _joystick_zone.size
    _joystick_zone.add_child(base)

    var rim := CircleScript.new()
    rim.radius = JOY_RADIUS
    rim.color = Color("eef4f6", 0.22)
    rim.size = _joystick_zone.size
    _joystick_zone.add_child(rim)

    _thumb = Control.new()
    _thumb.name = "Thumb"
    _thumb.size = Vector2(JOY_THUMB_RADIUS * 2.0, JOY_THUMB_RADIUS * 2.0)
    _thumb.mouse_filter = Control.MOUSE_FILTER_IGNORE
    var thumb_disc := CircleScript.new()
    thumb_disc.radius = JOY_THUMB_RADIUS
    thumb_disc.color = Color("8fd3c7")
    thumb_disc.size = _thumb.size
    _thumb.add_child(thumb_disc)
    _joystick_zone.add_child(_thumb)
    _reset_thumb()

func _build_action() -> void:
    _action_pivot = _disc("Action", ACTION_DISC, Color(0.05, 0.07, 0.11, 0.55))
    var fill := CircleScript.new()
    fill.radius = ACTION_DISC * 0.76
    fill.color = Color("f4c878")
    fill.size = _action_pivot.size
    _action_pivot.add_child(fill)
    _glyph(_action_pivot, "GATHER", 14, Color("5a3d10"))
    _action_pivot.gui_input.connect(_on_action_input)
    add_child(_action_pivot)

# ---------------------------------------------------------------------------
# INPUT
# ---------------------------------------------------------------------------
func _reset_thumb() -> void:
    if is_instance_valid(_thumb) and is_instance_valid(_joystick_zone):
        _thumb.position = (_joystick_zone.size / 2.0) - Vector2(JOY_THUMB_RADIUS, JOY_THUMB_RADIUS)

func _on_joystick_input(event: InputEvent) -> void:
    _note_device(event)
    # Press requires no active touch; release must match the ACTIVE index, or a
    # lifted finger can never reach _release_stick() and the intent sticks on.
    if event is InputEventScreenTouch:
        if event.pressed and _active_touch == -1:
            _active_touch = event.index
            _stick_origin = event.position
        elif not event.pressed and event.index == _active_touch:
            _release_stick()
    elif event is InputEventScreenDrag and event.index == _active_touch:
        _update_stick(event.position)
    elif not _touch_seen and event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
        if event.pressed and _active_touch == -1:
            _active_touch = -2
            _stick_origin = event.position
        elif not event.pressed and _active_touch == -2:
            _release_stick()
    elif event is InputEventMouseMotion and _active_touch == -2:
        _update_stick(event.position)

## One pad, two meanings. The mode decides which authoritative-free intent the
## pad feeds: walking the Overseer, or panning the observer camera.
func _update_stick(pos: Vector2) -> void:
    var clamped := (pos - _stick_origin).limit_length(JOY_RADIUS)
    _thumb.position = (_joystick_zone.size / 2.0) + clamped - Vector2(JOY_THUMB_RADIUS, JOY_THUMB_RADIUS)
    var direction := clamped / JOY_RADIUS
    if direction.length() < DEADZONE:
        direction = Vector2.ZERO
    if _follow_mode:
        AstrixInput.set_virtual_direction(direction)
    else:
        AstrixInput.set_camera_pan(direction)

func _release_stick() -> void:
    _active_touch = -1
    _reset_thumb()
    AstrixInput.clear_virtual_direction()
    AstrixInput.clear_camera_pan()

func _on_zoom_input(event: InputEvent, direction: float) -> void:
    if _is_press(event):
        AstrixInput.request_camera_zoom(direction)
        _zoom_held = direction
        _zoom_accum = 0.0
        _pulse(_zoom_in if direction < 0.0 else _zoom_out)
    elif _is_release(event):
        _zoom_held = 0.0

## Held zoom repeats after a short delay, so crossing the whole zoom range is one
## press rather than seven taps.
func _process(delta: float) -> void:
    if is_zero_approx(_zoom_held):
        return
    _zoom_accum += delta
    if _zoom_accum >= 0.26:
        _zoom_accum -= 0.09
        AstrixInput.request_camera_zoom(_zoom_held)

func _on_mode_input(event: InputEvent, mode_name: String) -> void:
    if _is_press(event):
        AstrixInput.request_camera_mode(mode_name)
        _pulse(_pills.get(mode_name, _overview_pill) as Control)

func _on_action_input(event: InputEvent) -> void:
    if _is_press(event):
        AstrixInput.request_interact()
        _pulse(_action_pivot)

func _on_pause_input(event: InputEvent) -> void:
    if _is_press(event):
        _pulse(_pause_pivot)
        get_tree().paused = not get_tree().paused

## Godot's `emulate_mouse_from_touch` is on by default, and it has to stay on:
## `Button` (APPROVE / REJECT in ApprovalGate) only reacts to mouse events, so
## without emulation those are dead under a finger. The cost is that every touch
## also arrives a second time as a synthetic mouse press, which made every
## tap-toggle control fire TWICE per tap. Measured with tools/probe_controls.gd:
## pause switched on and straight back off (so the world could never be paused),
## and a single zoom tap jumped two steps.
##
## Once a real touch has been seen we treat this as a touch device and ignore the
## emulated mouse presses. A desktop never emits touch, so the mouse path there is
## untouched. The latch is set from the touch event itself, which Godot dispatches
## BEFORE the mouse event it synthesises, so even the very first tap is correct.
func _note_device(event: InputEvent) -> void:
    if event is InputEventScreenTouch or event is InputEventScreenDrag:
        _touch_seen = true

func _is_press(event: InputEvent) -> bool:
    _note_device(event)
    if event is InputEventScreenTouch:
        return event.pressed
    return not _touch_seen and event is InputEventMouseButton \
        and event.button_index == MOUSE_BUTTON_LEFT and event.pressed

func _is_release(event: InputEvent) -> bool:
    _note_device(event)
    if event is InputEventScreenTouch:
        return not event.pressed
    return not _touch_seen and event is InputEventMouseButton \
        and event.button_index == MOUSE_BUTTON_LEFT and not event.pressed

func _pulse(node: Control) -> void:
    if not is_instance_valid(node):
        return
    var tween := create_tween()
    node.scale = Vector2(0.88, 0.88)
    tween.tween_property(node, "scale", Vector2.ONE, 0.16).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
