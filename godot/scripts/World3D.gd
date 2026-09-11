extends Node3D
## ASTrix world renderer — the AI Steward's visible laboratory.
##
## AUTHORITY: none. Every entity that represents simulation state (buildings,
## crops, bridges, villagers, season, time of day) is materialized from Core's
## authoritative snapshot arriving via GameClient -> _on_astrix_state_received.
## This script never invents world state and never decides anything. Terrain,
## vegetation and settlement dressing are static set decoration.
##
## ART DIRECTION (see AstrixPalette): saturated low-poly settlement diorama.
## Green land / terracotta roofs / ocean-blue water triad, cream + grey
## neutrals, flat Lambert materials, one warm key light with real shadows.
##
## COORDINATE MAPPING: Core works in an abstract coordinate space (farms at
## meadow x10-22, frost x44-56, dusk x72-84). The renderer places islands where
## they compose well and maps authoritative positions onto them through
## `_map_core_pos`, preserving relative layout while guaranteeing that an
## authoritative farm always lands ON its own island. Composition is a
## presentation decision; the simulation's coordinates stay untouched.


# ---------------------------------------------------------------------------
# WORLD LAYOUT
#
# Islands are deliberately packed so ONE camera frame can contain land, shore,
# water, a bridge and legible people. `core_center` is the centroid of the Core
# coordinate region that island owns; `top` is the walkable grass surface.
# ---------------------------------------------------------------------------
const WATER_LEVEL := 0.0

## Island layout + the mapping from Core's abstract coordinates.
##
## `core_center` is the centre of the Core region this island owns, `core_scale`
## is world units per Core unit, and `core_flip` mirrors an axis. The meadow
## flips Z on purpose: Core clusters its farmland at LOW z and its houses at HIGH
## z, and the farm belt is the story this demo has to show, so flipping puts the
## fields in the camera-facing foreground and the houses behind them.
const ISLANDS := {
    "meadow": {
        "center": Vector3(0.0, 0.0, 0.0), "radius": Vector2(14.5, 13.0), "top": 3.0,
        # flip BOTH axes: this puts Core's farmland cluster in the screen-bottom
        # foreground (the food story, unobstructed by the HUD) and Core's houses
        # up-screen behind them.
        "core_center": Vector2(17.0, 20.0), "core_scale": Vector2(1.3, 0.55),
        "core_flip": Vector2(-1.0, -1.0),
        "grass": "grass", "rock": AstrixPalette.ROCK, "beach": true,
    },
    "frost": {
        # THE BASTION: the high alpine crag. Raised well above the Meadow so the
        # archipelago reads as three elevations, not three pancakes — the bridge
        # visibly climbs to it, and its snow/beacon crown the skyline.
        "center": Vector3(26.0, 0.0, -14.0), "radius": Vector2(8.0, 7.0), "top": 5.4,
        "core_center": Vector2(48.0, 12.0), "core_scale": Vector2(0.8, 0.8),
        "core_flip": Vector2(-1.0, -1.0),
        "grass": "frost", "rock": AstrixPalette.FROST_ROCK, "beach": false,
    },
    "dusk": {
        # Third island. Placed so ARCHIPELAGO framing contains all three without
        # wasted ocean, and deliberately OUTSIDE the observatory frame so it can
        # never appear as a cropped sliver in the settlement shot.
        "center": Vector3(-16.0, 0.0, -30.0), "radius": Vector2(9.0, 8.5), "top": 2.4,
        "core_center": Vector2(76.0, 32.0), "core_scale": Vector2(1.0, 1.0),
        "core_flip": Vector2(-1.0, -1.0),
        "grass": "dusk", "rock": AstrixPalette.DUSK_ROCK, "beach": true,
    },
}

const MEADOW_SURFACE := 3.0
const FROST_SURFACE := 5.4
const DUSK_SURFACE := 2.4

## Full world extent including water margin — drives seabed size and camera fit.
const WORLD_MIN := Vector2(-40.0, -50.0)
const WORLD_MAX := Vector2(46.0, 30.0)

# ---------------------------------------------------------------------------
# CAMERA
#
# OBSERVATORY (default) frames the settlement, the channel and the bridge to
# Frost: this is the composition where water, two islands, farms and PEOPLE are
# all legible at once. ARCHIPELAGO pulls back to all three islands for the
# "island world" read. FOLLOW is the walking Overseer camera.
#
# One fixed light direction, no roll, controlled tilt, and vegetation is placed
# so nothing tall sits in the near corridor between camera and settlement.
# ---------------------------------------------------------------------------
## Boats: proof the water is navigable, and a sense of scale out at sea — a boat
## is the single strongest cue that the blue is water. Anchors are part of the
## OVERVIEW solve (see _world_frame_points), so none of them can be cropped.
##
## `heading` is a FIXED yaw, not a random one. The old code used
## `rotation.y = randf() * TAU`, which regularly presented a sail edge-on: a
## 0.07-unit-thin sail seen edge-on is ~2 screen px and the boat collapses into an
## unreadable crate. -0.785 rad is exactly broadside to the 45deg camera axis, and
## each boat sits within +-0.25 rad of it, which costs at most 3% of sail area.
const BOAT_ANCHORS := [
    {"pos": Vector3(14.0, 0.0, 8.0), "seed": 11, "heading": -0.62},
    {"pos": Vector3(21.5, 0.0, 3.0), "seed": 12, "heading": -0.95},
    {"pos": Vector3(-8.0, 0.0, 13.0), "seed": 13, "heading": -0.55},
    # Mid-channel between meadow and frost: reads as TRAFFIC between them, which
    # is what makes the pair one settlement rather than two unrelated sites.
    {"pos": Vector3(18.0, 0.0, -3.0), "seed": 14, "heading": -1.02},
    # The meadow->dusk channel only entered the frame when OVERVIEW became the
    # default, so it had no traffic at all before this pass.
    {"pos": Vector3(-11.0, 0.0, -15.0), "seed": 15, "heading": -0.70},
]

## APPENDED, never renumbered: OVERVIEW stays 0 and FOLLOW stays 3, which is what
## tools/probe_controls.gd asserts and what screenshot_harness.gd addresses by
## name. ISLAND and STEWARD are the two questions the overview cannot answer --
## "what is happening HERE" and "what is the agent actually doing".
enum CameraMode { OVERVIEW, OBSERVATORY, ARCHIPELAGO, FOLLOW, ISLAND, STEWARD }
## DEFAULT = OVERVIEW. The first thing a visitor must understand is that ASTrix
## is a WORLD, so the opening frame contains every island Core defines. The
## tighter OBSERVATORY composition is one zoom step away, not the entry point.
var camera_mode: int = CameraMode.OVERVIEW

## OBSERVATORY framing — derived, not guessed.
##
## The camera is ORTHOGONAL at 45° yaw / ~38° pitch. Work in the camera's own
## ground axes: u = (x - z)/√2 runs screen-right, v = (x + z)/√2 runs
## screen-down (toward the camera). `camera.size` is the visible height, so the
## visible ground patch is  size*aspect  along u and  size/sin(38°)  along v.
##
## Meadow (r 14.5 at origin) spans u,v ∈ [-14, 14]. Frost (r 8 at 26,-14) sits at
## u = 28.3, v = 8.5, spanning u ∈ [20.3, 36.3], v ∈ [0.5, 16.5]. So the pair
## needs 50.3 along u and 30.5 along v. At size 32 / 16:9 the frame provides 56.9
## along u and 52.1 along v — both islands fit whole, with a 2.15-unit villager
## at ~52px on a 768px viewport.
##
## Centre of that bounding box: u = 11.2, v = 1.25  ->  world (8.8, ·, -7.0).
const OBS_TARGET := Vector3(8.8, 1.4, -7.0)
const OBS_OFFSET := Vector3(20.0, 22.0, 20.0)
const OBS_SIZE_LANDSCAPE := 32.0
const OBS_SIZE_PORTRAIT := 46.0

const ARCH_TARGET := Vector3(4.0, 1.0, -14.0)
const ARCH_OFFSET := Vector3(30.0, 34.0, 30.0)
## Pulled back only as far as the three islands need. At 74 the archipelago
## occupied ~13% of the frame; 56 lifts it toward ~30% while still containing
## Dusk (centre -27,-35, r 9) whole.
const ARCH_SIZE_LANDSCAPE := 56.0
const ARCH_SIZE_PORTRAIT := 72.0

## PORTRAIT is a re-composed shot, not a squeezed desktop view.
##
## In landscape the meadow->frost axis runs screen-horizontally, which is exactly
## wrong for a tall frame (both shorelines clip). Portrait therefore ORBITS the
## camera so that axis runs screen-VERTICALLY: the offset is aligned with
## a = (26,0,-14).normalized(), so Frost sits nearer the camera (lower on screen)
## and the Meadow settlement sits above it. Pitch and roll are unchanged, so the
## diorama read and the light direction are identical.
##
## Sizing: the pair spans 26.7 units across the perpendicular axis and 51.5 along
## the view axis (31.6 after the sin(38°) foreshortening). At 800x1280 (aspect
## 0.625) size 46 gives 28.75 horizontal — the pair fits with margin — and the
## islands occupy ~880 of 1280px, inside the band the HUD leaves free.
const OBS_TARGET_PORTRAIT := Vector3(14.0, 1.4, -4.0)
const OBS_OFFSET_PORTRAIT := Vector3(24.9, 22.0, -13.4)
const ARCH_OFFSET_PORTRAIT := Vector3(30.0, 34.0, -16.0)

## ISLAND and STEWARD reuse the OBSERVATORY composition (its offset, and its
## ortho heights for ISLAND) because that framing is the one visual review signed
## off on -- they change only WHAT is centred, never the angle. Holding one ortho
## height for every island also makes the islands' relative sizes readable, and
## makes cycling between them a pure pan with no scale cut.
const ISLAND_ORDER := ["meadow", "frost", "dusk"]
var _island_index := 0
## Islands Core actually reports, in ISLAND_ORDER. ISLAND mode cycles only these,
## so the camera can never tour an island the authoritative world does not have.
var _core_islands: PackedStringArray = PackedStringArray()
## Tighter than ISLAND so the object under discussion is identifiable, wide enough
## that its surroundings still say WHERE it is.
const STEWARD_SIZE_LANDSCAPE := 24.0
const STEWARD_SIZE_PORTRAIT := 34.0
const STEWARD_LOOK_HEIGHT := 1.2

const FOLLOW_OFFSET := Vector3(10.0, 11.5, 10.0)
const FOLLOW_LOOK_HEIGHT := 0.8
const FOLLOW_SMOOTH := 6.0

## OVERVIEW framing — SOLVED at runtime, not tuned by hand.
##
## OBSERVATORY's constants were hand-fitted to meadow + frost and deliberately
## crop Dusk (see ASTRIX_VISUAL_BUILD.md §15). Rather than hand-fit a second set
## that would silently rot the next time an island moves, OVERVIEW projects every
## island footprint into the camera's own basis and solves for the ortho size and
## target that contain them all. Move an island in ISLANDS and the opening shot
## re-frames itself.
##
## The camera DIRECTION is still art-directed, because yaw decides which faces
## the fixed key light strikes:
##   landscape - the established 45deg yaw, unchanged from OBSERVATORY. At 16:9 the
##               frame reaches size*1.778 across and size/sin(38deg)=1.618*size deep,
##               i.e. nearly isotropic, so yaw buys almost nothing (43 vs 50) and
##               is not worth altering the diorama's light read for.
##   portrait  - a tall frame reaches ~2.6x further deep than across, so the
##               cluster's long axis MUST run screen-vertically or the shot has to
##               pull back ~20% further. The camera orbits onto the cluster's
##               principal axis, choosing whichever of the two candidate
##               directions sits nearer the landscape camera so the lighting
##               barely shifts. (The old portrait orbit was aligned to the
##               meadow->frost axis, which is the two-island answer.)
const PORTRAIT_ASPECT := 1.05
const OVERVIEW_MARGIN_LANDSCAPE := 5.0
const OVERVIEW_MARGIN_PORTRAIT := 3.0
## Pitch is preserved exactly: |(20,20)| horizontal against 22 up is the same
## ~37.9deg tilt every other mode uses.
const OVERVIEW_REACH := 28.284
## Lowered from 22.0: at ~38° elevation the camera looks DOWN on the islands
## and everything below the rim line (roots, waterfalls, cliff faces — the
## whole floating-world drama) is hidden behind the grass caps. At ~28° the
## opening frame shows the islands AS floating mountains while the settlement
## stays readable. The frame solver compensates foreshortening automatically.
const OVERVIEW_HEIGHT := 15.5
const OVERVIEW_TARGET_Y := 1.4

## Zoom multiplies whichever mode's base size is active; pan slides the target
## along the camera's own ground axes. Both are operator controls (MobileHUD /
## arrow keys) and both are bounded, so the frame can never leave the world.
const ZOOM_MIN := 0.34
const ZOOM_MAX := 1.15
const ZOOM_STEP := 0.16
## Fraction of the visible frame height panned per second while the pad is held.
## 0.55 measured as a lurch (the full clamped range in ~1.3s, so a small nudge was
## impossible); 0.38 crosses it in ~3.7s, which still feels responsive.
const PAN_SPEED := 0.38
const PAN_LIMIT := 0.7

var _zoom := 1.0
var _pan := Vector2.ZERO
var _overview_target := Vector3(0.0, OVERVIEW_TARGET_Y, 0.0)
var _overview_offset := Vector3(20.0, 22.0, 20.0)
var _overview_size := 50.0

var player: AstrixPlayer3D
var camera: Camera3D
var _portrait := false
var _time := 0.0

# ---------------------------------------------------------------------------
# LIGHTING / SEASON / TIME
# ---------------------------------------------------------------------------
var _sun: DirectionalLight3D
var _fill: DirectionalLight3D
var _sky_mat: ProceduralSkyMaterial
var _env: Environment
## Authoritative day phase (0..1 across Core's 08:00 -> 08:00 day). -1 = unknown.
var _sim_phase := -1.0
var _phase_eased := 0.25
var _season := ""
var _season_data: Dictionary = AstrixPalette.SEASONS["summer"]
## Meshes that repaint with the season: {node, kind, tier}.
var _seasonal: Array = []
## Roof/ground snow caps, shown only in winter.
var _snow_caps: Array[MeshInstance3D] = []
## Winter shore ice, shown only in winter.
var _ice_nodes: Array[MeshInstance3D] = []

# ---------------------------------------------------------------------------
# WATER — a real ocean shader (shaders/ocean.gdshader).
#
# The previous water was a translucent plane plus ~46 white "whitecap" quads and
# ~100 foam dashes ringing each island. Visual review found it did not read as
# water and the loose quads read as broken slabs floating in the sea. All of it
# is replaced by one surface that generates waves, crests, shallows and animated
# shore foam from the island positions in-shader — no decal geometry at all.
# ---------------------------------------------------------------------------
var _water_surface := WATER_LEVEL
var _water: MeshInstance3D
var _water_mat: ShaderMaterial
var _boats: Array[Node3D] = []
## Heading each boat was built with, so mooring yaw can swing AROUND it instead of
## accumulating drift. Sails are cached to spare a per-frame node lookup.
var _boat_headings: PackedFloat32Array = PackedFloat32Array()
var _boat_sails: Array[Node3D] = []

# ---------------------------------------------------------------------------
# SIM MATERIALIZATION
# ---------------------------------------------------------------------------
var _sim: Dictionary = {}            # key -> Node3D
var _sim_sig: Dictionary = {}        # key -> String (rebuild only on change)
var _villagers: Array[Node3D] = []
## Flat list of every anchor, as {"pos","island","kind","work"} — kept flat as
## well as bucketed because tools/diag_snapshot.gd reports its size.
var _villager_anchors: Array[Dictionary] = []
## island id -> Array[Dictionary] of that island's anchors. A villager is only
## ever routed within ONE bucket, which is what stops the old build's villagers
## from walking across open water between islands.
var _island_anchors: Dictionary = {}
## Deterministic island assignment per villager index, rebuilt with the anchors.
var _villager_islands: PackedStringArray = PackedStringArray()

# ---------------------------------------------------------------------------
# AUTHORITATIVE CLOCK + STEWARD FOCUS (from /astrix/agent/status)
# ---------------------------------------------------------------------------
## Whether AUTHORITATIVE world time is advancing. Read from the steward's own
## LoopState, never inferred from how long `day` has sat still.
##
## The server freezes Core's clock in exactly two situations: no run is live
## (IDLE/COMPLETED/STOPPED/FAILED -- see startWorldClock in src/server/index.ts)
## and AWAITING_APPROVAL, where src/astrix/server.ts's tick() returns early so
## the day cannot advance underneath a paused human decision. Both must read as
## a held world on screen, or the Observatory claims progress Core is not making.
var _world_live := true
const HELD_LOOP_STATES := ["IDLE", "COMPLETED", "STOPPED", "FAILED", "AWAITING_APPROVAL", ""]
## Where the steward is authoritatively acting, derived from the tool + args of
## its own action records. Vector3.ZERO with _has_steward_focus false means Core
## gave us nothing to point at -- the camera then says so instead of guessing.
var _steward_focus := Vector3.ZERO
var _has_steward_focus := false
var _steward_focus_label := ""
var _vegetation: Array[Node3D] = []  # swaying props
## Static set-dressing that must yield when an authoritative building lands on
## it. Vegetation is built at boot, before any snapshot, so a farm placed by the
## Steward WILL sometimes land on a tree — that is a real collision, and the
## settlement clearing land for a new farm is the correct visual answer.
var _clearable: Array[Node3D] = []

const VILLAGER_SCRIPT := preload("res://scripts/Villager3D.gd")
const MAX_RENDERED_VILLAGERS := 14

# ===========================================================================
# BOOT
# ===========================================================================
func _ready() -> void:
    var world_state := get_node_or_null("/root/WorldState")
    if world_state:
        world_state.resource_nodes.clear()
    GameClient.astrix_state_received.connect(_on_astrix_state_received)
    GameClient.astrix_agent_status_received.connect(_on_agent_status_received)
    _build_environment()
    _build_seabed()
    _build_water()
    for id in ISLANDS.keys():
        _build_island(id, ISLANDS[id])
    _build_distant_isles()
    _build_waterfalls()
    _build_settlement_dressing()
    _build_vegetation()
    _build_clouds()
    _build_fireflies()
    _build_gulls()
    _build_player()
    _build_camera()
    _build_systems()
    _apply_season("summer", "12:00")

func _process(delta: float) -> void:
    _time += delta
    _update_light(delta)
    _update_water(delta)
    _update_crops(delta)
    _update_smoke(delta)
    _update_proposal_markers()
    _update_fireflies()
    _update_splinters()
    _update_gulls()
    _update_clouds(delta)
    _update_camera(delta)
    for i in range(_vegetation.size()):
        var v: Node3D = _vegetation[i]
        if is_instance_valid(v):
            v.rotation.z = sin(_time * 0.7 + float(i) * 1.3) * 0.03

# ===========================================================================
# ENVIRONMENT + LIGHT
# ===========================================================================
func _build_environment() -> void:
    var holder := WorldEnvironment.new()
    holder.name = "Environment"
    var env := Environment.new()
    _env = env
    env.background_mode = Environment.BG_SKY
    var sky := Sky.new()
    var sky_mat := ProceduralSkyMaterial.new()
    _sky_mat = sky_mat
    sky_mat.sky_top_color = Color("3f8ee0")
    sky_mat.sky_horizon_color = Color("cfe4ef")
    sky_mat.ground_horizon_color = Color("cfe4ef")
    sky_mat.ground_bottom_color = Color("6f8ba8")
    sky_mat.sun_angle_max = 6.0
    sky_mat.sun_curve = 0.35
    sky.sky_material = sky_mat
    sky.process_mode = Sky.PROCESS_MODE_REALTIME
    env.sky = sky
    # Strong sky ambient: the reference keeps shadow faces bright and colourful
    # rather than crushing them to black. This is why the world looks sunlit.
    env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
    env.ambient_light_energy = 0.55
    env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
    env.tonemap_exposure = 1.0
    env.tonemap_white = 2.0
    env.glow_enabled = false
    # Aerial perspective: the world is small and the ocean is vast, so distance
    # needs atmosphere. Subtle blue depth fog (never dense enough to hide an
    # island) fuses the horizon and gives the far water its luminous depth.
    env.fog_enabled = true
    env.fog_light_color = Color("bcd8f0")
    env.fog_light_energy = 0.5
    env.fog_sun_scatter = 0.1
    env.fog_density = 0.0007
    env.fog_sky_affect = 0.25
    env.fog_height_density = 0.0
    holder.environment = env
    add_child(holder)

    # KEY LIGHT — single coherent direction (upper-left, ~48deg), real shadows.
    # Replaces the previous fake blob-shadow discs entirely.
    var sun := DirectionalLight3D.new()
    sun.name = "KeySun"
    _sun = sun
    sun.rotation_degrees = Vector3(-48.0, -34.0, 0.0)
    sun.light_color = Color("fff6cf")
    sun.light_energy = 1.75
    sun.shadow_enabled = true
    sun.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
    sun.directional_shadow_max_distance = 95.0
    sun.directional_shadow_blend_splits = false
    sun.shadow_normal_bias = 1.4
    sun.shadow_bias = 0.055
    sun.shadow_blur = 1.1
    add_child(sun)

    # Cool sky fill from the opposite side so shadowed faces stay readable
    # (no shadows from this one — one shadow-casting light only, mobile budget).
    var fill := DirectionalLight3D.new()
    fill.name = "SkyFill"
    _fill = fill
    fill.rotation_degrees = Vector3(-24.0, 148.0, 0.0)
    fill.light_color = Color("cfe2f5")
    fill.light_energy = 0.35
    fill.shadow_enabled = false
    add_child(fill)

