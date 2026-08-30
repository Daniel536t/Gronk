extends CanvasLayer
## Mobile touch controls + minimal HUD, matching the pastel miniature style.
## Keyboard still works alongside these: AstrixInput merges any active source,
## so the player controller never cares where input came from.

const CircleScript := preload("res://scripts/Circle.gd")

const JOY_RADIUS := 112.0
const JOY_THUMB_RADIUS := 52.0
const DEADZONE := 0.22
const ACTION_DISC := 58.0
const SAFE_MARGIN := 26.0

var _joystick_zone: Control
var _joystick_base: Circle
var _joystick_rim: Circle
var _thumb: Control
var _thumb_disc: Circle
var _active_touch := -1
var _stick_origin := Vector2.ZERO
var _action: Circle
var _action_pivot: Control
var _pause_pivot: Control

func _ready() -> void:
    _build_title()
    _build_pause()
    _build_joystick()
    _build_action()
    _reposition()
    get_viewport().size_changed.connect(_reposition)

func _reposition() -> void:
    var v := get_viewport().get_visible_rect().size
    if is_instance_valid(_joystick_zone):
        _joystick_zone.position = Vector2(SAFE_MARGIN, v.y - _joystick_zone.size.y - SAFE_MARGIN)
        _stick_origin = _joystick_zone.size / 2.0
    if is_instance_valid(_action_pivot):
        _action_pivot.position = Vector2(v.x - _action_pivot.size.x - SAFE_MARGIN,
                                         v.y - _action_pivot.size.y - SAFE_MARGIN)

# ---------------------------------------------------------------------------
# HUD chrome
# ---------------------------------------------------------------------------
func _build_title() -> void:
    var panel := CircleScript.new()
    panel.radius = 22.0
    panel.color = Color(0.1, 0.14, 0.16, 0.6)
    panel.size = Vector2(160, 52)
    panel.set_anchors_preset(Control.PRESET_TOP_LEFT)
    panel.position = Vector2(14, 14)
    add_child(panel)
    var label := Label.new()
    label.text = "ASTRIX"
    label.set_anchors_preset(Control.PRESET_TOP_LEFT)
    label.position = Vector2(34, 25)
    label.add_theme_font_size_override("font_size", 28)
    label.add_theme_color_override("font_color", Color("ffffff"))
    add_child(label)

func _build_pause() -> void:
    _pause_pivot = Control.new()
    _pause_pivot.name = "Pause"
    _pause_pivot.set_anchors_preset(Control.PRESET_TOP_RIGHT)
    _pause_pivot.size = Vector2(76, 76)
    _pause_pivot.position = Vector2(-(76 + 16), 16)
    _pause_pivot.gui_input.connect(_on_pause_input)
    _pause_pivot.mouse_filter = Control.MOUSE_FILTER_STOP
    add_child(_pause_pivot)
    var disc := CircleScript.new()
    disc.radius = 34.0
    disc.color = Color(0.1, 0.14, 0.16, 0.6)
    disc.size = _pause_pivot.size
    _pause_pivot.add_child(disc)
    var icon := Label.new()
    icon.text = "⏸"
    icon.set_anchors_preset(Control.PRESET_FULL_RECT)
    icon.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    icon.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
    icon.add_theme_font_size_override("font_size", 34)
    icon.add_theme_color_override("font_color", Color("ffffff"))
    _pause_pivot.add_child(icon)

# ---------------------------------------------------------------------------
# Virtual joystick (bottom-left) — high contrast so it is plainly visible.
# ---------------------------------------------------------------------------
func _build_joystick() -> void:
    _joystick_zone = Control.new()
    _joystick_zone.name = "JoystickZone"
    _joystick_zone.mouse_filter = Control.MOUSE_FILTER_STOP
    var zone := JOY_RADIUS * 2.0
    _joystick_zone.size = Vector2(zone, zone)
    _joystick_zone.gui_input.connect(_on_joystick_input)
    add_child(_joystick_zone)

    _joystick_base = CircleScript.new()
    _joystick_base.radius = JOY_RADIUS
    _joystick_base.color = Color(0.05, 0.08, 0.1, 0.5)
    _joystick_base.size = _joystick_zone.size
    _joystick_base.mouse_filter = Control.MOUSE_FILTER_IGNORE
    _joystick_zone.add_child(_joystick_base)

    _joystick_rim = CircleScript.new()
    _joystick_rim.radius = JOY_RADIUS
    _joystick_rim.color = Color("eef4f6", 0.28)
    _joystick_rim.size = _joystick_zone.size
    _joystick_rim.mouse_filter = Control.MOUSE_FILTER_IGNORE
    _joystick_zone.add_child(_joystick_rim)

    _thumb = Control.new()
    _thumb.name = "Thumb"
    _thumb.size = Vector2(JOY_THUMB_RADIUS * 2.0, JOY_THUMB_RADIUS * 2.0)
    _thumb.mouse_filter = Control.MOUSE_FILTER_IGNORE
    _thumb_disc = CircleScript.new()
    _thumb_disc.radius = JOY_THUMB_RADIUS
    _thumb_disc.color = Color("8fd3c7")
    _thumb_disc.size = _thumb.size
    _thumb.add_child(_thumb_disc)
    _joystick_zone.add_child(_thumb)
    _reset_thumb()

