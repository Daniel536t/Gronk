extends SceneTree

## Shared harness for deterministic ASTrix visual evidence.
##
## WHY THIS EXISTS: GameClient polls the live Core server twice a second. Any
## render or probe that does not stop polling first gets whatever the live world
## happens to be (a 3000-day-old collapsed village at 21:48, which is why early
## renders came out dark and empty). Evidence has to be reproducible, so the
## harness takes the world OFFLINE and feeds an explicit snapshot.
##
## The snapshot below is a REAL Core-shaped snapshot: same field names, same
## value ranges, same growth-stage semantics as src/astrix/state.ts produces.
## It is a fixture, not a fake world — nothing here bypasses Core's authority
## model, it only replaces the transport.

## Take GameClient offline so nothing overwrites the fixture mid-capture.
static func go_offline(root: Node) -> void:
    var client: Node = root.get_node_or_null("GameClient")
    if client == null:
        return
    if "_poll_timer" in client and client._poll_timer is Timer:
        (client._poll_timer as Timer).stop()
    # Prevent late in-flight responses from landing on top of the fixture.
    if "api_origin" in client:
        client.api_origin = "http://127.0.0.1:1"

## A mid-game autumn snapshot: 5 villagers, a house, storage, three farms with
## crops at every growth tier, a meadow-frost bridge, and food pressure high.
static func snapshot_autumn() -> Dictionary:
    return {
        "day": 19, "time": "12:00", "elapsedSeconds": 2160.0, "season": "autumn",
        "population": 5, "food": 21, "foodSecurity": 4.2,
        "daysUntilWinter": 6, "foodPerDay": 5, "daysOfFoodRemaining": 4,
        "harvestableFood": 12, "growingFood": 30, "projectedFoodAtWinter": 33,
        "foodPressureLevel": "high",
        "resources": {"wood": 22, "stone": 11, "food": 21, "water": 0, "crystal": 5},
        "biomeHealth": {"meadow": 0.8, "frost": 0.6, "dusk": 0.4},
        "islands": [
            {"id": "meadow", "biome": "meadow", "health": 0.8, "connectivity": ["frost"]},
            {"id": "frost", "biome": "frost", "health": 0.6, "connectivity": ["meadow"]},
            {"id": "dusk", "biome": "dusk", "health": 0.4, "connectivity": []},
        ],
        "farmland": [
            {"islandId": "meadow", "capacity": 2, "used": 2, "available": 0},
            {"islandId": "frost", "capacity": 2, "used": 1, "available": 1},
            {"islandId": "dusk", "capacity": 1, "used": 0, "available": 1},
        ],
        "bridges": [{"id": "bridge-001", "islandA": "meadow", "islandB": "frost"}],
        "buildings": [
            {"id": "house-001", "type": "house", "position": {"x": 20, "y": 3.6, "z": 30}, "health": 1, "islandId": "meadow"},
            {"id": "house-002", "type": "house", "position": {"x": 13, "y": 3.6, "z": 28}, "health": 1, "islandId": "meadow"},
            {"id": "storage-001", "type": "storage", "position": {"x": 24, "y": 3.6, "z": 25}, "health": 1, "islandId": "meadow"},
            {"id": "farm-001", "type": "farm", "position": {"x": 10, "y": 0, "z": 10}, "health": 1, "islandId": "meadow"},
            {"id": "farm-002", "type": "farm", "position": {"x": 14, "y": 0, "z": 10}, "health": 1, "islandId": "meadow"},
            {"id": "farm-003", "type": "farm", "position": {"x": 44, "y": 0, "z": 10}, "health": 1, "islandId": "frost"},
        ],
        "crops": [
            {"id": "crop-001", "farmPlotId": "farm-001", "cropType": "wheat", "growthStage": 1.0, "harvestable": true, "plantedAtDay": 11},
            {"id": "crop-002", "farmPlotId": "farm-001", "cropType": "wheat", "growthStage": 0.75, "harvestable": false, "plantedAtDay": 13},
            {"id": "crop-003", "farmPlotId": "farm-001", "cropType": "wheat", "growthStage": 0.5, "harvestable": false, "plantedAtDay": 15},
            {"id": "crop-004", "farmPlotId": "farm-002", "cropType": "wheat", "growthStage": 0.25, "harvestable": false, "plantedAtDay": 17},
            {"id": "crop-005", "farmPlotId": "farm-002", "cropType": "wheat", "growthStage": 0.0, "harvestable": false, "plantedAtDay": 19},
            {"id": "crop-006", "farmPlotId": "farm-003", "cropType": "wheat", "growthStage": 0.9, "harvestable": false, "plantedAtDay": 12},
            {"id": "crop-007", "farmPlotId": "farm-003", "cropType": "wheat", "growthStage": 1.0, "harvestable": true, "plantedAtDay": 10},
        ],
        "resourceNodes": [
            {"id": "tree-meadow-001", "type": "wood", "position": {"x": 12, "y": 3.5, "z": 24}, "quantity": 5, "islandId": "meadow"},
            {"id": "tree-meadow-002", "type": "wood", "position": {"x": 30, "y": 3.5, "z": 36}, "quantity": 5, "islandId": "meadow"},
            {"id": "rock-frost-001", "type": "stone", "position": {"x": 44, "y": 4.5, "z": 14}, "quantity": 4, "islandId": "frost"},
            {"id": "crystal-dusk-001", "type": "crystal", "position": {"x": 72, "y": 3.2, "z": 36}, "quantity": 3, "islandId": "dusk"},
            {"id": "water-source-001", "type": "water", "position": {"x": 50, "y": 0, "z": 30}, "quantity": 999, "islandId": "meadow"},
        ],
        "pendingApprovals": [],
    }

