extends CharacterBody3D
class_name AstrixPlayer3D
## Local presentation/controller layer. Authoritative networking remains in the
## existing GameClient and is intentionally not rewritten here.

signal swimming_changed(is_swimming: bool)
signal inventory_changed(inventory: Dictionary)
signal gathered(resource_id: String)

@export var move_speed: float = 7.0
@export var run_multiplier: float = 1.45
@export var acceleration: float = 18.0
@export var deceleration: float = 24.0
@export var water_level: float = -0.05

var inventory: Dictionary = {"wood": 0, "stone": 0, "food": 0, "water": 0, "crystal": 0}
var is_swimming: bool = false
var _visual: Node3D
var _body: MeshInstance3D
var _bob_time: float = 0.0

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
    if velocity.length_squared() > 0.05:
        _visual.rotation.y = lerp_angle(_visual.rotation.y, atan2(velocity.x, velocity.z), minf(1.0, delta * 10.0))

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
        _bob_time += delta
        global_position.y = water_level + 0.12 + sin(_bob_time * 3.0) * 0.05
        _visual.scale.y = lerpf(_visual.scale.y, 0.85, delta * 5.0)
    else:
        _visual.scale.y = lerpf(_visual.scale.y, 1.0, delta * 5.0)

func _build_visual() -> Node3D:
    var root := Node3D.new()
    root.name = "AstrixAdventurerPlaceholder"
    _body = MeshInstance3D.new()
    var body_mesh := CapsuleMesh.new()
    body_mesh.radius = 0.55
    body_mesh.height = 1.6
    _body.mesh = body_mesh
    _body.position.y = 0.9
    _body.material_override = _material(Color("8fd3c7"))
    root.add_child(_body)
    var hood := MeshInstance3D.new()
    var hood_mesh := CylinderMesh.new()
    hood_mesh.top_radius = 0.08
    hood_mesh.bottom_radius = 0.7
    hood_mesh.height = 0.9
    hood.mesh = hood_mesh
    hood.position.y = 1.9
    hood.material_override = _material(Color("f2b5d4"))
    root.add_child(hood)
    var eye := MeshInstance3D.new()
    var eye_mesh := SphereMesh.new()
    eye_mesh.radius = 0.1
    eye_mesh.height = 0.2
    eye.mesh = eye_mesh
    eye.position = Vector3(0.0, 1.95, 0.58)
    eye.material_override = _material(Color("fff0bd"), 0.2)
    root.add_child(eye)
    return root

func _material(color: Color, emission_energy: float = 0.0) -> StandardMaterial3D:
    var material := StandardMaterial3D.new()
    material.albedo_color = color
    material.roughness = 0.82
    if emission_energy > 0.0:
        material.emission_enabled = true
        material.emission = color
        material.emission_energy_multiplier = emission_energy
    return material