## Time of day from Core's clock: sun arc + warm/cool grade. Falls back to a
## fixed midday look before the first authoritative snapshot (never a fake clock).
func _update_light(delta: float) -> void:
    if _sim_phase >= 0.0:
        _phase_eased = lerpf(_phase_eased, _sim_phase, minf(1.0, delta * 1.2))
    if not _sun or not _sky_mat or not _env:
        return

    # SOLAR ALTITUDE, not distance-from-noon.
    #
    # Iteration 1 used `evening = (|phase - 0.21| / 0.5) ^ 1.4`, which at Core's
    # 19:30 gave only 0.42 — a sunset render still looked like midday.
    # Iteration 2 put sunset AT 19:30, so altitude hit exactly 0 and the frame
    # went full night (review: "reads as night, not evening").
    #
    # Now: daylight runs 05:30 -> 21:00 (15.5h), so 19:30 lands in the last tenth
    # of the arc — a real golden hour with the sun still up. The sun's ELEVATION
    # comes from the altitude angle itself, so shadow length is physical rather
    # than tuned, and `evening` is a softer curve used only for colour/exposure.
    var hour := fmod(8.0 + _phase_eased * 24.0, 24.0)
    var altitude := sin(PI * clampf((hour - 5.5) / 15.5, 0.0, 1.0))
    var elevation := maxf(6.0, rad_to_deg(asin(clampf(altitude, 0.0, 1.0))))
    var evening := pow(1.0 - altitude, 1.3)

    var sun_base: Color = _season_data["sun"]
    var energy := float(_season_data["sun_energy"])
    # Sell time of day with HUE, not darkness. Golden hour is a WARM KEY against a
    # COOL FILL — an earlier pass that only cut exposure read as "midday over a
    # night background" because the light itself never changed temperature.
    _sun.light_color = sun_base.lerp(Color("ff7a2e"), evening)
    # Keep a real key light at dusk: the sun is low and warm, not switched off.
    _sun.light_energy = lerpf(energy, energy * 0.62, evening)
    # Elevation from the true solar angle => shadows rake long at both ends of the
    # day. Floored at 16deg (≈3.5x object height) rather than the physical 6deg:
    # a 10x rake buries the farm plots, and this is a management view.
    _sun.rotation_degrees = Vector3(-maxf(16.0, elevation), lerpf(-62.0, 62.0, clampf(_phase_eased, 0.0, 1.0)), 0.0)
    if _fill:
        # Cool blue-violet skylight fill at dusk, RAISED not lowered: a 1:20
        # key-to-fill ratio crushed shade faces to black. Golden hour has a strong
        # sky fill, so shade is a different HUE from the key, not merely darker.
        _fill.light_color = Color("cfe2f5").lerp(Color("6a7ae0"), evening)
        _fill.light_energy = lerpf(0.35, 0.62, evening)

    var top: Color = _season_data["sky_top"]
    var horizon: Color = _season_data["sky_horizon"]
    _sky_mat.sky_top_color = top.lerp(Color("3a4a86"), evening)
    # Warm horizon band on the sun side: a flat dark sky said "already set", which
    # made long raking shadows physically impossible.
    _sky_mat.sky_horizon_color = horizon.lerp(Color("ffa050"), minf(1.0, evening * 1.25))
    _sky_mat.ground_horizon_color = horizon.lerp(Color("d07a4a"), evening)
    _sky_mat.ground_bottom_color = Color("6f8ba8").lerp(Color("3a4270"), evening)
    # Ambient stays high: the sky is the fill source at dusk, and crushing it is
    # what made the settlement stop being legible.
    _env.ambient_light_energy = lerpf(float(_season_data["ambient"]), float(_season_data["ambient"]) * 0.92, evening)
    # Exposure barely moves. Time of day is carried by hue and shadow length; at
    # 0.62 the frame went black and plot state became unreadable.
    _env.tonemap_exposure = lerpf(1.0, 0.94, evening)
    _apply_water_colors(evening)
    _update_windows(evening)

## Lit windows: the settlement switches its lamps on as the light fails. Cheap,
## and the single clearest "it is evening" signal a still frame can carry.
var _window_lights: Array[MeshInstance3D] = []
var _windows_lit := false
func _update_windows(evening: float) -> void:
    var should_light := evening > 0.35
    if should_light == _windows_lit:
        return
    _windows_lit = should_light
    for w in _window_lights:
        if not is_instance_valid(w):
            continue
        var mat := w.material_override
        if mat is StandardMaterial3D:
            var m := mat as StandardMaterial3D
            m.albedo_color = Color("ffd98a") if should_light else Color("2f3a44")
            m.emission_enabled = should_light
            m.emission = Color("ffcf7a")
            m.emission_energy_multiplier = 1.4 if should_light else 0.0

## Collect an asset's window panes so the light cycle can switch them on.
func _register_windows_in(node: Node) -> void:
    for child in node.get_children():
        if child is MeshInstance3D and str(child.name).begins_with("Window") \
                and not str(child.name).contains("Frame"):
            _window_lights.append(child as MeshInstance3D)
        _register_windows_in(child)

## Parse Core's "HH:MM" into 0..1 across the simulated day (day starts 08:00).
func _phase_from_time(text: String) -> float:
    var parts := text.split(":")
    if parts.size() < 2:
        return -1.0
    var hours := fmod(float(parts[0].to_int()) - 8.0 + 24.0, 24.0) + float(parts[1].to_int()) / 60.0
    return clampf(hours / 24.0, 0.0, 1.0)

## Authoritative season -> the world repaints. Idempotent per season.
func _apply_season(season: String, time_text: String) -> void:
    var phase := _phase_from_time(time_text)
    if phase >= 0.0:
        _sim_phase = phase
    if season == _season:
        return
    _season = season
    _season_data = AstrixPalette.season(season)
    for entry in _seasonal:
        _paint_seasonal(entry)
    var winter := season == "winter"
    for cap in _snow_caps:
        if is_instance_valid(cap):
            cap.visible = winter
    # Winter shore ice: a pale ring just inside the waterline. Land goes white in
    # winter, so without this the sea kept a summer coastline.
    for ice in _ice_nodes:
        if is_instance_valid(ice):
            ice.visible = winter
    for v in _villagers:
        if is_instance_valid(v) and v.has_method("apply_season"):
            v.apply_season(season)

## Register a mesh as season-responsive. `kind` selects the season colour;
## `tier` preserves per-instance value layering (+lighter / -darker).
##
## IMPORTANT: the mesh is repainted IMMEDIATELY if a season is already active.
## Sim-materialized props (resource-node trees, farm crops) are created AFTER the
## first snapshot applies its season, so registration alone left them painted in
## their constructor colours — a bright green summer canopy standing in the snow.
func _seasonal_mesh(node: MeshInstance3D, kind: String, tier: float = 0.0) -> MeshInstance3D:
    _seasonal.append({"node": node, "kind": kind, "tier": tier})
    if _season != "":
        _paint_seasonal({"node": node, "kind": kind, "tier": tier})
    return node

func _paint_seasonal(entry: Dictionary) -> void:
    var node: Variant = entry.get("node")
    # Same freed-operand trap as _update_crops: valid-check first.
    if not is_instance_valid(node) or not (node is MeshInstance3D):
        return
    var mat := (node as MeshInstance3D).material_override
    if not (mat is StandardMaterial3D):
        return
    var base: Color = _season_data.get(str(entry.get("kind", "foliage")), _season_data["foliage"])
    var tier := float(entry.get("tier", 0.0))
    (mat as StandardMaterial3D).albedo_color = base.lightened(tier) if tier >= 0.0 else base.darkened(-tier)

func _register_foliage(parts: Array[MeshInstance3D], kind: String = "foliage") -> void:
    for i in range(parts.size()):
        _seasonal_mesh(parts[i], kind, 0.06 * float(i))

## A snow cap that only exists in winter (roofs, plot soil, rock tops).
func _snow_cap(node: MeshInstance3D) -> MeshInstance3D:
    node.visible = _season == "winter"
    _snow_caps.append(node)
    return node

## Assets build their own winter snow as children named "SnowCap*" (a roof cap
## can only be shaped correctly by whoever built the roof). This scans a freshly
## instanced asset and hands those nodes to the season system.
func _register_snow_in(node: Node) -> void:
    for child in node.get_children():
        if child is MeshInstance3D and str(child.name).begins_with("SnowCap"):
            _snow_cap(child as MeshInstance3D)
        _register_snow_in(child)

# ===========================================================================
# WATER + SEABED
#
# The single biggest previous failure was that water did not read as water.
# Fixes: ocean-blue specular surface at y=0, a real seabed far below so no gap
# ever shows through to nothing, island cliffs that continue underwater, a wet
# shore band, foam rings at every waterline, whitecap dashes and boats.
# ===========================================================================
## Padding added to the world span for the water surface and the seabed under it.
##
## Sized so NO camera frame can ever run off the edge of the water. Worst case is
## the portrait overview at maximum zoom-out and maximum pan: ~97 units of visible
## height, which the 38deg pitch stretches to ~157 units of ground reach, half of
## that from the centre (79), plus the pan clamp (0.7 x ~84 = 59) plus the offset
## from world centre to the island centroid (~10) = ~148 per side. 170 per side
## clears it. This is not cosmetic: the first portrait capture showed a solid band
## across the bottom sixth of the screen where the frame had run past the water and
## was showing the empty environment behind it.
const WATER_PAD := 340.0

func _build_seabed() -> void:
    # Deep floor well below the surface: guarantees there is never a void band
    # between islands, and gives the water something to be translucent over.
    var span := WORLD_MAX - WORLD_MIN
    var bed := AstrixMesh.box("Seabed", Vector3(span.x + WATER_PAD, 2.0, span.y + WATER_PAD),
        Vector3((WORLD_MIN.x + WORLD_MAX.x) * 0.5, WATER_LEVEL - 6.0, (WORLD_MIN.y + WORLD_MAX.y) * 0.5),
        AstrixPalette.WATER_DEEP.darkened(0.45))
    add_child(bed)

const OCEAN_SHADER := preload("res://shaders/ocean.gdshader")

func _build_water() -> void:
    var span := WORLD_MAX - WORLD_MIN
    var centre := Vector3((WORLD_MIN.x + WORLD_MAX.x) * 0.5, WATER_LEVEL, (WORLD_MIN.y + WORLD_MAX.y) * 0.5)
    _water = MeshInstance3D.new()
    _water.name = "Ocean"
    var plane := PlaneMesh.new()
    plane.size = span + Vector2(WATER_PAD, WATER_PAD)
    # Subdivided so the vertex-adjacent shader work has resolution to play with
    # and the surface never shows a single flat facet across the whole frame.
    # Raised with WATER_PAD to hold roughly the previous vertex spacing.
    plane.subdivide_width = 48
    plane.subdivide_depth = 48
    _water.mesh = plane
    var mat := ShaderMaterial.new()
    mat.shader = OCEAN_SHADER
    _water_mat = mat
    _apply_water_colors()
    # Feed the island footprints so the shader can draw shallows and shore foam
    # exactly where land actually is.
    var slots := ["island_a", "island_b", "island_c"]
    var i := 0
    for id in ISLANDS.keys():
        if i >= slots.size():
            break
        var data: Dictionary = ISLANDS[id]
        var c: Vector3 = data["center"]
        var rad: Vector2 = data["radius"]
        mat.set_shader_parameter(slots[i], Vector4(c.x, c.z, rad.x, rad.y))
        i += 1
    _water.material_override = mat
    _water.position = centre
    add_child(_water)

    for spec in BOAT_ANCHORS:
        var boat := AstrixAssets.sailboat(int(spec["seed"]), float(spec["heading"]))
        boat.position = (spec["pos"] as Vector3) + Vector3(0.0, WATER_LEVEL + 0.14, 0.0)
        add_child(boat)
        _boats.append(boat)
        # sailboat() adds deterministic per-boat jitter to the heading, so read the
        # built value back rather than assuming the spec's.
        _boat_headings.append(boat.rotation.y)
        _boat_sails.append(boat.get_node_or_null("Sail"))

func _apply_water_colors(evening: float = 0.0) -> void:
    if _water_mat == null:
        return
    var deep: Color = _season_data.get("water_deep", AstrixPalette.WATER_DEEP)
    var shallow: Color = _season_data.get("water_shallow", AstrixPalette.WATER_SHALLOW)
    # At dusk the sea goes dark and cool; foam stays the brightest thing on it.
    _water_mat.set_shader_parameter("deep_color", deep.lerp(Color("101c38"), evening * 0.8))
    _water_mat.set_shader_parameter("shallow_color", shallow.lerp(Color("2b4470"), evening * 0.75))
    _water_mat.set_shader_parameter("foam_color", AstrixPalette.FOAM.lerp(Color("c8b8d8"), evening * 0.5))

## Boats are MOORED, and they stay moored.
##
## Everything here is wind and water acting on a stationary hull: heave, roll,
## pitch, a slow swing on the mooring and a sail that luffs. None of it moves a
## boat from one place to another, because Core has no transportation state at all
## -- no vessels, no routes, no cargo, no in-transit resources (see the missing-
## field list in the audit). A boat that sailed somewhere would be asserting a
## journey the authoritative world does not contain, so no boat sails and none
## carries a wake.
func _update_water(_delta: float) -> void:
    # The surface itself is animated in-shader; only the boats need CPU motion.
    for i in range(_boats.size()):
        var boat: Node3D = _boats[i]
        if not is_instance_valid(boat):
            continue
        var phase := float(i)
        boat.position.y = WATER_LEVEL + 0.14 + sin(_time * 0.7 + phase * 1.4) * 0.07
        boat.rotation.z = sin(_time * 0.6 + phase) * 0.05
        boat.rotation.x = cos(_time * 0.5 + phase) * 0.035
        # Mooring yaw: a hull on a single line lies to the wind and swings slowly.
        # Bounded at +-0.045 rad about the BUILT heading, which keeps the sail off
        # edge-on (the failure that made boats collapse to ~2px) and cannot drift.
        if i < _boat_headings.size():
            boat.rotation.y = _boat_headings[i] + sin(_time * 0.19 + phase * 2.1) * 0.045
        # Sail luff: unsheeted cloth shivers. Rotating the sail node about Y keeps
        # it in one draw call -- no vertex animation, no extra material.
        var sail: Node3D = _boat_sails[i] if i < _boat_sails.size() else null
        if is_instance_valid(sail):
            sail.rotation.y = (PI * 0.5) + sin(_time * 1.9 + phase * 0.8) * 0.07

# ===========================================================================
# CLOUDS — purely environmental sky life. Flat-shaded diorama puffs drifting
# slowly over the ocean; they assert nothing about the simulation (Core has no
# weather), cast no shadows, and drift on wall-clock time even while the world
# clock is held, exactly like wind and water.
# ===========================================================================
var _clouds: Array[Node3D] = []
var _cloud_bases: Array[Vector3] = []

func _build_clouds() -> void:
    var group := Node3D.new()
    group.name = "Clouds"
    add_child(group)
    var r := AstrixMesh.rng(4242)
    # Six clouds over the OUTER ocean only: from the diorama camera a cloud at
    # any height projects onto the ground plane, so anything placed over the
    # island triangle would regularly cover a farm or building and read as
    # simulation state (snow? smoke? a verification mark?). Outer water never
    # holds authoritative meaning, so sky life lives there. Stations are LOW
    # (y~13): the higher a cloud, the further its projection shifts, so low
    # clouds stay over the water they were placed above.
    var spots := [
        Vector3(-48.0, 13.0, -2.0), Vector3(-44.0, 14.0, -36.0), Vector3(0.0, 13.0, -50.0),
        Vector3(50.0, 12.0, 14.0), Vector3(-42.0, 15.0, -22.0), Vector3(22.0, 13.0, 30.0),
    ]
    var bases: Array[Vector3] = []
    for i in range(spots.size()):
        var cloud := Node3D.new()
        cloud.name = "Cloud_%d" % i
        cloud.position = (spots[i] as Vector3) + Vector3(r.randf() * 4.0 - 2.0, r.randf() * 2.0 - 1.0, r.randf() * 4.0 - 2.0)
        var puffs := 3 + int(r.randf() * 2.0)
        for p in range(puffs):
            var rad := 1.2 + r.randf() * 0.8
            var puff := AstrixMesh.blob("Puff", rad,
                Vector3(float(p) * 2.2 - float(puffs) * 1.1 + r.randf(), r.randf() * 0.8, (r.randf() - 0.5) * 2.4),
                Color("f4f8fc"), 7, 4)
            puff.scale.y = 0.45
            # Unshaded: clouds stay bright against any sky grade, and critically
            # they must never darken the world beneath them.
            puff.material_override = AstrixPalette.unshaded(Color("f4f8fc"))
            puff.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
            cloud.add_child(puff)
        # Deterministic variety: some clouds read larger and lazier. Capped so
        # no single cloud grows island-sized and confusing at close framing.
        var s := 0.7 + r.randf() * 0.4
        cloud.scale = Vector3(s, s, s)
        group.add_child(cloud)
        _clouds.append(cloud)
        _cloud_bases.append(cloud.position)

func _update_clouds(_delta: float) -> void:
    # A slow breathing bob around each cloud's fixed station — deliberately NOT
    # lateral travel. Travel would eventually carry a cloud over an island,
    # where it would cover authoritative state; the station never moves, so the
    # sky stays alive and the islands stay readable.
    for i in range(_clouds.size()):
        var cloud: Node3D = _clouds[i]
        if not is_instance_valid(cloud):
            continue
        var base: Vector3 = _cloud_bases[i] if i < _cloud_bases.size() else cloud.position
        cloud.position.x = base.x + sin(_time * 0.05 + float(i) * 1.7) * 2.0
        cloud.position.y = base.y + sin(_time * 0.07 + float(i) * 2.3) * 0.5
        cloud.position.z = base.z + cos(_time * 0.04 + float(i) * 1.1) * 1.5

# ===========================================================================
# DISTANT GEOGRAPHY + WATERFALLS
#
# The horizon used to be empty water: the world ended at the third island.
# Three far islets (pure environment — no Core counterpart, no simulation,
# like clouds) give the ocean scale, and waterfalls falling off the island
# rims prove the world FLOATS: water leaves the world here.
# ===========================================================================

