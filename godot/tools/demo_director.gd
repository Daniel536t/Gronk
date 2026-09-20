extends SceneTree

## Demo director: runs the REAL game (Main.tscn) against a chosen server and
## stays up until killed. Used for live screen capture — no fixtures, no
## staged state; whatever the server holds is what renders.
## Usage:
##   ASTRIX_ORIGIN=http://127.0.0.1:8789 ASTRIX_DEMO_CAM=overview
##   godot --path . --script tools/demo_director.gd --resolution 1280x720
## Kill with SIGTERM/SIGINT when the take is done.

func _initialize() -> void:
    var main: Node = load("res://scenes/Main.tscn").instantiate()
    root.add_child(main)
    var client: Node = root.get_node_or_null("GameClient")
    var origin := OS.get_environment("ASTRIX_ORIGIN")
    if client and not origin.is_empty():
        client.api_origin = origin
    await process_frame
    var world: Node = root.find_child("World3D", true, false)
    if world:
        world.set_camera_mode_named(OS.get_environment("ASTRIX_DEMO_CAM") if not OS.get_environment("ASTRIX_DEMO_CAM").is_empty() else "overview")
    print("[director] live on ", origin)
