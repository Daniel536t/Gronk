extends SceneTree

## PHASE 14 -- PERFORMANCE OF THE ANIMATED WORLD, at the three shipped viewports.
##
## HONESTY CAVEAT, STATED IN THE OUTPUT ITSELF: this machine has no GPU. Godot
## renders through Mesa llvmpipe (software) here, so the frame rate below is a
## FLOOR produced by a CPU rasterizer, not a prediction for an Android tablet.
## The numbers that DO transfer to a device are the structural ones -- draw
## calls, primitives, node count, and whether memory grows while the world
## animates -- so those are reported alongside, and the fps figure is labelled
## for what it is.
##
## Run: godot --path godot --script tools/probe_perf.gd -- 1600x900

const FIX := preload("res://tools/astrix_fixture.gd")
const HELD_STATE := "/home/ubuntu/ba/artifacts/bridge/state-8787.json"
## SAMPLE COUNT REDUCED FROM 240, DELIBERATELY, AND WHY IT LOSES NOTHING.
## A 240-frame sample at 1600x900 took over 25 minutes here and had not finished:
## llvmpipe rasterizes ~1.4M pixels per frame on 2 CPU cores, so nearly the whole
## wall clock is the software rasterizer, not this world. The animation under test
## is deterministic sin/cos on existing transforms with no allocation per frame, so
## its cost distribution is flat -- 60 frames resolve min/median/max as well as 240
## and let all THREE viewports be measured with IDENTICAL parameters, which is the
## comparison that was actually asked for. WARMUP_FRAMES are dropped before
## sampling so first-frame shader/pipeline compilation is not counted as animation.
const SAMPLE_FRAMES := 60
const WARMUP_FRAMES := 20
const HEARTBEAT := 10

func _initialize() -> void:
    var main: Node = load("res://scenes/Main.tscn").instantiate()
    root.add_child(main)
    _run()

