extends Node3D
## ASTrix playable world. The world is procedural and modular so authored voxel
## assets can replace individual categories later. Terrain is assembled to a
## consistent "surface" height per biome so ground props, paths and bridges sit
## flush instead of floating; playable objects get simple StaticBody3D collision.

const WORLD_SIZE := Vector2(100.0, 60.0)

# Biome definitions. `top` is the grass-slab center height; the walkable surface
# is always `top + 0.3` (half-thickness 0.5 of the 1.0 GrassTop slab).
# Reference-driven palette: the world is a pale parchment-lavender miniature
# (video pale intro ~#c0c0a0) with warm orange/tan built accents and a violet
# signature (water + dusk). Biomes stay distinct but share the same world ramp.
const ISLANDS := {
    "meadow": {"center": Vector3(22.0, 0.0, 30.0), "radius": Vector2(19.0, 17.0), "top": 3.0, "color": Color("c8bfa6"), "accent": Color("d8a8c8")},
    "frost": {"center": Vector3(50.0, 0.0, 14.0), "radius": Vector2(18.0, 12.0), "top": 4.0, "color": Color("c2c8d4"), "accent": Color("b8c4e8")},
    "dusk": {"center": Vector3(76.0, 0.0, 39.0), "radius": Vector2(19.0, 16.0), "top": 2.5, "color": Color("c9ad92"), "accent": Color("a979df")},
}

# Walkable ground surfaces (grass-top top face per biome).
const MEADOW_SURFACE := 3.3
const FROST_SURFACE := 4.3
const DUSK_SURFACE := 2.8

# Isometric gameplay camera. A deliberate lower pitch (~24deg from horizontal)
# reveals object sides (tree trunks, cliff faces, bridge elevation, hut walls) and
# keeps the horizon/sky out of frame, so the world reads as a 2.5D miniature
# instead of a top-down bird's-eye view. Pulled in closer than the map so the
# starting clearing (not the whole 100x60 world) is the composition.
const CAMERA_OFFSET := Vector3(11.0, 12.2, 11.0)
const CAMERA_LOOK_HEIGHT := 0.9
# Look slightly ahead along the southern path so the player stays prominent
# while the shoreline, bridge and magic islet remain in frame.
const CAMERA_LOOK_AHEAD := 4.0
const CAMERA_SMOOTH := 6.0

var player: AstrixPlayer3D
var companion: Companion3D
var camera: Camera3D
var _time := 0.0
var _animated_water: Array[MeshInstance3D] = []
var _animated_plants: Array[Node3D] = []
var _portrait := false

func _ready() -> void:
    var world_state := get_node_or_null("/root/WorldState")
    if world_state:
        world_state.resource_nodes.clear()
    GameClient.astrix_state_received.connect(_on_astrix_state_received)
    _build_environment()
    _build_water()
    _build_islands()
    _build_paths()
    _build_starting_area()
    _build_decor()
    _build_resource_nodes()
    _build_player()
    _build_camera()
    _build_systems()

func _process(delta: float) -> void:
    _time += delta
    _update_cycle(delta)
    if is_instance_valid(camera) and is_instance_valid(player):
        # Constant iso offset: camera glides with the player, yaw never rolls.
        # Portrait pulls the x-offset in and looks further ahead so the beacon
        # destination stays in frame on narrow mobile viewports.
        var offset := Vector3(8.0 if _portrait else CAMERA_OFFSET.x, CAMERA_OFFSET.y, CAMERA_OFFSET.z)
        var look_ahead := 6.0 if _portrait else CAMERA_LOOK_AHEAD
        var target := player.global_position + offset
        var focal := player.global_position + Vector3(0.0, CAMERA_LOOK_HEIGHT, look_ahead)
        var k := 1.0 - exp(-CAMERA_SMOOTH * delta)
        camera.global_position = camera.global_position.lerp(target, k)
        camera.look_at(focal, Vector3.UP)
    for i in range(_animated_water.size()):
        _animated_water[i].position.y = _water_surface - 0.06 + sin(_time * 0.8 + float(i) * 0.45) * 0.035
    if is_instance_valid(_water_ripple):
        # Slow shimmering drift so the ripple reads as moving water.
        _water_ripple.position.x = 50.0 + sin(_time * 0.3) * 1.5
        _water_ripple.position.z = 30.0 + cos(_time * 0.25) * 1.2
    if is_instance_valid(_water_highlight):
        # The sun sheen travels across the surface, catching the light.
        _water_highlight.position.x = 50.0 + sin(_time * 0.14) * 20.0
        _water_highlight.position.z = 30.0 + cos(_time * 0.11) * 12.0
        _water_highlight.rotation.y = sin(_time * 0.05) * 0.6
    for i in range(_water_sparkles.size()):
        var sparkle := _water_sparkles[i]
        sparkle.visible = fmod(_time * 0.7 + float(i) * 1.7, 1.0) < 0.6
    for i in range(_animated_plants.size()):
        var plant := _animated_plants[i]
        plant.rotation.z = sin(_time * 0.55 + float(i) * 1.3) * 0.025

# ---------------------------------------------------------------------------
# Lighting & environment — soft gradient sky + day/dusk cycle.
# Day: warm pale sky, bright low-saturation light (reference pale intro).
# Dusk: violet/magenta sky, warmer dim light (reference night still).
# The cycle is presentation-only; it never touches authoritative state.
# ---------------------------------------------------------------------------
var _sky_mat: ProceduralSkyMaterial
var _sun: DirectionalLight3D
var _env_settings: Environment
var _day_phase := 0.0
const DAY_CYCLE_SECONDS := 90.0

func _build_environment() -> void:
    var environment := WorldEnvironment.new()
    var settings := Environment.new()
    _env_settings = settings
    settings.background_mode = Environment.BG_SKY
    var sky := Sky.new()
    var sky_mat := ProceduralSkyMaterial.new()
    _sky_mat = sky_mat
    # Day defaults (set each frame by the cycle anyway). Colors are deliberately
    # dim so the tonemap doesn't blow the whole frame to white.
    # Reference target: soft pale sky, NOT a blinding white. Keep the sky's
    # energy low so the tonemap never clips the terrain (the previous build blew
    # the whole frame to near-white; the sun disc was 40 degrees wide).
    sky_mat.sky_top_color = Color("8a9cc0")          # pale soft blue-violet
    sky_mat.sky_horizon_color = Color("c8b898")      # warm pale horizon
    sky_mat.ground_bottom_color = Color("5c6894")
    sky_mat.ground_horizon_color = Color("a89880")
    sky_mat.sun_angle_max = 4.0                        # small readable sun
    sky_mat.sun_curve = 0.9
    sky.sky_material = sky_mat
    sky.process_mode = Sky.PROCESS_MODE_REALTIME
    settings.sky = sky
    settings.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
    # Deliberately LOW ambient: the key light must carry the form. Sky-based
    # ambient was 0.35 (washed). 0.22 keeps shadow faces blue-violet-tinted but
    # clearly darker than lit faces, which is what gives low-poly geometry form.
    settings.ambient_light_energy = 0.22
    settings.tonemap_mode = Environment.TONE_MAPPER_FILMIC
    settings.tonemap_exposure = 0.5
    settings.glow_enabled = false
    environment.environment = settings
    add_child(environment)

    # Warm key light from the upper-left: soft pastel diorama illumination with
    # readable warm highlights and a gentle fill from the right. This is the
    # sun that decides lit-vs-shadowed faces, so it is the strongest light.
    var sun := DirectionalLight3D.new()
    sun.name = "WarmSun"
    _sun = sun
    sun.rotation_degrees = Vector3(-46.0, -38.0, 0.0)   # upper-left key
    sun.light_color = Color("ffe6bd")                   # warm cream sunlight
    sun.light_energy = 1.0
    sun.shadow_enabled = true
    sun.directional_shadow_max_distance = 110.0
    sun.shadow_blur = 1.6                             # tighter, readable shadows
    sun.directional_shadow_fade_start = 0.6
    add_child(sun)

    # Soft cool fill from the lower-right so shadow faces are never flat-black:
    # keeps pastel surfaces charming while preserving the lit/shadow separation.
    var fill := DirectionalLight3D.new()
    fill.name = "WarmFill"
    fill.rotation_degrees = Vector3(36.0, 42.0, 0.0)
    fill.light_color = Color("c8dbe8")                 # pale blue fill
    fill.light_energy = 0.18
    fill.shadow_enabled = false
    add_child(fill)