## Three tiny far islands on the horizon. Deliberately simple silhouettes
## (grass cap + cliff + root + one tree): they are depth cues, not destinations.
func _build_distant_isles() -> void:
    var group := Node3D.new()
    group.name = "DistantIsles"
    add_child(group)
    var r := AstrixMesh.rng(90210)
    var spots := [
        {"pos": Vector3(-25.0, 0.0, 20.0), "s": 0.5, "grass": AstrixPalette.GRASS_DARK},
        {"pos": Vector3(44.0, 0.0, -32.0), "s": 0.4, "grass": AstrixPalette.FROST_GRASS},
        {"pos": Vector3(-60.0, 0.0, 10.0), "s": 0.62, "grass": AstrixPalette.DUSK_GRASS},
    ]
    for i in range(spots.size()):
        var spec: Dictionary = spots[i]
        var c: Vector3 = spec["pos"]
        var s: float = spec["s"]
        var isle := Node3D.new()
        isle.name = "FarIsle_%d" % i
        isle.position = c
        var rad := 7.0 * s
        isle.add_child(AstrixMesh.cylinder_on("Cap", rad, rad * 1.04, 1.2,
            Vector3.ZERO, spec["grass"], 9))
        isle.add_child(AstrixMesh.cylinder_on("Cliff", rad * 0.96, rad * 0.5, 4.0,
            Vector3(0.0, -5.2, 0.0), AstrixPalette.ROCK.darkened(0.2), 8))
        isle.add_child(AstrixMesh.cylinder_on("Root", rad * 0.45, 0.2, 6.0,
            Vector3(0.0, -11.2, 0.0), AstrixPalette.ROCK.darkened(0.35), 7))
        var tree := AstrixAssets.tree_broadleaf(3100 + i, 1.3)
        (tree["root"] as Node3D).position = Vector3((r.randf() - 0.5) * 3.0, 1.2, (r.randf() - 0.5) * 3.0)
        isle.add_child(tree["root"])
        group.add_child(isle)
    # THE DROWNED GIANT — a dark half-sunken reef behind Dusk. Pure mystery and
    # scale: no Core counterpart, no simulation, like clouds. Dark slate fangs
    # and a low broken back (no green crown, unlike every living isle).
    #
    # SCALE DISCIPLINE: this sits just ~20 units past Dusk's rim, so at the
    # archipelago ortho height anything tall and wide fills the frame top as a
    # grey void-slab (it did). It therefore stays LOW — a reef breaching the
    # surface, never a continent: mass top +0.5, tallest fang +4.
    var levi := Node3D.new()
    levi.name = "Leviathan"
    # Behind Dusk as seen from the +X+Z cameras, with 10u of open water so it
    # stays a separate, unreachable mass no building can land on.
    levi.position = Vector3(-30.0, 0.0, -52.0)
    levi.rotation.y = 0.6
    var levi_rock := AstrixPalette.ROCK_DARK.darkened(0.25)
    levi.add_child(AstrixMesh.box("Mass", Vector3(20.0, 3.0, 8.0), Vector3(0.0, -2.5, 0.0), levi_rock))
    var peak1 := AstrixMesh.cone_on("Peak1", 2.2, 4.0, Vector3(-4.5, 0.5, 0.0), levi_rock, 7)
    levi.add_child(peak1)
    var peak2 := AstrixMesh.cone_on("Peak2", 1.6, 3.0, Vector3(4.0, 0.5, 1.0), levi_rock, 6)
    levi.add_child(peak2)
    group.add_child(levi)
    # A ring of small basalt fangs scattered offshore — the archipelago's
    # drowned kin. Offshore, so no building can ever land on them.
    var fang_spots := [Vector3(44.0, 0.0, 6.0), Vector3(-30.0, 0.0, -12.0), Vector3(6.0, 0.0, 26.0)]
    for i in range(fang_spots.size()):
        var fang := Node3D.new()
        fang.name = "SeaFang_%d" % i
        fang.position = Vector3((fang_spots[i] as Vector3).x, WATER_LEVEL - 1.2, (fang_spots[i] as Vector3).z)
        var fh := 3.0 + r.randf() * 1.5
        fang.add_child(AstrixMesh.cylinder_on("Fang", 0.7, 0.15, fh, Vector3.ZERO, AstrixPalette.BASALT.darkened(0.05), 6))
        group.add_child(fang)

## Waterfalls: Meadow's spring spills off the western rim, Dusk weeps off its
## southern rim. A translucent cascade + foam burst at the base + a drifting
## mist puff. Static geometry (no scrolling shader — the ocean's own motion
## sells the water); if it reads as glass in the render, it gets cut.
func _build_waterfalls() -> void:
    var group := Node3D.new()
    group.name = "Waterfalls"
    add_child(group)
    _waterfall(group, "meadow", 3.32, 1.6)
    _waterfall(group, "dusk", 4.45, 1.1)

func _waterfall(group: Node3D, island_id: String, angle: float, width: float) -> void:
    var data: Dictionary = ISLANDS[island_id]
    var centre: Vector3 = data["center"]
    var radius: Vector2 = data["radius"]
    var top: float = data["top"]
    var dir := Vector3(cos(angle), 0.0, sin(angle))
    var edge := Vector3(centre.x + dir.x * radius.x * 0.97, top, centre.z + dir.z * radius.y * 0.97)
    var fall_h := top - WATER_LEVEL + 0.4
    var cascade := AstrixMesh.box("Cascade", Vector3(width, fall_h, 0.28),
        Vector3(edge.x + dir.x * 0.5, edge.y - fall_h * 0.5, edge.z + dir.z * 0.5),
        Color(0.75, 0.9, 1.0, 0.62))
    var cmat := StandardMaterial3D.new()
    cmat.albedo_color = Color(0.75, 0.9, 1.0, 0.62)
    cmat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
    cmat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
    cascade.material_override = cmat
    cascade.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
    group.add_child(cascade)
    # Foam burst where the fall lands.
    var r := AstrixMesh.rng(hash(island_id) & 0x7fffffff)
    for i in range(4):
        var foam := AstrixMesh.blob("FallFoam", 0.5 + r.randf() * 0.4,
            Vector3(edge.x + dir.x * (1.2 + r.randf() * 1.6), WATER_LEVEL + 0.1,
                edge.z + dir.z * (1.2 + r.randf() * 1.6)),
            Color(0.93, 0.97, 1.0, 0.85), 7, 3)
        foam.scale.y = 0.35
        foam.material_override = AstrixPalette.unshaded(Color(0.93, 0.97, 1.0))
        foam.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
        group.add_child(foam)
    # A notch in the rim where the water leaves: dark wet stone channel.
    var notch := AstrixMesh.box("Spillway", Vector3(width + 0.7, 0.16, 1.6),
        Vector3(edge.x - dir.x * 0.6, top + 0.02, edge.z - dir.z * 0.6), AstrixPalette.ROCK_DARK)
    notch.rotation.y = atan2(dir.x, dir.z) + PI * 0.5
    group.add_child(notch)

# ===========================================================================
# ISLANDS
#
# Each island is a CONTINUOUS column: submerged plinth -> stone cliff -> soil
# band -> grass cap, then a rocky rim, a beach where appropriate, and a foam
# ring at the waterline. No vertical gaps (the old build left a void band from
# y1.6-2.3 that made every island look like it was floating).
# ===========================================================================
func _build_island(id: String, data: Dictionary) -> void:
    var group := Node3D.new()
    group.name = "Island_%s" % id
    add_child(group)
    var centre: Vector3 = data["center"]
    var radius: Vector2 = data["radius"]
    var top: float = data["top"]
    var grass_kind: String = data["grass"]
    var rock_color: Color = data["rock"]

    var grass_h := 0.9
    var soil_h := 0.8
    var grass_bottom := top - grass_h
    var soil_bottom := grass_bottom - soil_h
    # Cliff runs from 5 units UNDER the water up to the soil band: the island
    # visibly rises out of the sea and has mass below it.
    var cliff_bottom := WATER_LEVEL - 5.0

    # Stone cliff, faceted, slightly rotated so it never looks like a box.
    # Cliff rock is darkened well below the grass so the island silhouette reads
    # as land rising out of water rather than a pale mass floating in sky.
    var cliff := AstrixMesh.cylinder_on("Cliff", radius.x * 0.99, radius.x * 1.06,
        soil_bottom - cliff_bottom, Vector3(centre.x, cliff_bottom, centre.z), rock_color.darkened(0.18), 11)
    cliff.scale.z = radius.y / radius.x
    cliff.rotation.y = 0.19
    group.add_child(cliff)
    # Wet band right at the waterline: darkest value in the island stack.
    var wet := AstrixMesh.cylinder_on("WetRock", radius.x * 1.02, radius.x * 1.05, 1.4,
        Vector3(centre.x, WATER_LEVEL - 0.8, centre.z), rock_color.darkened(0.48), 11)
    wet.scale.z = radius.y / radius.x
    wet.rotation.y = 0.19
    group.add_child(wet)

    # Soil band, inset so the profile steps inward toward the grass.
    var soil := AstrixMesh.cylinder_on("Soil", radius.x * 0.955, radius.x * 0.985, soil_h,
        Vector3(centre.x, soil_bottom, centre.z), AstrixPalette.SOIL, 12)
    soil.scale.z = radius.y / radius.x
    soil.rotation.y = -0.11
    group.add_child(soil)

    # Grass cap — its bottom sits exactly on the soil band, no gap.
    var grass := AstrixMesh.cylinder_on("Grass", radius.x * 0.93, radius.x * 0.95, grass_h,
        Vector3(centre.x, grass_bottom, centre.z), _grass_color(grass_kind), 12)
    grass.scale.z = radius.y / radius.x
    grass.rotation.y = 0.07
    group.add_child(grass)
    _seasonal_mesh(grass, _grass_season_kind(grass_kind), 0.0)
    # Winter snow blanket, sized just above the grass cap.
    var snow := AstrixMesh.cylinder_on("SnowBlanket", radius.x * 0.935, radius.x * 0.955, 0.14,
        Vector3(centre.x, top - 0.04, centre.z), AstrixPalette.SNOW, 12)
    snow.scale.z = radius.y / radius.x
    snow.rotation.y = 0.07
    group.add_child(_snow_cap(snow))

    # WINTER SHORE ICE: a pale collar floating just outside the rim. In winter the
    # land goes white, so without this the coastline still read as summer.
    var ice := AstrixMesh.cylinder_on("ShoreIce", radius.x * 1.14, radius.x * 1.14, 0.18,
        Vector3(centre.x, WATER_LEVEL - 0.02, centre.z), Color("dbe9f2"), 14)
    ice.scale.z = radius.y / radius.x
    ice.rotation.y = -0.14
    group.add_child(ice)
    ice.visible = _season == "winter"
    _ice_nodes.append(ice)

    # Interior elevation: a low knoll so the ground is not a perfect disc.
    var knoll := AstrixMesh.cylinder_on("Knoll", radius.x * 0.34, radius.x * 0.44, 0.55,
        Vector3(centre.x - radius.x * 0.28, top - 0.1, centre.z - radius.y * 0.3),
        _grass_color(grass_kind).darkened(0.05), 10)
    knoll.scale.z = radius.y / radius.x
    group.add_child(knoll)
    _seasonal_mesh(knoll, _grass_season_kind(grass_kind), -0.05)

    _build_island_rim(group, id, centre, radius, top, rock_color, bool(data["beach"]))
    _build_island_strata(group, id, centre, radius, top, rock_color)
    _build_island_root(group, id, centre, radius, top, rock_color)
    _build_island_shelves(group, id, centre, radius, top)
    _build_island_floor(group, id, centre, radius, top)
    # Reimagination sculpt: each island's geology declares its identity.
    if id == "frost":
        _build_frost_crown(group, centre, radius, top)
    elif id == "dusk":
        _build_dusk_shatter(group, centre, radius, top)

func _grass_color(kind: String) -> Color:
    match kind:
        "frost": return AstrixPalette.FROST_GRASS
        "dusk": return AstrixPalette.DUSK_GRASS
        _: return AstrixPalette.GRASS
## Frost/dusk keep their identity through the seasons: each biome has its own
## per-season grass colour in AstrixPalette.SEASONS, so a seasonal repaint never
## flattens dusk's violet or frost's mint into meadow green.
func _grass_season_kind(kind: String) -> String:
    match kind:
        "frost": return "frost_grass"
        "dusk": return "dusk_grass"
        _: return "grass"

## Rocky rim + optional beach. Islands end in blocky boulders meeting the water,
## with an occasional sand strip — a crisp readable silhouette. Shore foam is
## drawn by the ocean shader, so there is no decal geometry here.
func _build_island_rim(group: Node3D, id: String, centre: Vector3, radius: Vector2,
        top: float, rock_color: Color, beach: bool) -> void:
    var r := AstrixMesh.rng(hash(id) & 0x7fffffff)
    var count := int(radius.x * 1.5)
    for i in range(count):
        var a := TAU * float(i) / float(count) + r.randf() * 0.12
        var dir := Vector3(cos(a), 0.0, sin(a))
        var rad := AstrixMesh.ellipse_radius(radius * 0.95, dir)
        var pos := centre + dir * rad
        # Boulders straddle the waterline: land visibly enters the sea. They are
        # DARK and wet-looking on purpose — pale grey rocks at the waterline read
        # as cloud puffs under a floating island, which made the ocean read as sky.
        var boulder := AstrixAssets.rock(int(r.randi()), 1.1 + r.randf() * 0.45, rock_color.darkened(0.3))
        boulder.position = Vector3(pos.x, WATER_LEVEL + 0.08, pos.z)
        boulder.scale.y = 1.4 + r.randf() * 1.0
        group.add_child(boulder)
        # Turf overhang so the top rim is soft, not a sharp disc.
        if i % 2 == 0:
            var lip := AstrixMesh.blob("Turf", 0.5 + r.randf() * 0.28,
                Vector3(pos.x, top - 0.32, pos.z), _grass_color(ISLANDS[id]["grass"]), 6, 3)
            lip.scale.y = 0.42
            group.add_child(lip)
            _seasonal_mesh(lip, _grass_season_kind(ISLANDS[id]["grass"]), 0.03)
    if beach:
        # Sand spit on the camera-facing side: LAND -> SAND -> WATER reads
        # instantly. It sits ABOVE the waterline and overlaps the grass cap so it
        # is visibly part of the island — a sand disc floating at water level
        # read as a detached white blob in open water.
        var dir2 := Vector3(0.72, 0.0, 0.69).normalized()
        var rad2 := AstrixMesh.ellipse_radius(radius * 0.82, dir2)
        var beach_pos := centre + dir2 * rad2
        var sand := AstrixMesh.cylinder_on("Beach", 2.6, 3.4, 1.2,
            Vector3(beach_pos.x, WATER_LEVEL + 0.15, beach_pos.z), AstrixPalette.SAND, 10)
        sand.scale.z = 0.55
        sand.rotation.y = -0.7
        group.add_child(sand)

# ===========================================================================
# ISLAND SCULPT — strata terraces + rim shelves.
#
# The reference dioramas read as sculpted because their cliffs are LAYERED
# (visible strata shelves stepping down to the water) and their rims are broken
# (grass shelves at different heights, never one perfect disc). The island core
# stays a smooth column; these sit ON it, outside the 72% buildable interior,
# so no authoritative building can ever intersect them and the island topology
# Core owns is untouched.
# ===========================================================================

## Two stepped strata rings on the cliff face: lighter stone shelves jutting out
## below the soil band, with deterministic boulder outcrops for breakup.
func _build_island_strata(group: Node3D, id: String, centre: Vector3, radius: Vector2,
        top: float, rock_color: Color) -> void:
    var r := AstrixMesh.rng((hash(id) & 0x7fffffff) + 517)
    # Shelf heights: fractions of the way from the grass top down to the water.
    # Strata read as SHADOWED rock ledges: darker than the cliff face, never
    # lighter — a pale ring renders as snow/foam and breaks the island's mass.
    var shelves := [
        {"t": 0.45, "out": 1.03, "tone": 0.10},
        {"t": 0.72, "out": 1.07, "tone": 0.22},
    ]
    for s in shelves:
        var shelf_y: float = lerpf(top, WATER_LEVEL, float(s["t"]))
        var ring := AstrixMesh.cylinder_on("Strata", radius.x * float(s["out"]),
            radius.x * float(s["out"]) * 1.03, 0.4,
            Vector3(centre.x, shelf_y - 0.4, centre.z),
            rock_color.darkened(float(s["tone"])), 11)
        ring.scale.z = radius.y / radius.x
        ring.rotation.y = 0.31
        group.add_child(ring)
    # Boulder outcrops gripping the upper shelf: 3 per island, deterministic.
    for i in range(3):
        var a := TAU * (float(i) / 3.0) + r.randf() * 0.5 + float(hash(id) & 0xff) * 0.01
        var dir := Vector3(cos(a), 0.0, sin(a))
        var rad := AstrixMesh.ellipse_radius(radius * 1.02, dir)
        var shelf_y2: float = lerpf(top, WATER_LEVEL, 0.45)
        var outcrop := AstrixAssets.rock(int(r.randi()), 0.9 + r.randf() * 0.5, rock_color.darkened(0.12))
        outcrop.position = Vector3(centre.x + dir.x * rad, shelf_y2 + 0.1, centre.z + dir.z * rad)
        group.add_child(outcrop)

## THE ROOT — the answer to "a green disc floating in a blue void". Beneath
## every island hangs an inverted mountain: a tapering rock spire descending
## into the luminous deep, with clinging shards. Islands stop being platforms
## and become the sunlit crowns of ancient geological bodies. Purely
## environmental (Core owns the surface topology; nothing lives below), but it
## is what sells the floating world from every camera angle.
func _build_island_root(group: Node3D, id: String, centre: Vector3, radius: Vector2,
        top: float, rock_color: Color) -> void:
    var r := AstrixMesh.rng((hash(id) & 0x7fffffff) + 2718)
    var base_y := WATER_LEVEL - 4.0
    # Main spire: wide where it meets the cliff, tapering to a point deep below.
    # cylinder_on(top_r, bottom_r, h, pos): top radius large, bottom tiny.
    var depth := 9.0 + radius.x * 0.35
    var spire := AstrixMesh.cylinder_on("Root", radius.x * 0.72, 0.4, depth,
        Vector3(centre.x, base_y - depth, centre.z), rock_color.darkened(0.3), 9)
    spire.scale.z = radius.y / radius.x
    spire.rotation.y = 0.44
    group.add_child(spire)
    # A lighter collar where root meets cliff: makes the join read as one body.
    var collar := AstrixMesh.cylinder_on("RootCollar", radius.x * 0.86, radius.x * 0.7, 1.6,
        Vector3(centre.x, base_y - 1.6, centre.z), rock_color.darkened(0.14), 9)
    collar.scale.z = radius.y / radius.x
    collar.rotation.y = 0.44
    group.add_child(collar)
    # Clinging shards: 3 tilted splinters at deterministic angles.
    for i in range(3):
        var a := TAU * float(i) / 3.0 + r.randf() * 0.8
        var dir := Vector3(cos(a), 0.0, sin(a))
        var shard := AstrixMesh.cone_on("Shard", 0.5 + r.randf() * 0.4, 2.6 + r.randf() * 1.4,
            Vector3(centre.x + dir.x * radius.x * 0.62, base_y - 1.0 - r.randf() * 2.0, centre.z + dir.z * radius.y * 0.62),
            rock_color.darkened(0.22), 5)
        shard.rotation_degrees = Vector3((r.randf() - 0.5) * 36.0, r.randf() * 180.0, 165.0 + (r.randf() - 0.5) * 30.0)
        group.add_child(shard)
    if id == "dusk":
        # Dusk's strangeness has a source: pale crystals growing UNDER the
        # island, catching the deep light. Environmental echo of the
        # authoritative crystal node on top — never a resource itself.
        for i in range(4):
            var a2 := TAU * float(i) / 4.0 + 0.5
            var dir2 := Vector3(cos(a2), 0.0, sin(a2))
            var gem := AstrixMesh.cone_on("UnderCrystal", 0.28, 1.1 + r.randf() * 0.7,
                Vector3(centre.x + dir2.x * radius.x * 0.5, base_y - 0.6 - r.randf() * 1.5, centre.z + dir2.z * radius.y * 0.5),
                AstrixPalette.CRYSTAL, 5)
            gem.material_override = AstrixPalette.glow(AstrixPalette.CRYSTAL, 0.55)
            gem.rotation_degrees = Vector3(160.0 + (r.randf() - 0.5) * 24.0, r.randf() * 180.0, (r.randf() - 0.5) * 20.0)
            group.add_child(gem)

