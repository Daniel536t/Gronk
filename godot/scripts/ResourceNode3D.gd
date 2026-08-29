extends Node3D
class_name ResourceNode3D

@export var resource_id: String = "wood"
@export var amount: int = 1
@export var server_node_id: String = ""
var gathered: bool = false
var request_pending: bool = false

func _ready() -> void:
    GameClient.astrix_command_succeeded.connect(_on_command_succeeded)
    GameClient.astrix_command_failed.connect(_on_command_failed)

func gather() -> Dictionary:
    if gathered:
        return {"ok": false, "error": "resource already gathered"}
    var bus := get_node_or_null("/root/GameCommandBus")
    if not bus:
        return {"ok": false, "error": "command bus unavailable"}
    if request_pending:
        return {"ok": false, "error": "resource request pending"}
    request_pending = true
    var params := {"resource_type": resource_id}
    if not server_node_id.is_empty():
        params = {"resource_id": server_node_id}
    bus.send_command("gather", params)
    return {"ok": true, "pending": true}

func _on_command_succeeded(result: Dictionary) -> void:
    if str(result.get("command", "")) == "GATHER_RESOURCE" and not gathered and (server_node_id.is_empty() or str(result.get("resourceId", "")) == server_node_id):
        gathered = true
        request_pending = false
        scale = Vector3.ZERO

func _on_command_failed(_error: String) -> void:
    request_pending = false