# Advances the day/dusk cycle and eases all lighting/sky colors between the two
# reference moods. Pure presentation; no gameplay state.
func _update_cycle(delta: float) -> void:
    _day_phase = fmod(_day_phase + delta / DAY_CYCLE_SECONDS, 1.0)
    # dusk = 0 at phase 0 (full day), 1 at phase 0.5 (full dusk), 0 again at 1.
    var dusk := sin(_day_phase * PI)
    if not _env_settings or not is_instance_valid(_sky_mat):
        return
    # Sky: warm pale (day) -> pale violet (dusk).
    _sky_mat.sky_top_color = Color("8a9cc0").lerp(Color("4a3a76"), dusk)
    _sky_mat.sky_horizon_color = Color("c8b898").lerp(Color("7a5aa0"), dusk)
    _sky_mat.ground_horizon_color = Color("a89880").lerp(Color("5a4a84"), dusk)
    _sky_mat.ground_bottom_color = Color("5c6894").lerp(Color("2e2e56"), dusk)
    # Ambient: pale cool (day) -> violet (dusk). Matches the new low baseline
    # so the key light keeps carrying form even at dusk.
    _env_settings.ambient_light_energy = lerpf(0.22, 0.16, dusk)
    # Sun: warm bright (day) -> warm violet, dimmer (dusk).
    if _sun:
        _sun.light_color = Color("ffe9c9").lerp(Color("c9a0d8"), dusk)
        _sun.light_energy = lerpf(1.0, 0.45, dusk)

# Stylized violet-lavender translucent water — ASTrix's signature material.
# Layered treatment: a rich violet base plane, a brighter drifting ripple plane,
# a long moving sun-highlight band, small sparkle patches, and shoreline foam
# discs where land meets water. All presentation-only.
var _water_surface := -0.2
var _water_ripple: MeshInstance3D
var _water_highlight: MeshInstance3D
var _water_sparkles: Array[MeshInstance3D] = []
func _build_water() -> void:
    var water := MeshInstance3D.new()
    water.name = "StylizedWater"
    var mesh := PlaneMesh.new()
    mesh.size = WORLD_SIZE + Vector2(20.0, 20.0)
    mesh.material = _water_material(false)
    water.mesh = mesh
    water.rotation_degrees.x = -90.0
    water.position = Vector3(50.0, _water_surface, 30.0)
    add_child(water)
    _animated_water.append(water)

    # Brighter translucent top plane with subtle emission = light depth + sparkle.
    _water_ripple = MeshInstance3D.new()
    _water_ripple.name = "WaterRipple"
    var ripple_mesh := PlaneMesh.new()
    ripple_mesh.size = WORLD_SIZE + Vector2(8.0, 8.0)
    ripple_mesh.material = _water_material(true)
    _water_ripple.mesh = ripple_mesh
    _water_ripple.rotation_degrees.x = -90.0
    _water_ripple.position = Vector3(50.0, _water_surface + 0.02, 30.0)
    add_child(_water_ripple)
    _animated_water.append(_water_ripple)

    # Long moving sun-highlight band: a thin bright sheen that drifts across the
    # water so the surface visibly changes under the warm key (reads as water).
    _water_highlight = MeshInstance3D.new()
    _water_highlight.name = "WaterHighlight"
    var highlight_mesh := PlaneMesh.new()
    highlight_mesh.size = Vector2(46.0, 7.0)
    highlight_mesh.material = _water_material(true, true)
    _water_highlight.mesh = highlight_mesh
    _water_highlight.rotation_degrees.x = -90.0
    _water_highlight.position = Vector3(50.0, _water_surface + 0.045, 30.0)
    add_child(_water_highlight)
    _animated_water.append(_water_highlight)

    # Small soft sparkle patches scattered over the water for surface variation.
    var sparkle_rng := RandomNumberGenerator.new()
    sparkle_rng.seed = 7331
    for i in range(9):
        var sparkle := MeshInstance3D.new()
        var sparkle_mesh := PlaneMesh.new()
        sparkle_mesh.size = Vector2(2.0 + sparkle_rng.randf() * 2.5, 1.2 + sparkle_rng.randf() * 1.6)
        sparkle_mesh.material = _water_material(true, true)
        sparkle.mesh = sparkle_mesh
        sparkle.rotation_degrees.x = -90.0
        sparkle.position = Vector3(20.0 + sparkle_rng.randf() * 60.0, _water_surface + 0.05, 8.0 + sparkle_rng.randf() * 44.0)
        sparkle.rotation.y = sparkle_rng.randf() * TAU
        add_child(sparkle)
        _water_sparkles.append(sparkle)
        _animated_water.append(sparkle)

    _build_shore_foam()

# Foam/edge discs at the water line around each island so the land->water
# boundary reads as a bright edge instead of a hard cut.
func _build_shore_foam() -> void:
    var foam_color := Color("c9bcee")
    for biome_id in ISLANDS:
        var data: Dictionary = ISLANDS[biome_id]
        var c: Vector3 = data["center"]
        var radius: Vector2 = data["radius"]
        for i in range(16):
            var ang := TAU * float(i) / 16.0 + fmod(float(i * 5), TAU) * 0.02
            var fx := c.x + cos(ang) * (radius.x * 1.52)
            var fz := c.z + sin(ang) * (radius.y * 1.52)
            var foam := MeshInstance3D.new()
            var foam_mesh := PlaneMesh.new()
            foam_mesh.size = Vector2(1.1, 0.7)
            foam_mesh.material = _foam_material()
            foam.mesh = foam_mesh
            foam.rotation_degrees.x = -90.0
            foam.position = Vector3(fx, _water_surface + 0.01, fz)
            foam.rotation.y = ang
            add_child(foam)
    # Foam ring around the magic islet shore too.
    for i in range(10):
        var ang := TAU * float(i) / 10.0
        var foam := MeshInstance3D.new()
        var foam_mesh := PlaneMesh.new()
        foam_mesh.size = Vector2(1.0, 0.6)
        foam_mesh.material = _foam_material()
        foam.mesh = foam_mesh
        foam.rotation_degrees.x = -90.0
        foam.position = Vector3(22.0 + cos(ang) * 3.6, _water_surface + 0.01, 43.5 + sin(ang) * 3.6)
        foam.rotation.y = ang
        add_child(foam)

func _foam_material() -> StandardMaterial3D:
    var material := StandardMaterial3D.new()
    material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
    material.albedo_color = Color(0.79, 0.74, 0.93, 0.75)
    material.emission_enabled = true
    material.emission = Color("b8a8e8")
    material.emission_energy_multiplier = 0.45
    material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
    material.roughness = 0.6
    return material

func _water_material(ripple: bool, highlight: bool = false) -> StandardMaterial3D:
    var material := StandardMaterial3D.new()
    material.metallic = 0.0
    material.roughness = 0.22
    material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
    if highlight:
        # Bright moving sheen: the sun reflecting off the surface.
        material.albedo_color = Color("b4a4ea")
        material.albedo_color.a = 0.55
        material.emission_enabled = true
        material.emission = Color("c8b8f4")
        material.emission_energy_multiplier = 0.5
    elif ripple:
        material.albedo_color = Color("8d7fd4")   # brighter lavender sparkle plane
        material.albedo_color.a = 0.5
        material.emission_enabled = true
        material.emission = Color("9a8be0")
        material.emission_energy_multiplier = 0.2
    else:
        # Rich violet-lavender base, deeper than the sand/grass above it so the
        # water is the dark base of the value hierarchy, not a pale wash.
        material.albedo_color = Color("54439c")
        material.albedo_color.a = 0.9
        material.emission_enabled = true
        material.emission = Color("45388a")
        material.emission_energy_multiplier = 0.12
    return material

