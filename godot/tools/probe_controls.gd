extends SceneTree

## Control + layout probe. Two jobs, both of which source code alone cannot answer:
##
##  1. LAYOUT: dump every visible Control's global rect, so an opaque panel that
##     eats the world (or a caption that lands on top of the activity feed) shows
##     up as numbers instead of being argued about from a screenshot.
##  2. FUNCTION: drive each control with SYNTHETIC POINTER EVENTS pushed through
##     the viewport, so Godot's own hit-testing decides what got hit, and then
##     assert the world actually changed. A button that is wired to nothing fails
##     here; a button that merely LOOKS present passes the screenshot and fails
##     this. That is the difference between a control and a decoration.
##
## INVOCATION -- THIS PROBE NEEDS A REAL WINDOW.
## `--headless` uses the dummy display server, which reports a 64x64 viewport and
## IGNORES `--resolution`. Every control then lays out off-screen, pointer
## hit-tests hit nothing, and the probe emits a wall of failures that look like a
## product regression but are an invocation error. Run it under a real (virtual)
## display, once per orientation:
##
##   xvfb-run -a -s "-screen 0 1280x1024x24" env LIBGL_ALWAYS_SOFTWARE=1 \
##     $GODOT --path godot --rendering-driver opengl3 --resolution 1180x820 \
##     --script ../godot/tools/probe_controls.gd     # tablet landscape
##   xvfb-run -a -s "-screen 0 1280x1280x24" env LIBGL_ALWAYS_SOFTWARE=1 \
##     $GODOT --path godot --rendering-driver opengl3 --resolution 820x1180 \
##     --script ../godot/tools/probe_controls.gd     # tablet portrait
##
## _require_real_viewport() below refuses to run rather than produce that
## misleading wall of failures.

const FIX := preload("res://tools/astrix_fixture.gd")

var _world: Node
var _hud: Node
var _cam: Camera3D
var _input: Node
var _fails := 0
var _checks := 0

func _initialize() -> void:
    var main: Node = load("res://scenes/Main.tscn").instantiate()
    root.add_child(main)
    _run()

## A layout probe on a degenerate viewport asserts nothing. Refuse loudly instead
## of reporting failures that describe the harness rather than the product.
const MIN_VIEWPORT := 480.0
func _require_real_viewport() -> bool:
    var size := root.get_visible_rect().size
    if size.x >= MIN_VIEWPORT and size.y >= MIN_VIEWPORT:
        return true
    print("[controls] FATAL viewport %.0fx%.0f is degenerate -- every layout and " % [size.x, size.y]
        + "hit-test assertion below would be meaningless.")
    print("[controls] Run under a real display (see INVOCATION at the top of this file); "
        + "--headless reports 64x64 and ignores --resolution.")
    print("[controls] RESULT=FAIL")
    quit(2)
    return false

func _run() -> void:
    FIX.go_offline(root)
    await FIX.wait_frames(self, 20)
    _world = root.find_child("World3D", true, false)
    _hud = root.find_child("MobileHUD", true, false)
    # Fetched by node path rather than by the autoload's global identifier: in
    # `--script` mode GDScript does not register autoload globals at compile time.
    _input = root.get_node_or_null("AstrixInput")
    if _world == null or _hud == null or _input == null:
        print("[controls] FATAL world=", _world, " hud=", _hud, " input=", _input)
        quit(1)
        return
    _world._on_astrix_state_received(FIX.snapshot_autumn())
    await FIX.wait_frames(self, 40)
    _cam = _world.find_child("Camera3D", true, false)
    print("[controls] viewport=", root.get_visible_rect().size)
    if not _require_real_viewport():
        return
    _dump_layout()
    await _exercise()
    print("[controls] checks=", _checks, " failures=", _fails)
    print("[controls] RESULT=", "PASS" if _fails == 0 else "FAIL")
    quit(0 if _fails == 0 else 1)

# ---------------------------------------------------------------------------
# LAYOUT
# ---------------------------------------------------------------------------
## Anything drawn over the world with a solid fill is reported, because a
## full-width opaque strip at the bottom of a portrait frame is indistinguishable
## from "the world stopped rendering" until you know which one it is.
func _dump_layout() -> void:
    for layer in root.find_children("*", "CanvasLayer", true, false):
        print("[layer] ", layer.name, " visible=", layer.visible, " layer=", layer.layer)
        _dump_controls(layer, 1)

