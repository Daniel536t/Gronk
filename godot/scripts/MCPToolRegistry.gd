extends Node
## MCP-shaped local registry. Phase 2 will connect external TrueForge calls.

var world_state: Node
var command_bus: Node

func _ready() -> void:
    world_state = get_node_or_null("/root/WorldState")
    command_bus = get_node_or_null("/root/GameCommandBus")

func inspect_world() -> Dictionary:
    return world_state.snapshot() if world_state else {}

func inspect_resources() -> Dictionary:
    if not world_state:
        return {}
    return {"resources": world_state.resources.duplicate(true), "locations": world_state.resource_nodes.duplicate(true)}

func inspect_buildings() -> Dictionary:
    return {"buildings": world_state.buildings.duplicate(true) if world_state else {}}

func inspect_biome(biome_id: String) -> Dictionary:
    return {"biome_id": biome_id, "health": float(world_state.biome_health.get(biome_id, 0.0)) if world_state else 0.0}

func gather(resource_id: String, location: Vector3) -> Dictionary:
    return command_bus.gather_resource(resource_id, location) if command_bus else {"ok": false, "error": "command bus unavailable"}

func build(building_type: String, location: Vector3) -> Dictionary:
    return command_bus.place_building(building_type, location) if command_bus else {"ok": false, "error": "command bus unavailable"}

func plant(plot_id: String, crop: String) -> Dictionary:
    return command_bus.plant_crop(plot_id, crop) if command_bus else {"ok": false, "error": "command bus unavailable"}

func simulate_plan(plan_json: Dictionary) -> Dictionary:
    return command_bus.simulate_plan(plan_json) if command_bus else {"ok": false, "error": "command bus unavailable"}