# ---------------------------------------------------------------------------
# Terrain
# ---------------------------------------------------------------------------
func _build_islands() -> void:
    for biome_id in ISLANDS:
        var data: Dictionary = ISLANDS[biome_id]
        _add_island_slabs(biome_id, data)
        _add_island_rim(biome_id, data)
        _add_shoreline_band(biome_id, data)
        _add_biome_features(biome_id, data)
        _add_island_floor(biome_id, data)
    # Flush the frost snow cap by raising its top slab height.
    _mesh_box("FrostSnowCap", Vector3(50.0, FROST_SURFACE + 0.2, 14.0), Vector3(ISLANDS["frost"]["radius"].x * 1.38, 0.3, ISLANDS["frost"]["radius"].y * 1.38), Color("dbeaf0")).rotation.y = 0.05

func _add_island_slabs(biome_id: String, data: Dictionary) -> void:
    var center: Vector3 = data["center"]
    var radius: Vector2 = data["radius"]
    var top: float = data["top"]
    # Face-to-face value separation: stone base and soil step are visibly DARKER
    # than the grass top, so the terrain reads as layered ground (bright sunlit
    # grass above, shadowed earth/rock below) instead of one flat pastel mass.
    var base := _mesh_box("%s_StoneBase" % biome_id, center + Vector3(0.0, 0.0, 0.0), Vector3(radius.x * 2.0, 1.0, radius.y * 2.0), Color("5f6a74"))
    base.rotation.y = 0.12
    add_child(base)
    var middle := _mesh_box("%s_SoilStep" % biome_id, center + Vector3(0.0, 0.8, 0.0), Vector3(radius.x * 1.86, 1.6, radius.y * 1.86), (data["color"] as Color).darkened(0.28))
    middle.rotation.y = -0.08
    add_child(middle)
    var top_mesh := _mesh_box("%s_GrassTop" % biome_id, center + Vector3(0.0, top - 0.2, 0.0), Vector3(radius.x * 1.68, 1.0, radius.y * 1.68), (data["color"] as Color).lightened(0.06))
    top_mesh.rotation.y = 0.05
    add_child(top_mesh)
    if biome_id == "frost":
        var snow := _mesh_box("FrostSnowCap_Lower", center + Vector3(0.0, FROST_SURFACE - 0.35, 0.0), Vector3(radius.x * 1.38, 0.3, radius.y * 1.38), Color("e6f2f6"))
        snow.rotation.y = 0.05
        add_child(snow)
    elif biome_id == "dusk":
        var sand := _mesh_box("DuskSandCap", center + Vector3(0.0, top + 0.32, 0.0), Vector3(radius.x * 1.42, 0.18, radius.y * 1.42), Color("e3bd9a"))
        sand.rotation.y = 0.05
        add_child(sand)

# Rounded "chunky edge" rim for each island slab: fat turf overhang balls around
# the grass-top rim (so the lip is soft, not a sharp box) plus a sparse ring of
# small soil/pebble mounds at the soil-step boundary for layered, hand-built
# elevation. Never spaced too regularly so it reads natural, not tessellated.
func _add_island_rim(biome_id: String, data: Dictionary) -> void:
    var c: Vector3 = data["center"]
    var radius: Vector2 = data["radius"]
    var top: float = data["top"]
    var surface := _surface_of(biome_id)
    var tuft_color := (data["color"] as Color).darkened(0.08)
    var mound_color := Color("b9a888") if biome_id == "meadow" else (
        Color("aeb6c4") if biome_id == "frost" else Color("b79b86"))
    var count := 18
    for i in range(count):
        # Grass overhang just proud of the grass-top rim.
        var ang := TAU * float(i) / float(count) + fmod(float(i * 7), TAU) * 0.03
        var gx := c.x + cos(ang) * (radius.x * 1.70)
        var gz := c.z + sin(ang) * (radius.y * 1.70)
        var turf := _mesh_box("RimTurf_%s_%02d" % [biome_id, i], Vector3(gx, surface - 0.18, gz), Vector3(1.1, 0.4, 1.1), tuft_color)
        turf.rotation.y = ang + PI * 0.25
        turf.material_override = _material(tuft_color)
        add_child(turf)
        # Layered soil mound slightly farther out, a touch lower -> stepped edge.
        if i % 2 == 0:
            var mx := c.x + cos(ang) * (radius.x * 1.82)
            var mz := c.z + sin(ang) * (radius.y * 1.82)
            var mound := _mesh_box("RimMound_%s_%02d" % [biome_id, i], Vector3(mx, top - 0.5, mz), Vector3(1.5, 0.5, 1.5), mound_color)
            mound.rotation.y = ang
            mound.material_override = _material(mound_color)
            add_child(mound)

# Soft bright sand/foam band ringing an island at the water line. This is the
# shoreline->water transition the viewer reads to understand where dry land ends.
func _add_shoreline_band(biome_id: String, data: Dictionary) -> void:
    var c: Vector3 = data["center"]
    var radius: Vector2 = data["radius"]
    var segments := 14
    var top: float = data["top"]
    var band_color := Color("d9b98a") if biome_id == "meadow" else (Color("bcd4d0") if biome_id == "frost" else Color("deaa8f"))
    for i in range(segments):
        var ang := TAU * float(i) / float(segments)
        var px := c.x + cos(ang) * (radius.x * 1.42)
        var pz := c.z + sin(ang) * (radius.y * 1.42)
        var band := _mesh_box("Shore_%s_%02d" % [biome_id, i], Vector3(px, top - 0.65, pz), Vector3(2.1, 0.24, 2.1), band_color)
        band.rotation.y = ang
        band.material_override = _material(band_color)
        add_child(band)

# Invisible StaticBody floor at the true walkable surface so the player rests on
# the terrain (froze at their spawn height otherwise).
func _add_island_floor(biome_id: String, data: Dictionary) -> void:
    var surface := _surface_of(biome_id)
    var radius: Vector2 = data["radius"]
    var body := StaticBody3D.new()
    body.name = "%s_Floor" % biome_id
    body.position = Vector3(data["center"].x, surface, data["center"].z)
    var shape := CollisionShape3D.new()
    var box := BoxShape3D.new()
    box.size = Vector3(radius.x * 1.7, 0.6, radius.y * 1.7)
    shape.shape = box
    body.add_child(shape)
    add_child(body)

func _surface_of(biome_id: String) -> float:
    match biome_id:
        "meadow": return MEADOW_SURFACE
        "frost": return FROST_SURFACE
        _: return DUSK_SURFACE

func _add_biome_features(biome_id: String, data: Dictionary) -> void:
    var c: Vector3 = data["center"]
    var s := _surface_of(biome_id)
    if biome_id == "meadow":
        for i in range(6):
            _add_tree(c + Vector3(-13.0 + float(i % 3) * 11.0, 0.0, -8.0 + float(i / 3) * 13.0), s, i, data["accent"])
        for i in range(10):
            _add_grass(c + Vector3(-15.0 + float(i % 5) * 7.0, s, -11.0 + float(i / 5) * 14.0), i, Color("a8b98a"))
    elif biome_id == "frost":
        for i in range(5):
            _add_ice(c + Vector3(-10.0 + float(i % 3) * 10.0, s, -5.0 + float(i / 3) * 8.0), i)
        for i in range(4):
            _add_rock(c + Vector3(-11.0 + float(i) * 7.0, s, 5.0), i, Color("a8c4d4"))
    else:
        for i in range(5):
            _add_crystal(c + Vector3(-10.0 + float(i % 3) * 10.0, s, -5.0 + float(i / 3) * 9.0), i)
        for i in range(4):
            _add_rock(c + Vector3(-10.0 + float(i) * 7.0, s, 6.0), i, Color("ae887e"))