func _reset_thumb() -> void:
    _thumb.position = (_joystick_zone.size / 2.0) - Vector2(JOY_THUMB_RADIUS, JOY_THUMB_RADIUS)

func _on_joystick_input(event: InputEvent) -> void:
    # Press requires no active touch; release must match the ACTIVE index, or a
    # lifted finger can never reach _release_stick() and virtual movement sticks.
    if event is InputEventScreenTouch:
        if event.pressed and _active_touch == -1:
            _active_touch = event.index
            _stick_origin = event.position
        elif not event.pressed and event.index == _active_touch:
            _release_stick()
    elif event is InputEventScreenDrag and event.index == _active_touch:
        _update_stick(event.position)
    elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
        if event.pressed and _active_touch == -1:
            # Desktop/mouse parity so Playwright + desktop users can drive it too.
            _active_touch = -2
            _stick_origin = event.position
        elif not event.pressed and _active_touch == -2:
            _release_stick()
    elif event is InputEventMouseMotion and _active_touch == -2:
        _update_stick(event.position)

func _update_stick(pos: Vector2) -> void:
    var origin := _stick_origin
    var vec: Vector2 = pos - origin
    var clamped := vec.limit_length(JOY_RADIUS)
    _thumb.position = (_joystick_zone.size / 2.0) + clamped - Vector2(JOY_THUMB_RADIUS, JOY_THUMB_RADIUS)
    var direction := clamped / JOY_RADIUS
    AstrixInput.set_virtual_direction(direction if direction.length() >= DEADZONE else Vector2.ZERO)

func _release_stick() -> void:
    _active_touch = -1
    _reset_thumb()
    AstrixInput.clear_virtual_direction()

# ---------------------------------------------------------------------------
# Interact / action button (bottom-right) — large, obvious, gold.
# ---------------------------------------------------------------------------
func _build_action() -> void:
    _action_pivot = Control.new()
    _action_pivot.name = "Action"
    _action_pivot.mouse_filter = Control.MOUSE_FILTER_STOP
    _action_pivot.size = Vector2(ACTION_DISC * 2.0, ACTION_DISC * 2.0)
    _action_pivot.gui_input.connect(_on_action_input)
    add_child(_action_pivot)

    var ring := CircleScript.new()
    ring.radius = ACTION_DISC
    ring.color = Color(0.1, 0.14, 0.16, 0.6)
    ring.size = _action_pivot.size
    _action_pivot.add_child(ring)

    _action = CircleScript.new()
    _action.radius = ACTION_DISC * 0.78
    _action.color = Color("f4c878")
    _action.size = _action_pivot.size
    _action.mouse_filter = Control.MOUSE_FILTER_IGNORE
    _action_pivot.add_child(_action)

    var icon := Label.new()
    icon.text = "✦"
    icon.set_anchors_preset(Control.PRESET_FULL_RECT)
    icon.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    icon.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
    icon.add_theme_font_size_override("font_size", 56)
    icon.add_theme_color_override("font_color", Color("6b4a1f"))
    _action_pivot.add_child(icon)

func _on_action_input(event: InputEvent) -> void:
    if _is_press(event):
        AstrixInput.request_interact()
        _pulse(_action_pivot)

func _on_pause_input(event: InputEvent) -> void:
    if _is_press(event):
        _pulse(_pause_pivot)
        _toggle_pause()

func _toggle_pause() -> void:
    get_tree().paused = not get_tree().paused

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
func _is_press(event: InputEvent) -> bool:
    return (event is InputEventScreenTouch and event.pressed) or \
           (event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed)

func _pulse(node: Control) -> void:
    var tween := create_tween()
    node.scale = Vector2(0.86, 0.86)
    tween.tween_property(node, "scale", Vector2.ONE, 0.16).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)

