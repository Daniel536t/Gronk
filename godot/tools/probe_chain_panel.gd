extends SceneTree

## Chain-panel verification: points GameClient at a REAL server (default
## 127.0.0.1:8788) so the ⛓ row renders live data, not fallback text.
## Usage:
##   ASTRIX_SHOT_PATH=/tmp/x.png ASTRIX_ORIGIN=http://127.0.0.1:8788
##   godot --path . --script tools/probe_chain_panel.gd --resolution 1280x720

const FIX := preload("res://tools/astrix_fixture.gd")

func _initialize() -> void:
    var main: Node = load("res://scenes/Main.tscn").instantiate()
    root.add_child(main)
    _run()

func _run() -> void:
    # Origin FIRST, before any poll timer can fire: GameClient boots polling
    # on its default origin, and a single early poll to the wrong server
    # permanently stains the sticky activity feed (world strip would recover
    # on the next poll; the feed never forgets).
    var client0: Node = root.get_node_or_null("GameClient")
    var origin0 := OS.get_environment("ASTRIX_ORIGIN")
    if client0 and not origin0.is_empty():
        client0.api_origin = origin0
    await FIX.wait_frames(self, 10)
    var client: Node = root.get_node_or_null("GameClient")
    if client == null:
        print("[chainprobe] FATAL: no GameClient")
        quit(1)
        return
    # Do NOT go offline: this probe needs the real /astrix/* surface.
    # (Origin was already pinned at _initialize, before any poll could fire.)
    var world: Node = root.find_child("World3D", true, false)
    world.set_camera_mode_named("overview")
    # No fixture: the world AND the feed both come from the live server polls,
    # exactly like production. Slower to settle (poll-driven), but honest.
    await FIX.wait_frames(self, 400)
    var img: Image = root.get_texture().get_image()
    var path := OS.get_environment("ASTRIX_SHOT_PATH")
    if path.is_empty():
        path = "/tmp/shots/chain-panel-live.png"
    DirAccess.make_dir_recursive_absolute(path.get_base_dir())
    img.save_png(path)
    print("[chainprobe] saved ", path)
    quit()
