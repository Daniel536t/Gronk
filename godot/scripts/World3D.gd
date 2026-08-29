extends Node3D
## ASTrix playable world. The world is procedural and modular so authored voxel
## assets can replace individual categories later. Terrain is assembled to a
## consistent "surface" height per biome so ground props, paths and bridges sit
## flush instead of floating; playable objects get simple StaticBody3D collision.

const WORLD_SIZE := Vector2(100.0, 60.0)

# Biome definitions. `top` is the grass-slab center height; the walkable surface
# is always `top + 0.3` (half-thickness 0.5 of the 1.0 GrassTop slab).
const ISLANDS := {
    "meadow": {"center": Vector3(22.0, 0.0, 30.0), "radius": Vector2(19.0, 17.0), "top": 3.0, "color": Color("9fce8f"), "accent": Color("ed9dcc")},
    "frost": {"center": Vector3(50.0, 0.0, 14.0), "radius": Vector2(18.0, 12.0), "top": 4.0, "color": Color("bad4e2"), "accent": Color("9bd9ef")},
    "dusk": {"center": Vector3(76.0, 0.0, 39.0), "radius": Vector2(19.0, 16.0), "top": 2.5, "color": Color("d0a086"), "accent": Color("a979df")},
}

# Walkable ground surfaces (grass-top top face per biome).
const MEADOW_SURFACE := 3.3
const FROST_SURFACE := 4.3
const DUSK_SURFACE := 2.8

# Isometric gameplay camera. A deliberate lower pitch (~32deg from horizontal)
# reveals object sides (tree trunks, cliff faces, bridge elevation, hut walls) so
# the world reads as a 2.5D miniature rather than a top-down bird's-eye view.
const CAMERA_OFFSET := Vector3(13.0, 14.5, 13.0)
const CAMERA_LOOK_HEIGHT := 0.8
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
    _build_player()
    _build_camera()
    _build_systems()

func _process(delta: float) -> void:
    _time += delta
    if is_instance_valid(camera) and is_instance_valid(player):
        # Constant iso offset: camera glides with the player, yaw never rolls.
        var target := player.global_position + CAMERA_OFFSET
        # Temporarily move the player up locally so the look_at yaw doesn't roll
        # with height; keep the constant iso offset for a stable diamond view.
        var focal := player.global_position + Vector3(0.0, CAMERA_LOOK_HEIGHT, CAMERA_LOOK_AHEAD)
        var k := 1.0 - exp(-CAMERA_SMOOTH * delta)
        camera.global_position = camera.global_position.lerp(target, k)
        camera.look_at(focal, Vector3.UP)
    for i in range(_animated_water.size()):
        _animated_water[i].position.y = _water_surface - 0.06 + sin(_time * 0.8 + float(i) * 0.45) * 0.035
    for i in range(_animated_plants.size()):
        var plant := _animated_plants[i]
        plant.rotation.z = sin(_time * 0.55 + float(i) * 1.3) * 0.025

# ---------------------------------------------------------------------------
# Lighting & environment — soft warm sun, gentle ambient, pastel sky, no blowout
# ---------------------------------------------------------------------------
func _build_environment() -> void:
    var environment := WorldEnvironment.new()
    var settings := Environment.new()
    settings.background_mode = Environment.BG_COLOR
    settings.background_color = Color("8fc4d4")          # soft pastel sky
    settings.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
    settings.ambient_light_color = Color("d6e6dc")
    settings.ambient_light_energy = 0.5
    settings.tonemap_mode = Environment.TONE_MAPPER_FILMIC
    settings.tonemap_exposure = 0.78
    settings.glow_enabled = false
    environment.environment = settings
    add_child(environment)

    var sun := DirectionalLight3D.new()
    sun.name = "WarmSun"
    sun.rotation_degrees = Vector3(-52.0, 40.0, 0.0)
    sun.light_color = Color("ffe9c9")                    # warm cream sun
    sun.light_energy = 0.5
    sun.shadow_enabled = true
    sun.directional_shadow_max_distance = 120.0
    sun.shadow_blur = 1.5
    add_child(sun)

