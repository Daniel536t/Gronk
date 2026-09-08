extends SceneTree

## HUD truthfulness probe.
##
## WHY THIS EXISTS: the fixtures are GDScript literals, so their numbers are ints.
## The LIVE server sends JSON, and JSON has one number type — Godot parses every
## figure as a float. The deployed HUD therefore read "DAY 355.0  POP 0.0
## FOOD 0.0" while every fixture screenshot read "DAY 19  POP 5  FOOD 21". Nothing
## short of live-shaped data catches that, so this probe feeds live-shaped data.
##
## It also pins the CLOCK HELD indicator, which must appear ONLY when the steward
## reports no live run, and the activity feed, which must never render an event as
## a bare type name with nothing after it.
##
##   godot --path . --script tools/probe_hud_truth.gd --resolution 820x1180

const FIX := preload("res://tools/astrix_fixture.gd")

var _checks := 0
var _failures := 0
var _console: Node = null

func _ok(name: String, passed: bool, detail: String = "") -> void:
    _checks += 1
    if not passed:
        _failures += 1
    # A HUD panel's text is multi-line; printing it raw makes a probe line look
    # truncated at the first newline and hides the very text being asserted on.
    var flat := detail.replace("\n", " / ").strip_edges()
    print("[hud] %s %s%s" % ["ok  " if passed else "FAIL", name, "" if flat == "" else " -- " + flat])

func _initialize() -> void:
    var main: Node = load("res://scenes/Main.tscn").instantiate()
    root.add_child(main)
    _run()

## Every number as a float, exactly as JSON.parse_string returns them.
static func _as_floats(value: Variant) -> Variant:
    if value is Dictionary:
        var out := {}
        for key in (value as Dictionary):
            out[key] = _as_floats((value as Dictionary)[key])
        return out
    if value is Array:
        var arr := []
        for item in (value as Array):
            arr.append(_as_floats(item))
        return arr
    if value is int:
        return float(value)
    return value

func _text_of(field: String) -> String:
    var label = _console.get(field)
    return "" if label == null else str(label.text)