func _build_paths() -> void:
    # Meadow clearing + a dirt path that runs from the spawn toward the southern
    # water and bridge. Warm tan paths read as the "built" accent per the refs.
    add_child(_mesh_box("MeadowClearing", Vector3(22.0, MEADOW_SURFACE - 0.08, 30.0), Vector3(14.0, 0.16, 11.0), Color("cfa97a")))
    add_child(_mesh_box("MeadowPath", Vector3(22.0, MEADOW_SURFACE - 0.05, 37.0), Vector3(3.6, 0.12, 12.0), Color("c29568")))
    add_child(_mesh_box("MeadowPath_South", Vector3(22.0, MEADOW_SURFACE - 0.05, 42.0), Vector3(3.0, 0.12, 4.0), Color("b98a5d")))
    add_child(_mesh_box("FrostPath", Vector3(50.0, FROST_SURFACE - 0.05, 14.0), Vector3(3.0, 0.12, 14.0), Color("c4c9d6")))
    add_child(_mesh_box("DuskPath", Vector3(76.0, DUSK_SURFACE - 0.05, 39.0), Vector3(18.0, 0.12, 2.8), Color("c08976")))

# ---------------------------------------------------------------------------
# Curated starting clearing — the "front door" of the game.
# ---------------------------------------------------------------------------
func _build_starting_area() -> void:
    var s := MEADOW_SURFACE
    # Trees / rocks curtaining the clearing so the path is readable.
    _add_tree(Vector3(16.0, 0.0, 40.0), s + 0.5, 90, Color("ed9dcc"))
    _add_tree(Vector3(28.0, 0.0, 39.0), s + 0.5, 91, Color("a5d873"))
    _add_shrub(Vector3(14.5, s, 31.0), "Shrub_01")
    _add_shrub(Vector3(29.5, s, 25.5), "Shrub_02")
    _add_shrub(Vector3(25.0, s, 36.5), "Shrub_03")

    # Small handcrafted hut with a doorway (walkable gap).
    _build_hut(Vector3(29.0, s, 26.0))

    # Using high indices avoids clashing with the meadow feature trees (0..5).
    _add_signpost(Vector3(18.0, s, 32.5))
    _add_lantern(Vector3(24.5, s, 29.5))
    _add_bench(Vector3(16.5, s, 27.0))
    _add_crate(Vector3(27.0, s, 33.0))
    _add_crate(Vector3(27.9, s, 33.8))
    _add_barrel(Vector3(26.2, s, 33.4))
    _add_rock(Vector3(31.5, s, 31.0), 80, Color("8f98a3"))
    _add_rock(Vector3(13.5, s, 36.0), 81, Color("9aa3ae"))
    # A little well by the hut path edge ties the clearing to "habitation".
    _add_well(Vector3(19.5, s, 24.5))
    # A low split fence lines the southern path from spawn toward the shore,
    # guiding the eye (and traversal) toward the bridge and magic islet.
    for i in range(4):
        _add_fence_post(Vector3(24.6, s, 34.2 + float(i) * 2.4), float(i) * 90.0)

    # Flowers + pebbles scattered around the clearing give readable grass dressing.
    var flower_colors := [Color("f5c6d8"), Color("f0e08a"), Color("e8a0b8"), Color("f4f0c8")]
    for i in range(14):
        var fx: float = 15.0 + fmod(float(i) * 3.7, 12.0)
        var fz: float = 24.5 + fmod(float(i) * 5.1, 9.0)
        if Vector2(fx - 22.0, fz - 30.0).length() > 7.5:
            _add_flower(Vector3(fx, s, fz), i, flower_colors[i % flower_colors.size()])
    for i in range(10):
        var px: float = 14.0 + fmod(float(i) * 4.3, 14.0)
        var pz: float = 23.0 + fmod(float(i) * 6.7, 11.0)
        if Vector2(px - 22.0, pz - 30.0).length() > 7.8:
            _add_pebble(Vector3(px, s, pz), i)
    # A couple of mushrooms at the tree bases for a cozy, hand-planted feel.
    _add_mushroom(Vector3(15.2, s, 39.6), 0)
    _add_mushroom(Vector3(27.2, s, 38.4), 1)

    # Southern shore, water edge + the bridge to the magic islet, all kept
    # close to spawn so the clearing -> path -> water -> bridge -> landmark
    # composition reads in a single camera frame next to the player.
    _build_shoreline(s)
    _build_bridge(s)
    _build_magic_islet(s + 0.5)
    _build_staging()

# ---------------------------------------------------------------------------
# Foreground / midground / background staging (Presentation Pass 2).
# Foreground: large framing elements entering the frame corners for overlap &
# occlusion depth. Midground: clusters filling the once-hollow center. Far:
# a quieter rim of trees behind the clearing. All coords computed from the
# ortho camera's world->screen mapping at spawn so staging lands on-frame.
# ---------------------------------------------------------------------------
func _build_staging() -> void:
    var s := MEADOW_SURFACE

    # FOREGROUND — bottom-right frame corner gets a large tree that partially
    # enters the frame (overlap/occlusion depth); the bottom-left is already the
    # beacon destination, so the left edge gets shore rocks + a shrub instead.
    _add_tree(Vector3(31.3, 0.0, 29.3), s, 100, Color("e89fc0"), 1.6)    # right foreground tree
    _add_rock(Vector3(19.1, s, 41.8), 82, Color("9aa3ae"))                # left edge shore rock
    _add_rock(Vector3(23.2, s, 39.8), 83, Color("8f98a3"))
    _add_shrub(Vector3(19.6, s, 40.9), "Shrub_FG1")
    _add_shrub(Vector3(28.3, s, 31.7), "Shrub_FG2")
    _add_grass(Vector3(30.2, s, 30.6), 100, Color("8fc08a"))
    _add_grass(Vector3(32.6, s, 28.4), 101, Color("8fc08a"))
    _add_flower(Vector3(30.0, s, 30.0), 110, Color("f5d0e0"))
    _add_flower(Vector3(32.4, s, 28.0), 111, Color("f0e08a"))

    # MIDGROUND — clusters that fill the previously hollow center band (world
    # z ~31-37) without blocking the path. Intentional groups, not scatter.
    _add_shrub(Vector3(24.6, s, 33.6), "Shrub_M1")
    _add_rock(Vector3(25.2, s, 34.8), 84, Color("a0a9b2"))
    _add_flower(Vector3(25.8, s, 34.2), 112, Color("e8c4f0"))
    _add_flower(Vector3(24.9, s, 35.2), 113, Color("f5d0e0"))
    _add_shrub(Vector3(18.9, s, 34.0), "Shrub_M2")
    _add_pebble(Vector3(18.3, s, 33.4), 20)
    _add_pebble(Vector3(19.6, s, 34.5), 21)
    _add_grass(Vector3(19.4, s, 33.4), 102, Color("a8c98a"))
    _add_grass(Vector3(25.4, s, 31.2), 103, Color("a8c98a"))
    _add_flower(Vector3(26.2, s, 30.8), 114, Color("f0e08a"))
    _add_flower(Vector3(20.4, s, 32.2), 115, Color("c8e8ff"))
    _add_mushroom(Vector3(26.6, s, 32.8), 5)

    # BACKGROUND RIM — a quieter, smaller tree line behind the clearing (upper
    # frame) that frames the scene without competing with the foreground.
    _add_tree(Vector3(12.5, 0.0, 36.8), s, 102, Color("a5d873"), 0.85)
    _add_tree(Vector3(15.0, 0.0, 32.1), s, 103, Color("ed9dcc"), 0.9)
    _add_tree(Vector3(20.8, 0.0, 24.4), s, 104, Color("a5d873"), 1.0)
    _add_rock(Vector3(14.4, s, 34.5), 87, Color("aab6c2"))
    _add_grass(Vector3(16.2, s, 31.0), 104, Color("8fc08a"))

    # AUTHORED GROUPS — little composed scenes so the world feels designed.
    # Hut garden: fence posts + flowers on the hut's south face.
    _add_fence_post(Vector3(28.0, s, 28.3), 0.0)
    _add_fence_post(Vector3(30.0, s, 28.3), 0.0)
    _add_flower(Vector3(28.6, s, 27.9), 116, Color("f5c6d8"))
    _add_flower(Vector3(29.4, s, 27.7), 117, Color("f0e08a"))
    _add_pebble(Vector3(29.0, s, 27.5), 22)
    # Well cluster: barrel + crate + flowers around the well.
    _add_crate(Vector3(18.8, s, 23.8))
    _add_barrel(Vector3(20.3, s, 23.6))
    _add_flower(Vector3(18.4, s, 24.8), 118, Color("e8a0b8"))
    _add_grass(Vector3(20.9, s, 24.0), 105, Color("a8c98a"))
    # Bridge shoreline: rocks + flowers flanking the bridge head on both sides.
    _add_rock(Vector3(19.2, s, 40.6), 88, Color("8f98a3"))
    _add_rock(Vector3(24.6, s, 40.7), 89, Color("a0a9b2"))
    _add_flower(Vector3(19.8, s, 39.9), 119, Color("c8e8ff"))
    _add_flower(Vector3(24.0, s, 39.9), 123, Color("f5d0e0"))
    _add_grass(Vector3(20.6, s, 39.6), 106, Color("8fc08a"))
    _add_grass(Vector3(23.4, s, 39.6), 107, Color("8fc08a"))

