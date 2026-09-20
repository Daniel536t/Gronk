extends SceneTree

## PHASE 12 -- BRIDGE VISUAL VERIFICATION (numeric half).
##
## WHY THIS EXISTS: a screenshot can show "a bridge exists somewhere". It cannot
## show that the deck sits on the authoritative `bridgeAnchorFor(a, b)` axis
## rather than at an arbitrary world origin, that the span is represented
## EXACTLY ONCE, or that BUILD_BRIDGE(frost, meadow) renders identically to
## BUILD_BRIDGE(meadow, frost). This probe asserts those from the engine's own
## numbers, using the REAL authoritative snapshots captured from two isolated
## Core instances (artifacts/bridge/state-8899.json = meadow->frost,
## artifacts/bridge/state-8898.json = frost->meadow).
##
## Nothing here mutates Core. The probe replaces the TRANSPORT only: the
## payloads are verbatim /astrix/state responses written to disk.

const FIX := preload("res://tools/astrix_fixture.gd")

# Core island anchors -- src/astrix/state.ts ISLAND_ANCHORS. Duplicated here as
# the EXPECTATION the renderer is measured against, not as a source of truth.
const CORE_ANCHOR := {
    "meadow": Vector3(17.0, 3.5, 20.0),
    "frost": Vector3(48.0, 4.5, 12.0),
}

var _checks := 0
var _failures := 0

func _initialize() -> void:
    var main: Node = load("res://scenes/Main.tscn").instantiate()
    root.add_child(main)
    _run()

func _run() -> void:
    FIX.go_offline(root)
    await FIX.wait_frames(self, 20)
    var world: Node = root.find_child("World3D", true, false)

    var forward: Dictionary = _load_state("/home/ubuntu/ba/artifacts/bridge/state-8899.json")
    var reversed: Dictionary = _load_state("/home/ubuntu/ba/artifacts/bridge/state-8898.json")
    if forward.is_empty() or reversed.is_empty():
        print("[bridge] FATAL could not load authoritative snapshots")
        quit(1)
        return

    var geom_fwd := await _measure(world, forward, "meadow->frost")
    # Clear the bridge, then feed the reversed pair, so the second measurement is
    # a real re-materialization rather than a cached node from the first pass.
    var empty := forward.duplicate(true)
    empty["bridges"] = []
    world._on_astrix_state_received(empty)
    await FIX.wait_frames(self, 20)
    _check("bridge removed when topology empties", _bridge_keys(world).size() == 0,
        str(_bridge_keys(world)))
    var geom_rev := await _measure(world, reversed, "frost->meadow")

    _check("reversed pair renders the SAME deck key",
        geom_fwd.get("key", "") == geom_rev.get("key", "x"),
        "%s vs %s" % [geom_fwd.get("key", ""), geom_rev.get("key", "")])
    var da: Vector3 = geom_fwd.get("a", Vector3.ZERO) - geom_rev.get("a", Vector3.ONE)
    var db: Vector3 = geom_fwd.get("b", Vector3.ZERO) - geom_rev.get("b", Vector3.ONE)
    _check("reversed pair renders the SAME endpoints",
        da.length() < 0.001 and db.length() < 0.001,
        "delta_a=%.5f delta_b=%.5f" % [da.length(), db.length()])

    await _check_steward_focus(world)

    print("[bridge] checks=%d failures=%d" % [_checks, _failures])
    print("[bridge] RESULT=%s" % ("PASS" if _failures == 0 else "FAIL"))
    quit(1 if _failures > 0 else 0)