## Grass shelves on the rim: stepped mini-plateaus that break the perfect disc.
## Angles are hand-picked per island to stay clear of bridge heads, beaches and
## the farm belt; all sit at 0.80-0.88 radius, outside the buildable interior.
func _build_island_shelves(group: Node3D, id: String, centre: Vector3, radius: Vector2, top: float) -> void:
    var angles: Array[float] = [1.75, 2.97, 5.24]
    match id:
        "frost":
            angles = [1.05, 4.01, 5.59]
        "dusk":
            angles = [2.62, 4.19, 5.76]
    var r := AstrixMesh.rng((hash(id) & 0x7fffffff) + 917)
    var grass_kind := str(ISLANDS[id]["grass"])
    for i in range(angles.size()):
        var dir := Vector3(cos(angles[i]), 0.0, sin(angles[i]))
        var dist := 0.84 * (0.97 + r.randf() * 0.06)
        var pos := Vector3(centre.x + dir.x * radius.x * dist, top - 0.55, centre.z + dir.z * radius.y * dist)
        var shelf := AstrixMesh.box_on("GrassShelf", Vector3(3.4 + r.randf() * 0.8, 0.55, 2.6 + r.randf() * 0.6),
            pos, _grass_color(grass_kind))
        shelf.rotation.y = -angles[i] + (r.randf() - 0.5) * 0.3
        group.add_child(shelf)
        _seasonal_mesh(shelf, _grass_season_kind(grass_kind), 0.02)
        # One piece of dressing per shelf so it reads as ground, not a plinth.
        if r.randf() < 0.6:
            var b := AstrixAssets.bush(1200 + hash(id) & 0xffff + i)
            (b["root"] as Node3D).position = pos + Vector3((r.randf() - 0.5) * 1.6, 0.55, (r.randf() - 0.5) * 1.2)
            group.add_child(b["root"])
            _register_foliage(b["foliage"])
        else:
            var rk := AstrixAssets.rock(1400 + hash(id) & 0xffff + i, 0.7)
            rk.position = pos + Vector3((r.randf() - 0.5) * 1.6, 0.55, (r.randf() - 0.5) * 1.2)
            group.add_child(rk)

func _build_island_floor(group: Node3D, id: String, centre: Vector3, radius: Vector2, top: float) -> void:
    var body := StaticBody3D.new()
    body.name = "%s_Floor" % id
    body.position = Vector3(centre.x, top - 0.3, centre.z)
    var shape := CollisionShape3D.new()
    var box := BoxShape3D.new()
    box.size = Vector3(radius.x * 1.75, 0.6, radius.y * 1.75)
    shape.shape = box
    body.add_child(shape)
    group.add_child(body)

# ===========================================================================
# REIMAGINATION SCULPT — each island's geology declares its identity.
#
# Meadow needs no sculpt here: its terraces live in the settlement dressing
# (they must align with the farm belt, not the island rim). Frost becomes the
# Bastion (basalt palisade + winter cornice) and Dusk becomes the Shatter
# (jagged shards, a broken arch, crystal veins, floating splinters). All of it
# is environmental — Core owns the surface topology; nothing lives in the rock.
# ===========================================================================

## Frost crown: a palisade of basalt columns gripping the upper cliff + a snow
## cornice ringing the rim in winter. The columns stand at ~1.0 radius on the
## cliff face (outside the 72% buildable interior), the cornice just above the
## grass cap. Together they make the Bastion severe in every season.
func _build_frost_crown(group: Node3D, centre: Vector3, radius: Vector2, top: float) -> void:
    var r := AstrixMesh.rng(5150)
    var count := 10
    for i in range(count):
        var a := TAU * float(i) / float(count) + 0.31 + r.randf() * 0.1
        var dir := Vector3(cos(a), 0.0, sin(a))
        var rad := AstrixMesh.ellipse_radius(radius * 1.0, dir)
        var h := 1.6 + r.randf() * 1.1
        var col := AstrixAssets.basalt_column(5100 + i, h)
        # Columns rise from the cliff face: base below the grass cap, crown above.
        col.position = Vector3(centre.x + dir.x * rad, top - h * 0.55, centre.z + dir.z * rad)
        group.add_child(col)
    # Winter cornice: snow slabs overhanging the rim. Winter-only, like the caps.
    for i in range(8):
        var a2 := TAU * float(i) / 8.0 + 0.15
        var dir2 := Vector3(cos(a2), 0.0, sin(a2))
        var rad2 := AstrixMesh.ellipse_radius(radius * 0.99, dir2)
        var slab := AstrixMesh.blob("Cornice", 0.75 + r.randf() * 0.3,
            Vector3(centre.x + dir2.x * rad2, top + 0.12, centre.z + dir2.z * rad2),
            AstrixPalette.SNOW, 7, 3)
        slab.scale.y = 0.3
        group.add_child(_snow_cap(slab))

## Dusk shatter: jagged shards instead of round boulders on the rim, a broken
## arch ruin on the north slope, crystal veins along a fracture line, and three
## splinters floating above the island (wall-clock bob, like clouds — pure
## atmosphere, Core has no sky state).
func _build_dusk_shatter(group: Node3D, centre: Vector3, radius: Vector2, top: float) -> void:
    var r := AstrixMesh.rng(7771)
    for i in range(6):
        var a := TAU * float(i) / 6.0 + 0.5 + r.randf() * 0.2
        var dir := Vector3(cos(a), 0.0, sin(a))
        var rad := AstrixMesh.ellipse_radius(radius * 0.97, dir)
        var shard := AstrixAssets.dusk_shard(7700 + i, 0.9 + r.randf() * 0.5)
        shard.position = Vector3(centre.x + dir.x * rad, top - 0.1, centre.z + dir.z * rad)
        group.add_child(shard)
    # The broken arch stands on the north slope at 0.8 radius — outside the
    # buildable interior, so no authoritative structure can land on it.
    var ruin_dir := Vector3(cos(4.4), 0.0, sin(4.4))
    var ruin := AstrixAssets.ruin_arch(7799)
    ruin.position = Vector3(
        centre.x + ruin_dir.x * radius.x * 0.8, top, centre.z + ruin_dir.z * radius.y * 0.8)
    group.add_child(ruin)
    # Crystal veins along a diagonal fracture: environmental echo of the
    # authoritative crystal node, never a resource itself.
    for i in range(4):
        var t := -1.5 + float(i) * 1.0
        var vein := AstrixMesh.cone_on("Vein", 0.14, 0.4 + r.randf() * 0.3,
            Vector3(centre.x + t, top, centre.z + t * 0.6), AstrixPalette.CRYSTAL, 5)
        vein.material_override = AstrixPalette.glow(AstrixPalette.CRYSTAL, 0.5)
        vein.rotation_degrees.z = (r.randf() - 0.5) * 30.0
        group.add_child(vein)
    # Floating splinters above the island.
    var splinters := Node3D.new()
    splinters.name = "DuskSplinters"
    group.add_child(splinters)
    var offsets := [Vector3(-3.0, 4.4, 1.0), Vector3(2.5, 5.2, -2.0), Vector3(0.5, 3.7, 3.2)]
    for i in range(offsets.size()):
        var splinter := AstrixMesh.box("Splinter_%d" % i,
            Vector3(0.6 + r.randf() * 0.35, 0.5 + r.randf() * 0.3, 0.55 + r.randf() * 0.3),
            Vector3.ZERO, AstrixPalette.DUSK_ROCK.darkened(0.1))
        splinter.rotation_degrees = Vector3(18.0 + r.randf() * 22.0, r.randf() * 60.0, 24.0 + r.randf() * 18.0)
        splinter.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
        var holder := Node3D.new()
        holder.name = "SplinterHolder_%d" % i
        holder.position = Vector3(centre.x, top, centre.z) + offsets[i]
        holder.add_child(splinter)
        var gem := AstrixMesh.cone_on("SplinterGem", 0.14, 0.4, Vector3(0.0, -0.6, 0.0),
            AstrixPalette.CRYSTAL, 5)
        gem.material_override = AstrixPalette.glow(AstrixPalette.CRYSTAL, 0.6)
        holder.add_child(gem)
        splinters.add_child(holder)
        _splinters.append({"node": holder, "base": holder.position, "phase": float(i) * 2.1})

func _surface_of(id: String) -> float:
    return float(ISLANDS.get(id, ISLANDS["meadow"])["top"])

## Signed distance-ish helper: >0 means the point is inside some island's grass
## disc. Used to keep water dressing off the land.
func _nearest_island_penetration(pos: Vector3) -> float:
    var best := -999.0
    for id in ISLANDS.keys():
        var data: Dictionary = ISLANDS[id]
        var c: Vector3 = data["center"]
        var rad: Vector2 = data["radius"]
        var dx := (pos.x - c.x) / rad.x
        var dz := (pos.z - c.z) / rad.y
        best = maxf(best, 1.0 - sqrt(dx * dx + dz * dz))
    return best

## Map an authoritative Core position onto its rendered island.
##
## Core's coordinates are abstract (farms clustered at one end of each island,
## houses at the other). `core_scale` is an ANISOTROPIC world-units-per-Core-unit
## factor: the meadow stretches X so Core's 4-unit farm spacing becomes ~6 world
## units — enough that two farm plots with barns never overlap — while keeping Z
## inside the island. `core_flip` mirrors Z so the farm belt faces the camera.
##
## The clamp is PER-AXIS (a box, not an ellipse): an ellipse clamp collapsed
## distinct farms onto the same rim arc, which made them overlap.
func _map_core_pos(island_id: String, core_pos: Vector3) -> Vector3:
    var data: Dictionary = ISLANDS.get(island_id, ISLANDS["meadow"])
    var centre: Vector3 = data["center"]
    var radius: Vector2 = data["radius"]
    var core_centre: Vector2 = data["core_center"]
    var flip: Vector2 = data.get("core_flip", Vector2.ONE)
    var scale: Vector2 = data.get("core_scale", Vector2.ONE)
    var offset := Vector2(
        (core_pos.x - core_centre.x) * flip.x * scale.x,
        (core_pos.z - core_centre.y) * flip.y * scale.y)
    # Buildable interior: 72% of the island radius keeps a margin from the rim so
    # nothing is ever built on a cliff or hanging over the sea.
    var limit := radius * 0.72
    offset.x = clampf(offset.x, -limit.x, limit.x)
    offset.y = clampf(offset.y, -limit.y, limit.y)
    return Vector3(centre.x + offset.x, float(data["top"]), centre.z + offset.y)

## World-space point on an island's rim facing another island — used for bridge
## endpoints and for routing the static path network to the bridge head.
func _rim_point(from_id: String, toward_id: String, inset: float = 0.93) -> Vector3:
    var da: Dictionary = ISLANDS[from_id]
    var db: Dictionary = ISLANDS[toward_id]
    var ca: Vector3 = da["center"]
    var cb: Vector3 = db["center"]
    var dir := cb - ca
    dir.y = 0.0
    dir = dir.normalized()
    var point := ca + dir * (AstrixMesh.ellipse_radius((da["radius"] as Vector2) * inset, dir))
    point.y = float(da["top"])
    return point

# ===========================================================================
# SETTLEMENT DRESSING (static: paths, square, well, market, fences)
#
# Ground decals are THIN BOXES with real thickness at distinct heights, never
# coplanar quads — this is the actual fix for the ground striping / z-fighting,
# rather than hiding it with a camera angle.
# ===========================================================================
const GROUND_PATH_Y := 0.02        # path slabs sit 2cm above the grass cap
const GROUND_PLAZA_Y := 0.015

## A path slab running between two points on the island surface. Built as a real
## box (never a coplanar quad) at a fixed offset above the grass, so ground
## decals can never z-fight; the caller supplies actual endpoints, which is what
## stops paths from dead-ending in open grass.
func _path_between(from_pos: Vector3, to_pos: Vector3, width: float, surface: float) -> MeshInstance3D:
    var delta := to_pos - from_pos
    delta.y = 0.0
    var length := Vector2(delta.x, delta.z).length()
    var mid := (from_pos + to_pos) * 0.5
    var path := AstrixMesh.box_on("Path", Vector3(width, 0.1, length + width * 0.6),
        Vector3(mid.x, surface + GROUND_PATH_Y, mid.z), AstrixPalette.PATH.darkened(0.05))
    path.rotation.y = atan2(delta.x, delta.z)
    return path

## A winding path through 3+ waypoints: chained slabs with a slight width taper
## so the route narrows as it leaves the village heart. Same cheap boxes as a
## straight path — the organic read comes from the bends, not new geometry.
## Presentation only: no navigation, no traffic, no pathfinding, no state.
func _path_polyline(group: Node3D, points: Array[Vector3], width: float, surface: float) -> void:
    for i in range(points.size() - 1):
        var taper := width * (1.0 - 0.12 * float(i) / maxf(1.0, float(points.size() - 2)))
        group.add_child(_path_between(points[i], points[i + 1], taper, surface))

## A gate arch at the bridge head from one island toward another. Oriented so
## its lintel spans the walked line: pylons flank the path, the lantern hangs
## over it. Static geography at rim 0.80 — outside the buildable interior.
func _place_gate(group: Node3D, from_id: String, to_id: String, seed_value: int) -> void:
    var pos := _rim_point(from_id, to_id, 0.80)
    var from_c: Vector3 = ISLANDS[from_id]["center"]
    var to_c: Vector3 = ISLANDS[to_id]["center"]
    var dir := to_c - from_c
    dir.y = 0.0
    dir = dir.normalized()
    var gate := AstrixAssets.gate_arch(seed_value)
    gate.position = pos
    # The span (local X, pylon to pylon) must lie ACROSS the walked line: with
    # yaw = atan2(dx,dz) local +Z runs along the path (the same convention as
    # _path_between and the bridge deck), so local X spans it. A +90° offset
    # here would turn the gate sideways, pylons fore-and-aft of the walker.
    gate.rotation.y += atan2(dir.x, dir.z)
    group.add_child(gate)
    _register_snow_in(gate)
    for cloth in gate.find_children("BannerCloth", "MeshInstance3D", true, false):
        _vegetation.append(cloth)

## One terrace step: dry-stone retaining wall segments (with gaps) + a tilled
## tread strip on the south face. Ground-level dressing farms settle into.
func _terrace_run(group: Node3D, z: float, spans: Array, surface: float) -> void:
    for span in spans:
        var x0 := float(span[0])
        var x1 := float(span[1])
        var cx := (x0 + x1) * 0.5
        var length := x1 - x0
        group.add_child(AstrixMesh.box_on("TerraceWall", Vector3(length, 0.75, 0.6),
            Vector3(cx, surface, z), AstrixPalette.STONE_WALL))
        group.add_child(AstrixMesh.box("TerraceCap", Vector3(length, 0.12, 0.72),
            Vector3(cx, surface + 0.81, z), AstrixPalette.ROCK_DARK))
        group.add_child(AstrixMesh.box_on("TerraceTread", Vector3(length, 0.14, 1.5),
            Vector3(cx, surface, z + 1.05), AstrixPalette.SOIL_TILLED))

## Irrigation rill + spring basin west of the farm belt.
func _build_rill(group: Node3D, surface: float) -> void:
    var x := -3.2
    var z0 := -2.0
    var z1 := 8.0
    var length := z1 - z0
    var mid := (z0 + z1) * 0.5
    for side in [-1.0, 1.0]:
        group.add_child(AstrixMesh.box_on("RillEdge", Vector3(0.25, 0.3, length),
            Vector3(x + side * 0.32, surface, mid), AstrixPalette.STONE_WALL))
    var water := AstrixMesh.box_on("RillWater", Vector3(0.4, 0.1, length),
        Vector3(x, surface + 0.06, mid), AstrixPalette.WATER_SHALLOW)
    group.add_child(water)
    group.add_child(AstrixMesh.cylinder_on("SpringBasin", 0.75, 0.85, 0.45,
        Vector3(x, surface, z0 - 0.6), AstrixPalette.STONE_WALL, 10))
    group.add_child(AstrixMesh.cylinder_on("SpringWater", 0.6, 0.6, 0.1,
        Vector3(x, surface + 0.36, z0 - 0.6), AstrixPalette.WATER_SHALLOW, 10))

