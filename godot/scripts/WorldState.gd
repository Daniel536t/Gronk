extends Node
## Client-side MIRROR of ASTrix Core's authoritative world snapshot.
##
## AUTHORITY: none. This object never decides anything. Mutations enter through
## GameCommandBus -> POST /astrix/command -> Core's AstrixGameCommandBus.
##
## BOOT STATE (P0-E fix): this class previously carried invented defaults
## (food = 12, biome_health = 1.0, resources.wood = 0) that CONTRADICTED Core's
## real start state (food = 40, meadow health = 0.8, wood = 30). For up to one
## poll interval the client asserted numbers the authoritative world never had.
##
## Now uninitialized state is represented EXPLICITLY as unknown: `initialized`
## is false and every numeric field is -1 / empty until the first authoritative
## snapshot arrives. UI must call `is_ready()` (or read `initialized`) and render
## "—" rather than a fabricated value. There is no second default simulation.

signal changed
## Emitted once, when the first authoritative snapshot is applied.
signal initialized_from_core

## False until Core's first snapshot lands. Nothing below is meaningful until then.
var initialized: bool = false

## Sentinel for "not yet received from Core". Never a plausible world value.
const UNKNOWN_INT := -1
const UNKNOWN_FLOAT := -1.0
const UNKNOWN_STR := "—"

# ---- authoritative mirror (all UNKNOWN until the first snapshot) ------------
var day: int = UNKNOWN_INT
var time_of_day: String = UNKNOWN_STR
var population: int = UNKNOWN_INT
var food: int = UNKNOWN_INT
var food_security: float = UNKNOWN_FLOAT
var season: String = UNKNOWN_STR
var days_until_winter: int = UNKNOWN_INT
var food_per_day: int = UNKNOWN_INT
var days_of_food_remaining: int = UNKNOWN_INT
## Core reports `null` when nothing can mature (Winter); mirrored as UNKNOWN_INT
## so the HUD shows the unknown marker rather than a fabricated 0.
var days_until_next_harvest: int = UNKNOWN_INT
var harvestable_food: int = UNKNOWN_INT
var growing_food: int = UNKNOWN_INT
var projected_food_at_winter: int = UNKNOWN_INT
var food_pressure_level: String = UNKNOWN_STR
var biome_health: Dictionary = {}
var resources: Dictionary = {}
var resource_nodes: Dictionary = {}
var buildings: Dictionary = {}
var crops: Dictionary = {}
var bridges: Array[Dictionary] = []
var farmland: Array[Dictionary] = []
var islands: Array[Dictionary] = []
var pending_approvals: Array[Dictionary] = []

func is_ready() -> bool:
    return initialized

## Display helper: authoritative value, or the unknown marker before first sync.
func label_for(value: Variant) -> String:
    if not initialized:
        return UNKNOWN_STR
    if value is int and int(value) == UNKNOWN_INT:
        return UNKNOWN_STR
    return str(value)

func snapshot() -> Dictionary:
    return {
        "initialized": initialized,
        "day": day,
        "time": time_of_day,
        "population": population,
        "food": food,
        "food_security": food_security,
        "season": season,
        "daysUntilWinter": days_until_winter,
        "foodPerDay": food_per_day,
        "daysOfFoodRemaining": days_of_food_remaining,
        "daysUntilNextHarvest": days_until_next_harvest,
        "harvestableFood": harvestable_food,
        "growingFood": growing_food,
        "projectedFoodAtWinter": projected_food_at_winter,
        "foodPressureLevel": food_pressure_level,
        "biome_health": biome_health.duplicate(true),
        "resources": resources.duplicate(true),
        "resource_nodes": resource_nodes.duplicate(true),
        "buildings": buildings.duplicate(true),
        "crops": crops.duplicate(true),
        "bridges": bridges.duplicate(true),
        "farmland": farmland.duplicate(true),
        "islands": islands.duplicate(true),
        "pending_approvals": pending_approvals.duplicate(true),
    }

## Adopt an authoritative Core snapshot. Every field below comes from the server;
## nothing is computed locally except `food_security`, which mirrors Core's own
## formula and is overwritten by the server value when present.
func apply_snapshot(snapshot_data: Dictionary) -> void:
    var was_initialized := initialized

    day = int(snapshot_data.get("day", day))
    time_of_day = str(snapshot_data.get("time", time_of_day))
    population = int(snapshot_data.get("population", population))
    food = int(snapshot_data.get("food", food))
    season = str(snapshot_data.get("season", season))
    days_until_winter = int(snapshot_data.get("daysUntilWinter", days_until_winter))
    food_per_day = int(snapshot_data.get("foodPerDay", food_per_day))
    days_of_food_remaining = int(snapshot_data.get("daysOfFoodRemaining", days_of_food_remaining))
    var next_harvest: Variant = snapshot_data.get("daysUntilNextHarvest", days_until_next_harvest)
    days_until_next_harvest = UNKNOWN_INT if next_harvest == null else int(next_harvest)
    harvestable_food = int(snapshot_data.get("harvestableFood", harvestable_food))
    growing_food = int(snapshot_data.get("growingFood", growing_food))
    projected_food_at_winter = int(snapshot_data.get("projectedFoodAtWinter", projected_food_at_winter))
    food_pressure_level = str(snapshot_data.get("foodPressureLevel", food_pressure_level))

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

    crops.clear()
    var remote_crops: Variant = snapshot_data.get("crops", [])
    if remote_crops is Array:
        for crop in remote_crops:
            if crop is Dictionary:
                crops[str(crop.get("id", "crop"))] = crop.duplicate(true)

    bridges = _typed_dicts(snapshot_data.get("bridges", []))
    farmland = _typed_dicts(snapshot_data.get("farmland", farmland))
    islands = _typed_dicts(snapshot_data.get("islands", islands))
    pending_approvals = _typed_dicts(
        snapshot_data.get("pendingApprovals", snapshot_data.get("pending_approvals", pending_approvals))
    )

    # Prefer the server's derived value; fall back to Core's own formula.
    if snapshot_data.has("foodSecurity"):
        food_security = float(snapshot_data.get("foodSecurity", food_security))
    else:
        food_security = float(food) / maxf(1.0, float(population))

    initialized = true
    if not was_initialized:
        initialized_from_core.emit()
    changed.emit()

## JSON.parse yields untyped Arrays; rebuild as Array[Dictionary] or typed
## assignment fails at runtime in exported builds.
func _typed_dicts(value: Variant) -> Array[Dictionary]:
    var typed: Array[Dictionary] = []
    if value is Array:
        for item in value:
            if item is Dictionary:
                typed.append(item.duplicate(true))
    return typed

## Farmland usage for one island, or null before the first snapshot.
func farmland_for(island_id: String) -> Variant:
    for entry in farmland:
        if str(entry.get("islandId", "")) == island_id:
            return entry
    return null
