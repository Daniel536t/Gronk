extends Node
## Input abstraction shared by desktop keyboard and the mobile virtual controls.
## Any source (keyboard, virtual joystick, or the on-screen button) maps to the
## same gameplay actions, so the player controller never cares where input came
## from.

signal interact_triggered

var virtual_direction := Vector2.ZERO
var virtual_run := false

func set_virtual_direction(direction: Vector2) -> void:
    virtual_direction = direction.limit_length(1.0)

func clear_virtual_direction() -> void:
    virtual_direction = Vector2.ZERO

func set_virtual_run(enabled: bool) -> void:
    virtual_run = enabled

func movement_vector() -> Vector2:
    var keyboard := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
    return keyboard if keyboard.length_squared() > 0.0 else virtual_direction

func is_running() -> bool:
    return Input.is_action_pressed("run") or virtual_run

func _process(_delta: float) -> void:
    if Input.is_action_just_pressed("interact"):
        interact_triggered.emit()

## Called by the mobile action button.
func request_interact() -> void:
    interact_triggered.emit()