func _build_settlement_dressing() -> void:
    var s := MEADOW_SURFACE
    var group := Node3D.new()
    group.name = "Settlement"
    add_child(group)

    # Village plaza at the island centre. Warm gravel (not grey — grey read as a
    # missing-material patch against the green), with a darker trim ring so its
    # edge is a deliberate shape rather than a hard cut into the grass.
    group.add_child(AstrixMesh.box_on("Plaza", Vector3(7.0, 0.13, 6.0),
        Vector3(0.0, s + GROUND_PLAZA_Y, -1.5), AstrixPalette.PATH))
    group.add_child(AstrixMesh.box_on("PlazaTrim", Vector3(7.7, 0.1, 6.7),
        Vector3(0.0, s + GROUND_PLAZA_Y - 0.015, -1.5), AstrixPalette.PATH_DARK))

    # THE MERIDIAN SPIRE — the world's memory hook. Rises from the old knoll at
    # the plaza's west edge: a pale needle with gold rings and a violet tip.
    # An ancient monument (environmental, like the watchtower): it claims no
    # function and reads no state. Four banner poles ring its dais.
    var knoll_pos := Vector3(-4.06, s + 0.42, -3.9)
    var spire := AstrixAssets.meridian_spire()
    spire.position = knoll_pos
    group.add_child(spire)
    _register_snow_in(spire)
    var banner_angles := [0.6, 2.2, 3.7, 5.3]
    var banner_colors := [AstrixPalette.ROOF, AstrixPalette.ROOF_CIVIC]
    for i in range(banner_angles.size()):
        var pole := AstrixAssets.banner_pole(8100 + i, banner_colors[i % 2])
        pole.position = knoll_pos + Vector3(cos(banner_angles[i]) * 3.3, 0.03, sin(banner_angles[i]) * 3.3)
        group.add_child(pole)
        for cloth in pole.find_children("BannerCloth", "MeshInstance3D", true, false):
            _vegetation.append(cloth)

    # TERRACED FARM BELT — the Bowl's signature. Two dry-stone retaining walls
    # step the southern slope, with tilled treads on their south faces, so the
    # authoritative farms nestle into worked terraces instead of stamped plots
    # on flat grass. Gaps where the walked path crosses (steps, not blockage).
    _terrace_run(group, 2.6, [[-4.0, -1.0], [2.0, 12.0]], s)
    _terrace_run(group, 8.8, [[-4.0, -1.5], [1.0, 12.0]], s)
    # Irrigation rill: stone-edged channel with a spring basin at its head,
    # running down to the terraces. Ornamental dressing (like the well), not a
    # water-system claim — Core has no irrigation state.
    _build_rill(group, s)

    # Lantern-lit causeway to the bridge gate: two lamps along the walked route
    # so the way to Frost reads as a road that matters after dark.
    for spec in [{"pos": Vector3(5.0, 0.0, -3.4), "seed": 8111}, {"pos": Vector3(8.2, 0.0, -6.0), "seed": 8112}]:
        var lamp := AstrixAssets.lantern()
        lamp.position = (spec["pos"] as Vector3) + Vector3(0.0, s, 0.0)
        group.add_child(_clearable_prop(lamp))

    # BRIDGE GATES — stone pylons + timber lintel + hanging lantern at every
    # real bridge head, plus the meadow/dusk heads that await a steward's
    # proposal. A crossing becomes a threshold; an unbuilt span already has an
    # address, which is exactly where a proposal beacon will land.
    _place_gate(group, "meadow", "frost", 8121)
    _place_gate(group, "frost", "meadow", 8122)
    _place_gate(group, "meadow", "dusk", 8123)
    _place_gate(group, "dusk", "meadow", 8124)

    # Path network. Winding polylines, never straight slabs: every route bends
    # at least once the way a walked path does, and narrows as it leaves the
    # plaza. Every route still RUNS BETWEEN two real places (plaza -> farm belt,
    # plaza -> houses, plaza -> bridge head, plaza -> beach) instead of
    # dead-ending in open grass.
    var bridge_head := _rim_point("meadow", "frost", 0.84)
    _path_polyline(group, [Vector3(0.0, 0.0, 1.0), Vector3(0.9, 0.0, 3.6), Vector3(-0.5, 0.0, 6.0), Vector3(0.0, 0.0, 8.0)], 2.4, s)
    _path_polyline(group, [Vector3(0.0, 0.0, -4.0), Vector3(-1.3, 0.0, -6.6), Vector3(-1.5, 0.0, -9.0)], 2.2, s)
    _path_polyline(group, [Vector3(3.0, 0.0, -2.0), Vector3(6.2, 0.0, -4.2), Vector3(bridge_head.x, 0.0, bridge_head.z)], 2.2, s)
    _path_polyline(group, [Vector3(2.5, 0.0, 1.5), Vector3(5.6, 0.0, 4.1), Vector3(8.0, 0.0, 7.5)], 1.9, s)
    _path_polyline(group, [Vector3(-2.0, 0.0, 5.5), Vector3(-5.2, 0.0, 6.3), Vector3(-8.5, 0.0, 5.0)], 1.8, s)
    # Bridge landing: a small stone pad where the village path meets the bridge
    # head, flanked by two waystones — the bridge reads as ARRIVED AT rather
    # than sprouting from grass. Static geography (rim point), not topology.
    var landing := AstrixMesh.cylinder_on("BridgeLanding", 1.7, 1.9, 0.14,
        Vector3(bridge_head.x, s + 0.02, bridge_head.z), AstrixPalette.PATH_DARK, 10)
    group.add_child(landing)
    var head_dir := (bridge_head - Vector3(3.0, 0.0, -2.0))
    head_dir.y = 0.0
    head_dir = head_dir.normalized()
    var side_dir := Vector3(-head_dir.z, 0.0, head_dir.x)
    for sign in [-1.0, 1.0]:
        var stone := AstrixAssets.rock(6100 + int(sign * 3.0 + 9.0), 0.8)
        stone.position = Vector3(bridge_head.x, s, bridge_head.z) - head_dir * 1.2 + side_dir * sign * 1.9
        group.add_child(_clearable_prop(stone))
    # Frost frontier trail: a narrow rocky footpath from the frost bridge head
    # toward the island heart. Sparse and narrow — a frontier trail, not a road.
    var frost_head := _rim_point("frost", "meadow", 0.84)
    var frost_centre: Vector3 = ISLANDS["frost"]["center"]
    _path_polyline(group, [frost_head, frost_head * 0.6 + frost_centre * 0.4 + Vector3(0.8, 0.0, 0.6),
        frost_centre + Vector3(-1.5, 0.0, 1.0)], 1.3, FROST_SURFACE)

    var well := AstrixAssets.well()
    well.position = Vector3(0.0, s, -1.5)
    group.add_child(well)
    # Village-heart edging: a broken ring of low stones around the plaza trim
    # so the centre reads as a deliberate gathering space with a soft boundary.
    # Broken (gaps on the path exits) — a closed ring would read as a pen.
    var edge_r := AstrixMesh.rng(777)
    for i in range(10):
        if i % 5 == 2:
            continue    # gaps where the farm-belt and house paths leave
        var a := TAU * float(i) / 10.0 + 0.2
        var stone := AstrixMesh.blob("PlazaStone", 0.22 + edge_r.randf() * 0.1,
            Vector3(cos(a) * 4.3, s + 0.05, -1.5 + sin(a) * 3.8),
            AstrixPalette.STONE_WALL.darkened(edge_r.randf() * 0.12), 6, 3)
        stone.scale.y = 0.6
        group.add_child(_clearable_prop(stone))
    var plaza_bench := AstrixAssets.bench(913)
    plaza_bench.position = Vector3(-2.9, s, 0.6)
    plaza_bench.rotation.y = 0.5
    group.add_child(_clearable_prop(plaza_bench))

    # Market stalls lining the plaza edge (not scattered across it), rotated to
    # face inward so the square reads as a market.
    var stall_colors := [Color("d64239"), Color("3f91da"), Color("79b93b")]
    for i in range(3):
        var stall := AstrixAssets.market_stall(50 + i, stall_colors[i])
        stall.position = Vector3(-2.6 + float(i) * 2.6, s, -4.0)
        stall.rotation.y = 0.0
        group.add_child(_clearable_prop(stall))

    var cart := AstrixAssets.cart(77)
    cart.position = Vector3(2.6, s, -0.2)
    group.add_child(_clearable_prop(cart))

    for spec2 in [
        {"pos": Vector3(1.9, 0.0, 1.6), "seed": 91},
        {"pos": Vector3(-3.4, 0.0, -0.4), "seed": 92},
    ]:
        var sign_post := AstrixAssets.signpost(int(spec2["seed"]))
        sign_post.position = (spec2["pos"] as Vector3) + Vector3(0.0, s, 0.0)
        group.add_child(_clearable_prop(sign_post))

    for lx in [-3.2, 3.2]:
        var lamp := AstrixAssets.lantern()
        lamp.position = Vector3(lx, s, -3.0)
        group.add_child(_clearable_prop(lamp))

    # Pasture: a CLOSED four-sided pen with hay inside, on the west side. The
    # previous open fence corner enclosed nothing, which read as unfinished.
    var pen_centre := Vector3(-10.5, s, -3.0)
    var pen := Node3D.new()
    pen.name = "Pasture"
    pen.position = pen_centre
    for side in [-1.0, 1.0]:
        var rail_z := AstrixAssets.fence_run(7.0, 31)
        rail_z.position = Vector3(side * 3.0, 0.0, 0.0)
        pen.add_child(rail_z)
        var rail_x := AstrixAssets.fence_run(6.0, 32)
        rail_x.position = Vector3(0.0, 0.0, side * 3.5)
        rail_x.rotation.y = PI * 0.5
        pen.add_child(rail_x)
    for i in range(3):
        pen.add_child(AstrixMesh.cylinder_on("HayBale", 0.45, 0.45, 0.6,
            Vector3(-1.2 + float(i) * 1.2, 0.0, -0.5 + float(i % 2) * 1.2),
            AstrixPalette.CROP_HARVEST.darkened(0.15), 9))
    group.add_child(_clearable_prop(pen))

    # Frost island: the BEACON — a taller watchtower for the raised Bastion, its
    # brazier dish visible for miles and kindling at dusk from the same
    # authoritative `time` the lamps use. A manned watchtower is the only
    # "activity" this landmark can honestly claim: Core has no garrison, no
    # patrol and no watch state, so nothing here moves.
    var frost: Vector3 = ISLANDS["frost"]["center"]
    var tower := Node3D.new()
    tower.name = "FrostBeacon"
    tower.position = Vector3(frost.x - 3.0, FROST_SURFACE, frost.z + 2.5)
    tower.add_child(AstrixMesh.cylinder_on("TowerBase", 1.1, 1.35, 0.5, Vector3.ZERO, AstrixPalette.BASALT, 10))
    tower.add_child(AstrixMesh.cylinder_on("TowerShaft", 0.72, 0.9, 4.2, Vector3(0.0, 0.5, 0.0), AstrixPalette.STONE_WALL, 10))
    tower.add_child(AstrixMesh.cylinder_on("TowerCorbel", 0.98, 0.72, 0.3, Vector3(0.0, 4.7, 0.0), AstrixPalette.FROST_ROCK, 10))
    # Crenellations round the top: unmistakably built, unmistakably a tower.
    for i in range(8):
        var a := TAU * float(i) / 8.0
        tower.add_child(AstrixMesh.box_on("Merlon", Vector3(0.26, 0.45, 0.26),
            Vector3(cos(a) * 0.82, 5.0, sin(a) * 0.82), AstrixPalette.FROST_ROCK))
    tower.add_child(AstrixMesh.cylinder_on("TowerDeck", 0.95, 0.95, 0.18, Vector3(0.0, 5.0, 0.0), AstrixPalette.STONE_WALL, 10))
    tower.add_child(AstrixMesh.box("TowerDoor", Vector3(0.4, 0.75, 0.06), Vector3(0.0, 0.88, 0.92), AstrixPalette.TIMBER))
    # Brazier dish on the deck, registered with the settlement's window lights.
    tower.add_child(AstrixMesh.cylinder_on("BeaconDish", 0.55, 0.35, 0.3, Vector3(0.0, 5.18, 0.0), AstrixPalette.BASALT, 10))
    var brazier := AstrixMesh.box("BeaconFire", Vector3(0.42, 0.34, 0.42),
        Vector3(0.0, 5.48, 0.0), Color("2f3a44"))
    tower.add_child(brazier)
    _window_lights.append(brazier)
    _windows_lit = false   # force the next light update to evaluate it
    group.add_child(tower)
    group.add_child(_snow_cap(AstrixMesh.box("TowerSnow", Vector3(1.9, 0.12, 1.9),
        Vector3(frost.x - 3.0, FROST_SURFACE + 5.2, frost.z + 2.5), AstrixPalette.SNOW)))
    # Dusk island: crystal formation — the arcane accent, contained to one place.
    var dusk: Vector3 = ISLANDS["dusk"]["center"]
    for i in range(3):
        var crystal := AstrixAssets.crystal(200 + i)
        crystal.position = Vector3(dusk.x - 2.0 + float(i) * 2.0, DUSK_SURFACE, dusk.z - 1.5 + float(i))
        group.add_child(_clearable_prop(crystal))
    # Frost sea-stack: a low basalt fang breaking the water just off the
    # northern rim — a hint of the frontier's severity, deliberately SMALLER
    # than the island it guards (a taller stack read as a concrete pillar and
    # competed with the watchtower). Offshore so no building can land on it.
    var frost_r: Vector2 = ISLANDS["frost"]["radius"]
    var stack_dir := Vector3(cos(1.75), 0.0, sin(1.75))
    var stack_pos := frost + Vector3(stack_dir.x * frost_r.x * 1.45, 0.0, stack_dir.z * frost_r.y * 1.45)
    var stack := Node3D.new()
    stack.name = "FrostSeaStack"
    stack.position = Vector3(stack_pos.x, WATER_LEVEL - 1.6, stack_pos.z)
    stack.add_child(AstrixMesh.cylinder_on("Fang", 0.85, 0.18, 5.0, Vector3.ZERO, AstrixPalette.FROST_ROCK.darkened(0.12), 7))
    stack.add_child(AstrixMesh.cylinder_on("FangCap", 0.95, 0.85, 0.45, Vector3(0.0, 5.0, 0.0), AstrixPalette.SNOW, 7))
    group.add_child(stack)

# ===========================================================================
# VEGETATION
#
# Placement rule (fixes the canopy-occlusion failure): tall vegetation goes on
# island INTERIORS and FAR rims only. The camera sits on the +X/+Z side, so the
# near corridor (+X/+Z of the settlement) carries only low bushes and tufts.
# ===========================================================================
func _build_vegetation() -> void:
    var group := Node3D.new()
    group.name = "Vegetation"
    add_child(group)
    var s := MEADOW_SURFACE

    # Hero tree: one landmark with more detail than anything else, the way the
    # reference anchors its settlement. North-west, so it never occludes.
    # Grown into a small ancient grove: the hero plus two companions at its
    # feet, so the landmark has mass instead of standing alone.
    var hero := AstrixAssets.tree_broadleaf(1, 2.6)
    (hero["root"] as Node3D).position = Vector3(-9.0, s, -8.0)
    group.add_child(_clearable_prop(hero["root"]))
    _register_foliage(hero["foliage"])
    for gi in range(2):
        var companion := AstrixAssets.tree_broadleaf(700 + gi, 1.1 + float(gi) * 0.2)
        (companion["root"] as Node3D).position = Vector3(-11.5 + float(gi) * 4.2, s, -6.2 + float(gi) * 1.1)
        group.add_child(_clearable_prop(companion["root"]))
        _register_foliage(companion["foliage"])

    # Treeline along the north and west rim (away from the camera and away from
    # the farm belt, which occupies the south).
    var meadow_trees := [
        Vector3(-11.0, 0.0, -4.5), Vector3(-10.0, 0.0, -1.0), Vector3(-5.5, 0.0, -10.0),
        Vector3(-2.0, 0.0, -10.8), Vector3(1.5, 0.0, -11.0), Vector3(4.5, 0.0, -10.0),
        Vector3(7.5, 0.0, -8.0), Vector3(-11.5, 0.0, 2.0),
    ]
    for i in range(meadow_trees.size()):
        var is_conifer := i % 3 == 2
        var kind := AstrixAssets.tree_broadleaf(10 + i, 0.9 + float(i % 3) * 0.18) if not is_conifer else AstrixAssets.tree_conifer(10 + i, 1.05)
        (kind["root"] as Node3D).position = (meadow_trees[i] as Vector3) + Vector3(0.0, s, 0.0)
        group.add_child(_clearable_prop(kind["root"]))
        # Evergreens keep their cold green through autumn: repainting them with
        # the seasonal broadleaf colour turned the frost biome orange.
        _register_foliage(kind["foliage"], "conifer" if is_conifer else "foliage")

    # Young trees: visible growth stages, clustered near the treeline.
    for i in range(4):
        var young := AstrixAssets.tree_young(40 + i)
        (young["root"] as Node3D).position = Vector3(-10.0 + float(i) * 1.7, s, -6.5 + float(i % 2) * 1.5)
        group.add_child(_clearable_prop(young["root"]))
        _register_foliage(young["foliage"])

    # Ground cover across the whole island: this is what stops the grass from
    # reading as one enormous flat colour field. Dense, low, never occluding.
    var r := AstrixMesh.rng(808)
    for i in range(84):
        var a := r.randf() * TAU
        var rad := sqrt(r.randf()) * 11.6
        var pos := Vector3(cos(a) * rad, s, sin(a) * rad * 0.88)
        # Keep the plaza, the farm belt and the orchard block clear, so those
        # areas read as CULTIVATED (ordered) rather than wild.
        if absf(pos.x) < 4.6 and absf(pos.z + 1.5) < 4.2:
            continue
        if pos.z > 2.0 and pos.z < 9.5 and pos.x > -2.0 and pos.x < 12.0:
            continue    # south farm belt
        if pos.x > -8.2 and pos.x < -0.7 and pos.z > 7.2 and pos.z < 11.8:
            continue    # south-west orchard
        var roll := r.randf()
        if roll < 0.3:
            var b := AstrixAssets.bush(300 + i)
            (b["root"] as Node3D).position = pos
            group.add_child(_clearable_prop(b["root"]))
            _register_foliage(b["foliage"])
        elif roll < 0.42:
            var rk2 := AstrixAssets.rock(1300 + i, 0.6 + r.randf() * 0.3)
            rk2.position = pos
            group.add_child(_clearable_prop(rk2))
        else:
            var tuft := AstrixAssets.grass_tuft(400 + i)
            (tuft["root"] as Node3D).position = pos
            group.add_child(_clearable_prop(tuft["root"]))
            _register_foliage(tuft["foliage"], "grass_dark")
            _vegetation.append(tuft["root"])
    for i in range(16):
        var f := AstrixAssets.flower(500 + i, [Color("e8d24a"), Color("e2649b"), Color("f4f2ea")][i % 3])
        var a2 := r.randf() * TAU
        var rad2 := 5.0 + r.randf() * 6.0
        f.position = Vector3(cos(a2) * rad2, s, sin(a2) * rad2 * 0.88)
        group.add_child(_clearable_prop(f))
        _vegetation.append(f)

    # ORCHARD: ordered rows of fruit trees on the SOUTH-WEST lawn, with a
    # continuous tilled strip under each row so the grid reads as PLANTED, not as
    # wild woodland. Placed here because in camera axes (u = (x-z)/√2 right,
    # v = (x+z)/√2 down) this block lands left-of-centre and BELOW centre — clear
    # of the top-left Observatory panel, which previously covered it.
    for row in range(3):
        var oz := 8.0 + float(row) * 1.6
        var strip := AstrixMesh.box_on("OrchardStrip", Vector3(6.4, 0.1, 0.85),
            Vector3(-4.45, s + 0.01, oz), AstrixPalette.SOIL_TILLED)
        group.add_child(strip)
        for col in range(4):
            var tree := AstrixAssets.tree_young(900 + row * 10 + col)
            (tree["root"] as Node3D).position = Vector3(-7.0 + float(col) * 1.7, s + 0.1, oz)
            group.add_child(_clearable_prop(tree["root"]))
            _register_foliage(tree["foliage"])

    # Frost island: conifers + boulders, sparser (harsher biome reads as sparser).
    var frost: Vector3 = ISLANDS["frost"]["center"]
    for i in range(6):
        var a3 := TAU * float(i) / 6.0 + 0.4
        var conifer := AstrixAssets.tree_conifer(600 + i, 0.95 + float(i % 2) * 0.2)
        (conifer["root"] as Node3D).position = frost + Vector3(cos(a3) * 6.0, FROST_SURFACE, sin(a3) * 5.0)
        group.add_child(_clearable_prop(conifer["root"]))
        _register_foliage(conifer["foliage"], "conifer")
    for i in range(4):
        var rk := AstrixAssets.rock(700 + i, 1.2, AstrixPalette.FROST_ROCK)
        rk.position = frost + Vector3(-4.0 + float(i) * 2.2, FROST_SURFACE, -3.5 + float(i % 2) * 2.0)
        group.add_child(_clearable_prop(rk))

    # Dusk island: sparse, degraded-looking (biomeHealth 0.4) — exposed ground.
    var dusk: Vector3 = ISLANDS["dusk"]["center"]
    for i in range(3):
        var db := AstrixAssets.bush(800 + i)
        (db["root"] as Node3D).position = dusk + Vector3(-3.0 + float(i) * 3.0, DUSK_SURFACE, 3.0)
        group.add_child(_clearable_prop(db["root"]))
        _register_foliage(db["foliage"])
    for i in range(5):
        var dr := AstrixAssets.rock(900 + i, 1.0, AstrixPalette.DUSK_ROCK)
        dr.position = dusk + Vector3(2.0 - float(i) * 1.5, DUSK_SURFACE, -2.0 + float(i % 3) * 2.0)
        group.add_child(_clearable_prop(dr))
    # Two windswept saplings: dusk stays wild and undeveloped, but a completely
    # bare disc reads as unfinished rather than wild. Small, leaning, clear of
    # the crystal accent and the beach, so the island's silhouette gains variety
    # without implying settlement.
    for i in range(2):
        var dw := AstrixAssets.tree_young(810 + i)
        var droot := dw["root"] as Node3D
        droot.position = dusk + Vector3(5.0 - float(i) * 10.5, DUSK_SURFACE, -4.0 + float(i) * 1.5)
        droot.rotation.z = 0.14 + float(i) * 0.06
        group.add_child(_clearable_prop(droot))
        _register_foliage(dw["foliage"])

# ===========================================================================
# PLAYER + CAMERA
# ===========================================================================
func _build_player() -> void:
    player = AstrixPlayer3D.new()
    player.name = "Overseer"
    player.position = Vector3(3.0, MEADOW_SURFACE + 0.5, 4.5)
    player.water_level = WATER_LEVEL + 0.1
    # Scaled to villager proportions so the Overseer belongs to the settlement
    # instead of towering over it (it was ~2.6u against 1.4u villagers).
    player.scale = Vector3(0.62, 0.62, 0.62)
    add_child(player)

func _build_camera() -> void:
    camera = Camera3D.new()
    camera.name = "DioramaCamera"
    camera.projection = Camera3D.PROJECTION_ORTHOGONAL
    camera.near = 1.0
    camera.far = CAMERA_FAR
    add_child(camera)
    _apply_camera_framing()
    var target := _camera_target()
    camera.global_position = _camera_eye(target)
    camera.look_at(target, Vector3.UP)
    camera.current = true
    get_viewport().size_changed.connect(_apply_camera_framing)
    # Operator camera controls arrive through the AstrixInput autoload so the HUD
    # never has to reach into the 3D scene tree by node path.
    AstrixInput.camera_zoom_requested.connect(_on_camera_zoom_requested)
    AstrixInput.camera_mode_requested.connect(set_camera_mode_named)

func _camera_target() -> Vector3:
    match camera_mode:
        CameraMode.FOLLOW:
            return (player.global_position + Vector3(0.0, FOLLOW_LOOK_HEIGHT, 0.0)) if is_instance_valid(player) else _overview_target
        CameraMode.ARCHIPELAGO:
            return ARCH_TARGET + _pan_offset()
        CameraMode.OBSERVATORY:
            return (OBS_TARGET_PORTRAIT if _portrait else OBS_TARGET) + _pan_offset()
        CameraMode.ISLAND:
            return _island_target() + _pan_offset()
        CameraMode.STEWARD:
            # No authoritative target means no target. Fall back to the whole
            # world rather than framing an arbitrary point and implying the
            # steward is working there.
            if not _has_steward_focus:
                return _overview_target + _pan_offset()
            return _steward_focus + Vector3(0.0, STEWARD_LOOK_HEIGHT, 0.0) + _pan_offset()
        _:
            return _overview_target + _pan_offset()

## Core's island list, filtered to islands this renderer has geography for and
## ordered west-to-east. Empty until the first authoritative snapshot arrives.
func _sync_core_islands(world_state: Node) -> void:
    var found: PackedStringArray = PackedStringArray()
    for entry in world_state.islands:
        if entry is Dictionary:
            var id := str((entry as Dictionary).get("id", ""))
            if ISLANDS.has(id) and not found.has(id):
                found.append(id)
    var ordered: PackedStringArray = PackedStringArray()
    for id in ISLAND_ORDER:
        if found.has(id):
            ordered.append(str(id))
    if ordered != _core_islands:
        _core_islands = ordered
        _island_index = 0

## The islands ISLAND mode may visit. Before the first snapshot this is the
## authored geography already standing in the scene, never a longer list.
func _island_cycle() -> PackedStringArray:
    if not _core_islands.is_empty():
        return _core_islands
    var authored: PackedStringArray = PackedStringArray()
    for id in ISLAND_ORDER:
        authored.append(str(id))
    return authored