func _build_shoreline(s: float) -> void:
    for i in range(5):
        var x: float = 17.0 + float(i) * 2.4
        add_child(_mesh_box("ShoreSand_%d" % i, Vector3(x, s - 0.12, 38.2), Vector3(2.2, 0.2, 3.4), Color("d9b98a")))

# Walkable wooden deck flush with the meadow surface, bridging the shore to the
# magic islet. Planks carry their own StaticBody so the player crosses it.
func _build_bridge(s: float) -> void:
    # Wide soft grounding shadow under the deck so the bridge reads as a solid
    # object sitting on the water, not a floating plank.
    _add_ground_shadow(Vector3(22.0, s + 0.02, 41.0), 3.2, 3.4, 0.3)
    var deck := StaticBody3D.new()
    deck.name = "Bridge_Deck"
    deck.position = Vector3(22.0, s, 41.0)
    deck.rotation.y = 0.0
    var shape := CollisionShape3D.new()
    var box := BoxShape3D.new()
    box.size = Vector3(4.2, 0.3, 6.0)
    shape.shape = box
    deck.add_child(shape)
    var rail_l := _mesh_box("Rail_L", Vector3(-1.9, 1.0, 0.0), Vector3(0.2, 1.1, 6.0), Color("8a5a3f"))
    var rail_r := _mesh_box("Rail_R", Vector3(1.9, 1.0, 0.0), Vector3(0.2, 1.1, 6.0), Color("8a5a3f"))
    rail_l.material_override = StandardMaterial3D.new()
    rail_r.material_override = StandardMaterial3D.new()
    (rail_l.material_override as StandardMaterial3D).albedo_color = Color("8a5a3f")
    (rail_r.material_override as StandardMaterial3D).albedo_color = Color("8a5a3f")
    deck.add_child(rail_l)
    deck.add_child(rail_r)
    for i in range(7):
        var plank := MeshInstance3D.new()
        var pm := BoxMesh.new()
        pm.size = Vector3(3.8, 0.22, 0.95)
        plank.mesh = pm
        plank.position = Vector3(0.0, 0.0, (float(i) - 3.0) * 1.0)
        plank.material_override = _material(Color("a9795c"))
        deck.add_child(plank)
    add_child(deck)

# A small modular island the player reaches by crossing the bridge. Carries its
# own floor collider, then the magic landmark on top.
func _build_magic_islet(s: float) -> void:
    var isle_base := StaticBody3D.new()
    isle_base.name = "MagicIslet_Floor"
    isle_base.position = Vector3(22.0, s, 43.5)
    var shape := CollisionShape3D.new()
    var box := BoxShape3D.new()
    box.size = Vector3(6.0, 0.6, 6.0)
    shape.shape = box
    isle_base.add_child(shape)
    add_child(isle_base)
    add_child(_mesh_box("MagicIslet_Stone", Vector3(22.0, s - 3.4, 43.5), Vector3(8.0, 6.4, 8.0), Color("6e748c")))
    add_child(_mesh_box("MagicIslet_Top", Vector3(22.0, s - 0.22, 43.5), Vector3(7.0, 0.5, 7.0), Color("c4b18e")))
    add_child(_mesh_box("MagicIslet_Grass", Vector3(22.0, s - 0.02, 43.5), Vector3(6.4, 0.1, 6.4), Color("a5b886")))

    # The magic landmark: a softly glowing obelisk beacon. Emissive body + tip,
    # a warm violet light pool at its base, a small OmniLight, and a ring of
    # standing stones so it reads as a deliberate destination, not a prop.
    var obelisk := MeshInstance3D.new()
    obelisk.name = "MagicLandmark"
    var om := BoxMesh.new()
    om.size = Vector3(1.0, 4.8, 1.0)
    obelisk.mesh = om
    obelisk.position = Vector3(22.0, s + 2.4, 43.5)
    obelisk.material_override = _material(Color("8a6cc9"), 0.5)
    add_child(obelisk)
    var tip := MeshInstance3D.new()
    var tm := PrismMesh.new()
    tm.size = Vector3(1.4, 1.1, 1.4)
    tip.mesh = tm
    tip.position = Vector3(22.0, s + 5.1, 43.5)
    tip.material_override = _material(Color("a88ae6"), 0.7)
    add_child(tip)
    var base := _mesh_box("LandmarkBase", Vector3(22.0, s + 0.4, 43.5), Vector3(2.4, 0.8, 2.4), Color("5e6f78"))
    base.material_override = _material(Color("5e6f78"))
    add_child(base)
    # Warm violet glow pool on the ground under the beacon.
    var pool := MeshInstance3D.new()
    var pool_mesh := CylinderMesh.new()
    pool_mesh.top_radius = 1.7
    pool_mesh.bottom_radius = 1.7
    pool_mesh.height = 0.02
    pool.mesh = pool_mesh
    pool.position = Vector3(22.0, s + 0.03, 43.5)
    pool.material_override = _material(Color("a889e8"), 0.65)
    add_child(pool)
    # Small localized light so the beacon visibly illuminates its surroundings.
    var beacon_light := OmniLight3D.new()
    beacon_light.name = "BeaconLight"
    beacon_light.position = Vector3(22.0, s + 3.4, 43.5)
    beacon_light.light_color = Color("c9a0ff")
    beacon_light.light_energy = 2.2
    beacon_light.omni_range = 11.0
    beacon_light.shadow_enabled = false
    add_child(beacon_light)
    # Standing-stone ring: chunky silhouettes that frame the beacon.
    for i in range(6):
        var ang := TAU * float(i) / 6.0 + 0.3
        var stone := MeshInstance3D.new()
        var stone_mesh := PrismMesh.new()
        stone_mesh.size = Vector3(0.7, 1.6 + float(i % 3) * 0.5, 0.7)
        stone.mesh = stone_mesh
        stone.position = Vector3(22.0 + cos(ang) * 2.6, s + 0.8 + float(i % 2) * 0.3, 43.5 + sin(ang) * 2.6)
        stone.rotation.y = ang
        stone.material_override = _material(Color("7a5a9e"))
        add_child(stone)
    # Surrounding vegetation + a couple of rocks so the islet feels lived-in.
    _add_flower(Vector3(20.2, s, 42.4), 120, Color("e8c4f0"))
    _add_flower(Vector3(23.9, s, 44.6), 121, Color("c8e8ff"))
    _add_flower(Vector3(20.6, s, 45.0), 122, Color("f0e0c0"))
    _add_rock(Vector3(24.6, s, 42.6), 85, Color("8a7a9e"))
    _add_rock(Vector3(19.4, s, 43.9), 86, Color("96849e"))

