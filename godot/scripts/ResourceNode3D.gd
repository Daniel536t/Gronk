extends Node3D
class_name ResourceNode3D

@export var resource_id: String = "wood"
@export var amount: int = 1
var gathered: bool = false

func gather() -> Dictionary:
    if gathered:
        return {"ok": false, "error": "resource already gathered"}
    var bus := get_node_or_null("/root/GameCommandBus")
    if not bus:
        return {"ok": false, "error": "command bus unavailable"}
    var result: Dictionary = bus.gather_resource(resource_id, global_position)
    if bool(result.get("ok", false)):
        gathered = true
        scale = Vector3.ZERO
    return result