## Centre of the currently selected island, at its own surface height.
func _island_target() -> Vector3:
    var cycle := _island_cycle()
    var id: String = cycle[_island_index % cycle.size()]
    var centre: Vector3 = ISLANDS[id]["center"]
    return Vector3(centre.x, _surface_of(id) + 0.6, centre.z)

## Which island ISLAND mode is showing, for the HUD pill. Empty in other modes.
func island_focus_name() -> String:
    if camera_mode != CameraMode.ISLAND:
        return ""
    var cycle := _island_cycle()
    return str(cycle[_island_index % cycle.size()])

## What the STEWARD camera is pointed at, derived from authoritative action
## records. Empty when Core gave us nothing to point at.
func steward_focus_name() -> String:
    return _steward_focus_label if _has_steward_focus else ""

## How far back the eye sits along the view axis, and the matching far plane.
##
## THIS IS NOT A COMPOSITION SETTING. Under an ORTHOGONAL projection, sliding the
## eye along its own view axis changes nothing on screen -- only the depth range.
## The mode offsets below therefore set the camera's DIRECTION (and the pitch that
## gives the diorama its read); the distance is this one number for every mode.
##
## It has to be this large. The bug it fixes: the overview offset was 35.8 units
## long while the portrait frame has to see ground up to 0.814 x size = 68 units
## TOWARD the camera, which put the nearest 24 units of ground BEHIND the near
## plane. It was clipped away, and the bottom 18% of a portrait frame rendered as
## bare seabed and background. Measured at 820x1180: the band began at y=978,
## against y=970 predicted by that arithmetic.
##
## Requirement is `distance >= near + 0.643 * size` at the widest zoom, which for
## the portrait overview (size 84, ZOOM_MAX 1.15) is 63. 180 clears every mode
## with room for the solve to grow. Ortho depth is linear, so a generous range
## costs almost no precision -- ~0.000025 units per step over CAMERA_FAR.
const CAMERA_DISTANCE := 180.0
const CAMERA_FAR := 420.0

## Eye position for a given look-at target: mode direction, fixed distance.
func _camera_eye(target: Vector3) -> Vector3:
    return target + _camera_offset().normalized() * CAMERA_DISTANCE

func _camera_offset() -> Vector3:
    match camera_mode:
        CameraMode.FOLLOW: return FOLLOW_OFFSET
        CameraMode.ARCHIPELAGO: return ARCH_OFFSET_PORTRAIT if _portrait else ARCH_OFFSET
        CameraMode.OBSERVATORY, CameraMode.ISLAND, CameraMode.STEWARD:
            return OBS_OFFSET_PORTRAIT if _portrait else OBS_OFFSET
        _: return _overview_offset

## Base ortho height before zoom. OVERVIEW's is solved; the others stay the
## hand-composed values that visual review signed off on.
func _base_camera_size() -> float:
    match camera_mode:
        CameraMode.ARCHIPELAGO: return ARCH_SIZE_PORTRAIT if _portrait else ARCH_SIZE_LANDSCAPE
        CameraMode.FOLLOW: return 15.0 if _portrait else 13.0
        CameraMode.OBSERVATORY, CameraMode.ISLAND:
            return OBS_SIZE_PORTRAIT if _portrait else OBS_SIZE_LANDSCAPE
        CameraMode.STEWARD:
            # With nothing authoritative to frame, STEWARD is the world frame.
            if not _has_steward_focus:
                return _overview_size
            return STEWARD_SIZE_PORTRAIT if _portrait else STEWARD_SIZE_LANDSCAPE
        _: return _overview_size

# ---------------------------------------------------------------------------
# DERIVED FRAMING
# ---------------------------------------------------------------------------
## The two GROUND directions that move the frame exactly one unit screen-right
## and one unit screen-up, for whatever direction the camera currently sits in.
## Both are horizontal, so panning never changes the target's height and the
## diorama never tilts.
func _screen_ground_basis() -> Array:
    var bz := _camera_offset().normalized()
    var right := Vector3.UP.cross(bz)
    right = right.normalized() if right.length() > 0.001 else Vector3.RIGHT
    var up := -(bz - Vector3.UP * bz.dot(Vector3.UP))
    up = up.normalized() if up.length() > 0.001 else Vector3.FORWARD
    return [right, up]

## Operator pan, expressed in the camera's ground axes. `_pan.y` is screen-DOWN
## (the direction a finger drags), hence the negated up vector.
func _pan_offset() -> Vector3:
    if is_zero_approx(_pan.x) and is_zero_approx(_pan.y):
        return Vector3.ZERO
    var b := _screen_ground_basis()
    return (b[0] as Vector3) * _pan.x - (b[1] as Vector3) * _pan.y

func _clamp_pan() -> void:
    var limit := _base_camera_size() * PAN_LIMIT
    _pan.x = clampf(_pan.x, -limit, limit)
    _pan.y = clampf(_pan.y, -limit, limit)

## Every point the OVERVIEW frame must contain: each island footprint corner at
## water level AND at its plateau height (a tall island crops from the top before
## it crops from the side), plus every boat anchor. Derived from ISLANDS, so the
## opening shot cannot drift out of sync with the geography.
func _world_frame_points() -> Array:
    var pts: Array = []
    for key in ISLANDS:
        var isl: Dictionary = ISLANDS[key]
        var c: Vector3 = isl["center"]
        var r: Vector2 = isl["radius"]
        var top := float(isl["top"])
        for ix in [-1.0, 1.0]:
            for iz in [-1.0, 1.0]:
                var px: float = c.x + float(ix) * r.x
                var pz: float = c.z + float(iz) * r.y
                pts.append(Vector3(px, 0.0, pz))
                pts.append(Vector3(px, top, pz))
    for spec in BOAT_ANCHORS:
        pts.append(spec["pos"] as Vector3)
    return pts

## Horizontal principal axis of the island cluster (PCA on the frame points).
## PORTRAIT orbits the camera onto this axis; see the OVERVIEW comment block.
func _cluster_major_axis() -> Vector3:
    var pts := _world_frame_points()
    var n := float(maxi(1, pts.size()))
    var cx := 0.0
    var cz := 0.0
    for p in pts:
        cx += (p as Vector3).x
        cz += (p as Vector3).z
    cx /= n
    cz /= n
    var sxx := 0.0
    var szz := 0.0
    var sxz := 0.0
    for p in pts:
        var dx: float = (p as Vector3).x - cx
        var dz: float = (p as Vector3).z - cz
        sxx += dx * dx
        szz += dz * dz
        sxz += dx * dz
    if is_zero_approx(sxz) and is_zero_approx(sxx - szz):
        return Vector3(1.0, 0.0, 0.0)
    var angle := 0.5 * atan2(2.0 * sxz, sxx - szz)
    return Vector3(cos(angle), 0.0, sin(angle))

## Solve {target, size} so every point in `pts` sits inside an ORTHOGONAL frame
## looking down `-offset`.
##
## Godot's ortho `size` is the visible HEIGHT, so the frame spans `size` along the
## camera's screen-up axis and `size * aspect` along screen-right — both measured
## in the CAMERA's basis, which already carries the pitch foreshortening. That is
## why this needs no sin/cos of the tilt: project, measure, divide.
##
## Recentring is exact because the two correction directions are orthogonal in
## screen space: moving along `right` changes screen-x only (it is perpendicular
## to screen-up by construction), and moving along `up` changes screen-y only.
func _solve_frame(offset: Vector3, pts: Array, aspect: float, margin: float) -> Dictionary:
    var t0 := Vector3(0.0, OVERVIEW_TARGET_Y, 0.0)
    var bz := offset.normalized()
    var bx := Vector3.UP.cross(bz)
    bx = bx.normalized() if bx.length() > 0.001 else Vector3.RIGHT
    var by := bz.cross(bx).normalized()
    var up := -(bz - Vector3.UP * bz.dot(Vector3.UP))
    up = up.normalized() if up.length() > 0.001 else Vector3.FORWARD
    # Screen-y gained per world unit travelled along `up` — the foreshortening,
    # measured rather than assumed.
    var f_up := up.dot(by)
    var min_x := INF
    var max_x := -INF
    var min_y := INF
    var max_y := -INF
    for p in pts:
        var q: Vector3 = (p as Vector3) - t0
        var sx := q.dot(bx)
        var sy := q.dot(by)
        min_x = minf(min_x, sx)
        max_x = maxf(max_x, sx)
        min_y = minf(min_y, sy)
        max_y = maxf(max_y, sy)
    if min_x > max_x:
        return {"target": t0, "size": OBS_SIZE_LANDSCAPE}
    var need_h := (max_y - min_y) + margin * 2.0 * absf(f_up)
    var need_w := (max_x - min_x) + margin * 2.0
    var target := t0 + bx * ((min_x + max_x) * 0.5)
    if absf(f_up) > 0.001:
        target += up * ((min_y + max_y) * 0.5 / f_up)
    return {"target": target, "size": maxf(need_h, need_w / maxf(0.2, aspect))}

## Re-solve the OVERVIEW shot for the current viewport. Cheap (44 points) and
## only runs on boot and on resize/orientation change.
func _recompute_overview(aspect: float) -> void:
    var horizontal := Vector3(OBS_OFFSET.x, 0.0, OBS_OFFSET.z).normalized()
    if aspect < PORTRAIT_ASPECT:
        var axis := _cluster_major_axis()
        # Two candidate orbits; take the one nearer the landscape camera so the
        # fixed key light keeps striking roughly the same faces.
        horizontal = axis if axis.dot(horizontal) >= 0.0 else -axis
    _overview_offset = horizontal * OVERVIEW_REACH + Vector3.UP * OVERVIEW_HEIGHT
    var margin := OVERVIEW_MARGIN_PORTRAIT if aspect < PORTRAIT_ASPECT else OVERVIEW_MARGIN_LANDSCAPE
    var solved := _solve_frame(_overview_offset, _world_frame_points(), aspect, margin)
    _overview_target = solved["target"]
    _overview_size = float(solved["size"])

func _update_camera(delta: float) -> void:
    if not is_instance_valid(camera):
        return
    var panning := false
    if camera_mode != CameraMode.FOLLOW:
        var pan_in: Vector2 = AstrixInput.camera_pan()
        if pan_in.length_squared() > 0.0001:
            # Scaled by the live ortho height so the pan rate feels identical at
            # every zoom level (a fixed world-units/sec rate crawls when zoomed out).
            _pan += pan_in * PAN_SPEED * camera.size * delta
            _clamp_pan()
            panning = true
    var target := _camera_target()
    if camera_mode != CameraMode.FOLLOW and not panning:
        # Slow orbital breathing keeps the frame alive without moving the
        # composition or introducing roll. Suppressed while the operator pans, so
        # a deliberate camera move is not fighting an idle drift.
        target += Vector3(sin(_time * 0.05) * 0.8, 0.0, cos(_time * 0.04) * 0.6)
    var desired := _camera_eye(target)
    var k := 1.0 - exp(-(FOLLOW_SMOOTH if camera_mode == CameraMode.FOLLOW else 2.2) * delta)
    camera.global_position = camera.global_position.lerp(desired, k)
    camera.look_at(target, Vector3.UP)

## Portrait is a DESIGNED framing, not a shrunk desktop view: the camera orbits
## so the island axis runs screen-vertically, the ortho height grows to fit the
## whole cluster, and the HUD reserves the top and bottom bands.
func _apply_camera_framing() -> void:
    var vp := get_viewport()
    if not vp or not is_instance_valid(camera):
        return
    var size := vp.get_visible_rect().size
    var aspect := size.x / maxf(1.0, size.y)
    var was_portrait := _portrait
    _portrait = aspect < PORTRAIT_ASPECT
    _recompute_overview(aspect)
    camera.size = _base_camera_size() * _zoom
    _clamp_pan()
    # An orientation flip re-composes the shot, so snap rather than glide there:
    # lerping across a 60-degree yaw change sweeps the camera through the sea.
    if was_portrait != _portrait:
        _snap_camera()

func _snap_camera() -> void:
    if not is_instance_valid(camera):
        return
    var target := _camera_target()
    camera.global_position = _camera_eye(target)
    camera.look_at(target, Vector3.UP)

# ---------------------------------------------------------------------------
# OPERATOR CAMERA CONTROLS
# ---------------------------------------------------------------------------
## Reachability note: before this pass `set_camera_mode` had exactly one caller in
## the whole repo — tools/screenshot_harness.gd — so ARCHIPELAGO was dead code at
## runtime and there was no zoom, no pan and no way back to a wide shot. The mode
## is now driven by MobileHUD through the AstrixInput autoload.
## snap = false keeps the ortho size fixed and lets _update_camera glide the eye
## to the new target. Used when the composition is unchanged and only the subject
## moves -- cycling ISLAND, or STEWARD re-aiming at a new authoritative action --
## so those read as a pan across one world, not as a cut to somewhere else.
func set_camera_mode(mode: int, snap := true) -> void:
    camera_mode = mode
    # A mode is a composition; entering one starts from that composition rather
    # than inheriting the previous mode's zoom and pan.
    _zoom = 1.0
    _pan = Vector2.ZERO
    _apply_camera_framing()
    if snap:
        _snap_camera()
    _sync_hud_mode()

## Name-addressed entry point for the HUD (see AstrixInput.camera_mode_requested).
## Re-requesting "island" while already in ISLAND advances to the next island
## Core reports, which is how one button tours the whole archipelago.
func set_camera_mode_named(mode_name: String) -> void:
    match mode_name:
        "observatory": set_camera_mode(CameraMode.OBSERVATORY)
        "archipelago": set_camera_mode(CameraMode.ARCHIPELAGO)
        "follow": set_camera_mode(CameraMode.FOLLOW)
        "steward": set_camera_mode(CameraMode.STEWARD)
        "island":
            if camera_mode == CameraMode.ISLAND:
                _island_index = (_island_index + 1) % _island_cycle().size()
                set_camera_mode(CameraMode.ISLAND, false)
            else:
                set_camera_mode(CameraMode.ISLAND)
        _: set_camera_mode(CameraMode.OVERVIEW)

## step < 0 tightens the frame, step > 0 widens it.
func _on_camera_zoom_requested(step: float) -> void:
    _zoom = clampf(_zoom + step * ZOOM_STEP, ZOOM_MIN, ZOOM_MAX)
    if is_instance_valid(camera):
        camera.size = _base_camera_size() * _zoom
    _clamp_pan()

func _sync_hud_mode() -> void:
    var hud := get_node_or_null("MobileHUD")
    if hud == null:
        return
    if hud.has_method("set_camera_mode_name"):
        hud.set_camera_mode_name(_camera_mode_name(), _camera_subject())
    elif hud.has_method("set_follow_mode"):
        hud.set_follow_mode(camera_mode == CameraMode.FOLLOW)

## The mode name the HUD addresses this mode by (see set_camera_mode_named).
func _camera_mode_name() -> String:
    match camera_mode:
        CameraMode.FOLLOW: return "follow"
        CameraMode.ISLAND: return "island"
        CameraMode.STEWARD: return "steward"
        CameraMode.ARCHIPELAGO: return "archipelago"
        CameraMode.OBSERVATORY: return "observatory"
        _: return "overview"

## What the active mode is looking at, for the pill caption. Empty when the mode
## frames the whole world, and empty in STEWARD when Core named no subject --
## the HUD then says so instead of naming a place the steward is not working.
func _camera_subject() -> String:
    match camera_mode:
        CameraMode.ISLAND: return island_focus_name().to_upper()
        CameraMode.STEWARD: return steward_focus_name()
        _: return ""

func _build_systems() -> void:
    var building_system := Node3D.new()
    building_system.name = "BuildingSystem"
    building_system.set_script(load("res://scripts/BuildingSystem.gd"))
    add_child(building_system)
    var observatory := CanvasLayer.new()
    observatory.name = "AgentConsole"
    observatory.set_script(load("res://scripts/AgentConsole.gd"))
    add_child(observatory)
    var approval := CanvasLayer.new()
    approval.name = "ApprovalGate"
    approval.set_script(load("res://scripts/ApprovalGate.gd"))
    add_child(approval)
    var hud := CanvasLayer.new()
    hud.name = "MobileHUD"
    hud.set_script(load("res://scripts/MobileHUD.gd"))
    add_child(hud)
    _sync_hud_mode()

# ===========================================================================
# AUTHORITATIVE STEWARD STATUS -> WORLD
# ===========================================================================
## The steward's own reported LoopState decides whether the world animates as a
## LIVING world or as a HELD one, and its own action records decide where the
## STEWARD camera points. Nothing here writes world state; nothing here invents a
## target when Core supplies none.
func _on_agent_status_received(status: Dictionary) -> void:
    var loop_state := str(status.get("state", "")).to_upper()
    var live := not HELD_LOOP_STATES.has(loop_state)
    if live != _world_live:
        _world_live = live
        _broadcast_world_live()
    _derive_steward_focus(status)
    _sync_proposal_markers(status)

## Push the authoritative clock gate to every figure whose animation would
## otherwise imply the world is progressing.
func _broadcast_world_live() -> void:
    for v in _villagers:
        if is_instance_valid(v) and v.has_method("set_world_live"):
            v.set_world_live(_world_live)

## WHERE IS THE STEWARD WORKING? Answered only from authoritative records, in
## descending order of certainty:
##   1. the pending proposal (that is literally what is awaiting a human)
##   2. the action currently executing
##   3. the most recent action with a resolvable target
## Every branch resolves through the SAME mapping the world itself is built from
## (_bridge_endpoints / _map_core_pos / the authoritative building and resource
## records), so the camera lands on the object the viewer can see, not on a
## parallel guess at where it might be.
func _derive_steward_focus(status: Dictionary) -> void:
    var was_label := _steward_focus_label
    var had_focus := _has_steward_focus
    _resolve_steward_focus(status)
    # The STEWARD pill names its subject, so refresh it when the subject changes.
    if camera_mode == CameraMode.STEWARD and (was_label != _steward_focus_label or had_focus != _has_steward_focus):
        _sync_hud_mode()

func _resolve_steward_focus(status: Dictionary) -> void:
    var pending: Variant = status.get("pendingApproval")
    if pending is Dictionary:
        var from_pending := _focus_from_pending(pending)
        if from_pending.size() == 2:
            _set_steward_focus(from_pending[0], str(from_pending[1]))
            return
    var current: Variant = status.get("currentAction")
    if current is Dictionary:
        var from_current := _focus_from_action(current)
        if from_current.size() == 2:
            _set_steward_focus(from_current[0], str(from_current[1]))
            return
    var actions: Variant = status.get("actions")
    if actions is Array:
        for i in range((actions as Array).size() - 1, -1, -1):
            var action: Variant = (actions as Array)[i]
            if not (action is Dictionary):
                continue
            var resolved := _focus_from_action(action)
            if resolved.size() == 2:
                _set_steward_focus(resolved[0], str(resolved[1]))
                return
    # Core told us nothing to point at. Say so rather than holding a stale target.
    _has_steward_focus = false
    _steward_focus_label = ""

func _set_steward_focus(pos: Vector3, label: String) -> void:
    _steward_focus = pos
    _steward_focus_label = label
    _has_steward_focus = true

## [position, label] or [] — a pending bridge proposal points at the span it
## would create, which is the object the human is being asked about.
func _focus_from_pending(pending: Dictionary) -> Array:
    var a := str(pending.get("sourceIsland", ""))
    var b := str(pending.get("destinationIsland", ""))
    if ISLANDS.has(a) and ISLANDS.has(b):
        var span := _bridge_endpoints(a, b)
        return [(span[0] + span[1]) * 0.5, "%s <-> %s" % [a.to_upper(), b.to_upper()]]
    if ISLANDS.has(a) and pending.get("position") is Dictionary:
        return [_map_core_pos(a, _core_vec(pending.get("position"))), a.to_upper()]
    # Older server builds report the proposal as a NESTED action record with no
    # flattened island fields at all. Read the action the same way a completed
    # action is read rather than giving up on a payload that does carry a target.
    var nested: Variant = pending.get("action")
    if nested is Dictionary:
        return _focus_from_action(nested)
    return []

