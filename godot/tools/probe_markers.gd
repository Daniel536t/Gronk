extends SceneTree

## Focused probe: do proposal markers materialize from fixture statuses?
## Prints marker count + positions for three pendingApproval shapes, then quits.

const FIX := preload("res://tools/astrix_fixture.gd")

func _initialize() -> void:
    var main: Node = load("res://scenes/Main.tscn").instantiate()
    root.add_child(main)
    _run()

func _run() -> void:
    FIX.go_offline(root)
    await FIX.wait_frames(self, 20)
    var world: Node = root.find_child("World3D", true, false)
    if world == null:
        print("[markers] FATAL: World3D missing")
        quit(1)
        return

    # Shape 1: nested action + args (harness approval fixture).
    var nested := {
        "state": "AWAITING_APPROVAL", "turn": 7,
        "pendingApproval": {
            "approvalId": "approval-001",
            "action": {"tool": "build_bridge", "args": {"island_a": "meadow", "island_b": "dusk"}},
        },
    }
    world._on_agent_status_received(FIX.snapshot_autumn())
    world._on_agent_status_received(nested)
    await FIX.wait_frames(self, 10)
    print("[markers] nested-action shape -> count=%d" % world._proposal_markers.size())
    for m in world._proposal_markers:
        print("[markers]   at %s" % str((m as Node3D).position))
    # A bridge proposal must mark BOTH shores, never a midpoint dot.
    var ok_endpoints: bool = world._proposal_markers.size() == 2
    print("[markers] nested endpoints ok=%s" % str(ok_endpoints))
    # Same payload, but through the real GameClient signal path.
    var client: Node = root.get_node_or_null("GameClient")
    if client and client.has_signal("astrix_agent_status_received"):
        client.astrix_agent_status_received.emit(nested)
        await FIX.wait_frames(self, 10)
        print("[markers] via-signal shape -> count=%d" % world._proposal_markers.size())

    # Shape 2: flat summary shape (new server build).
    var flat := {
        "state": "AWAITING_APPROVAL", "turn": 3,
        "pendingApproval": {
            "approvalId": "approval-009", "tool": "build_bridge",
            "sourceIsland": "meadow", "destinationIsland": "frost",
        },
    }
    world._on_agent_status_received(flat)
    await FIX.wait_frames(self, 10)
    print("[markers] flat shape -> count=%d" % world._proposal_markers.size())
    for m in world._proposal_markers:
        print("[markers]   at %s" % str((m as Node3D).position))

    # Shape 3: no pending -> markers must clear.
    world._on_agent_status_received({"state": "RUNNING", "turn": 4})
    await FIX.wait_frames(self, 10)
    print("[markers] cleared shape -> count=%d" % world._proposal_markers.size())
    # Re-arm flat shape and capture the frame, so the beacons are SEEN.
    world._on_agent_status_received(flat)
    await FIX.wait_frames(self, 30)
    print("[markers] re-armed -> count=%d" % world._proposal_markers.size())
    for c in root.get_children():
        if c is CanvasLayer:
            (c as CanvasLayer).visible = false
    await FIX.wait_frames(self, 5)
    var img: Image = root.get_texture().get_image()
    img.save_png("/tmp/probe_markers_shot.png")
    print("[markers] shot saved")
    print("[markers] RESULT=PASS" if world._proposal_markers.size() == 2 else "[markers] RESULT=FAIL")
    quit()
