extends Node3D
class_name Companion3D

@export var follow_distance: float = 2.0
@export var follow_speed: float = 5.0
var target: Node3D
var _visual: Node3D

func _ready() -> void:
    _visual = _build_visual()
    add_child(_visual)

func _process(delta: float) -> void:
    if not is_instance_valid(target):
        return
    var desired := target.global_position - target.global_basis.z * follow_distance
    desired.y = target.global_position.y
    global_position = global_position.lerp(desired, 1.0 - exp(-follow_speed * delta))
    _visual.position.y = 0.45 + sin(Time.get_ticks_msec() * 0.006) * 0.04

func _build_visual() -> Node3D:
    var root := Node3D.new()
    var body := MeshInstance3D.new()
    var body_mesh := CapsuleMesh.new()
    body_mesh.radius = 0.3
    body_mesh.height = 0.7
    body.mesh = body_mesh
    body.position.y = 0.35
    body.material_override = _material(Color("d98b71"))
    root.add_child(body)
    var ear_left := MeshInstance3D.new()
    var ear_mesh := PrismMesh.new()
    ear_mesh.size = Vector3(0.22, 0.35, 0.18)
    ear_left.mesh = ear_mesh
    ear_left.position = Vector3(-0.18, 0.82, 0.0)
    ear_left.material_override = _material(Color("b9675c"))
    root.add_child(ear_left)
    var ear_right := ear_left.duplicate() as MeshInstance3D
    ear_right.position.x = 0.18
    root.add_child(ear_right)
    return root

func _material(color: Color) -> StandardMaterial3D:
    var material := StandardMaterial3D.new()
    material.albedo_color = color
    material.roughness = 0.85
    return material
