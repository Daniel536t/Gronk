extends SceneTree

## Deterministic ASTrix render harness.
##
## Usage:
##   ASTRIX_SHOT_PATH=/tmp/x.png ASTRIX_SHOT_SCENARIO=autumn|winter|evening|approval
##   ASTRIX_SHOT_CAMERA=observatory|archipelago|follow
##   godot --path . --script tools/screenshot_harness.gd --resolution WxH
##
## Takes the world offline (see astrix_fixture.gd) so the capture always reflects
## the requested fixture rather than whatever the live server currently holds.

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
        print("[harness] FATAL: World3D missing")
        quit(1)
        return

    var scenario := OS.get_environment("ASTRIX_SHOT_SCENARIO")
    if scenario.is_empty():
        scenario = "autumn"
    var snapshot := _snapshot_for(scenario)

    # Camera mode: the same world, framed for the shot being captured.
    var cam_mode := OS.get_environment("ASTRIX_SHOT_CAMERA")
    # Name-addressed so the enum can gain modes without silently reassigning the
    # meaning of a hardcoded index in this dev tool.
    world.set_camera_mode_named(cam_mode if not cam_mode.is_empty() else "overview")

    world._on_astrix_state_received(snapshot)

    # Drive the Observatory HUD + approval UI from the real signal path, so the
    # captured UI is the production UI reacting to production-shaped data.
    if Engine.has_singleton("GameClient") or root.has_node("GameClient"):
        var client: Node = root.get_node_or_null("GameClient")
        if client:
            client.astrix_state_received.emit(snapshot)
            var with_approval := scenario == "approval"
            var state_name := "AWAITING APPROVAL" if with_approval else "EXECUTING"
            # A real-snapshot capture (ASTRIX_SHOT_SNAPSHOT) carries no steward
            # narrative: report the honest idle truth (no run, no events)
            # instead of a fixture feed that would describe things which never
            # happened to this world.
            var status: Dictionary
            if not OS.get_environment("ASTRIX_SHOT_SNAPSHOT").is_empty() and not with_approval:
                status = {"state": "IDLE", "turn": 0, "objective": "",
                    "currentAction": null, "lastEvents": []}
            else:
                status = FIX.agent_status_winter() if scenario == "winter" \
                    else FIX.agent_status(state_name, with_approval)
            client.astrix_agent_status_received.emit(status)
            if with_approval:
                client.astrix_approval_requested.emit(FIX.pending_approval())

    # ASTRIX_SHOT_NO_HUD=1 strips every CanvasLayer so a capture shows the 3D
    # world alone. Diagnostics only: it is how the portrait bottom band was
    # proven to be a camera clip rather than an opaque UI panel.
    if OS.get_environment("ASTRIX_SHOT_NO_HUD") == "1":
        _hide_hud(root)

    # Let the camera settle, crops/villagers spawn, and the light grade ease in.
    await FIX.wait_frames(self, 150)
    _capture()

func _snapshot_for(scenario: String) -> Dictionary:
    # ASTRIX_SHOT_SNAPSHOT=<path> feeds a REAL snapshot (e.g. the
    # chain-catchup output) instead of a fixture: the render then shows an
    # actual world state, never staged data. The file holds either the raw
    # snapshot or {"snapshot": snapshot}.
    var snap_path := OS.get_environment("ASTRIX_SHOT_SNAPSHOT")
    if not snap_path.is_empty() and FileAccess.file_exists(snap_path):
        var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(snap_path))
        if parsed is Dictionary:
            if (parsed as Dictionary).has("snapshot"):
                return (parsed as Dictionary)["snapshot"]
            return parsed
    match scenario:
        "winter": return FIX.snapshot_winter()
        "evening": return FIX.snapshot_evening()
        _: return FIX.snapshot_autumn()

static func _hide_hud(node: Node) -> void:
    if node is CanvasLayer:
        (node as CanvasLayer).visible = false
        return
    for child in node.get_children():
        _hide_hud(child)

func _capture() -> void:
    var img: Image = root.get_texture().get_image()
    var path := OS.get_environment("ASTRIX_SHOT_PATH")
    if path.is_empty():
        path = "/tmp/observatory-shots/astrix-godot.png"
    DirAccess.make_dir_recursive_absolute(path.get_base_dir())
    img.save_png(path)
    print("[harness] saved ", path, " ", img.get_size())
    quit()

# ---------------------------------------------------------------------------
# Back-compat: older probes call these directly.
# ---------------------------------------------------------------------------
static func _sample_snapshot() -> Dictionary:
    return FIX.snapshot_autumn()
