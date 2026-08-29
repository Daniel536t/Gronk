extends CharacterBody3D
class_name AstrixPlayer3D
## Local presentation/controller layer. Movement is a thin, responsive wrapper
## around the shared AstrixInput actions; authoritative networking remains in
## the existing GameClient and is intentionally not rewritten here.

signal swimming_changed(is_swimming: bool)
signal inventory_changed(inventory: Dictionary)
signal gathered(resource_id: String)

@export var move_speed: float = 7.0
@export var run_multiplier: float = 1.5
@export var acceleration: float = 18.0
@export var deceleration: float = 24.0
@export var water_level: float = -0.05

var inventory: Dictionary = {"wood": 0, "stone": 0, "food": 0, "water": 0, "crystal": 0}
var is_swimming: bool = false

var _visual: Node3D
var _body_group: Node3D        # animated (bob/lean/sway) part of the character
var _shadow: MeshInstance3D
var _animation_time: float = 0.0
var _walk_phase := 0.0
var _idle_bob := 0.0
var _move_amount := 0.0

func _ready() -> void:
    _visual = _build_visual()
    add_child(_visual)

func _physics_process(delta: float) -> void:
    var input_vector := AstrixInput.movement_vector()
    var running := AstrixInput.is_running()
    var speed := move_speed * (run_multiplier if running else 1.0)
    var desired := Vector3(input_vector.x, 0.0, input_vector.y) * speed
    var rate := acceleration if desired.length_squared() > 0.0 else deceleration
    velocity.x = move_toward(velocity.x, desired.x, rate * delta)
    velocity.z = move_toward(velocity.z, desired.z, rate * delta)
    move_and_slide()
    _update_swimming(delta)
    _animate(delta, desired)

func add_resource(resource_id: String, amount: int = 1) -> void:
    if not inventory.has(resource_id) or amount <= 0:
        return
    inventory[resource_id] = int(inventory[resource_id]) + amount
    inventory_changed.emit(inventory.duplicate(true))
    gathered.emit(resource_id)

func gather_nearest(max_distance: float = 2.5) -> Dictionary:
    var nearest: ResourceNode3D
    var nearest_distance := max_distance
    for node in get_tree().get_nodes_in_group("resource_nodes"):
        if node is ResourceNode3D:
            var distance := global_position.distance_to(node.global_position)
            if distance < nearest_distance and not node.gathered:
                nearest = node
                nearest_distance = distance
    if not nearest:
        return {"ok": false, "error": "no resource nearby"}
    var result := nearest.gather()
    if bool(result.get("ok", false)):
        add_resource(nearest.resource_id, nearest.amount)
    return result

func _update_swimming(delta: float) -> void:
    var should_swim := global_position.y <= water_level
    if should_swim != is_swimming:
        is_swimming = should_swim
        swimming_changed.emit(is_swimming)
    if is_swimming:
        _animation_time += delta
        global_position.y = water_level + 0.12 + sin(_animation_time * 3.0) * 0.05
        _visual.scale.y = lerpf(_visual.scale.y, 0.86, delta * 5.0)
    else:
        _visual.scale.y = lerpf(_visual.scale.y, 1.0, delta * 5.0)

