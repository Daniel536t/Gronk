extends SceneTree

## Focused diagnostic for the rebuilt world: confirms the authoritative snapshot
## lands in WorldState, that materialization produces the expected node
## categories, and reports on-screen pixel sizes so "built but illegible" is
## distinguishable from "not built".

const HARNESS := preload("res://tools/screenshot_harness.gd")
const FIX := preload("res://tools/astrix_fixture.gd")

func _initialize() -> void:
    var main: Node = load("res://scenes/Main.tscn").instantiate()
    root.add_child(main)
    _run()

func _run() -> void:
    FIX.go_offline(root)
    await _wait_frames(20)
    var world: Node = root.find_child("World3D", true, false)
    var ws: Node = root.get_node_or_null("WorldState")
    if world == null:
        print("[diag] FATAL no World3D")
        quit()
        return

    var snap: Dictionary = HARNESS._sample_snapshot()
    world._on_astrix_state_received(snap)
    await _wait_frames(25)

    print("[diag] initialized=", ws.initialized, " pop=", ws.population,
          " buildings=", ws.buildings.size(), " crops=", ws.crops.size(),
          " bridges=", ws.bridges.size(), " season=", ws.season, " time=", ws.time_of_day)
    print("[diag] season_applied=", world._season, " sim_phase=", "%.3f" % world._sim_phase)
    print("[diag] sim keys=", world._sim.keys())
    print("[diag] villagers=", world._villagers.size(), " anchors=", world._villager_anchors.size())
    print("[diag] seasonal_meshes=", world._seasonal.size(), " snow_caps=", world._snow_caps.size())

    var cam: Camera3D = world.camera
    var vp: Vector2 = root.get_viewport().get_visible_rect().size
    print("[diag] camera mode=", world.camera_mode, " size=", cam.size,
          " pos=", cam.global_position, " rot=", cam.global_rotation_degrees)

    # Category census with on-screen height, so legibility is measured not guessed.
    var census := {}
    var pixels := {}
    _walk(world, census, pixels, cam, vp)
    print("[diag] === CENSUS (count / representative on-screen height px) ===")
    var keys := census.keys()
    keys.sort()
    for k in keys:
        print("  %-14s %4d   %s" % [k, census[k], pixels.get(k, "-")])

    # Villager legibility is the P0 question: how tall is a person on screen?
    for c in world.get_children():
        if str(c.name).begins_with("Villager_"):
            var lo: Vector3 = c.global_position
            var hi: Vector3 = lo + Vector3(0.0, 1.55, 0.0)
            if not cam.is_position_behind(lo) and not cam.is_position_behind(hi):
                var a := cam.unproject_position(lo)
                var b := cam.unproject_position(hi)
                print("[diag] %s at %s -> %.1f px tall, screen %s" % [
                    c.name, lo, absf(a.y - b.y), a])
    quit()

func _walk(node: Node, census: Dictionary, pixels: Dictionary, cam: Camera3D, vp: Vector2) -> void:
    for child in node.get_children():
        if child is MeshInstance3D:
            var key := _classify(child as MeshInstance3D)
            census[key] = int(census.get(key, 0)) + 1
            if not pixels.has(key):
                pixels[key] = _px(child as MeshInstance3D, cam)
        _walk(child, census, pixels, cam, vp)

func _classify(mi: MeshInstance3D) -> String:
    var path := str(mi.get_path()).to_lower()
    for key in ["villager", "crop", "farmplot", "barn", "house", "storage", "bridge",
                "ocean", "whitecap", "foam", "beach", "cliff", "grass", "soil",
                "tree", "bush", "grasstuft", "rock", "well", "stall", "boat", "dock",
                "path", "plaza", "snow", "fence", "scarecrow", "crystal", "lantern"]:
        if path.contains(key):
            return key
    return "other"

func _px(mi: MeshInstance3D, cam: Camera3D) -> String:
    var aabb := mi.get_aabb()
    var lo := mi.global_transform * aabb.position
    var hi := mi.global_transform * (aabb.position + Vector3(0.0, maxf(aabb.size.y, 0.01), 0.0))
    if cam.is_position_behind(lo) or cam.is_position_behind(hi):
        return "behind"
    var a := cam.unproject_position(lo)
    var b := cam.unproject_position(hi)
    return "%.1f px" % absf(a.y - b.y)

func _wait_frames(count: int) -> void:
    for _i in range(count):
        await process_frame
