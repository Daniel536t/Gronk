extends SceneTree

## Verify specific storytelling props actually exist in the scene and measure how
## big they are on screen. Used to distinguish "not built" from "built but too
## small / occluded / off-frame" without guessing from a render.

const FIX := preload("res://tools/astrix_fixture.gd")

func _initialize() -> void:
    var main: Node = load("res://scenes/Main.tscn").instantiate()
    root.add_child(main)
    _run()

func _run() -> void:
    FIX.go_offline(root)
    await FIX.wait_frames(self, 20)
    var world: Node = root.find_child("World3D", true, false)
    world._on_astrix_state_received(FIX.snapshot_autumn())
    await FIX.wait_frames(self, 40)

    var cam: Camera3D = world.camera
    var vp: Vector2 = root.get_viewport().get_visible_rect().size
    print("[probe] viewport=", vp, " cam.size=", cam.size)

    # Named things the storytelling test asks about.
    for needle in ["FoodStore", "Smoke", "Sack", "CribRoof", "CropRow_Harvestable",
                   "CropRow_Growing", "CropRow_Seedling", "TilledSoil", "Bridge",
                   "Ocean", "Sailboat", "Villager", "OrchardStrip", "Scarecrow"]:
        var hits: Array = []
        _collect(world, needle, hits)
        if hits.is_empty():
            print("[probe] %-22s MISSING" % needle)
            continue
        var first: Node3D = hits[0]
        var on_screen := false
        var px := ""
        if first is Node3D:
            var pos: Vector3 = (first as Node3D).global_position
            on_screen = not cam.is_position_behind(pos)
            if on_screen:
                var p := cam.unproject_position(pos)
                on_screen = p.x > -60.0 and p.y > -60.0 and p.x < vp.x + 60.0 and p.y < vp.y + 60.0
                px = " screen=(%.0f,%.0f)" % [p.x, p.y]
            if first is MeshInstance3D:
                var aabb := (first as MeshInstance3D).get_aabb()
                var lo := (first as MeshInstance3D).global_transform * aabb.position
                var hi := (first as MeshInstance3D).global_transform * (aabb.position + Vector3(0, maxf(aabb.size.y, 0.01), 0))
                if not cam.is_position_behind(lo) and not cam.is_position_behind(hi):
                    px += " h=%.0fpx" % absf(cam.unproject_position(lo).y - cam.unproject_position(hi).y)
        print("[probe] %-22s count=%-4d visible=%s onscreen=%s%s" % [
            needle, hits.size(), str(first.visible if first is Node3D else "?"), str(on_screen), px])
    quit()

func _collect(node: Node, needle: String, out: Array) -> void:
    for child in node.get_children():
        if str(child.name).contains(needle):
            out.append(child)
        _collect(child, needle, out)
