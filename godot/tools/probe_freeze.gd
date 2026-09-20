extends SceneTree

## PHASE 13 -- ANIMATION QA UNDER A HELD CLOCK.
##
## THE REQUIREMENT: while ASTrix holds the world clock for a human decision, the
## Observatory must not falsely communicate world progression. Crops must not
## keep growing. Purely environmental motion (wind, water, moored hulls) may
## continue, because it asserts nothing about simulation state.
##
## THE TEST: feed ONE authoritative snapshot -- the real production world at
## /astrix/state while it sits in AWAITING_APPROVAL (day 5, every crop at
## growthStage 0.125) -- and then let real seconds pass WITHOUT a new snapshot,
## exactly as the deployed client does while the clock is held. State-derived
## geometry must be bit-identical afterwards; environmental motion must not be.
## Finally, raise growthStage in the payload and confirm the crops DO grow, so
## the frozen result above is a consequence of frozen state and not of a
## renderer that simply cannot animate growth at all.

const FIX := preload("res://tools/astrix_fixture.gd")
const HELD_STATE := "/home/ubuntu/ba/artifacts/bridge/state-8787.json"

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

    var held: Dictionary = _load(HELD_STATE)
    if held.is_empty():
        print("[freeze] FATAL cannot load ", HELD_STATE)
        quit(1)
        return
    var stages: Array = []
    for c in held.get("crops", []):
        if c is Dictionary:
            stages.append(float((c as Dictionary).get("growthStage", 0.0)))
    print("[freeze] held snapshot: day=%s time=%s crops=%d stages=%s" % [
        str(held.get("day", "?")), str(held.get("time", "?")), stages.size(), str(stages)])

    world._on_astrix_state_received(held)
    await FIX.wait_frames(self, 60)

    var before := _sample(world)
    print("[freeze] t0    ", _describe(before))
    _check("crops are actually rendered (otherwise this proves nothing)",
        int(before["crop_count"]) > 0, "rows=%d" % int(before["crop_count"]))
    _coverage(world, held)

    # Real seconds of held clock: no new snapshot arrives, because Core's tick
    # returns early while the loop is AWAITING_APPROVAL.
    await FIX.wait_frames(self, 180)
    var after := _sample(world)
    print("[freeze] t+180f", _describe(after))

    _check("engine time really advanced (the scene is live, not stalled)",
        float(after["time"]) > float(before["time"]) + 0.5,
        "%.2fs -> %.2fs" % [float(before["time"]), float(after["time"])])
    _check("CROP GROWTH GEOMETRY UNCHANGED while the clock is held (sway-invariant)",
        str(before["heights"]) == str(after["heights"]),
        "%s -> %s" % [str(before["heights"]), str(after["heights"])])
    _check("crop growth scale untouched while the clock is held",
        str(before["scales"]) == str(after["scales"]),
        "%s -> %s" % [str(before["scales"]), str(after["scales"])])
    _check("wind still moves the crop rows (environmental, asserts nothing)",
        str(before["sway"]) != str(after["sway"]), "sway changed")
    _check("moored hulls still rock (environmental, asserts nothing)",
        str(before["boats"]) != str(after["boats"]), "boat yaw changed")
    # The sway is real geometry, not a bookkeeping value: the rows' WORLD-SPACE
    # silhouette moves while their state-derived height does not.
    _check("the swaying rows really move in world space (sway is not cosmetic bookkeeping)",
        str(before["wheights"]) != str(after["wheights"]),
        "%s -> %s" % [str((before["wheights"] as Array).slice(0, 2)), str((after["wheights"] as Array).slice(0, 2))])

    # Re-delivering the SAME snapshot is what polling does while the clock is
    # held. It must not read as growth either.
    world._on_astrix_state_received(held)
    await FIX.wait_frames(self, 60)
    var again := _sample(world)
    _check("re-delivering the identical snapshot does not grow anything",
        str(after["heights"]) == str(again["heights"]),
        "%s -> %s" % [str(after["heights"]), str(again["heights"])])

    # Now let authoritative time move. Growth MUST appear, or the freeze above
    # would only prove the renderer is incapable of showing growth.
    var advanced := held.duplicate(true)
    var grown: Array = []
    for c in advanced.get("crops", []):
        if c is Dictionary:
            (c as Dictionary)["growthStage"] = 0.62
            grown.append(0.62)
    advanced["day"] = int(held.get("day", 5)) + 3
    world._on_astrix_state_received(advanced)
    await FIX.wait_frames(self, 90)
    var ws: Node = root.get_node_or_null("/root/WorldState")
    var raw_rows: int = (world._crop_rows as Array).size()
    var farm_keys: Array = []
    for k in world._sim.keys():
        if str(k).contains("farm"):
            farm_keys.append(str(k))
    print("[freeze] after advance: ws.crops=%d ws.buildings=%d registry_entries=%d farm_nodes=%s" % [
        (ws.crops as Dictionary).size() if ws != null else -1,
        (ws.buildings as Dictionary).size() if ws != null else -1,
        raw_rows, str(farm_keys)])
    # REGRESSION LOCK for the defect this probe found: rebuilding a farm frees its
    # old rows, and the wind pass has to compact those entries out. It could not,
    # because `node is Node3D` on a freed reference raised a script error that
    # aborted the pass -- so the registry grew to 12 stale entries and no crop was
    # animated again for the rest of the session. 6 crops must mean 6 entries.
    # Compared against the AUTHORITATIVE crop count, not the literal 6, so the
    # lock keeps meaning if the captured snapshot ever carries a different world.
    var authoritative_crops: int = (ws.crops as Dictionary).size() if ws != null else -1
    _check("the wind registry compacts freed rows after a farm rebuild",
        raw_rows == authoritative_crops,
        "registry_entries=%d authoritative_crops=%d (12 vs 6 = the pre-fix leak)" % [
            raw_rows, authoritative_crops])
    var risen := _sample(world)
    print("[freeze] grown ", _describe(risen))
    _check("crops DO grow when authoritative growthStage rises",
        _max_height(risen) > _max_height(again) + 0.05,
        "max height %.3f -> %.3f" % [_max_height(again), _max_height(risen)])

    print("[freeze] checks=%d failures=%d" % [_checks, _failures])
    print("[freeze] RESULT=%s" % ("PASS" if _failures == 0 else "FAIL"))
    quit(1 if _failures > 0 else 0)

