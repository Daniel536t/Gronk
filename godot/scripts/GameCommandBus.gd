extends Node
## ASTrix mutation boundary. Every world-changing request is validated here.
## The Phase 1 steward integration is intentionally a local seam; no agent loop
## or server authority is added in this milestone.

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

func _on_server_command_failed(error: String) -> void:
    command_failed.emit(error)

func validate(command_name: String, params: Dictionary) -> Dictionary:
    if command_name.is_empty():
        return {"ok": false, "error": "command is required"}
    if command_name == "build" and not params.has("building_type"):
        return {"ok": false, "error": "building_type is required"}
    return {"ok": true}

func place_building(building_type: String, location: Vector3) -> Dictionary:
    if not BUILD_COSTS.has(building_type):
        return _reject("PlaceBuilding", "unknown building type")
    if not _valid_location(location):
        return _reject("PlaceBuilding", "location is outside the buildable world")
    var cost: Dictionary = BUILD_COSTS[building_type]
    if not _can_afford(cost):
        return _reject("PlaceBuilding", "insufficient resources")
    var result := request_approval("PlaceBuilding", "Build %s" % building_type, {"cost": cost, "location": location})
    if bool(result.get("pending", false)):
        return result
    return result

func send_command(command_name: String, params: Dictionary) -> void:
    var validation := validate(command_name, params)
    if not bool(validation.get("ok", false)):
        command_failed.emit(str(validation.get("error", "invalid command")))
        return
    GameClient.send_astrix_command({"command": command_name, "params": params})

func commit_building(building_type: String, location: Vector3) -> Dictionary:
    if not BUILD_COSTS.has(building_type) or not _valid_location(location):
        return _reject("PlaceBuilding", "invalid building")
    var cost: Dictionary = BUILD_COSTS[building_type]
    if not _can_afford(cost):
        return _reject("PlaceBuilding", "insufficient resources")
    for resource_id in cost:
        world_state.consume(resource_id, int(cost[resource_id]))
    var building_id := "%s_%03d" % [building_type, world_state.buildings.size() + 1]
    world_state.buildings[building_id] = {"id": building_id, "type": building_type, "location": location}
    var result := {"ok": true, "command": "PlaceBuilding", "building_id": building_id}
    world_state.changed.emit()
    command_completed.emit("PlaceBuilding", result)
    return result

func build_bridge(location: Vector3) -> Dictionary:
    return place_building("bridge_segment", location)

func gather_resource(resource_id: String, location: Vector3) -> Dictionary:
    if not RESOURCE_IDS.has(resource_id) or not _valid_location(location):
        return _reject("GatherResource", "invalid resource or location")
    var result := {"ok": true, "command": "GatherResource", "resource_id": resource_id, "location": location}
    world_state.add_resource(resource_id, 1)
    world_state.changed.emit()
    command_completed.emit("GatherResource", result)
    return result

func plant_crop(plot_id: String, crop: String) -> Dictionary:
    if plot_id.is_empty() or crop.is_empty():
        return _reject("PlantCrop", "plot_id and crop are required")
    var result := {"ok": true, "command": "PlantCrop", "plot_id": plot_id, "crop": crop}
    command_completed.emit("PlantCrop", result)
    return result

func clear_terrain(location: Vector3) -> Dictionary:
    if not _valid_location(location):
        return _reject("ClearTerrain", "location is outside the world")
    var result := {"ok": true, "command": "ClearTerrain", "location": location}
    command_completed.emit("ClearTerrain", result)
    return result

func simulate_plan(plan: Dictionary) -> Dictionary:
    return {"ok": true, "validated": true, "plan": plan.duplicate(true)}

func request_approval(action: String, reason: String, impact: Dictionary) -> Dictionary:
    var request := {"action": action, "reason": reason, "impact": impact.duplicate(true)}
    approval_requested.emit(request)
    return {"ok": true, "pending": true, "request": request}

func approve(request: Dictionary) -> Dictionary:
    var impact: Dictionary = request.get("impact", {})
    var location: Vector3 = impact.get("location", Vector3.ZERO)
    var building_type := str(request.get("reason", "")).trim_prefix("Build ")
    return commit_building(building_type, location)

func reject(_request: Dictionary) -> Dictionary:
    return {"ok": true, "approved": false}

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