func _build_hut(center: Vector3) -> void:
    var s := center.y
    _add_ground_shadow(center + Vector3(0.0, 0.0, 0.0), 2.9, 2.5, 0.4)
    var body := MeshInstance3D.new()
    body.name = "Hut"
    var bm := BoxMesh.new()
    bm.size = Vector3(4.4, 2.6, 3.6)
    body.mesh = bm
    body.position = center + Vector3(0.0, 1.3, 0.0)
    body.material_override = _material(Color("e0b288"))
    add_child(body)
    var roof := MeshInstance3D.new()
    var rm := PrismMesh.new()
    rm.size = Vector3(5.2, 1.4, 4.4)
    roof.mesh = rm
    roof.position = center + Vector3(0.0, 2.8, 0.0)
    roof.rotation.y = 0.0
    roof.material_override = _material(Color("d07c63"))
    add_child(roof)
    # Door (southern side) + window accents.
    var door := _mesh_box("HutDoor", center + Vector3(0.0, 0.95, 1.85), Vector3(1.1, 1.9, 0.15), Color("8a5a3f"))
    door.material_override = _material(Color("8a5a3f"))
    add_child(door)
    var win := _mesh_box("HutWindow", center + Vector3(-1.9, 1.6, 0.4), Vector3(0.15, 0.9, 0.9), Color("e9b95c"))
    win.material_override = _material(Color("e9b95c"), 0.2)
    add_child(win)
    # Collision: walls (leave the door open).
    var body_collider := StaticBody3D.new()
    body_collider.name = "Hut_Walls"
    body_collider.position = center + Vector3(0.0, 1.3, 0.0)
    for part in [
        {"p": Vector3(0.0, 0.0, -1.9), "s": Vector3(4.6, 2.6, 0.25)},   # north wall
        {"p": Vector3(0.0, 0.0, 1.9), "s": Vector3(4.6, 2.6, 0.25)},    # south wall (blocked partially by collider too; door visual only)
        {"p": Vector3(-2.3, 0.0, 0.0), "s": Vector3(0.25, 2.6, 4.0)},   # west wall
        {"p": Vector3(2.3, 0.0, 0.0), "s": Vector3(0.25, 2.6, 4.0)},    # east wall
    ]:
        var cs := CollisionShape3D.new()
        var csh := BoxShape3D.new()
        csh.size = part["s"]
        cs.shape = csh
        cs.position = part["p"]
        body_collider.add_child(cs)
    add_child(body_collider)

func _add_signpost(pos: Vector3) -> void:
    _add_ground_shadow(pos, 0.5, 0.5, 0.4)
    var group := Node3D.new()
    group.name = "Signpost"
    group.position = pos
    var pole := _mesh_box("SigpPole", Vector3(0.0, 1.0, 0.0), Vector3(0.2, 2.0, 0.2), Color("7d5237"))
    var board := _mesh_box("SigpBoard", Vector3(0.35, 1.5, 0.0), Vector3(1.6, 0.8, 0.12), Color("b98a5f"))
    group.add_child(pole)
    group.add_child(board)
    add_child(group)
    _obstacle(pos + Vector3(0.0, 0.9, 0.0), Vector3(0.5, 1.8, 0.5))

func _add_lantern(pos: Vector3) -> void:
    _add_ground_shadow(pos, 0.42, 0.42, 0.4)
    var group := Node3D.new()
    group.name = "Lantern"
    group.position = pos
    var pole := _mesh_box("LantPole", Vector3(0.0, 1.2, 0.0), Vector3(0.15, 2.4, 0.15), Color("4c5560"))
    var glow := _mesh_box("LantGlow", Vector3(0.0, 2.5, 0.0), Vector3(0.7, 0.7, 0.7), Color("ffd98a"))
    glow.material_override = _material(Color("ffd98a"), 0.6)
    group.add_child(pole)
    group.add_child(glow)
    add_child(group)
    _obstacle(pos + Vector3(0.0, 1.2, 0.0), Vector3(0.4, 2.4, 0.4))

func _add_bench(pos: Vector3) -> void:
    _add_ground_shadow(pos, 1.15, 0.6, 0.42)
    var group := Node3D.new()
    group.name = "Bench"
    group.position = pos
    group.add_child(_mesh_box("BenchSeat", Vector3(0.0, 0.55, 0.0), Vector3(1.9, 0.2, 0.7), Color("b98a5f")))
    group.add_child(_mesh_box("BenchLegA", Vector3(-0.8, 0.25, 0.0), Vector3(0.2, 0.5, 0.6), Color("8a5a3f")))
    group.add_child(_mesh_box("BenchLegB", Vector3(0.8, 0.25, 0.0), Vector3(0.2, 0.5, 0.6), Color("8a5a3f")))
    add_child(group)
    _obstacle(pos + Vector3(0.0, 0.5, 0.0), Vector3(2.0, 0.6, 1.0))

func _add_crate(pos: Vector3) -> void:
    _add_ground_shadow(pos, 0.72, 0.72, 0.45)
    var box := _mesh_box("Crate", pos + Vector3(0.0, 0.55, 0.0), Vector3(1.1, 1.1, 1.1), Color("c2925f"))
    box.material_override = _material(Color("c2925f"))
    add_child(box)
    _obstacle(pos + Vector3(0.0, 0.55, 0.0), Vector3(1.1, 1.1, 1.1))

func _add_barrel(pos: Vector3) -> void:
    _add_ground_shadow(pos, 0.7, 0.7, 0.45)
    var barrel := MeshInstance3D.new()
    barrel.name = "Barrel"
    var bm := CylinderMesh.new()
    bm.top_radius = 0.55
    bm.bottom_radius = 0.62
    bm.height = 1.15
    barrel.mesh = bm
    barrel.position = pos + Vector3(0.0, 0.57, 0.0)
    barrel.material_override = _material(Color("a9795c"))
    add_child(barrel)
    # Band accent for material readability.
    var band := _mesh_box("Band", pos + Vector3(0.0, 0.95, 0.0), Vector3(1.1, 0.12, 1.1), Color("7d5237"))
    add_child(band)
    _obstacle(pos + Vector3(0.0, 0.55, 0.0), Vector3(1.2, 1.15, 1.2))

func _add_flower(pos: Vector3, index: int, color: Color) -> void:
    _add_ground_shadow(pos, 0.18, 0.18, 0.3)
    var flower := MeshInstance3D.new()
    flower.name = "Flower_%02d" % index
    var stem := CylinderMesh.new()
    stem.top_radius = 0.02
    stem.bottom_radius = 0.025
    stem.height = 0.32
    flower.mesh = stem
    flower.position = pos + Vector3(0.0, 0.16, 0.0)
    flower.material_override = _material(Color("6f9a55"))
    add_child(flower)
    var head := MeshInstance3D.new()
    var hm := SphereMesh.new()
    hm.radius = 0.1
    hm.height = 0.18
    head.mesh = hm
    head.position = pos + Vector3(0.0, 0.34, 0.0)
    head.material_override = _material(color)
    add_child(head)

func _add_pebble(pos: Vector3, index: int) -> void:
    _add_ground_shadow(pos, 0.24, 0.24, 0.32)
    var pebble := MeshInstance3D.new()
    pebble.name = "Pebble_%02d" % index
    var pm := SphereMesh.new()
    pm.radius = 0.16 + float(index % 3) * 0.05
    pm.height = 0.2
    pebble.mesh = pm
    pebble.position = pos + Vector3(0.0, 0.09, 0.0)
    pebble.rotation.x = 0.6
    pebble.rotation.y = float(index) * 0.9
    pebble.material_override = _material(Color("b8b4aa"))
    add_child(pebble)

func _add_mushroom(pos: Vector3, index: int) -> void:
    _add_ground_shadow(pos, 0.24, 0.24, 0.35)
    var mushroom := Node3D.new()
    mushroom.name = "Mushroom_%02d" % index
    mushroom.position = pos
    add_child(mushroom)
    var stem := MeshInstance3D.new()
    var sm := CylinderMesh.new()
    sm.top_radius = 0.06
    sm.bottom_radius = 0.09
    sm.height = 0.26
    stem.mesh = sm
    stem.position.y = 0.13
    stem.material_override = _material(Color("e8e3d6"))
    mushroom.add_child(stem)
    var cap := MeshInstance3D.new()
    var cm := SphereMesh.new()
    cm.radius = 0.18
    cm.height = 0.22
    cap.mesh = cm
    cap.position.y = 0.27
    cap.scale = Vector3(1.0, 0.7, 1.0)
    cap.material_override = _material(Color("e05f4e"))
    mushroom.add_child(cap)