## COVERAGE. A held clock is only half the truth requirement: the Observatory must
## also not UNDER-represent what Core holds. One authoritative crop is supposed to
## be one planted row (World3D._plant_rows over AstrixAssets.farm_plot's ridges),
## so the rendered row count must equal the authoritative crop count.
##
## COLLECTION CORRECTED, DELIBERATELY. This probe first gathered rows by node NAME
## ("contains CropRow") and reported 2 rendered rows for 6 authoritative crops --
## which would have been a real defect had it been true. It was not: Godot renames
## colliding siblings added through add_child() without force_readable_name, and
## the 2nd and 3rd row of each farm are therefore called "@Node3D@556" /
## "@Node3D@561", not "CropRow_Seedling2". All three rows were present the whole
## time. Rows are now enumerated from the renderer's OWN registry, World3D
## ._crop_rows -- the exact set of nodes the wind pass animates -- which cannot be
## fooled by naming. (The same trap undercounted the tilled ridge clumps.)
func _rows_of(world: Node) -> Array:
    var rows: Array = []
    for entry in world._crop_rows:
        var node: Variant = entry.get("node")
        # Same freed-operand trap the renderer had: valid-check first. This probe
        # hit it too -- that is how the renderer bug was found.
        if is_instance_valid(node) and node is Node3D:
            rows.append(node)
    rows.sort_custom(func(a, b): return str(a.get_path()) < str(b.get_path()))
    return rows

func _coverage(world: Node, held: Dictionary) -> void:
    var per_farm := {}
    for c in held.get("crops", []):
        if c is Dictionary:
            var f := str((c as Dictionary).get("farmPlotId", "?"))
            per_farm[f] = int(per_farm.get(f, 0)) + 1
    var total := 0
    for k in per_farm:
        total += int(per_farm[k])
    var rows: Array = _rows_of(world)
    print("[freeze] authoritative crops per farm %s (total %d); rendered rows %d" % [
        str(per_farm), total, rows.size()])
    for r in rows:
        print("[freeze]   rendered row: %s  (%s)" % [str((r as Node).get_path()), (r as Node3D).name])
    _check("every authoritative crop is rendered as its own row",
        rows.size() == total, "authoritative=%d rendered=%d" % [total, rows.size()])

