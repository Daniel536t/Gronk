extends SceneTree

## Screenshot harness: reproduces the ASTrix world, injects a representative
## authoritative snapshot (farms, crops at several growth stages, a bridge, room
## for cleared trees), lets a few frames render, then captures a PNG. Used for
## visual verification without a real browser display.

var _frames_waited := 0
const MAX_FRAMES := 90

func _initialize() -> void:
    var main: Node = load("res://scenes/Main.tscn").instantiate()
    root.add_child(main)
    # Start the loop after a short delay so _ready builds the whole world.
    _schedule_snapshot()

func _schedule_snapshot() -> void:
    # Delay then feed a realistic ASTrix authoritative state snapshot that
    # exercises the sim-materialization path: 2 farms w/ crops at growing &
    # mature stages, + a frost-meadow bridge.
    await _wait_frames(30)
    var world: Node = root.find_child("World3D", true, false)
    if world and world.has_method("_on_astrix_state_received"):
        world._on_astrix_state_received(_sample_snapshot())
    await _wait_frames(40)
    _capture()

static func _sample_snapshot() -> Dictionary:
    return {
        "day": 16, "time": "12:00", "season": "autumn", "population": 3,
        "food": 22, "daysUntilWinter": 9, "foodPerDay": 3,
        "daysOfFoodRemaining": 7, "harvestableFood": 12, "growingFood": 8,
        "projectedFoodAtWinter": 24, "foodPressureLevel": "high",
        "resources": {"wood": 24, "stone": 11, "food": 22, "water": 0, "crystal": 5},
        "biomeHealth": {"meadow": 0.7, "frost": 0.6, "dusk": 0.4},
        "islands": [
            {"id": "meadow", "biome": "meadow", "health": 0.7, "connectivity": []},
            {"id": "frost", "biome": "frost", "health": 0.6, "connectivity": []},
            {"id": "dusk", "biome": "dusk", "health": 0.4, "connectivity": []},
        ],
        "farmland": [
            {"islandId": "meadow", "capacity": 3, "used": 3, "available": 0},
            {"islandId": "frost", "capacity": 2, "used": 1, "available": 1},
            {"islandId": "dusk", "capacity": 1, "used": 0, "available": 1},
        ],
        "bridges": [{"id": "bridge-001", "islandA": "meadow", "islandB": "frost"}],
        "buildings": [
            {"id": "house-001", "type": "house", "position": {"x": 22, "y": 3.3, "z": 26}, "health": 1, "islandId": "meadow"},
            {"id": "farm-meadow-1", "type": "farm", "position": {"x": 27, "y": 3.3, "z": 34}, "health": 1, "islandId": "meadow"},
            {"id": "farm-meadow-2", "type": "farm", "position": {"x": 18, "y": 3.3, "z": 33}, "health": 1, "islandId": "meadow"},
            {"id": "farm-frost-1", "type": "farm", "position": {"x": 47, "y": 4.3, "z": 18}, "health": 1, "islandId": "frost"},
        ],
        "crops": [
            {"id": "crop-1", "farmPlotId": "farm-meadow-1", "cropType": "wheat", "growthStage": 0.15},
            {"id": "crop-2", "farmPlotId": "farm-meadow-1", "cropType": "wheat", "growthStage": 0.55},
            {"id": "crop-3", "farmPlotId": "farm-meadow-1", "cropType": "wheat", "growthStage": 1.0},
            {"id": "crop-4", "farmPlotId": "farm-meadow-2", "cropType": "wheat", "growthStage": 0.0},
            {"id": "crop-5", "farmPlotId": "farm-frost-1", "cropType": "wheat", "growthStage": 0.8},
        ],
        "resourceNodes": [
            {"id": "tree-meadow-001", "type": "wood", "position": {"x": 17, "y": 3.5, "z": 30}, "quantity": 5, "islandId": "meadow"},
            {"id": "tree-meadow-002", "type": "wood", "position": {"x": 15, "y": 3.5, "z": 38}, "quantity": 5, "islandId": "meadow"},
            {"id": "rock-frost-001", "type": "stone", "position": {"x": 44, "y": 4.5, "z": 14}, "quantity": 4, "islandId": "frost"},
            {"id": "crystal-dusk-001", "type": "crystal", "position": {"x": 72, "y": 3.2, "z": 36}, "quantity": 3, "islandId": "dusk"},
            {"id": "water-source-001", "type": "water", "position": {"x": 50, "y": 0, "z": 30}, "quantity": 999, "islandId": "meadow"},
        ],
        "pendingApprovals": [],
    }

func _wait_frames(count: int) -> void:
    for _i in range(count):
        await process_frame

func _capture() -> void:
    var img := root.get_texture().get_image()
    var path: String = OS.get_environment("ASTRIX_SHOT_PATH")
    if path.is_empty():
        path = "/tmp/observatory-shots/astrix-godot.png"
    img.save_png(path)
    print("[harness] saved ", path, " ", img.get_size())
    quit()