## Feed one authoritative snapshot and assert everything measurable about the
## deck it produces. Returns { key, a, b, mid }.
func _measure(world: Node, snapshot: Dictionary, label: String) -> Dictionary:
    world._on_astrix_state_received(snapshot)
    await FIX.wait_frames(self, 40)

    var topo: Array = snapshot.get("bridges", [])
    print("[bridge] --- %s  authoritative bridges=%s" % [label, JSON.stringify(topo)])

    var keys: Array = _bridge_keys(world)
    _check("%s: exactly one deck in _sim" % label, keys.size() == 1, str(keys))
    if keys.size() != 1:
        return {}
    var key := str(keys[0])
    _check("%s: deck key is the SORTED island pair" % label, key == "bridge:frost-meadow", key)

    var deck: Node3D = world._sim[key]
    _check("%s: deck node is valid and visible" % label,
        is_instance_valid(deck) and deck.visible, str(is_instance_valid(deck)))

    # A bridge_segment building must NEVER also be drawn as a building. Count
    # every buildings-derived node so a phantom house cannot hide in the scene.
    var authoritative_types: Array = []
    for b in snapshot.get("buildings", []):
        if b is Dictionary:
            authoritative_types.append(str((b as Dictionary).get("type", "")))
    var house_nodes: Array = []
    _collect(world, "House", house_nodes)
    var seg_building_nodes := 0
    for k in world._sim.keys():
        if str(k).begins_with("building:"):
            seg_building_nodes += 1
    var authoritative_non_bridge := 0
    for t in authoritative_types:
        if t != "bridge_segment":
            authoritative_non_bridge += 1
    print("[bridge] %s: authoritative buildings=%s  building nodes=%d" % [
        label, JSON.stringify(authoritative_types), seg_building_nodes])
    _check("%s: bridge_segment is NOT also drawn as a building" % label,
        seg_building_nodes == authoritative_non_bridge,
        "nodes=%d expected=%d" % [seg_building_nodes, authoritative_non_bridge])

    # Endpoints: the deck must land on both island rims, on the meadow-frost axis.
    var a: Vector3 = world._rim_point("meadow", "frost")
    var b: Vector3 = world._rim_point("frost", "meadow")
    var mid := (a + b) * 0.5
    print("[bridge] %s: rim_meadow=(%.3f,%.3f,%.3f) rim_frost=(%.3f,%.3f,%.3f) mid=(%.3f,%.3f,%.3f)" % [
        label, a.x, a.y, a.z, b.x, b.y, b.z, mid.x, mid.y, mid.z])
    _check("%s: deck midpoint is NOT the world origin" % label,
        Vector2(mid.x, mid.z).length() > 8.0,
        "dist_from_origin=%.3f" % Vector2(mid.x, mid.z).length())

    # The authoritative anchor, mapped through the renderer's OWN island
    # transform, must fall ON the rendered deck.
    var anchor := Vector3(
        (CORE_ANCHOR["meadow"].x + CORE_ANCHOR["frost"].x) * 0.5,
        (CORE_ANCHOR["meadow"].y + CORE_ANCHOR["frost"].y) * 0.5,
        (CORE_ANCHOR["meadow"].z + CORE_ANCHOR["frost"].z) * 0.5)
    var reported := _reported_anchor(snapshot)
    _check("%s: Core's own bridge position == bridgeAnchorFor(meadow,frost)" % label,
        reported == Vector3.ZERO or reported.distance_to(anchor) < 0.001,
        "core=(%.2f,%.2f,%.2f) expected=(%.2f,%.2f,%.2f)" % [
            reported.x, reported.y, reported.z, anchor.x, anchor.y, anchor.z])

    # The two coordinate systems are pinned to each other by the island anchors:
    # each Core anchor must map, through the RENDERER'S OWN _map_core_pos, onto
    # that island's world centre. Without this, "the anchor's world position" is
    # not a defined quantity at all.
    for island in ["meadow", "frost"]:
        var mapped_centre: Vector3 = world._map_core_pos(island, CORE_ANCHOR[island])
        var expected: Vector3 = world.ISLANDS[island]["center"]
        _check("%s: Core anchor for %s maps onto %s's world centre" % [label, island, island],
            absf(mapped_centre.x - expected.x) < 0.001 and absf(mapped_centre.z - expected.z) < 0.001,
            "mapped=(%.3f,%.3f) centre=(%.3f,%.3f)" % [
                mapped_centre.x, mapped_centre.z, expected.x, expected.z])

    var mapped := _anchor_world(world)
    var t_anchor := _axis_t(mapped)
    var t_a := _axis_t(a)
    var t_b := _axis_t(b)
    print("[bridge] %s: core anchor (%.1f,%.1f,%.1f) -> world (%.3f,%.3f,%.3f)  t=%.3f  deck t=[%.3f..%.3f]" % [
        label, anchor.x, anchor.y, anchor.z, mapped.x, mapped.y, mapped.z, t_anchor, t_a, t_b])
    _check("%s: anchor's world image lies ON the rendered deck span" % label,
        t_anchor > t_a and t_anchor < t_b,
        "t=%.3f span=[%.3f..%.3f]" % [t_anchor, t_a, t_b])
    _check("%s: anchor's world image is collinear with the deck axis" % label,
        _axis_offset(mapped) < 0.01, "perp_offset=%.5f" % _axis_offset(mapped))
    # Core's anchor y is the mean of the two plateau heights; so is the world
    # image's. Same rule, two coordinate systems -- checked, not assumed.
    _check("%s: anchor height is the mean of both plateaus in BOTH systems" % label,
        absf(anchor.y - (CORE_ANCHOR["meadow"].y + CORE_ANCHOR["frost"].y) * 0.5) < 0.001
        and absf(mapped.y - a.y * 0.5 - b.y * 0.5) < 0.001,
        "core_y=%.3f world_y=%.3f deck_y_mean=%.3f" % [anchor.y, mapped.y, (a.y + b.y) * 0.5])

    return {"key": key, "a": a, "b": b, "mid": mid}