## Winter variant of the same settlement: crops frozen, food critical, and the
## activity log advanced to match (a stale autumn log next to a winter HUD read as
## a contradiction — "food 21, pressure high" beside "food 6, CRITICAL").
static func snapshot_winter() -> Dictionary:
    var snap := snapshot_autumn()
    snap["day"] = 27
    snap["season"] = "winter"
    snap["time"] = "11:00"
    snap["daysUntilWinter"] = 0
    snap["food"] = 6
    snap["foodPerDay"] = 7
    snap["daysOfFoodRemaining"] = 0
    snap["foodPressureLevel"] = "critical"
    snap["population"] = 4
    snap["harvestableFood"] = 0
    snap["growingFood"] = 12
    snap["projectedFoodAtWinter"] = 6
    snap["resources"] = {"wood": 22, "stone": 11, "food": 6, "water": 0, "crystal": 5}
    # Winter halts growth: the mature rows were harvested (which is where the
    # food went), the rest are frozen mid-growth.
    var crops: Array = snap["crops"]
    for crop in crops:
        if crop is Dictionary:
            crop["harvestable"] = false
            crop["growthStage"] = minf(float(crop.get("growthStage", 0.0)), 0.6)
    return snap

## Agent status matching the WINTER snapshot: the steward has harvested and is now
## rationing, so the feed does not contradict the HUD.
static func agent_status_winter() -> Dictionary:
    return {
        "state": "ADAPTING",
        "turn": 12,
        "objective": "Keep the village fed through winter without irreversible expansion.",
        "currentAction": {"tool": "harvest", "executionState": "VERIFIED"},
        "lastEvents": [
            {"type": "SEASON_CHANGED", "at": 610000, "data": {"decision": "winter — crop growth halted"}},
            {"type": "STEWARD_OBSERVED", "at": 612000, "data": {"decision": "food 6, <1 day, pressure critical"}},
            {"type": "TOOL_CALLED", "at": 614000, "data": {"tool": "harvest (2 mature rows)"}},
            {"type": "COMMAND_EXECUTED", "at": 615000, "data": {"tool": "12 food gathered"}},
            {"type": "STEWARD_OBSERVED", "at": 617000, "data": {"decision": "no harvestable crops remain"}},
            {"type": "STEWARD_ADAPTED", "at": 618000, "data": {"decision": "ration; no irreversible expansion"}},
        ],
    }

## Evening variant, to prove the authoritative clock drives the sun.
static func snapshot_evening() -> Dictionary:
    var snap := snapshot_autumn()
    snap["time"] = "19:30"
    return snap

## A pending approval on the real approval shape, for the approval-UI evidence.
static func pending_approval() -> Dictionary:
    return {
        "id": "approval-001",
        "command": "BUILD_BRIDGE",
        "reason": "Dusk island holds the last unused farmland plot but is unreachable. "
            + "A bridge permanently changes island connectivity, so a human must decide.",
        "impact": {
            "irreversible": true,
            "risk": "HIGH",
            "cost": {"wood": 3},
            "islandA": "meadow",
            "islandB": "dusk",
            "unlocks": "1 farmland plot",
        },
        "createdAt": 1710000000000,
    }

## Agent status on the real /astrix/agent/status shape.
##
## The events below are consistent with snapshot_autumn(): the steward has just
## built farm-003 and planted, so the world shows 3 farms / 7 crops while food is
## still 21 and pressure still HIGH (production rises when the crops MATURE, not
## when they are planted). Consistency matters — an inconsistent fixture makes a
## working render look broken.
static func agent_status(state: String, with_approval: bool = false) -> Dictionary:
    var status := {
        "state": state,
        "turn": 7,
        "objective": "Keep the village fed through winter without irreversible expansion.",
        "currentAction": {"tool": "plant", "executionState": "EXECUTING"},
        "lastEvents": [
            {"type": "STEWARD_OBSERVED", "at": 412000, "data": {"decision": "food 21, 4 days remaining, pressure high"}},
            {"type": "STEWARD_PLANNED", "at": 415000, "data": {"decision": "expand food production before winter"}},
            {"type": "TOOL_CALLED", "at": 418000, "data": {"tool": "build farm (frost)"}},
            {"type": "COMMAND_EXECUTED", "at": 419000, "data": {"tool": "farm-003 constructed"}},
            {"type": "TOOL_CALLED", "at": 421000, "data": {"tool": "plant wheat"}},
            {"type": "VERIFICATION_PASSED", "at": 422000, "data": {"decision": "7 crops growing, 12 harvestable"}},
        ],
    }
    if with_approval:
        status["pendingApproval"] = {
            "approvalId": "approval-001",
            "action": {"tool": "build_bridge", "args": {"island_a": "meadow", "island_b": "dusk"}},
        }
    return status

static func wait_frames(tree: SceneTree, count: int) -> void:
    for _i in range(count):
        await tree.process_frame
