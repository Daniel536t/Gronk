extends Node
## ASTrix mutation boundary. Every world-changing request is validated here
## and forwarded to the authoritative server. No local mutation happens:
## visuals update only after a server response / snapshot.

signal command_completed(command_name: String, result: Dictionary)
signal command_rejected(command_name: String, reason: String)
signal approval_requested(request: Dictionary)
signal command_succeeded(result: Dictionary)
signal command_failed(error: String)

const RESOURCE_IDS := [&"wood", &"stone", &"food", &"water", &"crystal"]
const BUILD_COSTS := {
    "house": {"wood": 4, "stone": 2},
    "farm": {"wood": 2, "stone": 1},
    "storage": {"wood": 3, "stone": 2},
    "bridge_segment": {"wood": 3, "stone": 1},
}

var world_state: Node

func _ready() -> void:
    world_state = get_node_or_null("/root/WorldState")
    GameClient.astrix_command_succeeded.connect(_on_server_command_succeeded)
    GameClient.astrix_command_failed.connect(_on_server_command_failed)

func _on_server_command_succeeded(result: Dictionary) -> void:
    command_succeeded.emit(result)
    command_completed.emit(str(result.get("command", "")), result)

func _on_server_command_failed(error: String) -> void:
    command_failed.emit(error)

func validate(command_name: String, params: Dictionary) -> Dictionary:
    if command_name.is_empty():
        return {"ok": false, "error": "command is required"}
    if command_name == "build" and not params.has("building_type"):
        return {"ok": false, "error": "building_type is required"}
    if command_name == "gather" and not (params.has("resource_id") or params.has("resource_type")):
        return {"ok": false, "error": "resource_id or resource_type is required"}
    return {"ok": true}

func send_command(command_name: String, params: Dictionary) -> void:
    var validation := validate(command_name, params)
    if not bool(validation.get("ok", false)):
        command_failed.emit(str(validation.get("error", "invalid command")))
        return
    GameClient.send_astrix_command({"command": command_name, "params": params})

func place_building(building_type: String, location: Vector3) -> Dictionary:
    if not BUILD_COSTS.has(building_type):
        return _reject("PlaceBuilding", "unknown building type")
    if not _valid_location(location):
        return _reject("PlaceBuilding", "location is outside the buildable world")
    if not _can_afford(BUILD_COSTS[building_type]):
        return _reject("PlaceBuilding", "insufficient resources")
    return _dispatch("build", {"building_type": building_type, "position": {"x": location.x, "y": location.y, "z": location.z}, "island_id": "meadow"})

func build_bridge(location: Vector3, island_a: String = "meadow", island_b: String = "frost") -> Dictionary:
    return _dispatch("bridge", {"position": {"x": location.x, "y": location.y, "z": location.z}, "island_a": island_a, "island_b": island_b})

func gather_resource(resource_id: String, _location: Vector3) -> Dictionary:
    if not RESOURCE_IDS.has(resource_id):
        return _reject("GatherResource", "invalid resource")
    return _dispatch("gather", {"resource_id": resource_id})

func plant_crop(plot_id: String, crop: String) -> Dictionary:
    if plot_id.is_empty() or crop.is_empty():
        return _reject("PlantCrop", "plot_id and crop are required")
    return _dispatch("plant", {"farm_plot_id": plot_id, "crop_type": crop})

func clear_terrain(location: Vector3) -> Dictionary:
    if not _valid_location(location):
        return _reject("ClearTerrain", "location is outside the world")
    return _dispatch("clear", {"position": {"x": location.x, "y": location.y, "z": location.z}, "radius": 1})

func simulate_plan(plan: Dictionary) -> Dictionary:
    GameClient.send_astrix_command({"command": "simulate_plan", "params": {"plan": plan}})
    return {"ok": true, "pending": true}

func _dispatch(command_name: String, params: Dictionary) -> Dictionary:
    send_command(command_name, params)
    return {"ok": true, "pending": true}

func _can_afford(cost: Dictionary) -> bool:
    if not world_state:
        return false
    for resource_id in cost:
        if int(world_state.resources.get(resource_id, 0)) < int(cost[resource_id]):
            return false
    return true

func _valid_location(location: Vector3) -> bool:
    return location.x >= 0.0 and location.x <= 100.0 and location.z >= 0.0 and location.z <= 60.0

func _reject(command_name: String, reason: String) -> Dictionary:
    command_rejected.emit(command_name, reason)
    return {"ok": false, "command": command_name, "error": reason}
