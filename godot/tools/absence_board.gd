extends SceneTree

## Absence-drill storyboard: renders REAL drill states, not fixtures.
##
## Input is the artifact written by `npm run astrix:absence-drill`
## (artifacts/astrix-absence-drill.json). Four frames are captured:
##   1. managed     — last ONLINE day (steward governing)
##   2. absent      — middle ABSENT day (loop STOPPED, world alone)
##   3. return      — first RECOVER day (reconnect state)
##   4. recovered   — final day (scored outcome)
##
## Each frame feeds the snapshot production serves over /astrix/state plus an
## agent status built ONLY from recorded drill truth: the loop's recorded
## state/turn/objective and that day's recorded events. No staged data, no
## invented log lines: if the artifact lacks something, the frame shows the
## HUD's honest unknown state instead.
##
## Usage:
##   ASTRIX_BOARD_OUT=/tmp/board \
##   .tools/godot4/Godot_v4.7.2-stable_linux.x86_64 --path godot \
##     --script tools/absence_board.gd --resolution 1280x720

const FIX := preload("res://tools/astrix_fixture.gd")

func _initialize() -> void:
    var main: Node = load("res://scenes/Main.tscn").instantiate()
    root.add_child(main)
    _run()

func _run() -> void:
    FIX.go_offline(root)
    await FIX.wait_frames(self, 24)
    var world: Node = root.find_child("World3D", true, false)
    if world == null:
        print("[board] FATAL: World3D missing")
        quit(1)
        return
    var artifact := _load_artifact()
    if artifact.is_empty():
        print("[board] FATAL: no artifact")
        quit(1)
        return
    var out_dir := OS.get_environment("ASTRIX_BOARD_OUT")
    if out_dir.is_empty():
        out_dir = "/tmp/shots/absence-board"

    var picks := _pick_frames(artifact)
    for pick in picks:
        var entry: Dictionary = pick["entry"]
        world.set_camera_mode_named("overview")
        world._on_astrix_state_received(entry["snapshot"])
        _drive_hud(entry, artifact)
        await FIX.wait_frames(self, 150)
        _capture(out_dir + "/" + str(pick["name"]) + ".png")
    quit()

func _load_artifact() -> Dictionary:
    var path := OS.get_environment("ASTRIX_BOARD_ARTIFACT")
    if path.is_empty():
        path = "/home/ubuntu/ba/artifacts/astrix-absence-drill.json"
    if not FileAccess.file_exists(path):
        print("[board] artifact not found: ", path)
        return {}
    var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
    return parsed if parsed is Dictionary else {}

## The four storyboard moments, resolved from recorded phases only.
func _pick_frames(artifact: Dictionary) -> Array:
    var snaps: Array = artifact.get("snapshots", [])
    var online: Array = snaps.filter(func(e: Variant) -> bool: return (e as Dictionary).get("phase") == "ONLINE")
    var absent: Array = snaps.filter(func(e: Variant) -> bool: return (e as Dictionary).get("phase") == "ABSENT")
    var recover: Array = snaps.filter(func(e: Variant) -> bool: return (e as Dictionary).get("phase") == "RECOVER")
    var out: Array = []
    if not online.is_empty():
        out.append({"name": "1-managed", "entry": online[online.size() - 1]})
    if not absent.is_empty():
        out.append({"name": "2-absent", "entry": absent[absent.size() / 2]})
    if not recover.is_empty():
        out.append({"name": "3-return", "entry": recover[0]})
        out.append({"name": "4-recovered", "entry": recover[recover.size() - 1]})
    return out

## Drive the Observatory HUD from recorded truth only: the loop's recorded
## state/turn/objective plus that day's recorded events. Shapes match the real
## /astrix/agent/status payload the HUD consumes in production.
func _drive_hud(entry: Dictionary, artifact: Dictionary) -> void:
    var client: Node = root.get_node_or_null("GameClient")
    if client == null:
        return
    var steward: Dictionary = entry.get("steward", {})
    var day := int((entry as Dictionary).get("day", 0))
    var day_events: Array = []
    for event in (artifact.get("events", []) as Array):
        if event is Dictionary and int((event as Dictionary).get("day", -1)) == day:
            day_events.append({"type": str((event as Dictionary).get("type", "")),
                "at": (event as Dictionary).get("at", 0),
                "data": (event as Dictionary).get("data", {})})
    client.astrix_state_received.emit(entry["snapshot"])
    client.astrix_agent_status_received.emit({
        "state": str(steward.get("state", "STOPPED")),
        "turn": int(steward.get("turn", 0)),
        "objective": str(steward.get("objective", "")),
        "lastEvents": day_events.slice(0, 8),
    })

func _capture(path: String) -> void:
    var img: Image = root.get_texture().get_image()
    DirAccess.make_dir_recursive_absolute(path.get_base_dir())
    img.save_png(path)
    print("[board] saved ", path, " ", img.get_size())