## [position, label] or [] for one action record. `args` keys are the MCP tool
## vocabulary (src/astrix/mcpTools.ts); an unrecognised or unresolvable tool
## returns [] so the caller can fall further back rather than point at the origin.
func _focus_from_action(action: Dictionary) -> Array:
    var tool_name := str(action.get("tool", ""))
    var args: Variant = action.get("args")
    if not (args is Dictionary):
        return []
    var a: Dictionary = args
    var world_state := get_node_or_null("/root/WorldState")
    match tool_name:
        "build_bridge":
            var ia := str(a.get("island_a", ""))
            var ib := str(a.get("island_b", ""))
            if ISLANDS.has(ia) and ISLANDS.has(ib):
                var span := _bridge_endpoints(ia, ib)
                return [(span[0] + span[1]) * 0.5, "%s <-> %s" % [ia.to_upper(), ib.to_upper()]]
        "build":
            var island := str(a.get("island_id", "meadow"))
            if ISLANDS.has(island) and a.get("position") is Dictionary:
                return [_map_core_pos(island, _core_vec(a.get("position"))),
                    "%s · %s" % [island.to_upper(), str(a.get("building_type", "build")).to_upper()]]
        "plant":
            var farm := _building_position(world_state, str(a.get("farm_plot_id", "")))
            if farm.size() == 2:
                return [farm[0], "PLANTING · " + str(farm[1]).to_upper()]
        "harvest":
            var crop_farm := _crop_farm_position(world_state, str(a.get("crop_id", "")))
            if crop_farm.size() == 2:
                return [crop_farm[0], "HARVEST · " + str(crop_farm[1]).to_upper()]
        "gather":
            var node_pos := _resource_position(world_state, str(a.get("resource_id", "")))
            if node_pos.size() == 2:
                return [node_pos[0], "GATHER · " + str(node_pos[1]).to_upper()]
    return []

# ===========================================================================
# PROPOSAL MARKERS — the visible difference between PROPOSED and ACTUAL.
#
# When the Steward proposes a consequential action, the human must see WHAT
# part of the world the proposal is about WITHOUT the world changing. These
# markers are translucent pink beacons (pink is the approval UI's own colour
# and appears nowhere in the 3D world), gently pulsing, at the authoritative
# endpoints of the proposal. A proposed bridge is two beacons and open water;
# an actual bridge is a deck. The distinction is unmistakable on purpose:
# AI intent is not world authority.
#
# Data: status.pendingApproval in any known shape (flat summary with
# sourceIsland/destinationIsland, fixture shape with impact.islandA/islandB,
# or nested action record with MCP args). Shapes that carry no resolvable
# target yield no markers — honestly, like the steward focus.
# Presentation only: markers never touch state, never execute anything.
# ===========================================================================
var _proposal_markers: Array[Node3D] = []

const PROPOSAL_PINK := Color(1.0, 0.56, 0.64, 0.42)

func _sync_proposal_markers(status: Dictionary) -> void:
    _clear_proposal_markers()
    var pending: Variant = status.get("pendingApproval")
    if not (pending is Dictionary):
        return
    var spots: Array[Vector3] = []
    var radii: Array[float] = []
    var pd := pending as Dictionary
    var a := str(pd.get("sourceIsland", ""))
    var b := str(pd.get("destinationIsland", ""))
    var impact: Variant = pd.get("impact")
    if (a == "" or b == "") and impact is Dictionary:
        if a == "":
            a = str((impact as Dictionary).get("islandA", ""))
        if b == "":
            b = str((impact as Dictionary).get("islandB", ""))
    if ISLANDS.has(a) and ISLANDS.has(b):
        var span := _bridge_endpoints(a, b)
        spots = [span[0], span[1]]
        radii = [1.4, 1.4]
    elif ISLANDS.has(a) and pd.get("position") is Dictionary:
        spots = [_map_core_pos(a, _core_vec(pd.get("position")))]
        radii = [1.4]
    elif impact is Dictionary and (impact as Dictionary).get("position") is Dictionary and ISLANDS.has(a):
        spots = [_map_core_pos(a, _core_vec((impact as Dictionary).get("position")))]
        radii = [clampf(float((impact as Dictionary).get("radius", 2.0)), 1.0, 6.0)]
    else:
        var nested: Variant = pd.get("action")
        if nested is Dictionary:
            var nargs: Variant = (nested as Dictionary).get("args")
            if (nested as Dictionary).get("tool") == "build_bridge" and nargs is Dictionary:
                # A proposed bridge is about its TWO endpoints, not a midpoint
                # dot: resolve the span so both shores are marked.
                var nia := str((nargs as Dictionary).get("island_a", ""))
                var nib := str((nargs as Dictionary).get("island_b", ""))
                if ISLANDS.has(nia) and ISLANDS.has(nib):
                    var nspan := _bridge_endpoints(nia, nib)
                    spots = [nspan[0], nspan[1]]
                    radii = [1.4, 1.4]
            if spots.is_empty():
                # Other tools (or arg-less records): resolve through the same
                # focus path rather than duplicating its logic. Records with no
                # resolvable target yield nothing, honestly.
                var resolved := _focus_from_action(nested)
                if resolved.size() == 2 and resolved[0] is Vector3:
                    spots = [resolved[0]]
                    radii = [1.4]
    for i in range(spots.size()):
        _proposal_beacon(spots[i], radii[i])

## One beacon: a translucent pink disc on the ground + a short light pillar.
## Nothing in the world shares this colour or shape, so it cannot be mistaken
## for terrain, a building, a crop, or a bridge.
func _proposal_beacon(pos: Vector3, radius: float) -> void:
    var beacon := Node3D.new()
    beacon.name = "ProposalBeacon"
    beacon.position = pos
    var disc := AstrixMesh.cylinder_on("BeaconDisc", radius, radius, 0.1,
        Vector3(0.0, 0.15, 0.0), PROPOSAL_PINK, 16)
    disc.material_override = _proposal_material()
    disc.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
    beacon.add_child(disc)
    var pillar := AstrixMesh.box("BeaconPillar", Vector3(0.22, 3.2, 0.22),
        Vector3(0.0, 1.75, 0.0), PROPOSAL_PINK)
    pillar.material_override = _proposal_material()
    pillar.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
    beacon.add_child(pillar)
    add_child(beacon)
    _proposal_markers.append(beacon)

func _proposal_material() -> StandardMaterial3D:
    var mat := StandardMaterial3D.new()
    mat.albedo_color = PROPOSAL_PINK
    mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
    mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
    return mat

func _clear_proposal_markers() -> void:
    for m in _proposal_markers:
        if is_instance_valid(m):
            m.queue_free()
    _proposal_markers.clear()

func _update_proposal_markers() -> void:
    # Gentle pulse so the beacons read as ATTENTION rather than geometry.
    # Proposal UI, not simulation state: pulses whenever a proposal is open,
    # including under a held clock (the wait for the human is real).
    var s := 1.0 + sin(_time * 2.2) * 0.08
    for m in _proposal_markers:
        if is_instance_valid(m):
            m.scale = Vector3(s, 1.0, s)

# ===========================================================================
# DUSK FIREFLIES — the island's strange light. A dozen slow-drifting glow
# motes over Dusk's violet ground. Pure atmosphere (Core has no insects, no
# nightlife, no light state): they assert nothing except "this place is odd".
# Unshaded so they read at any hour; tiny so they never compete with the
# proposal beacons' pink.
# ===========================================================================
var _fireflies: Array[Node3D] = []
var _firefly_bases: Array[Vector3] = []

func _build_fireflies() -> void:
    var group := Node3D.new()
    group.name = "Fireflies"
    add_child(group)
    var r := AstrixMesh.rng(61616)
    var dusk: Vector3 = ISLANDS["dusk"]["center"]
    for i in range(12):
        var mote := AstrixMesh.blob("Mote", 0.09, Vector3.ZERO, Color("d8f79a"), 6, 4)
        mote.material_override = AstrixPalette.glow(Color("d8f79a"), 1.6)
        mote.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
        var base := dusk + Vector3((r.randf() - 0.5) * 13.0, DUSK_SURFACE + 0.8 + r.randf() * 1.6, (r.randf() - 0.5) * 12.0)
        mote.position = base
        group.add_child(mote)
        _fireflies.append(mote)
        _firefly_bases.append(base)

func _update_fireflies() -> void:
    for i in range(_fireflies.size()):
        var mote: Node3D = _fireflies[i]
        if not is_instance_valid(mote):
            continue
        var base: Vector3 = _firefly_bases[i] if i < _firefly_bases.size() else mote.position
        mote.position = base + Vector3(
            sin(_time * 0.35 + float(i) * 1.93) * 1.4,
            sin(_time * 0.5 + float(i) * 2.71) * 0.5,
            cos(_time * 0.3 + float(i) * 1.17) * 1.4)

# ===========================================================================
# DUSK SPLINTERS + HARBOUR GULLS — sky life. Both run on wall-clock time even
# while the world clock is held, exactly like wind, water and clouds: they are
# weather and wildlife, never simulation state (Core has no sky, no birds, no
# floating rock — the splinters are the Shatter's mystery, not its inventory).
# ===========================================================================
var _splinters: Array[Dictionary] = []
var _gulls: Array[Dictionary] = []

func _update_splinters() -> void:
    for entry in _splinters:
        var node: Variant = entry.get("node")
        if not is_instance_valid(node) or not (node is Node3D):
            continue
        var holder := node as Node3D
        var base: Vector3 = entry.get("base", holder.position)
        var phase := float(entry.get("phase", 0.0))
        holder.position = base + Vector3(
            sin(_time * 0.22 + phase) * 0.35,
            sin(_time * 0.31 + phase * 1.7) * 0.4,
            cos(_time * 0.18 + phase) * 0.35)
        holder.rotation.y += 0.0006

func _build_gulls() -> void:
    var group := Node3D.new()
    group.name = "Gulls"
    add_child(group)
    var r := AstrixMesh.rng(31337)
    var centre := Vector3(13.0, 0.0, -1.0)
    for i in range(5):
        var gull: Dictionary = AstrixAssets.gull()
        var root := gull["root"] as Node3D
        group.add_child(root)
        _gulls.append({
            "node": root,
            "wings": gull["wings"],
            "cx": centre.x + (r.randf() - 0.5) * 4.0,
            "cz": centre.z + (r.randf() - 0.5) * 4.0,
            "radius": 5.0 + r.randf() * 4.5,
            "height": 6.5 + r.randf() * 3.0,
            "speed": 0.22 + r.randf() * 0.16,
            "phase": r.randf() * TAU,
        })

func _update_gulls() -> void:
    for entry in _gulls:
        var node: Variant = entry.get("node")
        if not is_instance_valid(node) or not (node is Node3D):
            continue
        var gull := node as Node3D
        var t := _time * float(entry.get("speed", 0.3)) + float(entry.get("phase", 0.0))
        var rad := float(entry.get("radius", 6.0))
        var cx := float(entry.get("cx", 13.0))
        var cz := float(entry.get("cz", -1.0))
        var pos := Vector3(cx + cos(t) * rad, float(entry.get("height", 8.0)) + sin(_time * 0.5 + t) * 0.4,
            cz + sin(t) * rad)
        gull.position = pos
        # Face along the direction of travel.
        var vel := Vector3(-sin(t), 0.0, cos(t))
        gull.rotation.y = atan2(vel.x, vel.z)
        var flap := sin(_time * 7.0 + float(entry.get("phase", 0.0)) * 3.0) * 0.55
        var wings: Variant = entry.get("wings")
        if wings is Array and (wings as Array).size() == 2:
            ((wings as Array)[0] as MeshInstance3D).rotation.z = 0.15 + flap
            ((wings as Array)[1] as MeshInstance3D).rotation.z = -0.15 - flap

## [world position, island id] for an authoritative building, or [].
func _building_position(world_state: Node, building_id: String) -> Array:
    if world_state == null or building_id == "":
        return []
    var record: Variant = world_state.buildings.get(building_id)
    if not (record is Dictionary):
        return []
    var island := str((record as Dictionary).get("islandId", "meadow"))
    if not ISLANDS.has(island):
        return []
    return [_map_core_pos(island, _core_vec((record as Dictionary).get("position"))), island]

## A crop lives on its farm plot, so a harvest points at the farm Core assigned it.
func _crop_farm_position(world_state: Node, crop_id: String) -> Array:
    if world_state == null or crop_id == "":
        return []
    var crop: Variant = world_state.crops.get(crop_id)
    if not (crop is Dictionary):
        return []
    return _building_position(world_state, str((crop as Dictionary).get("farmPlotId", "")))

## [world position, island id] for an authoritative resource node, or [].
func _resource_position(world_state: Node, resource_id: String) -> Array:
    if world_state == null or resource_id == "":
        return []
    var record: Variant = world_state.resource_nodes.get(resource_id)
    if not (record is Dictionary):
        return []
    var island := str((record as Dictionary).get("islandId", "meadow"))
    if not ISLANDS.has(island):
        return []
    return [_map_core_pos(island, _core_vec((record as Dictionary).get("position"))), island]

# ===========================================================================
# AUTHORITATIVE SNAPSHOT -> WORLD
# ===========================================================================
func _on_astrix_state_received(state: Dictionary) -> void:
    var world_state := get_node_or_null("/root/WorldState")
    if world_state == null:
        return
    world_state.apply_snapshot(state)
    if not world_state.is_ready():
        return
    _apply_season(str(world_state.season), str(world_state.time_of_day))
    _sync_core_islands(world_state)
    _materialize_buildings(world_state)
    _materialize_bridges(world_state)
    _materialize_resource_nodes(world_state)
    _materialize_food_store(world_state)
    _sync_villagers(world_state)

## FOOD STORE — the village's grain store, stocked in proportion to authoritative
## `food`. This is the fix for "the stakes exist only in the HUD": a viewer can
## see the reserve emptying without reading a number.
##
## CAPACITY 48 is a presentation constant, not a Core rule: Core's food is
## unbounded, so the store shows food/48 clamped to 0..1 as 0..5 stacks. 48 is
## ~10 days of feed for a 4-villager village, which makes "full" mean "safe".
const FOOD_STORE_CAPACITY := 48
func _materialize_food_store(world_state: Node) -> void:
    var food := int(world_state.food)
    # Rebuild only when the stack count would actually change.
    var stacks := int(round(clampf(float(food) / float(FOOD_STORE_CAPACITY), 0.0, 1.0) * 5.0))
    if str(_sim_sig.get("foodstore", "")) == str(stacks):
        return
    _free_sim("foodstore")
    var store := AstrixAssets.food_store(food, FOOD_STORE_CAPACITY, 4711)
    # NORTH-EAST of the plaza, well away from the south farm belt: a granary
    # standing next to the wheat field read as "more wheat" rather than as a
    # stored reserve. Rotated so the stock platform faces the camera.
    store.position = Vector3(7.4, MEADOW_SURFACE, -3.6)
    store.rotation.y = 2.35
    add_child(store)
    _clear_footprint(store.position, 4.2, 4.0)
    _sim["foodstore"] = store
    _sim_sig["foodstore"] = str(stacks)

## Buildings: one authored structure per authoritative building, by type.
## Farms additionally build a plot with furrows and crops at their real stages.
func _materialize_buildings(world_state: Node) -> void:
    var seen := {}
    for id in world_state.buildings.keys():
        var building: Variant = world_state.buildings[id]
        if not (building is Dictionary):
            continue
        var type_name := str(building.get("type", "house"))
        # A bridge_segment is ALREADY drawn by _materialize_bridges, from the
        # authoritative bridges[] topology and the real island rims. Rendering
        # the building record too would double up -- and because the structure
        # match below falls through to `house`, an unhandled bridge_segment used
        # to appear as a HOUSE standing next to its own bridge.
        if type_name == "bridge_segment":
            continue
        var key := "building:" + str(id)
        seen[key] = true
        var island := str(building.get("islandId", "meadow"))
        var pos := _map_core_pos(island, _core_vec(building.get("position")))
        var sig := "%s|%s|%.2f,%.2f" % [type_name, island, pos.x, pos.z]
        if type_name == "farm":
            sig += "|" + _crop_signature(world_state, str(id))
        if str(_sim_sig.get(key, "")) == sig:
            continue
        _free_sim(key)
        # Clear the land this structure stands on before placing it. Farms need
        # the widest berth (plot + barn + scarecrow).
        if type_name == "farm":
            _clear_footprint(pos, 6.2, 4.6)
        elif type_name == "storage":
            _clear_footprint(pos, 2.6, 2.6)
        else:
            _clear_footprint(pos, 2.8, 2.6)
        var node := _build_structure(type_name, str(id), pos, island, world_state)
        if node:
            add_child(node)
            _sim[key] = node
            _sim_sig[key] = sig
    for key in _sim.keys():
        if str(key).begins_with("building:") and not seen.has(key):
            _free_sim(key)

## Hide static dressing that an authoritative structure now occupies. Called
## before a structure is added, so nothing ever interpenetrates a building.
func _clear_footprint(centre: Vector3, rx: float, rz: float) -> void:
    for node in _clearable:
        if not is_instance_valid(node) or not node.visible:
            continue
        var dx := absf(node.global_position.x - centre.x)
        var dz := absf(node.global_position.z - centre.z)
        if dx <= rx and dz <= rz:
            node.visible = false

## Register a static prop as clearable (yields to authoritative buildings).
func _clearable_prop(node: Node3D) -> Node3D:
    _clearable.append(node)
    return node

func _build_structure(type_name: String, id: String, pos: Vector3, island: String, world_state: Node) -> Node3D:
    var seed_value := hash(id) & 0x7fffffff
    var group := Node3D.new()
    group.name = "Sim_%s_%s" % [type_name, id]
    group.position = pos
    match type_name:
        "farm":
            # Field sized to the authoritative crop count, so a farm with 3
            # crops is visibly bigger than a farm with 1.
            var crop_count := _crop_count_for(world_state, id)
            var plot: Dictionary = AstrixAssets.farm_plot(seed_value, crop_count)
            group.add_child(plot["root"])
            group.add_child(_snow_cap(AstrixMesh.box("PlotFrost", Vector3(4.6, 0.07, 5.0),
                Vector3(0.0, 0.24, 0.0), AstrixPalette.SNOW)))
            # A barn set BEHIND the field (not beside it) so a farm's footprint
            # stays narrow and two authoritative farms never overlap.
            var barn := AstrixAssets.barn(seed_value + 7)
            barn.position = Vector3(0.4, 0.0, -(float(maxi(3, crop_count)) * 1.25 + 1.0) * 0.5 - 1.9)
            group.add_child(barn)
            group.add_child(_snow_cap(AstrixMesh.box("BarnSnow", Vector3(3.6, 0.12, 2.9),
                Vector3(0.4, 3.15, barn.position.z), AstrixPalette.SNOW)))
            var crow := AstrixAssets.scarecrow(seed_value + 3)
            crow.position = Vector3(2.3, 0.0, 0.6)
            group.add_child(crow)
            # Corner posts only — no rails. Rails read as boardwalk; short posts
            # read as a worked field boundary.
            var rows_n := float(maxi(3, crop_count))
            for cx in [-2.15, 2.15]:
                for cz in [-(rows_n * 1.25 + 1.0) * 0.5 - 0.25, (rows_n * 1.25 + 1.0) * 0.5 + 0.25]:
                    group.add_child(AstrixMesh.box_on("FieldPost", Vector3(0.12, 0.55, 0.12),
                        Vector3(cx, 0.0, cz), AstrixPalette.TIMBER.darkened(0.1)))
            _plant_rows(group, plot["rows"], world_state, id)
        "storage":
            var silo := AstrixAssets.storage(seed_value)
            group.add_child(silo)
        _:
            # Two house languages on the meadow street (rank-stable), and a
            # frontier stone cottage for any house Core places off-Meadow.
            # The COUNT stays authoritative in all cases; only the architectural
            # language follows the island culture.
            var house: Node3D
            if island != "meadow":
                house = AstrixAssets.house_stone(seed_value)
            else:
                var house_ids: Array[String] = []
                for bid in world_state.buildings.keys():
                    var b: Variant = world_state.buildings[bid]
                    if b is Dictionary and str(b.get("type", "")) == "house":
                        house_ids.append(str(bid))
                house_ids.sort()
                var rank := maxi(house_ids.find(id), 0)
                house = AstrixAssets.house(seed_value) if rank % 2 == 0 else AstrixAssets.house_timber(seed_value)
            group.add_child(house)
            _register_snow_in(house)
            _register_windows_in(house)
            _register_smoke_in(house)
            _windows_lit = false   # force the next light update to repaint them
            _dress_house(group, seed_value, island)
    return group

