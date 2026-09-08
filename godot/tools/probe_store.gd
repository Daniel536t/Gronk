extends SceneTree

## Focused probe: dump the FoodStore subtree with world + screen coordinates, so
## "the granary has no sacks" can be diagnosed instead of guessed at.

const FIX := preload("res://tools/astrix_fixture.gd")

func _initialize() -> void:
    var main: Node = load("res://scenes/Main.tscn").instantiate()
    root.add_child(main)
    _run()

func _run() -> void:
    FIX.go_offline(root)
    await FIX.wait_frames(self, 20)
    var world: Node = root.find_child("World3D", true, false)
    var snap := FIX.snapshot_autumn()
    world._on_astrix_state_received(snap)
    await FIX.wait_frames(self, 30)

    var ws: Node = root.get_node_or_null("WorldState")
    print("[store] authoritative food=", ws.food, " capacity=", world.FOOD_STORE_CAPACITY)
    var expected := int(round(clampf(float(ws.food) / float(world.FOOD_STORE_CAPACITY), 0.0, 1.0) * 5.0))
    print("[store] expected stock stacks=", expected)

    var store: Node = world.get_node_or_null("FoodStore")
    if store == null:
        for c in world.get_children():
            if str(c.name).begins_with("FoodStore"):
                store = c
    if store == null:
        print("[store] FATAL: no FoodStore node under World3D")
        quit()
        return

    var cam: Camera3D = world.camera
    print("[store] node=", store.name, " pos=", (store as Node3D).global_position,
          " children=", store.get_child_count())
    var sacks := 0
    # Walk the WHOLE subtree: stock stacks are Node3D groups, so a
    # MeshInstance3D-only filter reported zero when several existed.
    var queue: Array[Node] = [store]
    while not queue.is_empty():
        var node: Node = queue.pop_front()
        for child in node.get_children():
            queue.append(child)
        if not (node is Node3D) or node == store:
            continue
        var n3 := node as Node3D
        var p := cam.unproject_position(n3.global_position)
        var h := 0.0
        if node is MeshInstance3D:
            var aabb := (node as MeshInstance3D).get_aabb()
            var lo := n3.global_transform * aabb.position
            var hi := n3.global_transform * (aabb.position + Vector3(0, maxf(aabb.size.y, 0.01), 0))
            h = absf(cam.unproject_position(lo).y - cam.unproject_position(hi).y)
        if str(n3.name).begins_with("Sack"):
            sacks += 1
            # Measure the whole stack: base to the top of its cap.
            var top := cam.unproject_position(n3.global_position + Vector3(0, 2.2, 0))
            h = absf(p.y - top.y)
        print("  %-16s screen=(%.0f,%.0f) h=%.0fpx vis=%s" % [n3.name, p.x, p.y, h, str(n3.visible)])
    print("[store] stock stacks built=", sacks)
    quit()