## Everything this probe compares, measured from the live scene.
func _sample(world: Node) -> Dictionary:
    var rows: Array = _rows_of(world)
    var heights: Array = []
    var wheights: Array = []
    var scales: Array = []
    var sway: Array = []
    for r in rows:
        var row := r as Node3D
        heights.append("%.4f" % _state_height_of(row))
        wheights.append("%.4f" % _world_height_of(row))
        scales.append("%.4f" % row.scale.y)
        sway.append("%.5f" % row.rotation.z)
    var boats: Array = []
    for b in world._boats:
        if is_instance_valid(b):
            boats.append("%.5f" % (b as Node3D).rotation.y)
    return {
        "crop_count": rows.size(), "heights": heights, "wheights": wheights,
        "scales": scales, "sway": sway, "boats": boats, "time": world._time,
    }

func _describe(s: Dictionary) -> String:
    return "rows=%d t=%.2fs heights=%s scale_y=%s" % [
        int(s["crop_count"]), float(s["time"]),
        str((s["heights"] as Array).slice(0, 4)), str((s["scales"] as Array).slice(0, 4))]

func _max_height(s: Dictionary) -> float:
    var top := 0.0
    for h in s["heights"]:
        top = maxf(top, float(h))
    return top

## MEASUREMENT CORRECTED, DELIBERATELY. The first version of this probe measured
## each row's WORLD-SPACE vertical extent and demanded it be bit-identical while
## the clock was held. That metric cannot answer the question it was asked. A crop
## row sways by rotating about Z (World3D._update_crops), and rotating a row 2.8
## units wide by 0.03 rad swings its world-space Y extent by ~0.08 -- a fifth of a
## seedling row's height. The first run duly reported 0.3542 -> 0.4133 and I read
## it as growth; it was wind. The failure was in the metric, not the renderer:
## scale_y stayed exactly 1.0000 across the whole held period, and scale_y is the
## growth channel (_ease_growth is the only thing that writes it).
##
## Growth is therefore measured where growth actually lives: the row's geometry in
## the ROW'S OWN frame -- tier height, chosen from authoritative growthStage --
## multiplied by row.scale.y, the growth-ease tween. That is invariant under sway
## by construction. The world-space extent is still sampled alongside it, because
## it MUST change: that is what proves the sway is real geometric motion and not a
## number being written into a dictionary.
func _state_height_of(row: Node3D) -> float:
    var meshes: Array[Node] = row.find_children("*", "MeshInstance3D", true, false)
    if row is MeshInstance3D:
        meshes.append(row)
    var inv := row.global_transform.affine_inverse()
    var lo := INF
    var hi := -INF
    for m in meshes:
        var mi := m as MeshInstance3D
        var aabb := mi.get_aabb()
        var to_row := inv * mi.global_transform
        for i in range(8):
            var corner: Vector3 = to_row * aabb.get_endpoint(i)
            lo = minf(lo, corner.y)
            hi = maxf(hi, corner.y)
    return 0.0 if lo == INF else (hi - lo) * row.scale.y

## The contaminated metric, kept on purpose: sway must move the real silhouette.
func _world_height_of(row: Node3D) -> float:
    var meshes: Array[Node] = row.find_children("*", "MeshInstance3D", true, false)
    if row is MeshInstance3D:
        meshes.append(row)
    var lo := INF
    var hi := -INF
    for m in meshes:
        var mi := m as MeshInstance3D
        var aabb := mi.get_aabb()
        for i in range(8):
            var corner: Vector3 = mi.global_transform * aabb.get_endpoint(i)
            lo = minf(lo, corner.y)
            hi = maxf(hi, corner.y)
    return 0.0 if lo == INF else hi - lo

func _load(path: String) -> Dictionary:
    var f := FileAccess.open(path, FileAccess.READ)
    if f == null:
        return {}
    var parsed: Variant = JSON.parse_string(f.get_as_text())
    f.close()
    return parsed if parsed is Dictionary else {}

func _check(what: String, ok: bool, detail := "") -> void:
    _checks += 1
    if not ok:
        _failures += 1
    print("[freeze] %s %s%s" % ["ok  " if ok else "FAIL", what, ("  -- " + detail) if detail != "" else ""])