# Procedural animation: readable bob, stride and lean that scale with speed.
# Idle stays calm (breathing only) so a standing player never looks like walking.
func _animate(delta: float, desired: Vector3) -> void:
    _animation_time += delta
    var speed := Vector2(desired.x, desired.z).length()
    var is_moving := speed > 0.3
    _move_amount = lerpf(_move_amount, 1.0 if is_moving else 0.0, minf(1.0, delta * 6.0))
    var speed_factor := clampf(speed / move_speed, 0.0, 1.2)

    if is_moving:
        _walk_phase += delta * (4.0 + speed_factor * 6.0)
        # Body bob + forward lean that reads at gameplay zoom.
        _body_group.position.y = absf(sin(_walk_phase)) * 0.10 * (0.6 + speed_factor * 0.6)
        _body_group.rotation.x = lerp_angle(_body_group.rotation.x, 0.06 * speed_factor, minf(1.0, delta * 6.0))
        _body_group.rotation.z = sin(_walk_phase) * 0.05 * (0.5 + speed_factor * 0.5)
    else:
        _walk_phase = 0.0
        # Idle breathing: tiny torso lift only.
        _idle_bob = sin(_animation_time * 1.6) * 0.02
        _body_group.position.y = lerpf(_body_group.position.y, 0.0, minf(1.0, delta * 5.0))
        _body_group.rotation.x = lerp_angle(_body_group.rotation.x, _idle_bob * 0.5, minf(1.0, delta * 5.0))
        _body_group.rotation.z = lerp_angle(_body_group.rotation.z, 0.0, minf(1.0, delta * 5.0))

    # Face the direction of travel.
    if is_moving and Vector2(desired.x, desired.z).length() > 0.05:
        _visual.rotation.y = lerp_angle(_visual.rotation.y, atan2(velocity.x, velocity.z), minf(1.0, delta * 10.0))

    # Contact shadow stays glued just above the base of the character.
    if is_instance_valid(_shadow):
        _shadow.visible = not is_swimming
        _shadow.scale.x = lerpf(_shadow.scale.x, 0.8 + _move_amount * 0.35, delta * 6.0)
        _shadow.scale.z = _shadow.scale.x

func _build_visual() -> Node3D:
    var root := Node3D.new()
    root.name = "AstrixAdventurer"

    _body_group = Node3D.new()
    _body_group.name = "Animated"
    root.add_child(_body_group)

    # Body (hooded adventurer capsule silhouette, slightly exaggerated).
    var body := MeshInstance3D.new()
    var body_mesh := CapsuleMesh.new()
    body_mesh.radius = 0.58
    body_mesh.height = 1.7
    body.mesh = body_mesh
    body.position.y = 0.95
    body.material_override = _material(Color("8fd3c7"))
    _body_group.add_child(body)

    # Hood.
    var hood := MeshInstance3D.new()
    var hood_mesh := CylinderMesh.new()
    hood_mesh.top_radius = 0.06
    hood_mesh.bottom_radius = 0.74
    hood_mesh.height = 1.0
    hood.mesh = hood_mesh
    hood.position.y = 2.0
    hood.material_override = _material(Color("f0b0d0"))
    _body_group.add_child(hood)

    # Hood tip (directional readout gives the silhouette a point, not a bean).
    var tip := MeshInstance3D.new()
    var tip_mesh := PrismMesh.new()
    tip_mesh.size = Vector3(0.4, 0.5, 0.4)
    tip.mesh = tip_mesh
    tip.position = Vector3(0.0, 2.55, 0.05)
    tip.rotation.x = 0.15
    tip.material_override = _material(Color("f0b0d0"))
    _body_group.add_child(tip)

    # Glowing eye.
    var eye := MeshInstance3D.new()
    var eye_mesh := SphereMesh.new()
    eye_mesh.radius = 0.1
    eye_mesh.height = 0.2
    eye.mesh = eye_mesh
    eye.position = Vector3(0.0, 2.0, 0.62)
    eye.material_override = _material(Color("fff0bd"), 0.35)
    _body_group.add_child(eye)

    # Contact shadow: flattened dark disc at the feet.
    _shadow = MeshInstance3D.new()
    _shadow.name = "ContactShadow"
    var shadow_mesh := CylinderMesh.new()
    shadow_mesh.top_radius = 0.9
    shadow_mesh.bottom_radius = 0.9
    shadow_mesh.height = 0.04
    _shadow.mesh = shadow_mesh
    _shadow.position = Vector3(0.0, 0.03, 0.0)
    _shadow.material_override = _material(Color(0.02, 0.05, 0.06, 0.4))
    root.add_child(_shadow)

    return root

func _material(color: Color, emission_energy: float = 0.0) -> StandardMaterial3D:
    var material := StandardMaterial3D.new()
    material.albedo_color = color
    material.roughness = 0.82
    if emission_energy > 0.0:
        material.emission_enabled = true
        material.emission = color
        material.emission_energy_multiplier = emission_energy
    if color.a < 1.0:
        material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
    return material