# Readable stylized tea/cyan water with a semi-matte sheen and gentle motion.
var _water_surface := -0.2
func _build_water() -> void:
    var water := MeshInstance3D.new()
    water.name = "StylizedWater"
    var mesh := PlaneMesh.new()
    mesh.size = WORLD_SIZE + Vector2(20.0, 20.0)
    mesh.material = _water_material()
    water.mesh = mesh
    water.rotation_degrees.x = -90.0
    water.position = Vector3(50.0, _water_surface, 30.0)
    add_child(water)
    _animated_water.append(water)

func _water_material() -> StandardMaterial3D:
    var material := StandardMaterial3D.new()
    material.metallic = 0.0
    material.roughness = 0.25
    material.albedo_color = Color("53c0cd")
    material.albedo_color.a = 0.98
    return material

# ---------------------------------------------------------------------------
# Terrain
# ---------------------------------------------------------------------------
func _build_islands() -> void:
    for biome_id in ISLANDS:
        var data: Dictionary = ISLANDS[biome_id]
        _add_island_slabs(biome_id, data)
        _add_biome_features(biome_id, data)
        _add_island_floor(biome_id, data)
    # Flush the frost snow cap by raising its top slab height.
    _mesh_box("FrostSnowCap", Vector3(50.0, FROST_SURFACE + 0.2, 14.0), Vector3(ISLANDS["frost"]["radius"].x * 1.38, 0.3, ISLANDS["frost"]["radius"].y * 1.38), Color("dbeaf0")).rotation.y = 0.05

func _add_island_slabs(biome_id: String, data: Dictionary) -> void:
    var center: Vector3 = data["center"]
    var radius: Vector2 = data["radius"]
    var top: float = data["top"]
    var base := _mesh_box("%s_StoneBase" % biome_id, center + Vector3(0.0, 0.0, 0.0), Vector3(radius.x * 2.0, 1.0, radius.y * 2.0), Color("7a838c"))
    base.rotation.y = 0.12
    add_child(base)
    var middle := _mesh_box("%s_SoilStep" % biome_id, center + Vector3(0.0, 0.8, 0.0), Vector3(radius.x * 1.86, 1.6, radius.y * 1.86), data["color"].darkened(0.12))
    middle.rotation.y = -0.08
    add_child(middle)
    var top_mesh := _mesh_box("%s_GrassTop" % biome_id, center + Vector3(0.0, top - 0.2, 0.0), Vector3(radius.x * 1.68, 1.0, radius.y * 1.68), data["color"])
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
            _add_grass(c + Vector3(-15.0 + float(i % 5) * 7.0, s, -11.0 + float(i / 5) * 14.0), i, Color("89cd97"))
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
    # water and bridge. All flush with the meadow surface.
    add_child(_mesh_box("MeadowClearing", Vector3(22.0, MEADOW_SURFACE - 0.08, 30.0), Vector3(14.0, 0.16, 11.0), Color("d6ac7e")))
    add_child(_mesh_box("MeadowPath", Vector3(22.0, MEADOW_SURFACE - 0.05, 37.0), Vector3(3.6, 0.12, 12.0), Color("cd9a68")))
    add_child(_mesh_box("MeadowPath_South", Vector3(22.0, MEADOW_SURFACE - 0.05, 42.0), Vector3(3.0, 0.12, 4.0), Color("c08d5d")))
    add_child(_mesh_box("FrostPath", Vector3(50.0, FROST_SURFACE - 0.05, 14.0), Vector3(3.0, 0.12, 14.0), Color("c9dde0")))
    add_child(_mesh_box("DuskPath", Vector3(76.0, DUSK_SURFACE - 0.05, 39.0), Vector3(18.0, 0.12, 2.8), Color("c38976")))

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
    _add_rock(Vector3(31.5, s, 31.0), 80, Color("8f98a3"))

    # Southern shore, water edge + the bridge to the magic islet, all kept
    # close to spawn so the clearing -> path -> water -> bridge -> landmark
    # composition reads in a single camera frame next to the player.
    _build_shoreline(s)
    _build_bridge(s)
    _build_magic_islet(s + 0.5)

func _build_shoreline(s: float) -> void:
    for i in range(5):
        var x: float = 17.0 + float(i) * 2.4
        add_child(_mesh_box("ShoreSand_%d" % i, Vector3(x, s - 0.12, 38.2), Vector3(2.2, 0.2, 3.4), Color("e9c58f")))

