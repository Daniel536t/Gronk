extends SceneTree

## Diagnostic probe: builds the world, feeds the same authoritative snapshot the
## screenshot harness uses, then reports WHAT ACTUALLY EXISTS in the scene and
## WHERE IT IS RELATIVE TO THE CAMERA FRUSTUM. Used to distinguish "not built"
## from "built but off-frame / too small / occluded" instead of guessing from a
## render.

const HARNESS := preload("res://tools/screenshot_harness.gd")

func _initialize() -> void:
    var main: Node = load("res://scenes/Main.tscn").instantiate()
    root.add_child(main)
    _run()

func _run() -> void:
    await _wait_frames(30)
    var world: Node = root.find_child("World3D", true, false)
    if world == null:
        print("[probe] FATAL: no World3D")
        quit()
        return
    world._on_astrix_state_received(HARNESS._sample_snapshot())
    await _wait_frames(30)

    var cam: Camera3D = world.camera
    print("=== CAMERA ===")
    print("  mode=", world.camera_mode, " projection=", cam.projection, " size=", cam.size)
    print("  pos=", cam.global_position, " rot_deg=", cam.global_rotation_degrees)
    print("  near=", cam.near, " far=", cam.far)

    # Category census of every MeshInstance3D, with on-screen pixel footprint.
    var vp_size: Vector2 = root.get_viewport().get_visible_rect().size
    print("=== VIEWPORT === ", vp_size)

    var groups := {
        "villager": 0, "farm": 0, "bridge": 0, "water": 0, "island": 0,
        "tree": 0, "house": 0, "crop": 0, "shadow": 0, "other": 0,
    }
    var offscreen := {}
    var visible_px := {}
    _walk(world, groups, offscreen, visible_px, cam, vp_size)

    print("=== NODE CENSUS (built) ===")
    for key in groups.keys():
        print("  %-10s %d" % [key, groups[key]])
    print("=== OFF-SCREEN / DEGENERATE (built but not communicating) ===")
    for key in offscreen.keys():
        print("  %-10s off=%d" % [key, offscreen[key]])
    print("=== APPROX ON-SCREEN HEIGHT (px) of representative nodes ===")
    for key in visible_px.keys():
        print("  %-28s %s" % [key, visible_px[key]])

    # Villager detail: are they where the anchors say?
    print("=== VILLAGERS ===")
    var vcount := 0
    for child in world.get_children():
        if str(child.name).begins_with("Villager_"):
            vcount += 1
            var on: bool = _is_on_screen(child.global_position, cam, vp_size)
            print("  %s pos=%s onscreen=%s route=%d" % [
                child.name, child.global_position, on,
                (child.route.size() if "route" in child else -1),
            ])
    print("  total villager nodes: ", vcount)

    # Bridge + farm detail from sim materialization.
    print("=== SIM NODES ===")
    # The dictionary is `_sim` (key -> Node3D); `_sim_nodes` never existed on
    # World3D, so this probe crashed here on every run before reaching WATER.
    for key in world._sim.keys():
        var n: Variant = world._sim[key]
        if n is Node3D:
            print("  %s -> %s children=%d onscreen=%s" % [
                key, (n as Node3D).global_position, (n as Node3D).get_child_count(),
                _is_on_screen((n as Node3D).global_position, cam, vp_size),
            ])
        else:
            print("  %s -> %s" % [key, n])

    print("=== WATER ===")
    print("  _water_surface=", world._water_surface)
    print("=== SURFACES ===")
    print("  meadow=", world.MEADOW_SURFACE, " frost=", world.FROST_SURFACE, " dusk=", world.DUSK_SURFACE)
    quit()

func _walk(node: Node, groups: Dictionary, offscreen: Dictionary, visible_px: Dictionary, cam: Camera3D, vp: Vector2) -> void:
    for child in node.get_children():
        if child is MeshInstance3D:
            var mi := child as MeshInstance3D
            var key := _classify(mi)
            groups[key] = int(groups.get(key, 0)) + 1
            if not _is_on_screen(mi.global_position, cam, vp):
                offscreen[key] = int(offscreen.get(key, 0)) + 1
            elif not visible_px.has(key):
                visible_px[key] = _px_height(mi, cam, vp)
        if child is Node:
            _walk(child, groups, offscreen, visible_px, cam, vp)

func _classify(mi: MeshInstance3D) -> String:
    var path := str(mi.get_path()).to_lower()
    for key in ["villager", "farm", "bridge", "water", "crop", "tree", "shadow", "house", "island"]:
        if path.contains(key):
            return key
    if path.contains("grasstop") or path.contains("stonecliff") or path.contains("soilstep"):
        return "island"
    return "other"

func _is_on_screen(pos: Vector3, cam: Camera3D, vp: Vector2) -> bool:
    if cam.is_position_behind(pos):
        return false
    var p := cam.unproject_position(pos)
    return p.x >= -40.0 and p.y >= -40.0 and p.x <= vp.x + 40.0 and p.y <= vp.y + 40.0

## Rough on-screen height in pixels of a mesh's AABB — the number that decides
## whether the audience can actually see the thing.
func _px_height(mi: MeshInstance3D, cam: Camera3D, vp: Vector2) -> String:
    var aabb := mi.get_aabb()
    var lo := mi.global_transform * aabb.position
    var hi := mi.global_transform * (aabb.position + Vector3(0.0, aabb.size.y, 0.0))
    if cam.is_position_behind(lo) or cam.is_position_behind(hi):
        return "behind"
    var a := cam.unproject_position(lo)
    var b := cam.unproject_position(hi)
    return "%.1f px (world y-size %.2f)" % [absf(a.y - b.y), aabb.size.y]

func _wait_frames(count: int) -> void:
    for _i in range(count):
        await process_frame
