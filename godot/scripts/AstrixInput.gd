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

# ===========================================================================
# CAMERA CONTROL (observer)
# ===========================================================================
## The camera cluster lives in MobileHUD but the camera lives in World3D. Rather
## than have the HUD reach into the scene tree by node path, both sides talk
## through this autoload — the same indirection the movement joystick already
## uses. World3D consumes `camera_pan()` every frame and connects to the signals.

signal camera_zoom_requested(step: float)
signal camera_mode_requested(mode_name: String)

var camera_pan_direction := Vector2.ZERO

## Screen-space pan intent: +x screen-right, +y screen-down. Set by the HUD's
## directional pad while the camera is an observer camera (not FOLLOW).
func set_camera_pan(direction: Vector2) -> void:
    camera_pan_direction = direction.limit_length(1.0)

func clear_camera_pan() -> void:
    camera_pan_direction = Vector2.ZERO

## Keyboard arrows pan the observer camera on desktop; the virtual pad feeds
## `camera_pan_direction`. Arrow keys are read directly (not via the input map)
## so no new project.godot actions are required for the observer controls.
func camera_pan() -> Vector2:
    var keys := Vector2(
        float(Input.is_key_pressed(KEY_RIGHT)) - float(Input.is_key_pressed(KEY_LEFT)),
        float(Input.is_key_pressed(KEY_DOWN)) - float(Input.is_key_pressed(KEY_UP)),
    )
    return keys.limit_length(1.0) if keys.length_squared() > 0.0 else camera_pan_direction

## step < 0 zooms IN (tighter frame), step > 0 zooms OUT.
func request_camera_zoom(step: float) -> void:
    camera_zoom_requested.emit(step)

## "overview" | "observatory" | "archipelago" | "follow"
func request_camera_mode(mode_name: String) -> void:
    camera_mode_requested.emit(mode_name)
