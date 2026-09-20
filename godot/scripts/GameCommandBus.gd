extends Node
## ASTrix mutation boundary. Every world-changing request is validated for SHAPE
## here and forwarded to the authoritative server. No local mutation happens:
## visuals update only after a server response / snapshot.
##
## TRUST RULE (hardened): this layer owns NO game values. An earlier version
## carried its own BUILD_COSTS table, an affordability gate, world bounds, and
## a hardcoded island_id — a second cost table and a second topology that could
## drift from Core (Core COSTS != Godot COSTS). Costs, affordability, bounds,
## capacity and connectivity are decided EXCLUSIVELY by Core's CommandBus; this
## client forwards, then surfaces the server's verdict (success AND failure) in
## the Observatory feed. What remains here are shape checks (is the field
## present?) which mirror the transport contract and cannot drift with balance.
##
## Island hint: Core requires an islandId it owns. A world-space click is not a
## Core coordinate, so the client derives a HINT from the same ISLANDS
## geography the renderer stands on (single source, read live via preload —
## never a copied table) and the server validates it. Outside every island the
## hint is omitted and the server rejects truthfully.

signal command_completed(command_name: String, result: Dictionary)
signal command_rejected(command_name: String, reason: String)
signal approval_requested(request: Dictionary)
signal command_succeeded(result: Dictionary)
signal command_failed(error: String)

const RESOURCE_CONTRACT := "resource_id or resource_type is required"

const World3DGeography = preload("res://scripts/World3D.gd")

func _ready() -> void:
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
    if building_type.is_empty():
        return _reject("PlaceBuilding", "building_type is required")
    var params := {"building_type": building_type,
        "position": {"x": location.x, "y": location.y, "z": location.z}}
    # Island is a routing HINT from renderer geography, never a claim: Core
    # validates capacity, connectivity and cost against its own authority.
    var hint := island_hint_at(location)
    if hint != "":
        params["island_id"] = hint
    return _dispatch("build", params)

func build_bridge(location: Vector3, island_a: String = "meadow", island_b: String = "frost") -> Dictionary:
    return _dispatch("bridge", {"position": {"x": location.x, "y": location.y, "z": location.z}, "island_a": island_a, "island_b": island_b})

func gather_resource(resource_id: String, _location: Vector3) -> Dictionary:
    if resource_id.is_empty():
        return _reject("GatherResource", "resource is required")
    return _dispatch("gather", {"resource_id": resource_id})

func plant_crop(plot_id: String, crop: String) -> Dictionary:
    if plot_id.is_empty() or crop.is_empty():
        return _reject("PlantCrop", "plot_id and crop are required")
    return _dispatch("plant", {"farm_plot_id": plot_id, "crop_type": crop})

func clear_terrain(location: Vector3) -> Dictionary:
    return _dispatch("clear", {"position": {"x": location.x, "y": location.y, "z": location.z}, "radius": 1})

func simulate_plan(plan: Dictionary) -> Dictionary:
    GameClient.send_astrix_command({"command": "simulate_plan", "params": {"plan": plan}})
    return {"ok": true, "pending": true}

func _dispatch(command_name: String, params: Dictionary) -> Dictionary:
    send_command(command_name, params)
    return {"ok": true, "pending": true}

## Which rendered island contains a world-space point, or "" when none does.
## Read live from the renderer's own ISLANDS constant (preload, not a copy),
## so there is exactly one island geography and it cannot drift.
func island_hint_at(location: Vector3) -> String:
    var best := ""
    var best_d := 1.05
    for id in World3DGeography.ISLANDS.keys():
        var data: Dictionary = World3DGeography.ISLANDS[id]
        var c: Vector3 = data["center"]
        var rad: Vector2 = data["radius"]
        var dx := (location.x - c.x) / maxf(0.0001, rad.x)
        var dz := (location.z - c.z) / maxf(0.0001, rad.y)
        var d := sqrt(dx * dx + dz * dz)
        if d < best_d:
            best_d = d
            best = str(id)
    return best

func _reject(command_name: String, reason: String) -> Dictionary:
    command_rejected.emit(command_name, reason)
    return {"ok": false, "command": command_name, "error": reason}