func _add_well(pos: Vector3) -> void:
    _add_ground_shadow(pos, 1.35, 1.35, 0.4)
    var group := Node3D.new()
    group.name = "Well"
    group.position = pos + Vector3(0.0, 0.0, 0.0)
    add_child(group)
    var base := MeshInstance3D.new()
    var bm := CylinderMesh.new()
    bm.top_radius = 0.95
    bm.bottom_radius = 1.05
    bm.height = 1.0
    base.mesh = bm
    base.position.y = 0.5
    base.material_override = _material(Color("c9c5ba"))
    group.add_child(base)
    var rim := MeshInstance3D.new()
    var rm := CylinderMesh.new()
    rm.top_radius = 0.95
    rm.bottom_radius = 0.95
    rm.height = 0.3
    rim.mesh = rm
    rim.position.y = 1.0
    rim.material_override = _material(Color("8a8378"))
    group.add_child(rim)
    var post_l := _mesh_box("PostL", Vector3(-0.62, 1.6, 0.0), Vector3(0.14, 1.4, 0.14), Color("7d5237"))
    var post_r := _mesh_box("PostR", Vector3(0.62, 1.6, 0.0), Vector3(0.14, 1.4, 0.14), Color("7d5237"))
    group.add_child(post_l)
    group.add_child(post_r)
    var cross := _mesh_box("Cross", Vector3(0.0, 2.25, 0.0), Vector3(1.6, 0.14, 0.14), Color("8a5a3f"))
    group.add_child(cross)
    _obstacle(pos + Vector3(0.0, 0.9, 0.0), Vector3(2.2, 1.6, 2.2))

func _add_fence_post(pos: Vector3, rot_deg: float) -> void:
    _add_ground_shadow(pos, 0.3, 0.4, 0.4)
    var post := _mesh_box("FencePost", pos + Vector3(0.0, 0.5, 0.0), Vector3(0.16, 1.0, 0.5), Color("9a6a45"))
    post.rotation.y = deg_to_rad(rot_deg)
    post.material_override = _material(Color("9a6a45"))
    add_child(post)
    var rail := _mesh_box("FenceRail", pos + Vector3(0.0, 0.72, 0.0), Vector3(0.16, 0.1, 0.86), Color("b98a5f"))
    rail.rotation.y = deg_to_rad(rot_deg)
    rail.material_override = _material(Color("b98a5f"))
    add_child(rail)
    _obstacle(pos + Vector3(0.0, 0.4, 0.0), Vector3(0.4, 0.9, 0.6))

func _obstacle(center: Vector3, size: Vector3) -> void:
    var body := StaticBody3D.new()
    body.name = "Obstacle_%s_%s" % [center.x, center.z]
    body.position = center
    var cs := CollisionShape3D.new()
    var sh := BoxShape3D.new()
    sh.size = size
    cs.shape = sh
    body.add_child(cs)
    add_child(body)

func _add_tree(position: Vector3, surface: float, index: int, crown_color: Color, scale_mult: float = 1.0) -> void:
    _add_ground_shadow(Vector3(position.x, surface, position.z), 1.9 * scale_mult, 1.7 * scale_mult, 0.42)
    var tree := Node3D.new()
    tree.name = "Tree_%02d" % index
    tree.position = Vector3(position.x, surface, position.z)
    tree.scale = Vector3(scale_mult, scale_mult, scale_mult)
    add_child(tree)
    _animated_plants.append(tree)
    var trunk := _mesh_box("Trunk", Vector3(0.0, 1.0, 0.0), Vector3(0.6, 2.0, 0.6), Color("8a5a3f"))
    tree.add_child(trunk)
    # Lit side of the trunk brighter, shadow side darker: the key light defines
    # the cylinder's form instead of leaving it a flat brown stick.
    var trunk_light := _mesh_box("TrunkLight", Vector3(-0.2, 1.0, 0.0), Vector3(0.28, 2.0, 0.6), Color("a9795c"))
    trunk_light.material_override = _material(Color("a9795c"))
    tree.add_child(trunk_light)
    for tier in range(3):
        var crown := MeshInstance3D.new()
        var mesh := PrismMesh.new()
        mesh.size = Vector3(3.4 - tier * 0.6, 1.5, 3.0 - tier * 0.5)
        crown.mesh = mesh
        crown.position.y = 2.2 + float(tier) * 0.95
        crown.rotation.y = float(tier) * 0.4
        # Foliage value tiers: lowest tier darkest (shadowed underside), upper
        # tiers brighter (sun-facing) — the cone reads as volumetric, not flat.
        var tier_color := crown_color.darkened(0.18 - 0.06 * float(tier))
        crown.material_override = _material(tier_color.lightened(0.04 * float(tier)))
        tree.add_child(crown)
    # Trunk collision so the player can't pass through trees.
    var body := StaticBody3D.new()
    var cs := CollisionShape3D.new()
    var cyl := CylinderShape3D.new()
    cyl.radius = 0.42
    cyl.height = 1.8
    cs.shape = cyl
    cs.position = Vector3(0.0, 0.9, 0.0)
    body.add_child(cs)
    tree.add_child(body)

func _add_shrub(node_pos: Vector3, node_name: String) -> void:
    _add_ground_shadow(node_pos, 1.0, 0.85, 0.42)
    var shrub := Node3D.new()
    shrub.name = node_name
    shrub.position = node_pos
    add_child(shrub)
    _animated_plants.append(shrub)
    for i in range(5):
        var ball := MeshInstance3D.new()
        var sm := SphereMesh.new()
        sm.radius = 0.28
        sm.height = 0.5
        ball.mesh = sm
        ball.position = Vector3((i - 2) * 0.4, 0.3, (i % 3) * 0.3)
        ball.material_override = _material(Color("7cb56f"))
        shrub.add_child(ball)
    _obstacle(node_pos + Vector3(0.0, 0.3, 0.0), Vector3(1.6, 0.7, 1.2))

func _add_ice(position: Vector3, index: int) -> void:
    var ice := MeshInstance3D.new()
    ice.name = "IceFormation_%02d" % index
    var mesh := PrismMesh.new()
    mesh.size = Vector3(1.2, 3.0 + float(index % 2), 1.0)
    ice.mesh = mesh
    ice.position = position
    ice.rotation.y = float(index) * 0.7
    ice.material_override = _material(Color("a9dae8"), 0.15)
    add_child(ice)

func _add_crystal(position: Vector3, index: int) -> void:
    var crystal := MeshInstance3D.new()
    crystal.name = "DuskCrystal_%02d" % index
    var mesh := PrismMesh.new()
    mesh.size = Vector3(0.9, 2.6 + float(index % 2), 0.9)
    crystal.mesh = mesh
    crystal.position = position
    crystal.rotation.y = float(index) * 0.8
    crystal.material_override = _material(Color("a979df"), 0.3)
    add_child(crystal)

func _add_rock(position: Vector3, index: int, color: Color) -> void:
    _add_ground_shadow(position, 1.05, 0.9, 0.45)
    var rock := MeshInstance3D.new()
    rock.name = "Rock_%02d" % index
    var mesh := PrismMesh.new()
    mesh.size = Vector3(1.8, 1.1, 1.4)
    rock.mesh = mesh
    rock.position = position
    rock.rotation.y = float(index) * 0.8
    rock.material_override = _material(color)
    add_child(rock)
    _obstacle(position + Vector3(0.0, 0.4, 0.0), Vector3(1.6, 0.9, 1.3))