func _dump_controls(node: Node, depth: int) -> void:
    for child in node.get_children():
        if child is Control:
            var c := child as Control
            var r := c.get_global_rect()
            if c.is_visible_in_tree() and r.size.x > 0.0 and r.size.y > 0.0:
                print("  ".repeat(depth), c.name, " [", c.get_class(), "] ",
                    "pos=", r.position.round(), " size=", r.size.round(),
                    " filter=", c.mouse_filter, _fill_note(c))
        _dump_controls(child, depth + 1)

func _fill_note(c: Control) -> String:
    if c is Panel:
        var sb: StyleBox = c.get_theme_stylebox("panel")
        if sb is StyleBoxFlat:
            return " FILL=" + str((sb as StyleBoxFlat).bg_color)
    if c is ColorRect:
        return " FILL=" + str((c as ColorRect).color)
    return ""

# ---------------------------------------------------------------------------
# SYNTHETIC POINTER INPUT
# ---------------------------------------------------------------------------
func _centre_of(node_name: String) -> Vector2:
    var c: Node = _hud.find_child(node_name, true, false)
    if c == null or not (c is Control):
        return Vector2(-1.0, -1.0)
    return (c as Control).get_global_rect().get_center()

func _touch(at: Vector2, pressed: bool, index: int = 0) -> void:
    var ev := InputEventScreenTouch.new()
    ev.index = index
    ev.position = at
    ev.pressed = pressed
    root.push_input(ev)

func _drag(from_pos: Vector2, to: Vector2, index: int = 0) -> void:
    var ev := InputEventScreenDrag.new()
    ev.index = index
    ev.position = to
    ev.relative = to - from_pos
    root.push_input(ev)

## A press-then-release at a named control, with frames either side so the HUD's
## own _process (hold-repeat, tweens) runs like it does for a real finger.
func _tap(node_name: String) -> void:
    var at := _centre_of(node_name)
    if at.x < 0.0:
        print("[controls] MISSING control ", node_name)
        _fails += 1
        return
    _touch(at, true)
    await FIX.wait_frames(self, 3)
    _touch(at, false)
    await FIX.wait_frames(self, 6)

## Does the text actually land INSIDE the label's box? Measured from the laid-out
## rect and the font, NOT by calling MobileHUD's fitter -- a test that reuses the
## implementation only proves the implementation agrees with itself.
## Two ways to be inside: one line no wider than the box, or wrapped
## (AUTOWRAP_WORD_SMART bounds every line to the box width) with every line still
## visible and the whole stack no taller than the box.
func _text_fit(pill_name: String) -> Dictionary:
    var pill := _hud.find_child(pill_name, true, false) as Control
    if pill == null:
        return {"fits": false, "detail": "no pill named " + pill_name, "font_size": 0}
    var label := pill.get_node_or_null("Text") as Label
    if label == null:
        return {"fits": false, "detail": "no Text label under " + pill_name, "font_size": 0}
    var box := label.get_global_rect().size
    var font: Font = label.get_theme_font("font")
    var fs: int = int(label.get_theme_font_size("font_size"))
    var one_line: float = font.get_string_size(label.text, HORIZONTAL_ALIGNMENT_CENTER, -1.0, fs).x
    var lines: int = label.get_line_count()
    var visible: int = label.get_visible_line_count()
    var stack: float = float(lines) * float(label.get_line_height())
    var wide: bool = lines <= 1 and one_line > box.x + 0.5
    var fits: bool = not wide and visible == lines and stack <= box.y + 0.5
    return {
        "fits": fits,
        "font_size": fs,
        "detail": "\"%s\" %dpx w=%.1f box=%.0fx%.0f lines=%d visible=%d stack=%.0f" % [
            label.text, fs, one_line, box.x, box.y, lines, visible, stack],
    }

func _expect(label: String, condition: bool, detail: String) -> void:
    _checks += 1
    if not condition:
        _fails += 1
    print("[controls] ", "ok  " if condition else "FAIL", " ", label, " -- ", detail)