func _run() -> void:
    FIX.go_offline(root)
    await FIX.wait_frames(self, 20)
    _console = root.find_child("AgentConsole", true, false)
    if _console == null:
        print("[hud] FATAL: AgentConsole missing")
        quit(1)
        return

    # --- live-shaped world: every figure a float -----------------------------
    var live: Dictionary = _as_floats(FIX.snapshot_autumn())
    live["day"] = 355.0
    live["population"] = 0.0
    live["food"] = 0.0
    live["foodPerDay"] = 0.0
    live["daysOfFoodRemaining"] = 0.0
    live["season"] = "winter"
    live["foodPressureLevel"] = "critical"
    _console._on_world_state(live)
    await FIX.wait_frames(self, 4)

    var world_row := _text_of("_world_row")
    var pressure_row := _text_of("_pressure_row")
    _ok("whole numbers render as integers, not floats",
        world_row.contains("DAY 355") and not world_row.contains("355.0"), world_row)
    _ok("POP renders as an integer", world_row.contains("POP[/color] 0") and not world_row.contains("0.0"), world_row)
    _ok("food rate renders as an integer", not pressure_row.contains("0.0/day"), pressure_row)
    _ok("season still reads from authoritative state", world_row.contains("WINTER"), world_row)

    # A genuinely fractional figure must keep its decimal rather than be rounded away.
    var fractional := live.duplicate()
    fractional["daysOfFoodRemaining"] = 2.5
    fractional["food"] = 12.0
    _console._on_world_state(fractional)
    await FIX.wait_frames(self, 4)
    _ok("a fractional figure keeps one decimal", _text_of("_pressure_row").contains("2.5"), _text_of("_pressure_row"))
    _console._on_world_state(live)
    await FIX.wait_frames(self, 4)

    # --- CLOCK HELD tracks the steward's own reported LoopState --------------
    _ok("no clock claim before any steward status arrives",
        not _text_of("_world_row").contains("CLOCK HELD"), _text_of("_world_row"))

    for state in ["IDLE", "COMPLETED", "STOPPED", "FAILED"]:
        _console._on_agent_status({"state": state, "turn": 0, "objective": ""})
        await FIX.wait_frames(self, 3)
        _ok("%s announces the held clock on the world strip" % state,
            _text_of("_world_row").contains("CLOCK HELD"), _text_of("_world_row"))
        _ok("%s explains WHY on the steward panel" % state,
            _text_of("_agent_action").contains("no steward run is live"), _text_of("_agent_action"))

    # RUNNING is the one steward state in which world time actually advances.
    _console._on_agent_status({"state": "RUNNING", "turn": 3, "objective": "keep the village fed"})
    await FIX.wait_frames(self, 3)
    _ok("RUNNING does NOT claim a held clock",
        not _text_of("_world_row").contains("CLOCK HELD")
        and not _text_of("_agent_action").contains("no steward run is live"), _text_of("_world_row"))

    # AWAITING_APPROVAL WAS ASSERTED HERE AS A LIVE CLOCK, TOGETHER WITH RUNNING.
    # That assertion encoded behaviour Core does not have. src/astrix/server.ts's
    # tick() opens with `if (loop.state === "AWAITING_APPROVAL") return;`, so the
    # day clock is frozen for exactly as long as the gate is open, and the
    # shipping HUD says so on that authority (AgentConsole.UNMANAGED_STATES,
    # World3D.HELD_LOOP_STATES). A strip that showed time running at the gate
    # would be lying about the world -- the precise failure this probe exists to
    # catch -- so the check is INVERTED AND WIDENED rather than dropped: the strip
    # must claim the hold AND name the human as the reason, and the panel must
    # give the approval reason instead of the idle one.
    _console._on_agent_status({"state": "AWAITING_APPROVAL", "turn": 3, "objective": "keep the village fed"})
    await FIX.wait_frames(self, 3)
    _ok("AWAITING_APPROVAL announces the held clock (server.ts freezes tick() there)",
        _text_of("_world_row").contains("CLOCK HELD"), _text_of("_world_row"))
    _ok("AWAITING_APPROVAL names the human decision as the reason on the strip",
        _text_of("_world_row").contains("AWAITING YOUR DECISION"), _text_of("_world_row"))
    _ok("AWAITING_APPROVAL explains the hold as the gate, not as an idle steward",
        _text_of("_agent_action").contains("approve or reject")
        and not _text_of("_agent_action").contains("no steward run is live"),
        _text_of("_agent_action"))

    # Display-name states that are not LoopStates at all must read as live.
    _console._on_agent_status({"state": "EXECUTING", "turn": 7, "objective": ""})
    await FIX.wait_frames(self, 3)
    _ok("a lifecycle display name reads as a live run",
        not _text_of("_world_row").contains("CLOCK HELD"), _text_of("_world_row"))

    # --- the activity feed must say something -------------------------------
    _console._on_agent_status({
        "state": "RUNNING", "turn": 9, "objective": "",
        "lastEvents": [
            {"type": "SEASON_CHANGED", "turn": 0.0, "data": {"season": "winter", "day": 240.0}},
            {"type": "TURN_COMPLETED", "turn": 9.0, "data": {"turn": 9.0, "actionsExecuted": 2.0}},
            {"type": "WORLD_OBSERVED", "turn": 9.0, "data": {"turn": 9.0, "day": 241.0, "season": "winter"}},
            {"type": "ACTION_FAILED", "turn": 9.0, "data": {"tool": "plant", "error": "no farmland available"}},
        ],
    })
    await FIX.wait_frames(self, 3)
    var feed := _text_of("_feed")
    _ok("SEASON CHANGED names the season and the day",
        feed.contains("winter") and feed.contains("day 240"), feed)
    _ok("TURN COMPLETED reports the work done", feed.contains("2 actions"), feed)
    _ok("an error is surfaced verbatim", feed.contains("no farmland available"), feed)
    _ok("no feed line is left as a bare type name", not feed.contains("WORLD OBSERVED[/color] \n")
        and not feed.ends_with("[/color] "), feed)

    print("[hud] checks=%d failures=%d" % [_checks, _failures])
    print("[hud] RESULT=%s" % ("PASS" if _failures == 0 else "FAIL"))
    quit(1 if _failures > 0 else 0)