func _add_grass(position: Vector3, index: int, color: Color) -> void:
    var tuft := Node3D.new()
    tuft.name = "GrassTuft_%02d" % index
    tuft.position = position
    add_child(tuft)
    _animated_plants.append(tuft)
    for i in range(4):
        var blade := _mesh_box("Blade", Vector3((i - 2) * 0.18, 0.35, sin(float(i)) * 0.15), Vector3(0.12, 0.7 + float(i % 2) * 0.15, 0.12), color)
        blade.rotation.z = float(i - 2) * 0.12
        tuft.add_child(blade)

# Materialize gatherable resource nodes so the action button / gather_nearest()
# actually has targets. Each node carries its authoritative server id, wires into
# the "resource_nodes" group that Player3D scans, and shows a small floating glow
# marker so the player can see what is collectable. Positions sit on the walkable
# surface; server-node ids match src/astrix/state.ts seeds so gathering mutates
# authoritative state and follows the conflict-free GATHER flow.
func _build_resource_nodes() -> void:
    var specs := [
        {"id": "tree-meadow-002", "type": "wood", "pos": Vector3(22.8, MEADOW_SURFACE, 29.2), "color": Color("b9876a")},   # right beside spawn
        {"id": "tree-meadow-001", "type": "wood", "pos": Vector3(28.2, MEADOW_SURFACE, 31.8), "color": Color("c08a6a")},
        {"id": "rock-frost-001", "type": "stone", "pos": Vector3(31.6, MEADOW_SURFACE, 31.0), "color": Color("aab6c2")},  # by the path rock
        {"id": "crystal-dusk-001", "type": "crystal", "pos": Vector3(75.5, DUSK_SURFACE, 36.5), "color": Color("cf9ef0")},
        {"id": "water-source-001", "type": "water", "pos": Vector3(22.0, MEADOW_SURFACE, 38.0), "color": Color("7fb8e8")},  # shoreline
    ]
    for spec in specs:
        var node := ResourceNode3D.new()
        node.name = "ResourceNode_" + str(spec["id"])
        node.resource_id = spec["type"]
        node.server_node_id = spec["id"]
        node.amount = 1
        node.position = spec["pos"] + Vector3(0.0, 0.05, 0.0)
        node.add_to_group("resource_nodes")
        add_child(node)
        # Floating soft-glow pickup marker (visible, presentation-only).
        var marker := MeshInstance3D.new()
        var mm := PrismMesh.new()
        mm.size = Vector3(0.42, 0.7, 0.42)
        marker.mesh = mm
        marker.position = Vector3(0.0, 1.15, 0.0)
        marker.rotation.y = 0.6
        marker.material_override = _material(spec["color"], 0.45)
        node.add_child(marker)
        var halo := MeshInstance3D.new()
        var hm := SphereMesh.new()
        hm.radius = 0.34
        hm.height = 0.5
        halo.mesh = hm
        halo.position = Vector3(0.0, 1.15, 0.0)
        halo.material_override = _material((spec["color"] as Color).lightened(0.3), 0.3)
        node.add_child(halo)

func _build_decor() -> void:
    # Three decorative trees around the far meadow so the space doesn't feel bare.
    _add_tree(Vector3(31.0, 0.0, 41.0), MEADOW_SURFACE, 92, Color("a5d873"))
    _add_grass(Vector3(33.0, MEADOW_SURFACE, 43.0), 90, Color("89cd97"))
    _add_grass(Vector3(11.0, MEADOW_SURFACE, 23.0), 91, Color("89cd97"))

func _on_astrix_state_received(state: Dictionary) -> void:
    var world_state := get_node_or_null("/root/WorldState")
    if world_state:
        world_state.apply_snapshot(state)

func _build_systems() -> void:
    var building_system := Node3D.new()
    building_system.name = "BuildingSystem"
    building_system.set_script(load("res://scripts/BuildingSystem.gd"))
    add_child(building_system)
    var console := CanvasLayer.new()
    console.name = "AgentConsole"
    console.set_script(load("res://scripts/AgentConsole.gd"))
    add_child(console)
    var approval := CanvasLayer.new()
    approval.name = "ApprovalGate"
    approval.set_script(load("res://scripts/ApprovalGate.gd"))
    add_child(approval)
    var hud := CanvasLayer.new()
    hud.name = "MobileHUD"
    hud.set_script(load("res://scripts/MobileHUD.gd"))
    add_child(hud)

func _build_player() -> void:
    player = AstrixPlayer3D.new()
    player.name = "Player"
    player.position = Vector3(22.0, MEADOW_SURFACE + 1.0, 30.0)
    add_child(player)
    companion = Companion3D.new()
    companion.name = "Companion"
    companion.position = player.position + Vector3(-2.0, 0.0, 1.5)
    companion.target = player
    add_child(companion)

func _build_camera() -> void:
    camera = Camera3D.new()
    camera.name = "IsometricCamera"
    camera.projection = Camera3D.PROJECTION_ORTHOGONAL
    camera.position = player.global_position + CAMERA_OFFSET
    add_child(camera)
    _apply_camera_framing()
    camera.look_at(player.global_position + Vector3(0.0, CAMERA_LOOK_HEIGHT, CAMERA_LOOK_AHEAD), Vector3.UP)
    camera.current = true
    # Re-framing on rotation/resize keeps the player a clear anchor on tablets.
    get_viewport().size_changed.connect(_on_viewport_resized)


func _on_viewport_resized() -> void:
    _apply_camera_framing()

# Keep the player a readable size on both landscape (desktop) and portrait
# (mobile) viewports while showing the clearing, shoreline and bridge landmarks.
# Portrait/tall screens get a SMALLER ortho size (more zoom) so the player stays
# a clear anchor instead of floating tiny in a huge frame.
func _apply_camera_framing() -> void:
    var vp := get_viewport()
    if not vp:
        return
    var size := vp.get_visible_rect().size
    var aspect := size.x / maxf(1.0, size.y)
    _portrait = aspect < 1.05
    # Portrait zooms out slightly (13 vs 12) with a narrower x-offset and longer
    # look-ahead so the player anchor AND the beacon destination both stay on
    # screen; landscape keeps the fuller clearing view.
    camera.size = 13.0 if _portrait else 12.0

# Grounding contact shadow: a tight dark disc at the object's base plus a wider,
# fainter disc that softens outward. This is what makes props visibly TOUCH the
# terrain instead of floating. Presentation-only.
func _add_ground_shadow(center: Vector3, radius_x: float, radius_z: float, strength: float = 0.45) -> void:
    var group := Node3D.new()
    group.name = "GroundShadow"
    group.position = center + Vector3(0.0, 0.03, 0.0)
    for layer in [
        {"r": 1.0, "a": strength},                # tight core
        {"r": 1.55, "a": strength * 0.42},        # soft outer falloff
    ]:
        var disc := MeshInstance3D.new()
        var mesh := CylinderMesh.new()
        mesh.top_radius = radius_x * layer["r"]
        mesh.bottom_radius = radius_x * layer["r"]
        mesh.height = 0.02
        disc.mesh = mesh
        disc.scale.z = radius_z / maxf(0.01, radius_x)
        disc.material_override = _ground_shadow_material(layer["a"])
        group.add_child(disc)
    add_child(group)

func _ground_shadow_material(alpha: float) -> StandardMaterial3D:
    var material := StandardMaterial3D.new()
    material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
    material.albedo_color = Color(0.10, 0.07, 0.09, alpha)
    material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
    material.roughness = 1.0
    return material

func _mesh_box(node_name: String, position: Vector3, size: Vector3, color: Color) -> MeshInstance3D:
    var node := MeshInstance3D.new()
    node.name = node_name
    var mesh := BoxMesh.new()
    mesh.size = size
    node.mesh = mesh
    node.position = position
    node.material_override = _material(color)
    return node

func _material(color: Color, emission_energy: float = 0.0) -> StandardMaterial3D:
    var material := StandardMaterial3D.new()
    material.albedo_color = color
    # Roughness 0.82 keeps the matte pastel look while letting the directional
    # key produce gentle specular response on lit faces (form without gloss).
    material.roughness = 0.82
    if emission_energy > 0.0:
        material.emission_enabled = true
        material.emission = color
        material.emission_energy_multiplier = emission_energy
    return material