# Walkable wooden deck flush with the meadow surface, bridging the shore to the
# magic islet. Planks carry their own StaticBody so the player crosses it.
func _build_bridge(s: float) -> void:
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
    add_child(_mesh_box("MagicIslet_Stone", Vector3(22.0, s - 3.4, 43.5), Vector3(8.0, 6.4, 8.0), Color("7a838c")))
    add_child(_mesh_box("MagicIslet_Top", Vector3(22.0, s - 0.22, 43.5), Vector3(7.0, 0.5, 7.0), Color("c9b690")))
    add_child(_mesh_box("MagicIslet_Grass", Vector3(22.0, s - 0.02, 43.5), Vector3(6.4, 0.1, 6.4), Color("8fcd8d")))

    # The magic landmark: a soft glowing obelisk.
    var obelisk := MeshInstance3D.new()
    obelisk.name = "MagicLandmark"
    var om := BoxMesh.new()
    om.size = Vector3(0.9, 4.6, 0.9)
    obelisk.mesh = om
    obelisk.position = Vector3(22.0, s + 2.3, 43.5)
    obelisk.material_override = _material(Color("7db8de"), 0.35)
    add_child(obelisk)
    var tip := MeshInstance3D.new()
    var tm := PrismMesh.new()
    tm.size = Vector3(1.3, 1.0, 1.3)
    tip.mesh = tm
    tip.position = Vector3(22.0, s + 4.9, 43.5)
    tip.material_override = _material(Color("9fe0e6"), 0.5)
    add_child(tip)
    var base := _mesh_box("LandmarkBase", Vector3(22.0, s + 0.35, 43.5), Vector3(2.2, 0.7, 2.2), Color("5e6f78"))
    base.material_override = _material(Color("5e6f78"))
    add_child(base)

func _build_hut(center: Vector3) -> void:
    var s := center.y
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
    var group := Node3D.new()
    group.name = "Bench"
    group.position = pos
    group.add_child(_mesh_box("BenchSeat", Vector3(0.0, 0.55, 0.0), Vector3(1.9, 0.2, 0.7), Color("b98a5f")))
    group.add_child(_mesh_box("BenchLegA", Vector3(-0.8, 0.25, 0.0), Vector3(0.2, 0.5, 0.6), Color("8a5a3f")))
    group.add_child(_mesh_box("BenchLegB", Vector3(0.8, 0.25, 0.0), Vector3(0.2, 0.5, 0.6), Color("8a5a3f")))
    add_child(group)
    _obstacle(pos + Vector3(0.0, 0.5, 0.0), Vector3(2.0, 0.6, 1.0))

func _add_crate(pos: Vector3) -> void:
    var box := _mesh_box("Crate", pos + Vector3(0.0, 0.55, 0.0), Vector3(1.1, 1.1, 1.1), Color("c2925f"))
    box.material_override = _material(Color("c2925f"))
    add_child(box)
    _obstacle(pos + Vector3(0.0, 0.55, 0.0), Vector3(1.1, 1.1, 1.1))

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

func _add_tree(position: Vector3, surface: float, index: int, crown_color: Color) -> void:
    var tree := Node3D.new()
    tree.name = "Tree_%02d" % index
    tree.position = Vector3(position.x, surface, position.z)
    add_child(tree)
    _animated_plants.append(tree)
    var trunk := _mesh_box("Trunk", Vector3(0.0, 1.0, 0.0), Vector3(0.6, 2.0, 0.6), Color("966a4e"))
    tree.add_child(trunk)
    for tier in range(3):
        var crown := MeshInstance3D.new()
        var mesh := PrismMesh.new()
        mesh.size = Vector3(3.4 - tier * 0.6, 1.5, 3.0 - tier * 0.5)
        crown.mesh = mesh
        crown.position.y = 2.2 + float(tier) * 0.95
        crown.rotation.y = float(tier) * 0.4
        crown.material_override = _material(crown_color.lightened(0.05 * float(tier)))
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
    # Tall (portrait) viewports get more zoom so the player stays a clear anchor;
    # wide (landscape) viewports show a little more world.
    camera.size = 11.5 if aspect < 1.05 else 13.5

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
    material.roughness = 0.9
    if emission_energy > 0.0:
        material.emission_enabled = true
        material.emission = color
        material.emission_energy_multiplier = emission_energy
    return material