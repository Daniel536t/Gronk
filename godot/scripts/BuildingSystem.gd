extends Node3D
## Presentation/building seam. Placement is validated and routed through the
## command bus; this scaffold does not add authoritative game rules.

@export var grid_size: float = 1.0
var preview: MeshInstance3D
var preview_type: String = "house"
var preview_location := Vector3.ZERO

func _ready() -> void:
    preview = MeshInstance3D.new()
    preview.name = "PlacementPreview"
    var mesh := BoxMesh.new()
    mesh.size = Vector3(3.0, 2.0, 3.0)
    preview.mesh = mesh
    preview.visible = false
    var material := StandardMaterial3D.new()
    material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
    material.albedo_color = Color(0.35, 0.85, 0.55, 0.45)
    preview.material_override = material
    add_child(preview)

func show_preview(location: Vector3, building_type: String = "house", valid: bool = true) -> void:
    preview_type = building_type
    preview_location = Vector3(round(location.x / grid_size) * grid_size, location.y, round(location.z / grid_size) * grid_size)
    preview.position = preview_location
    preview.visible = true
    var material := preview.material_override as StandardMaterial3D
    if material:
        material.albedo_color = Color(0.35, 0.85, 0.55, 0.45) if valid else Color(0.9, 0.25, 0.25, 0.45)

func hide_preview() -> void:
    preview.visible = false

func confirm_placement() -> Dictionary:
    var bus := get_node_or_null("/root/GameCommandBus")
    if not bus or not preview.visible:
        return {"ok": false, "error": "no placement available"}
    return bus.place_building(preview_type, preview_location)
