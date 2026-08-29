extends Node
## Client-side ASTrix world model. Future authoritative mutations must enter
## through GameCommandBus; this object contains no server/gameplay authority.

signal changed

var day: int = 1
var population: int = 4
var food: int = 12
var food_security: float = 3.0
var biome_health: Dictionary = {"meadow": 1.0, "frost": 1.0, "dusk": 1.0}
var resources: Dictionary = {"wood": 0, "stone": 0, "food": 12, "water": 0, "crystal": 0}
var resource_nodes: Dictionary = {}
var buildings: Dictionary = {}
var pending_approvals: Array[Dictionary] = []

func _ready() -> void:
    _recalculate_food_security()

func snapshot() -> Dictionary:
    return {
        "day": day,
        "population": population,
        "food": food,
        "food_security": food_security,
        "biome_health": biome_health.duplicate(true),
        "resources": resources.duplicate(true),
        "resource_nodes": resource_nodes.duplicate(true),
        "buildings": buildings.duplicate(true),
        "pending_approvals": pending_approvals.duplicate(true),
    }

func apply_snapshot(snapshot_data: Dictionary) -> void:
    day = int(snapshot_data.get("day", day))
    population = int(snapshot_data.get("population", population))
    food = int(snapshot_data.get("food", food))
    var health: Variant = snapshot_data.get("biomeHealth", snapshot_data.get("biome_health", biome_health))
    if health is Dictionary:
        biome_health = health.duplicate(true)
    var remote_resources: Variant = snapshot_data.get("resources", resources)
    if remote_resources is Dictionary:
        resources = remote_resources.duplicate(true)
        food = int(resources.get("food", food))
    resource_nodes.clear()
    var remote_nodes: Variant = snapshot_data.get("resourceNodes", [])
    if remote_nodes is Array:
        for node in remote_nodes:
            if node is Dictionary:
                resource_nodes[str(node.get("id", "resource"))] = node.duplicate(true)
    var remote_buildings: Variant = snapshot_data.get("buildings", buildings)
    if remote_buildings is Array:
        buildings.clear()
        for building in remote_buildings:
            if building is Dictionary:
                buildings[str(building.get("id", "building"))] = building.duplicate(true)
    var approvals: Variant = snapshot_data.get("pendingApprovals", snapshot_data.get("pending_approvals", pending_approvals))
    if approvals is Array:
        pending_approvals = approvals.duplicate(true)
    _recalculate_food_security()
    changed.emit()

func set_resource(resource_id: String, amount: int) -> void:
    resources[resource_id] = maxi(0, amount)
    if resource_id == "food":
        food = maxi(0, amount)
    changed.emit()

func add_resource(resource_id: String, amount: int) -> void:
    set_resource(resource_id, int(resources.get(resource_id, 0)) + amount)

func consume(resource_id: String, amount: int) -> bool:
    var current := int(resources.get(resource_id, 0))
    if amount < 0 or current < amount:
        return false
    set_resource(resource_id, current - amount)
    return true

func _recalculate_food_security() -> void:
    food_security = float(food) / maxf(1.0, float(population))
