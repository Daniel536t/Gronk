extends CanvasLayer
## Mobile touch controls + minimal HUD, matching the pastel miniature style.
## Keyboard still works alongside these: AstrixInput merges any active source,
## so gameplay never cares where input came from.

const JOY_RADIUS := 96.0
const JOY_THUMB_RADIUS := 44.0
const DEADZONE := 0.22
const ACTION_DISC := 46.0

var _joystick_zone: Control
var _thumb: Control
var _active_touch := -1
var _stick_origin := Vector2.ZERO
var _action_pivot: Control
var _pause_pivot: Control

func _ready() -> void:
    _build_title()
    _build_pause()
    _build_joystick()
    _build_action()
    _apply_touch_emphasis()

# ---------------------------------------------------------------------------
# HUD chrome
# ---------------------------------------------------------------------------
func _build_title() -> void:
    var shrink := ColorRect.new()
    shrink.color = Color(0.1, 0.14, 0.16, 0.35)
    shrink.size = Vector2(134, 44)
    shrink.set_anchors_preset(Control.PRESET_TOP_LEFT)
    shrink.position = Vector2(14, 14)
    add_child(shrink)
    var label := Label.new()
    label.text = "ASTRIX"
    label.set_anchors_preset(Control.PRESET_TOP_LEFT)
    label.position = Vector2(26, 22)
    label.add_theme_font_size_override("font_size", 26)
    label.add_theme_color_override("font_color", Color("f4f8f5"))
    add_child(label)

func _build_pause() -> void:
    _pause_pivot = Control.new()
    _pause_pivot.name = "Pause"
    _pause_pivot.set_anchors_preset(Control.PRESET_TOP_RIGHT)
    _pause_pivot.size = Vector2(64, 64)
    _pause_pivot.position = Vector2(-(64 + 16), 16)
    _pause_pivot.pivot_offset = Vector2(32, 32)
    _pause_pivot.gui_input.connect(_on_pause_input)
    add_child(_pause_pivot)
    var disc := _disk(32, Color("e7eef2"))
    _pause_pivot.add_child(disc)
    var icon := Label.new()
    icon.text = "⏸"
    icon.set_anchors_preset(Control.PRESET_FULL_RECT)
    icon.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    icon.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
    icon.add_theme_font_size_override("font_size", 30)
    icon.add_theme_color_override("font_color", Color("5a6b74"))
    _pause_pivot.add_child(icon)

# ---------------------------------------------------------------------------
# Virtual joystick (bottom-left)
# ---------------------------------------------------------------------------
func _build_joystick() -> void:
    _joystick_zone = Control.new()
    _joystick_zone.name = "JoystickZone"
    _joystick_zone.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
    _joystick_zone.size = Vector2(JOY_RADIUS * 2.6, JOY_RADIUS * 2.6)
    _joystick_zone.position = Vector2(12, -14)
    _joystick_zone.gui_input.connect(_on_joystick_input)
    add_child(_joystick_zone)

    var base := _disk(JOY_RADIUS, Color(1, 1, 1, 0.16))
    base.position = Vector2(JOY_RADIUS, JOY_RADIUS) - Vector2(JOY_RADIUS, JOY_RADIUS)
    _joystick_zone.add_child(base)

    _thumb = Control.new()
    _thumb.set_anchors_preset(Control.PRESET_TOP_LEFT)
    _thumb.size = Vector2(JOY_THUMB_RADIUS * 2, JOY_THUMB_RADIUS * 2)
    _thumb.position = Vector2(JOY_RADIUS - JOY_THUMB_RADIUS, JOY_RADIUS - JOY_THUMB_RADIUS)
    var thumb_ring := _disk(JOY_THUMB_RADIUS, Color("eef4f6"))
    _thumb.add_child(thumb_ring)
    _joystick_zone.add_child(_thumb)

func _on_joystick_input(event: InputEvent) -> void:
    if event is InputEventScreenTouch:
        if event.pressed and _active_touch == -1:
            _active_touch = event.index
            _stick_origin = Vector2(JOY_RADIUS, JOY_RADIUS)
        elif not event.pressed and event.index == _active_touch:
            _release_stick()
    elif event is InputEventScreenDrag and event.index == _active_touch:
        var vec: Vector2 = event.position - _stick_origin
        var clamped := vec.limit_length(JOY_RADIUS)
        _thumb.position = Vector2(JOY_RADIUS, JOY_RADIUS) + clamped - Vector2(JOY_THUMB_RADIUS, JOY_THUMB_RADIUS)
        var direction := clamped / JOY_RADIUS
        AstrixInput.set_virtual_direction(direction if direction.length() >= DEADZONE else Vector2.ZERO)

func _release_stick() -> void:
    _active_touch = -1
    _thumb.position = Vector2(JOY_RADIUS - JOY_THUMB_RADIUS, JOY_RADIUS - JOY_THUMB_RADIUS)
    AstrixInput.clear_virtual_direction()

# ---------------------------------------------------------------------------
# Interact / action button (bottom-right)
# ---------------------------------------------------------------------------
func _build_action() -> void:
    _action_pivot = Control.new()
    _action_pivot.name = "Action"
    _action_pivot.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
    _action_pivot.size = Vector2(ACTION_DISC * 2, ACTION_DISC * 2)
    _action_pivot.position = Vector2(-(ACTION_DISC * 2 + 16), -(ACTION_DISC * 2 + 16))
    _action_pivot.pivot_offset = Vector2(ACTION_DISC, ACTION_DISC)
    _action_pivot.gui_input.connect(_on_action_input)
    add_child(_action_pivot)

    var ring := _disk(ACTION_DISC, Color(1, 1, 1, 0.14))
    _action_pivot.add_child(ring)
    var disc := _disk(ACTION_DISC * 0.78, Color("f4c878"))
    _action_pivot.add_child(disc)
    var icon := Label.new()
    icon.text = "✦"
    icon.set_anchors_preset(Control.PRESET_FULL_RECT)
    icon.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    icon.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
    icon.add_theme_font_size_override("font_size", 44)
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

func _disk(radius: float, color: Color) -> ColorRect:
    var rect := ColorRect.new()
    rect.color = color
    rect.size = Vector2(radius * 2, radius * 2)
    rect.position = Vector2.ZERO
    rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
    return rect

func _apply_touch_emphasis() -> void:
    var touch := astrix_is_touch()
    _joystick_zone.modulate.a = 1.0 if touch else 0.45
    _action_pivot.modulate.a = 1.0 if touch else 0.45

func astrix_is_touch() -> bool:
    if OS.has_feature("web"):
        return bool(JavaScriptBridge.eval("matchMedia('(pointer:coarse)').matches"))
    return false