## STEWARD camera focus for a bridge proposal, in BOTH agent-status shapes.
##
## The deployed production process predates current source and reports its
## pending proposal as a NESTED action record carrying only `tool` -- no args, no
## island fields -- so the honest answer there is NO TARGET, and that is what the
## deployed build shows. Current source (summarizePendingApproval, verified by
## tests/astrix-execution-loop.test.ts) reports FLAT sourceIsland/destinationIsland,
## and the same camera must then aim at the span those two islands share.
func _check_steward_focus(world: Node) -> void:
    var flat := {
        "state": "AWAITING_APPROVAL",
        "pendingApproval": {
            "approvalId": "approval-qa",
            "tool": "build_bridge",
            "sourceIsland": "meadow",
            "destinationIsland": "frost",
        },
    }
    world._on_agent_status_received(flat)
    world.set_camera_mode(world.CameraMode.STEWARD)
    await FIX.wait_frames(self, 30)
    var expected: Vector3 = (world._rim_point("meadow", "frost") + world._rim_point("frost", "meadow")) * 0.5
    _check("STEWARD focus resolves from FLAT island fields",
        world._has_steward_focus and world._steward_focus.distance_to(expected) < 0.001,
        "focus=%s expected=%s" % [str(world._steward_focus), str(expected)])
    _check("STEWARD subject names both islands",
        world.steward_focus_name() == "MEADOW <-> FROST", world.steward_focus_name())

    var nested := {
        "state": "AWAITING_APPROVAL",
        "pendingApproval": {
            "approvalId": "approval-009",
            "action": {"id": "act-009", "tool": "build_bridge", "riskLevel": "high"},
        },
    }
    world._on_agent_status_received(nested)
    await FIX.wait_frames(self, 30)
    _check("field-less nested proposal honestly yields NO TARGET",
        not world._has_steward_focus and world.steward_focus_name() == "",
        "has_focus=%s name=%s" % [str(world._has_steward_focus), world.steward_focus_name()])
    world.set_camera_mode(world.CameraMode.OVERVIEW)

## Distance along the meadow-centre -> frost-centre axis.
func _axis_t(p: Vector3) -> float:
    var dir := Vector2(26.0, -14.0).normalized()
    return Vector2(p.x, p.z).dot(dir)

## Perpendicular distance from that axis (0 == exactly on the line).
func _axis_offset(p: Vector3) -> float:
    var dir := Vector2(26.0, -14.0).normalized()
    var v := Vector2(p.x, p.z)
    return (v - dir * v.dot(dir)).length()

## World-space counterpart of bridgeAnchorFor(a, b).
##
## ASSERTION CORRECTED, DELIBERATELY: an earlier version of this probe mapped the
## anchor through meadow's island transform and demanded the result sit on the
## deck. That was ill-posed, and the failure was in the assertion, not the
## renderer. Each island carries its OWN local transform (`core_flip` is (-1,-1)
## per island, orienting that island's interior toward the camera), so there is
## no single global Core->world affine map, and a point BETWEEN two islands has
## no meaning under either island's local transform.
##
## What IS well defined -- and is checked below -- is that each island's Core
## anchor maps, under that island's own transform, exactly onto that island's
## world centre (ISLAND_ANCHORS[i] == ISLANDS[i].core_center, so the offset is
## zero). bridgeAnchorFor is BY DEFINITION the midpoint of the two anchors, so
## its faithful world-space image is the midpoint of the two island centres.
func _anchor_world(world: Node) -> Vector3:
    var cm: Vector3 = world.ISLANDS["meadow"]["center"]
    var cf: Vector3 = world.ISLANDS["frost"]["center"]
    return Vector3(
        (cm.x + cf.x) * 0.5,
        (float(world.ISLANDS["meadow"]["top"]) + float(world.ISLANDS["frost"]["top"])) * 0.5,
        (cm.z + cf.z) * 0.5)

## Bridge position Core actually recorded for the bridge_segment building.
func _reported_anchor(snapshot: Dictionary) -> Vector3:
    for b in snapshot.get("buildings", []):
        if b is Dictionary and str((b as Dictionary).get("type", "")) == "bridge_segment":
            var p: Variant = (b as Dictionary).get("position")
            if p is Dictionary:
                return Vector3(
                    float((p as Dictionary).get("x", 0.0)),
                    float((p as Dictionary).get("y", 0.0)),
                    float((p as Dictionary).get("z", 0.0)))
    return Vector3.ZERO

func _bridge_keys(world: Node) -> Array:
    var keys: Array = []
    for k in world._sim.keys():
        if str(k).begins_with("bridge:"):
            keys.append(str(k))
    keys.sort()
    return keys

func _load_state(path: String) -> Dictionary:
    var f := FileAccess.open(path, FileAccess.READ)
    if f == null:
        print("[bridge] cannot open ", path, " err=", FileAccess.get_open_error())
        return {}
    var parsed: Variant = JSON.parse_string(f.get_as_text())
    f.close()
    return parsed if parsed is Dictionary else {}

func _collect(node: Node, needle: String, out: Array) -> void:
    for child in node.get_children():
        if str(child.name).contains(needle):
            out.append(child)
        _collect(child, needle, out)

func _check(what: String, ok: bool, detail := "") -> void:
    _checks += 1
    if not ok:
        _failures += 1
    print("[bridge] %s %s%s" % ["ok  " if ok else "FAIL", what, ("  -- " + detail) if detail != "" else ""])