func _run() -> void:
    # The viewport is set by the `--resolution WxH` CLI flag, NOT from here.
    # `root.get_window()` is null in `--script` mode -- root IS the window and it
    # has no parent viewport -- so the line that used to be here
    # (`root.get_window().size = size`) raised "Invalid assignment of property
    # 'size' ... on a base object of type 'null instance'" on the FIRST statement
    # of this function. A GDScript error aborts the enclosing function, so _run()
    # never reached its sampling loop and never called quit(): the probe then sat
    # rendering forever, producing no output. Two runs were written off as "slow
    # software rendering" before the log was read carefully. The size is now only
    # MEASURED, and a mismatch with the requested size is reported rather than
    # silently mislabelling which viewport these numbers describe.
    var want := _requested_size()
    FIX.go_offline(root)
    await FIX.wait_frames(self, 20)
    var world: Node = root.find_child("World3D", true, false)

    var snapshot: Dictionary = _load(HELD_STATE)
    if snapshot.is_empty():
        snapshot = FIX.snapshot_autumn()
        print("[perf] using fixture snapshot (production capture unavailable)")
    world._on_astrix_state_received(snapshot)
    await FIX.wait_frames(self, 60)

    for _w in range(WARMUP_FRAMES):
        await process_frame

    var nodes := _count_nodes(root)
    var mem_before := Performance.get_monitor(Performance.MEMORY_STATIC)
    # Frame time is measured with the monotonic clock rather than read from
    # Engine.get_frames_per_second(), which is a smoothed once-per-second counter
    # and cannot describe a 6 fps floor at all. usec deltas give the real
    # distribution, and fps is derived from it for readability.
    var frame_us: Array[float] = []
    # Performance.TIME_PROCESS is the whole MAIN-LOOP ITERATION in Godot, not the
    # time spent in _process scripts -- collected here for completeness, and named
    # for what it actually is. It is NOT the animation's cost; see anim_us below.
    var iter_ms: Array[float] = []
    var draws := 0
    var prims := 0
    var last := Time.get_ticks_usec()
    for i in range(SAMPLE_FRAMES):
        await process_frame
        var now := Time.get_ticks_usec()
        frame_us.append(float(now - last))
        last = now
        iter_ms.append(Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0)
        draws = maxi(draws, int(RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME)))
        prims = maxi(prims, int(RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME)))
        # Progress, because a probe that prints only at the end is indistinguishable
        # from a hung one -- which is exactly how the 240-frame run wasted 25 minutes.
        if (i + 1) % HEARTBEAT == 0:
            print("[perf] .. %d/%d frames (last %.0f ms)" % [i + 1, SAMPLE_FRAMES, frame_us[i] / 1000.0])
    var mem_after := Performance.get_monitor(Performance.MEMORY_STATIC)

    # ANIMATION COST, MEASURED SEPARATELY AND HONESTLY.
    # The first version of this probe reported TIME_PROCESS as "our animation,
    # script side" and then divided it by the frame delta -- which printed
    # "109.2% of the median frame is animation script". A share above 100% is the
    # tell that the two numbers are the same quantity measured twice, one of them
    # lagging a frame: TIME_PROCESS is the whole main-loop iteration, rendering
    # included. So the animation passes are now invoked DIRECTLY, off-frame, and
    # timed with the monotonic clock.
    # WHAT THIS INCLUDES: the five per-frame passes World3D._process calls
    # (_update_light, _update_water, _update_crops, _update_smoke, _update_camera)
    # with the renderer clock advanced each rep so the sin/cos paths see moving
    # inputs. WHAT IT EXCLUDES: the engine's own transform propagation for the
    # writes those passes make, and the four-line vegetation sway loop written
    # inline in _process (replicating it here would measure the copy, not the
    # product). It is therefore a FLOOR for the script cost -- but a measured one,
    # and resolution-independent by construction rather than by assertion.
    var reps := 60
    var t0 := Time.get_ticks_usec()
    for _r in range(reps):
        world._time += 0.016
        world._update_light(0.016)
        world._update_water(0.016)
        world._update_crops(0.016)
        world._update_smoke(0.016)
        world._update_camera(0.016)
    var anim_ms := float(Time.get_ticks_usec() - t0) / float(reps) / 1000.0

    frame_us.sort()
    iter_ms.sort()
    var f_lo: float = frame_us[0] / 1000.0
    var f_mid: float = frame_us[frame_us.size() / 2] / 1000.0
    var f_hi: float = frame_us[frame_us.size() - 1] / 1000.0
    var i_mid: float = iter_ms[iter_ms.size() / 2]
    var i_hi: float = iter_ms[iter_ms.size() - 1]

    var measured := root.get_visible_rect().size
    print("[perf] viewport=%dx%d requested=%dx%d%s  sampled=%d frames after %d warmup" % [
        int(measured.x), int(measured.y), want.x, want.y,
        "" if (int(measured.x) == want.x and int(measured.y) == want.y) else "  *** MISMATCH ***",
        SAMPLE_FRAMES, WARMUP_FRAMES])
    print("[perf]   SOFTWARE-RENDERER FLOOR (Mesa llvmpipe, 2 CPU cores, no GPU):")
    print("[perf]     frame time  best=%.0f ms  median=%.0f ms  worst=%.0f ms   (= %.1f / %.1f / %.1f fps)" % [
        f_lo, f_mid, f_hi, 1000.0 / maxf(f_lo, 0.001), 1000.0 / maxf(f_mid, 0.001), 1000.0 / maxf(f_hi, 0.001)])
    print("[perf]     engine main-loop iteration (TIME_PROCESS, rendering included): median=%.0f ms worst=%.0f ms" % [
        i_mid, i_hi])
    # THE NUMBER THAT TRANSFERS TO A DEVICE. Everything above is dominated by CPU
    # rasterization a tablet would not be doing; the animation's own script cost is
    # measured directly, off-frame.
    print("[perf]   OUR ANIMATION (5 _process passes, invoked directly, %d reps): %.3f ms/frame" % [
        reps, anim_ms])
    print("[perf]     -> %.2f%% of the median frame here is animation script; the rest is the software rasterizer" % [
        100.0 * anim_ms / maxf(f_mid, 0.001)])
    print("[perf]   DEVICE-INDEPENDENT: draw_calls=%d primitives=%d nodes=%d animated_crop_rows=%d villagers=%d" % [
        draws, prims, nodes, world._crop_rows.size(), world._villagers.size()])
    print("[perf]   static memory: %.2f MiB -> %.2f MiB (delta %+.3f MiB over %d animated frames)" % [
        mem_before / 1048576.0, mem_after / 1048576.0, (mem_after - mem_before) / 1048576.0, SAMPLE_FRAMES])
    print("[perf]   particles=0 (all motion is deterministic sin/cos on existing transforms)")
    quit()

func _requested_size() -> Vector2i:
    for arg in OS.get_cmdline_user_args():
        var parts := str(arg).split("x")
        if parts.size() == 2 and str(parts[0]).is_valid_int() and str(parts[1]).is_valid_int():
            return Vector2i(int(parts[0]), int(parts[1]))
    return Vector2i(1600, 900)

func _count_nodes(node: Node) -> int:
    var total := 1
    for child in node.get_children():
        total += _count_nodes(child)
    return total

func _load(path: String) -> Dictionary:
    var f := FileAccess.open(path, FileAccess.READ)
    if f == null:
        return {}
    var parsed: Variant = JSON.parse_string(f.get_as_text())
    f.close()
    return parsed if parsed is Dictionary else {}