## House dressing: 2 micro-props tucked against the walls, deterministic per
## building id. Static storytelling (firewood, barrel, crates, bench, herbs) —
## no merchants, no logistics, nothing that implies a simulated economy.
func _dress_house(group: Node3D, seed_value: int, island: String) -> void:
    if island != "meadow":
        return    # outpost islands stay sparse; the village is on Meadow
    # Doorstep spur: a short path from the house toward the plaza, so the house
    # reads as CONNECTED rather than dropped on grass. Built in group-local
    # space (group origin is the house position), so it follows wherever Core
    # actually placed the house.
    var to_plaza := Vector3(0.0, 0.0, -1.5) - group.position
    to_plaza.y = 0.0
    if to_plaza.length() > 0.5:
        to_plaza = to_plaza.normalized()
        var spur := AstrixMesh.box_on("Doorstep", Vector3(1.1, 0.09, 2.6),
            to_plaza * 2.2, AstrixPalette.PATH.darkened(0.05))
        spur.rotation.y = atan2(to_plaza.x, to_plaza.z)
        group.add_child(_clearable_prop(spur))
    var r := AstrixMesh.rng(seed_value + 31337)
    var spots := [Vector3(1.9, 0.0, 1.2), Vector3(-1.9, 0.0, 0.4), Vector3(0.6, 0.0, -1.7)]
    var first := int(r.randi()) % 5
    var second := (first + 2 + int(r.randi()) % 2) % 5
    var picks := [first, second]
    for i in range(2):
        var prop: Node3D
        match picks[i]:
            0:
                prop = AstrixAssets.firewood_stack(seed_value + i)
            1:
                prop = AstrixAssets.barrel(seed_value + i)
            2:
                prop = AstrixAssets.crate_stack(seed_value + i)
            3:
                prop = AstrixAssets.bench(seed_value + i)
            _:
                prop = AstrixAssets.herb_garden(seed_value + i)
        prop.position = spots[(first + i * 2) % 3]
        group.add_child(_clearable_prop(prop))

## Crops rendered from authoritative crops[] — one crop = one planted row at its
## real growthStage. Row order is deterministic (sorted crop id) so a crop keeps
## its row between snapshots and only its growth changes.
func _plant_rows(group: Node3D, rows: Array, world_state: Node, farm_id: String) -> void:
    var ids: Array[String] = []
    for crop_id in world_state.crops.keys():
        var crop: Variant = world_state.crops[crop_id]
        if crop is Dictionary and str(crop.get("farmPlotId", "")) == farm_id:
            ids.append(str(crop_id))
    ids.sort()
    for i in range(rows.size()):
        var row: Dictionary = rows[i]
        if i >= ids.size():
            continue    # bare tilled ridge: unused capacity is visible
        var crop: Dictionary = world_state.crops[ids[i]]
        var stage := float(crop.get("growthStage", 0.0))
        var planted := AstrixAssets.crop_row(stage, float(row["width"]), hash(ids[i]) & 0x7fffffff)
        planted.position = Vector3(0.0, float(row["y"]), float(row["z"]))
        group.add_child(planted)
        _ease_growth(planted, str(ids[i]), stage)
        _register_crop_row(planted, stage)

## GROWTH TRANSITION. A crop's tier changes the instant Core's growthStage crosses
## a threshold, and the farm group is rebuilt from scratch when it does — so the
## new, taller row used to appear at full size in one frame. The row is instead
## born at the PREVIOUS tier's height and grows into the new one over ~0.7s.
##
## This is presentation only in the strictest sense: the authoritative stage has
## ALREADY changed before a single frame of this plays, the tween touches nothing
## but this node's scale, and it never runs backwards toward an older stage.
## Growth cannot appear while Core's clock is held, because a held clock cannot
## change growthStage and therefore cannot trigger a rebuild.
const GROWTH_EASE_SECONDS := 0.7
var _crop_stage: Dictionary = {}     # crop id -> last rendered growthStage
func _ease_growth(row: Node3D, crop_id: String, stage: float) -> void:
    var previous: Variant = _crop_stage.get(crop_id)
    _crop_stage[crop_id] = stage
    if previous == null or float(previous) >= stage:
        return
    var from_h := AstrixAssets.crop_tier_height(float(previous))
    var to_h := AstrixAssets.crop_tier_height(stage)
    if to_h <= from_h + 0.001:
        return
    row.scale = Vector3(1.0, from_h / to_h, 1.0)
    var tween := create_tween()
    tween.tween_property(row, "scale", Vector3.ONE, GROWTH_EASE_SECONDS) \
        .set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)

## WOODSMOKE. AstrixAssets.house already builds a four-puff column at the chimney
## pot; it just never moved, which is what made an inhabited village look like a
## model of one. Each puff now rises from the pot, swells, and dissolves on a
## deterministic loop offset per puff, so the column is continuous.
##
## Restraint is deliberate: only authoritative HOUSES smoke. There is no attempt
## to animate every structure, and no state is implied — a hearth burning is a
## house being lived in, which is exactly what `population` already asserts.
## Scale, not transparency, does the dissolving: alpha writes would touch shared
## materials, and a puff that shrinks to nothing reads the same from 28px/unit.
const SMOKE_RISE := 2.4
const SMOKE_PERIOD := 4.6
var _smoke: Array[Dictionary] = []
func _register_smoke_in(node: Node) -> void:
    var puffs := node.find_children("Smoke*", "MeshInstance3D", true, false)
    for i in range(puffs.size()):
        var puff := puffs[i] as MeshInstance3D
        _smoke.append({
            "node": puff,
            "base": puff.position,
            "scale": puff.scale,
            # Evenly spaced offsets so the four puffs form one continuous column
            # rather than four synchronised blobs.
            "offset": float(i) / float(maxi(1, puffs.size())),
        })

func _update_smoke(_delta: float) -> void:
    var live: Array[Dictionary] = []
    for entry in _smoke:
        var node: Variant = entry.get("node")
        # Same freed-operand trap as _update_crops: valid-check first.
        if not is_instance_valid(node) or not (node is MeshInstance3D):
            continue
        var puff := node as MeshInstance3D
        var t: float = fposmod(_time / SMOKE_PERIOD + float(entry.get("offset", 0.0)), 1.0)
        var base: Vector3 = entry.get("base", Vector3.ZERO)
        var scale0: Vector3 = entry.get("scale", Vector3.ONE)
        puff.position = Vector3(base.x + t * 0.55, base.y + t * SMOKE_RISE, base.z - t * 0.4)
        # sin(pi t) is 0 at both ends of the loop, so a puff is born and dies at
        # zero size and the wrap is invisible.
        puff.scale = scale0 * (0.35 + sin(t * PI) * 0.9)
        live.append(entry)
    _smoke = live

## Crop rows join the wind. Amplitude scales with the row's authoritative height,
## so a seedling barely stirs and a heavy harvestable sheaf leans — the wind
## itself is weather (presentation), but how much it moves is set by real growth.
var _crop_rows: Array[Dictionary] = []
func _register_crop_row(row: Node3D, stage: float) -> void:
    _crop_rows.append({
        "node": row,
        "amp": clampf(AstrixAssets.crop_tier_height(stage) * 0.030, 0.004, 0.038),
        "phase": float(_crop_rows.size()) * 0.9 + row.position.z * 0.4,
    })

## Wind pass over the crop rows. Freed rows are compacted out here rather than
## tracked with signals: a farm rebuild frees a dozen nodes at once.
func _update_crops(_delta: float) -> void:
    var live: Array[Dictionary] = []
    for entry in _crop_rows:
        var node: Variant = entry.get("node")
        # ORDER MATTERS, and it used to be wrong: `node is Node3D` on a FREED
        # reference is itself a script error ("Left operand of 'is' is a
        # previously freed instance"), which aborted this pass mid-loop. A farm
        # is rebuilt whenever a crop crosses a growth tier, so the first real
        # harvest cycle freed a dozen rows, and from the next frame on the wind
        # died permanently and the freed entries were never compacted out.
        # is_instance_valid() is the one check that is safe on a freed operand,
        # so it has to come first.
        if not is_instance_valid(node) or not (node is Node3D):
            continue
        var row := node as Node3D
        var phase := float(entry.get("phase", 0.0))
        # Two frequencies so the field ripples rather than swaying as one board.
        row.rotation.z = (sin(_time * 1.15 + phase) + sin(_time * 0.47 + phase * 1.7) * 0.5) \
            * float(entry.get("amp", 0.01))
        live.append(entry)
    _crop_rows = live

func _crop_count_for(world_state: Node, farm_id: String) -> int:
    var count := 0
    for crop_id in world_state.crops.keys():
        var crop: Variant = world_state.crops[crop_id]
        if crop is Dictionary and str(crop.get("farmPlotId", "")) == farm_id:
            count += 1
    return count

func _crop_signature(world_state: Node, farm_id: String) -> String:
    var parts: Array[String] = []
    for crop_id in world_state.crops.keys():
        var crop: Variant = world_state.crops[crop_id]
        if crop is Dictionary and str(crop.get("farmPlotId", "")) == farm_id:
            parts.append("%s:%.2f" % [str(crop_id), float(crop.get("growthStage", 0.0))])
    parts.sort()
    return ",".join(parts)

## Bridges: built between the real island rims, with piers in the water.
func _materialize_bridges(world_state: Node) -> void:
    var seen := {}
    for bridge in world_state.bridges:
        var a := str(bridge.get("islandA", ""))
        var b := str(bridge.get("islandB", ""))
        if not ISLANDS.has(a) or not ISLANDS.has(b):
            continue
        var pair := [a, b]
        pair.sort()
        var key := "bridge:%s-%s" % [pair[0], pair[1]]
        seen[key] = true
        if _sim.has(key):
            continue
        var span := _bridge_endpoints(str(pair[0]), str(pair[1]))
        var node := AstrixAssets.bridge(span[0], span[1], WATER_LEVEL, hash(key) & 0x7fffffff)
        add_child(node)
        _sim[key] = node
        _sim_sig[key] = key
    for key in _sim.keys():
        if str(key).begins_with("bridge:") and not seen.has(key):
            _free_sim(key)

## Endpoints on each island's actual rim, facing each other — so a bridge always
## lands on land at both ends and crosses only water in between.
func _bridge_endpoints(a: String, b: String) -> Array:
    return [_rim_point(a, b), _rim_point(b, a)]

## Resource nodes: authored props at mapped authoritative positions, kept in the
## `resource_nodes` group so gathering and clear_terrain removal still work.
func _materialize_resource_nodes(world_state: Node) -> void:
    var seen := {}
    for id in world_state.resource_nodes.keys():
        var node_data: Variant = world_state.resource_nodes[id]
        if not (node_data is Dictionary):
            continue
        var type_name := str(node_data.get("type", "wood"))
        if type_name == "water":
            continue    # the ocean already represents water
        var key := "resource:" + str(id)
        seen[key] = true
        if _sim.has(key):
            continue
        var island := str(node_data.get("islandId", "meadow"))
        var pos := _map_core_pos(island, _core_vec(node_data.get("position")))
        var holder := ResourceNode3D.new()
        holder.name = "Resource_%s" % str(id)
        holder.server_node_id = str(id)
        holder.resource_id = type_name
        holder.amount = int(node_data.get("quantity", 1))
        holder.position = pos
        holder.add_to_group("resource_nodes")
        match type_name:
            "stone":
                holder.add_child(AstrixAssets.rock(hash(id) & 0xffff, 1.5, AstrixPalette.ROCK_LIT))
            "crystal":
                holder.add_child(AstrixAssets.crystal(hash(id) & 0xffff))
            _:
                var tree := AstrixAssets.tree_broadleaf(hash(id) & 0xffff, 1.25)
                holder.add_child(tree["root"])
                _register_foliage(tree["foliage"])
        add_child(holder)
        _sim[key] = holder
    for key in _sim.keys():
        if str(key).begins_with("resource:") and not seen.has(key):
            _free_sim(key)

# ---------------------------------------------------------------------------
# VILLAGERS — rendered count always equals authoritative `population`.
#
# THE FABRICATION THAT WAS HERE. _rebuild_anchors used to pour every island's
# buildings into ONE anchor list, and _route_for sliced that list blindly, so a
# villager's round could start on Meadow and end on Frost. _physics_process walks
# in a straight line and sets y from the target, so those villagers strode across
# open water at surface height. That is fabricated transportation: Core has no
# transport state, no boat routes and no villager movement of any kind, and a
# bridge is the ONLY authoritative link between two islands.
#
# Anchors are therefore bucketed BY ISLAND and a villager is only ever routed
# inside one bucket. Nothing crosses water, because nothing in Core says anything
# crosses water.
# ---------------------------------------------------------------------------
func _sync_villagers(world_state: Node) -> void:
    _rebuild_anchors(world_state)
    var target := clampi(int(world_state.population), 0, MAX_RENDERED_VILLAGERS)
    _assign_villager_islands(target)
    while _villagers.size() > target:
        var doomed: Node3D = _villagers.pop_back()
        if is_instance_valid(doomed):
            doomed.queue_free()
    while _villagers.size() < target:
        _villagers.append(_spawn_villager(_villagers.size()))
    for i in range(_villagers.size()):
        var v: Node3D = _villagers[i]
        if not is_instance_valid(v):
            continue
        var route := _route_for(i)
        # The costume is DERIVED (see _role_for), so when the authoritative world
        # gains a granary the villager stationed at it becomes a carrier. Rebuild
        # the figure only on an actual change: the rig is built once, not per frame.
        if v.role != _role_for(route):
            v.queue_free()
            v = _spawn_villager(i)
            _villagers[i] = v
        else:
            v.route = route
        if v.has_method("set_world_live"):
            v.set_world_live(_world_live)

func _spawn_villager(index: int) -> Node3D:
    var route := _route_for(index)
    var villager := Node3D.new()
    villager.set_script(VILLAGER_SCRIPT)
    villager.name = "Villager_%d" % index
    add_child(villager)
    villager.setup(_role_for(route), index, route)
    if villager.has_method("apply_season"):
        villager.apply_season(_season)
    if villager.has_method("set_world_live"):
        villager.set_world_live(_world_live)
    return villager

## Role is DERIVED from the authoritative structure the villager is stationed at,
## never from its index. Core has no per-villager job record, so the costume is a
## statement about the BUILDING ("this farm is worked", "this granary is stocked")
## and not an invented personnel file. index % 4 -- the old rule -- was exactly
## the fabricated-job pattern the mandate forbids.
func _role_for(route: Array[Dictionary]) -> int:
    for entry in route:
        match str(entry.get("kind", "")):
            "farm": return 0        # FARMER  — hat + hoe
            "storage": return 2     # CARRIER — basket
            "resource": return 1    # BUILDER — timber over the shoulder
    return 0

## Deterministic island per villager index, weighted by how many authoritative
## anchors each island actually has: people are where the structures are, and a
## bare island gets nobody. Recomputed with the anchors, so a new building on
## Frost visibly moves someone there on the next snapshot.
func _assign_villager_islands(count: int) -> void:
    var slots: PackedStringArray = PackedStringArray()
    for id in ISLANDS.keys():
        var bucket: Variant = _island_anchors.get(id)
        if bucket is Array:
            for _i in range((bucket as Array).size()):
                slots.append(str(id))
    _villager_islands = PackedStringArray()
    if slots.is_empty():
        return
    for i in range(count):
        _villager_islands.append(slots[(i * 7) % slots.size()])

## Anchors are authoritative places — Core's buildings, Core's resource nodes, and
## the meadow plaza that the static settlement dressing occupies — each tagged
## with WHAT IS THERE so the villager animation can only claim work Core supports:
##   kind: farm | storage | house | resource | plaza | approach
##   work: "crop"   the farm authoritatively holds crops  -> tending motion
##         "gather" an authoritative resource node        -> gathering motion
##         ""       nothing workable here                 -> a pause, no work
##
## The MOST RECENT authoritative building gets an extra anchor: the steward's last
## act should have bodies at it, so a viewer can find what changed by looking at
## the world rather than only reading the activity log.
func _rebuild_anchors(world_state: Node) -> void:
    var buckets: Dictionary = {}
    for id in ISLANDS.keys():
        buckets[id] = []
    var newest_id := ""
    var newest_island := "meadow"
    var newest_pos := Vector3.ZERO
    for id in world_state.buildings.keys():
        var building: Variant = world_state.buildings[id]
        if not (building is Dictionary):
            continue
        var type_name := str(building.get("type", "house"))
        # A bridge_segment is topology, not a workplace: it is drawn once by
        # _materialize_bridges and nobody is stationed on it.
        if type_name == "bridge_segment":
            continue
        var island := str(building.get("islandId", "meadow"))
        if not buckets.has(island):
            continue
        var pos := _map_core_pos(island, _core_vec(building.get("position")))
        var list: Array = buckets[island]
        match type_name:
            "farm":
                # Two anchors per farm: standing in the crop rows, and at the
                # field edge by the barrel. Farming is the story, so it gets the
                # most visible bodies. The rows only count as WORK when Core says
                # this plot actually holds crops.
                var work := "crop" if _crop_count_for(world_state, str(id)) > 0 else ""
                list.append(_anchor(pos + Vector3(1.2, 0.3, 0.8), island, "farm", work))
                list.append(_anchor(pos + Vector3(-1.6, 0.0, 2.4), island, "approach", ""))
            "storage":
                list.append(_anchor(pos + Vector3(1.8, 0.0, 1.6), island, "storage", ""))
                list.append(_anchor(pos + Vector3(-1.5, 0.0, 2.2), island, "approach", ""))
            _:
                list.append(_anchor(pos + Vector3(0.0, 0.0, 2.4), island, "house", ""))
                list.append(_anchor(pos + Vector3(2.2, 0.0, 1.4), island, "approach", ""))
        # Building ids are monotonic (`farm-001`, `farm-002`, ...), so the highest
        # id is the most recently constructed.
        if str(id) > newest_id:
            newest_id = str(id)
            newest_island = island
            newest_pos = pos
    # Resource nodes are workable places Core owns: a villager at one is gathering
    # from something that authoritatively exists and has a quantity.
    for id in world_state.resource_nodes.keys():
        var record: Variant = world_state.resource_nodes[id]
        if not (record is Dictionary):
            continue
        if str((record as Dictionary).get("type", "wood")) == "water":
            continue
        var island := str((record as Dictionary).get("islandId", "meadow"))
        if not buckets.has(island):
            continue
        var pos := _map_core_pos(island, _core_vec((record as Dictionary).get("position")))
        (buckets[island] as Array).append(_anchor(pos + Vector3(1.5, 0.0, 1.2), island, "resource", "gather"))
    if newest_id != "" and buckets.has(newest_island):
        (buckets[newest_island] as Array).append(
            _anchor(newest_pos + Vector3(-0.8, 0.0, 1.4), newest_island, "approach", ""))
    # Plaza, well and market keep people circulating through the centre. These are
    # STATIC MEADOW DRESSING (see _build_settlement_dressing), so they are meadow's
    # anchors and nobody else's.
    var meadow: Array = buckets["meadow"]
    meadow.append(_anchor(Vector3(0.6, MEADOW_SURFACE, 1.6), "meadow", "plaza", ""))
    # Second anchor sits north of the plaza: the Meridian Spire's dais now owns
    # the old west-plaza standing point.
    meadow.append(_anchor(Vector3(-0.5, MEADOW_SURFACE, -4.9), "meadow", "plaza", ""))
    meadow.append(_anchor(Vector3(3.2, MEADOW_SURFACE, -0.6), "meadow", "plaza", ""))

    _island_anchors = buckets
    var flat: Array[Dictionary] = []
    for id in buckets.keys():
        for entry in (buckets[id] as Array):
            flat.append(entry)
    _villager_anchors = flat

func _anchor(pos: Vector3, island: String, kind: String, work: String) -> Dictionary:
    return {"pos": pos, "island": island, "kind": kind, "work": work}

## Deterministic per-villager route: a rotated slice of ITS OWN ISLAND's anchor
## list, so no two villagers walk an identical path, the world is reproducible,
## and no route can leave the island the villager stands on.
func _route_for(index: int) -> Array[Dictionary]:
    var route: Array[Dictionary] = []
    if index >= _villager_islands.size():
        return route
    var bucket: Variant = _island_anchors.get(_villager_islands[index])
    if not (bucket is Array) or (bucket as Array).is_empty():
        return route
    var anchors: Array = bucket
    var count := anchors.size()
    for step in range(mini(3, count)):
        route.append(anchors[(index * 3 + step * 2 + 1) % count])
    return route

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
func _core_vec(value: Variant) -> Vector3:
    if value is Dictionary:
        return Vector3(float(value.get("x", 0.0)), float(value.get("y", 0.0)), float(value.get("z", 0.0)))
    if value is Vector3:
        return value
    return Vector3.ZERO

func _free_sim(key: String) -> void:
    var node: Variant = _sim.get(key)
    # Same freed-operand trap as _update_crops, with a nastier failure: an error
    # here would abort before the erase below and strand the key in _sim, so the
    # structure could never be rebuilt.
    if is_instance_valid(node) and node is Node:
        (node as Node).queue_free()
    _sim.erase(key)
    _sim_sig.erase(key)