# ---------------------------------------------------------------------------
# THE ACTUAL VERIFICATION
# ---------------------------------------------------------------------------
func _exercise() -> void:
    var cam: Camera3D = _world.camera
    # --- ZOOM IN ---------------------------------------------------------
    var before := cam.size
    await _tap("ZoomIn")
    _expect("ZoomIn tightens the frame", cam.size < before - 0.01,
        "size %.2f -> %.2f" % [before, cam.size])

    # --- ZOOM OUT --------------------------------------------------------
    before = cam.size
    await _tap("ZoomOut")
    _expect("ZoomOut widens the frame", cam.size > before + 0.01,
        "size %.2f -> %.2f" % [before, cam.size])

    # --- ZOOM CLAMPS -----------------------------------------------------
    # Ten taps is more than the range, so this also proves zoom cannot run away.
    for _i in range(10):
        await _tap("ZoomIn")
    var tight := cam.size
    await _tap("ZoomIn")
    _expect("Zoom clamps at the tight end", is_equal_approx(cam.size, tight),
        "held at %.2f" % cam.size)

    # --- WALK (was "FOLLOW STEWARD") -------------------------------------
    # ASSERTION CHANGED, DELIBERATELY: this block used to tap a pill LABELLED
    # "FOLLOW STEWARD" and assert it entered FOLLOW. FOLLOW follows the Overseer
    # avatar -- the human's own body -- not the Steward agent, so the old label
    # named a mode that did not exist and the assertion encoded that mislabel.
    # The control is unchanged (mode 3, MOVE pad, GATHER disc); it is now called
    # WalkPill/"WALK", and "STEWARD" now addresses the real steward camera,
    # asserted separately below. Same checks, correct subject: a strengthening.
    await _tap("WalkPill")
    _expect("WALK switches camera mode", _world.camera_mode == 3,
        "camera_mode=%d (3=FOLLOW)" % _world.camera_mode)
    _expect("FOLLOW re-labels the pad to MOVE",
        _hud.find_child("PadCaption", true, false).text == "MOVE",
        "caption=" + _hud.find_child("PadCaption", true, false).text)
    var gather: Control = _hud.find_child("Action", true, false)
    _expect("FOLLOW reveals the GATHER control", gather != null and gather.visible,
        "visible=" + str(gather != null and gather.visible))

    # --- PAD FEEDS MOVEMENT WHILE FOLLOWING ------------------------------
    var pad := _centre_of("JoystickZone")
    _touch(pad, true)
    _drag(pad, pad + Vector2(60.0, -40.0))
    await FIX.wait_frames(self, 3)
    _expect("Pad drives MOVEMENT in FOLLOW",
        _input.movement_vector().length() > 0.3,
        "movement=" + str(_input.movement_vector().length()))
    _expect("Pad does NOT pan the camera in FOLLOW",
        _input.camera_pan_direction.length() < 0.001,
        "pan=" + str(_input.camera_pan_direction))
    _touch(pad, false)
    await FIX.wait_frames(self, 3)
    _expect("Releasing the pad clears movement intent",
        _input.movement_vector().length() < 0.001,
        "movement=" + str(_input.movement_vector().length()))

    # --- OVERVIEW RESET --------------------------------------------------
    await _tap("OverviewPill")
    _expect("OVERVIEW returns to the world frame", _world.camera_mode == 0,
        "camera_mode=%d (0=OVERVIEW)" % _world.camera_mode)
    _expect("OVERVIEW resets zoom", is_equal_approx(_world._zoom, 1.0),
        "zoom=%.3f" % _world._zoom)
    _expect("OVERVIEW resets pan", _world._pan.length() < 0.001,
        "pan=" + str(_world._pan))
    _expect("Leaving FOLLOW re-labels the pad to PAN",
        _hud.find_child("PadCaption", true, false).text == "PAN",
        "caption=" + _hud.find_child("PadCaption", true, false).text)
    _expect("Leaving FOLLOW hides GATHER", gather != null and not gather.visible,
        "visible=" + str(gather != null and gather.visible))

    # --- PAD PANS THE OBSERVER CAMERA ------------------------------------
    var target_before: Vector3 = cam.global_position
    _touch(pad, true)
    _drag(pad, pad + Vector2(70.0, 0.0))
    await FIX.wait_frames(self, 3)
    _expect("Pad drives CAMERA PAN outside FOLLOW",
        _input.camera_pan().length() > 0.3,
        "pan=" + str(_input.camera_pan().length()))
    _expect("Pad does NOT move the Overseer outside FOLLOW",
        _input.movement_vector().length() < 0.001,
        "movement=" + str(_input.movement_vector().length()))
    await FIX.wait_frames(self, 30)
    _expect("Panning actually moves the camera",
        cam.global_position.distance_to(target_before) > 0.5,
        "moved %.2f units" % cam.global_position.distance_to(target_before))
    _touch(pad, false)
    await FIX.wait_frames(self, 3)
    _expect("Releasing the pad clears pan intent",
        _input.camera_pan().length() < 0.001,
        "pan=" + str(_input.camera_pan()))

    # --- PAN CLAMPS ------------------------------------------------------
    # A pan that can run forever loses the world off-screen with no way back
    # except OVERVIEW. Hold the pad far longer than the clamp distance.
    _touch(pad, true)
    _drag(pad, pad + Vector2(200.0, 0.0))
    await FIX.wait_frames(self, 240)
    _touch(pad, false)
    await FIX.wait_frames(self, 20)
    var limit: float = _world._base_camera_size() * 0.7
    _expect("Pan is clamped, world cannot be lost",
        absf(_world._pan.x) <= limit + 0.01 and absf(_world._pan.y) <= limit + 0.01,
        "pan=%s limit=%.2f" % [str(_world._pan), limit])
    await _tap("OverviewPill")

    # --- ISLAND VIEW: "what is happening HERE?" --------------------------
    await _tap("IslandPill")
    _expect("ISLAND switches camera mode", _world.camera_mode == 4,
        "camera_mode=%d (4=ISLAND)" % _world.camera_mode)
    var cycle: PackedStringArray = _world._island_cycle()
    var first_island: String = _world.island_focus_name()
    _expect("ISLAND names an island the renderer has geography for",
        cycle.has(first_island) and _world.ISLANDS.has(first_island),
        "island=" + first_island)
    var island_label := _hud.find_child("IslandPill", true, false).get_node_or_null("Text") as Label
    _expect("ISLAND pill names the island it is showing",
        island_label != null and island_label.text == first_island.to_upper(),
        "pill=" + (island_label.text if island_label else "<none>"))
    # The frame must actually be over that island, not the world origin.
    var centre: Vector3 = _world.ISLANDS[first_island]["center"]
    var framed: Vector3 = _world._camera_target()
    _expect("ISLAND frames that island's centre",
        Vector2(framed.x - centre.x, framed.z - centre.z).length() < 1.0,
        "target=%s centre=%s" % [str(framed), str(centre)])

    # Tapping again tours the archipelago instead of doing nothing.
    await _tap("IslandPill")
    var second_island: String = _world.island_focus_name()
    _expect("ISLAND cycles to the next island Core reports",
        second_island != first_island and cycle.has(second_island),
        "%s -> %s" % [first_island, second_island])
    _expect("Cycling re-aims the frame",
        _world._camera_target().distance_to(framed) > 1.0,
        "moved %.2f units" % _world._camera_target().distance_to(framed))

    # --- STEWARD VIEW: only as honest as Core's action record -------------
    await _tap("StewardPill")
    _expect("STEWARD switches camera mode", _world.camera_mode == 5,
        "camera_mode=%d (5=STEWARD)" % _world.camera_mode)
    var steward_label := _hud.find_child("StewardPill", true, false).get_node_or_null("Text") as Label
    if _world._has_steward_focus:
        _expect("STEWARD pill names its authoritative subject",
            steward_label != null and steward_label.text == _world.steward_focus_name(),
            "pill=" + (steward_label.text if steward_label else "<none>"))
    else:
        # This probe runs with no server, so Core names no action. The camera must
        # say so and hold the world frame rather than point somewhere invented.
        _expect("STEWARD with no authoritative target says NO TARGET",
            steward_label != null and steward_label.text == "NO TARGET",
            "pill=" + (steward_label.text if steward_label else "<none>"))
        _expect("STEWARD with no authoritative target holds the world frame",
            is_equal_approx(_world._base_camera_size(), _world._overview_size),
            "size=%.2f overview=%.2f" % [_world._base_camera_size(), _world._overview_size])

    await _tap("OverviewPill")
    _expect("OVERVIEW still returns to the world frame after the new modes",
        _world.camera_mode == 0, "camera_mode=%d" % _world.camera_mode)

    # --- PILL TEXT STAYS INSIDE ITS PILL ---------------------------------
    # Screenshots caught this one and source review had not: in tablet portrait
    # the STEWARD pill read "O TARGE" -- "NO TARGET" clipped at BOTH ends by a
    # 71px half-pill (5x crop of artifacts/visual-life/tablet-portrait/
    # 05-steward.png). A pill whose job is to name what the camera is pointing at
    # must not eat the name. Every string the HUD can put in a pill is driven
    # through the REAL entry point World3D uses, then measured against the label's
    # own laid-out text box, and the pill RECT is compared before/after because
    # the fix must not move a touch target that the hit tests above rely on.
    var pill_rects := {}
    for pill_name in ["OverviewPill", "IslandPill", "StewardPill", "WalkPill"]:
        pill_rects[pill_name] = (_hud.find_child(pill_name, true, false) as Control).get_global_rect()
    var longest := "%s <-> %s" % [cycle[0].to_upper(), cycle[cycle.size() - 1].to_upper()]
    var cases: Array = [
        ["island", cycle[0].to_upper(), "IslandPill"],
        ["island", "", "IslandPill"],
        ["steward", "", "StewardPill"],
        ["steward", longest, "StewardPill"],
        ["overview", "", "OverviewPill"],
        ["follow", "", "WalkPill"],
    ]
    for row in cases:
        _hud.set_camera_mode_name(str(row[0]), str(row[1]))
        await FIX.wait_frames(self, 3)
        var fit := _text_fit(str(row[2]))
        _expect("pill text fits its pill: %s(%s)" % [row[2], row[1] if str(row[1]) != "" else "default"],
            fit["fits"], fit["detail"])
    # The pill that has just held the longest label must come back to full size
    # when a SHORT subject follows it: shrink-only fitting is a defect of its own,
    # and it would leave the HUD permanently small after one long bridge label.
    # The subject used here is a real island name, short enough that the designed
    # size fits it -- unlike "NO TARGET", which legitimately needs to shrink.
    _hud.set_camera_mode_name("steward", cycle[0].to_upper())
    await FIX.wait_frames(self, 3)
    var back := _text_fit("StewardPill")
    _expect("a pill that held a long label returns to its designed font size",
        int(back["font_size"]) == _hud.PILL_FONT_HALF and bool(back["fits"]),
        "%s designed=%d" % [back["detail"], _hud.PILL_FONT_HALF])
    for moved in pill_rects.keys():
        var now: Rect2 = (_hud.find_child(str(moved), true, false) as Control).get_global_rect()
        var was: Rect2 = pill_rects[moved]
        _expect("fitting text did NOT move or resize " + str(moved),
            now.is_equal_approx(was), "%s -> %s" % [str(was), str(now)])
    await _tap("OverviewPill")

    # --- WHO IS ON TOP ---------------------------------------------------
    # When a control does not respond, the question is always "did the event
    # reach it". Godot's own hover result answers that without guessing.
    for probe_name in ["Pause", "ZoomIn", "OverviewPill", "IslandPill", "StewardPill", "WalkPill", "JoystickZone"]:
        var at := _centre_of(probe_name)
        var mm := InputEventMouseMotion.new()
        mm.position = at
        root.push_input(mm)
        await FIX.wait_frames(self, 2)
        var hov: Control = root.gui_get_hovered_control()
        var path := str(hov.get_path()) if hov != null else "<none>"
        _expect("Pointer at " + probe_name + " reaches it",
            hov != null and (hov == _hud.find_child(probe_name, true, false)
                or _hud.find_child(probe_name, true, false).is_ancestor_of(hov)),
            "hover=" + path)

    # --- PAUSE ROUND-TRIPS -----------------------------------------------
    # The bug this catches: pausing the tree also paused the HUD, so gui_input
    # stopped being delivered and NOTHING could unpause. A pause button that
    # cannot be undone is worse than no pause button.
    await _tap("Pause")
    _expect("Pause pauses the world", paused, "paused=" + str(paused))
    await _tap("Pause")
    _expect("Pause UNpauses again (HUD still receives input while paused)",
        not paused, "paused=" + str(paused))

    # --- OBSERVER MODE STAYS READ-ONLY -----------------------------------
    # Section 13: none of the above may become a write path. With no credential
    # the approval controls must refuse to act.
    var client: Node = root.get_node_or_null("GameClient")
    if client != null:
        _expect("Observer mode holds no credential",
            str(client.astrix_api_key).is_empty(),
            "key_len=" + str(str(client.astrix_api_key).length()))
