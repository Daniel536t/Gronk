extends Node3D
## ASTrix Phase 1 world presentation. The world is procedural and modular so
## authored voxel assets can replace individual categories later.

const WORLD_SIZE := Vector2(100.0, 60.0)
const CELL := 2.0
const ISLANDS := {
    "meadow": {"center": Vector3(22.0, 0.0, 30.0), "radius": Vector2(19.0, 17.0), "top": 3.0, "color": Color("9fcf91"), "accent": Color("ed9dcc")},
    "frost": {"center": Vector3(50.0, 0.0, 14.0), "radius": Vector2(18.0, 12.0), "top": 4.0, "color": Color("d8eef0"), "accent": Color("9bd9ef")},
    "dusk": {"center": Vector3(76.0, 0.0, 39.0), "radius": Vector2(19.0, 16.0), "top": 2.5, "color": Color("d6aa91"), "accent": Color("a979df")},
}
const CAMERA_SMOOTH := 5.5
const CAMERA_SIZE := 34.0
const CAMERA_HEIGHT := 55.0

var player: AstrixPlayer3D
var companion: Companion3D
var camera: Camera3D
var _camera_target := Vector3(50.0, 0.0, 30.0)
var _animated_water: Array[MeshInstance3D] = []
var _animated_plants: Array[Node3D] = []
var _time := 0.0

func _ready() -> void:
    var world_state := get_node_or_null("/root/WorldState")
    if world_state:
        world_state.resource_nodes.clear()
    GameClient.astrix_state_received.connect(_on_astrix_state_received)
    _build_environment()
    _build_water()
    _build_islands()
    _build_bridges()
    _build_paths()
    _build_decor()
    _build_player()
    _build_camera()
    _build_systems()

func _process(delta: float) -> void:
    _time += delta
    if is_instance_valid(camera) and is_instance_valid(player):
        _camera_target = player.position
        _camera_target.y = 0.0
        var k := 1.0 - exp(-CAMERA_SMOOTH * delta)
        camera.position.x = lerp(camera.position.x, _camera_target.x, k)
        camera.position.z = lerp(camera.position.z, _camera_target.z, k)
        camera.look_at(Vector3(camera.position.x, 0.0, camera.position.z), Vector3.FORWARD)
    for i in range(_animated_water.size()):
        _animated_water[i].position.y = -0.45 + sin(_time * 0.8 + float(i) * 0.45) * 0.035
    for i in range(_animated_plants.size()):
        _animated_plants[i].rotation.z = sin(_time * 0.55 + float(i) * 1.3) * 0.025

func _build_environment() -> void:
    var environment := WorldEnvironment.new()
    var settings := Environment.new()
    settings.background_mode = Environment.BG_COLOR
    settings.background_color = Color("9cc6d2")
    settings.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
    settings.ambient_light_color = Color("d7e8df")
    settings.ambient_light_energy = 0.68
    settings.tonemap_mode = Environment.TONE_MAPPER_FILMIC
    environment.environment = settings
    add_child(environment)
    var sun := DirectionalLight3D.new()
    sun.name = "WarmMeadowSun"
    sun.rotation_degrees = Vector3(-52.0, -35.0, 0.0)
    sun.light_color = Color("fff0cf")
    sun.light_energy = 1.15
    sun.shadow_enabled = true
    sun.directional_shadow_max_distance = 140.0
    add_child(sun)

func _build_water() -> void:
    var water := MeshInstance3D.new()
    water.name = "PurpleTealWater"
    var mesh := PlaneMesh.new()
    mesh.size = WORLD_SIZE + Vector2(16.0, 16.0)
    water.mesh = mesh
    water.rotation_degrees.x = -90.0
    water.position = Vector3(50.0, -0.5, 30.0)
    var material := _material(Color("776fbd"), 0.08)
    material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
    material.albedo_color.a = 0.82
    water.material_override = material
    add_child(water)
    _animated_water.append(water)

func _build_islands() -> void:
    for biome_id in ISLANDS:
        var data: Dictionary = ISLANDS[biome_id]
        _add_island_slabs(biome_id, data)
        _add_biome_features(biome_id, data)

func _add_island_slabs(biome_id: String, data: Dictionary) -> void:
    var center: Vector3 = data["center"]
    var radius: Vector2 = data["radius"]
    var top: float = data["top"]
    var base := _mesh_box("%s_StoneBase" % biome_id, center + Vector3(0.0, 0.0, 0.0), Vector3(radius.x * 2.0, 1.0, radius.y * 2.0), Color("77828d"))
    base.rotation.y = 0.12
    var middle := _mesh_box("%s_SoilStep" % biome_id, center + Vector3(0.0, 0.8, 0.0), Vector3(radius.x * 1.86, 1.6, radius.y * 1.86), data["color"])
    middle.rotation.y = -0.08
    var top_mesh := _mesh_box("%s_GrassTop" % biome_id, center + Vector3(0.0, top - 0.2, 0.0), Vector3(radius.x * 1.68, 1.0, radius.y * 1.68), data["color"])
    top_mesh.rotation.y = 0.05
    if biome_id == "frost":
        _mesh_box("FrostSnowCap", center + Vector3(0.0, top + 0.45, 0.0), Vector3(radius.x * 1.38, 0.25, radius.y * 1.38), Color("f3fbf4"))
    elif biome_id == "dusk":
        _mesh_box("DuskSandCap", center + Vector3(0.0, top + 0.38, 0.0), Vector3(radius.x * 1.42, 0.18, radius.y * 1.42), Color("e4bd9b"))

func _add_biome_features(biome_id: String, data: Dictionary) -> void:
    var c: Vector3 = data["center"]
    if biome_id == "meadow":
        for i in range(6):
            _add_tree(c + Vector3(-12.0 + float(i % 3) * 11.0, 2.8, -7.0 + float(i / 3) * 12.0), i, data["accent"])
        for i in range(8):
            _add_grass(c + Vector3(-14.0 + float(i % 4) * 8.0, 3.4, -10.0 + float(i / 4) * 13.0), i, Color("8ccf9a"))
    elif biome_id == "frost":
        for i in range(5):
            _add_ice(c + Vector3(-10.0 + float(i % 3) * 10.0, 4.5, -5.0 + float(i / 3) * 8.0), i)
        for i in range(4):
            _add_rock(c + Vector3(-11.0 + float(i) * 7.0, 4.2, 5.0), i, Color("a8c4d4"))
    else:
        for i in range(5):
            _add_crystal(c + Vector3(-10.0 + float(i % 3) * 10.0, 3.2, -5.0 + float(i / 3) * 9.0), i)
        for i in range(4):
            _add_rock(c + Vector3(-10.0 + float(i) * 7.0, 3.0, 6.0), i, Color("ae887e"))

func _build_bridges() -> void:
    _add_bridge("MeadowToFrost", Vector3(36.0, 2.1, 24.0), 0.45)
    _add_bridge("MeadowToDusk", Vector3(48.0, 2.0, 34.0), -0.75)

func _add_bridge(node_name: String, center: Vector3, angle: float) -> void:
    var bridge := Node3D.new()
    bridge.name = node_name
    bridge.position = center
    bridge.rotation.y = angle
    add_child(bridge)
    for i in range(7):
        var plank := _mesh_box("Plank_%02d" % i, Vector3(float(i - 3) * 1.0, 0.0, 0.0), Vector3(0.86, 0.3, 4.2), Color("a9795c"))
        bridge.add_child(plank)
    for z in [-2.15, 2.15]:
        var rail := _mesh_box("Rail", Vector3(0.0, 1.0, z), Vector3(7.4, 1.1, 0.22), Color("825741"))
        bridge.add_child(rail)

func _build_paths() -> void:
    _mesh_box("MeadowClearing", Vector3(22.0, 3.58, 30.0), Vector3(12.0, 0.12, 9.0), Color("d8b083"))
    _mesh_box("MeadowPath", Vector3(25.0, 3.65, 30.0), Vector3(25.0, 0.12, 2.6), Color("c99a70"))
    _mesh_box("FrostPath", Vector3(50.0, 4.65, 14.0), Vector3(3.0, 0.12, 16.0), Color("c9dde0"))
    _mesh_box("DuskPath", Vector3(76.0, 3.1, 39.0), Vector3(20.0, 0.12, 2.8), Color("c48b78"))

func _build_decor() -> void:
    _add_rock(Vector3(12.0, 3.5, 36.0), 0, Color("909ba6"))
    _add_rock(Vector3(31.0, 3.5, 21.0), 1, Color("909ba6"))

func _add_tree(position: Vector3, index: int, crown_color: Color) -> void:
    var tree := Node3D.new()
    var resource_node := ResourceNode3D.new()
    resource_node.resource_id = "wood"
    resource_node.amount = 1
    resource_node.add_to_group("resource_nodes")
    resource_node.position = Vector3.ZERO
    tree.add_child(resource_node)
    tree.name = "MeadowTree_%02d" % index
    tree.position = position
    add_child(tree)
    _animated_plants.append(tree)
    var trunk := _mesh_box("Trunk", Vector3(0.0, 1.1, 0.0), Vector3(0.65, 2.2, 0.65), Color("9a745c"))
    tree.add_child(trunk)
    for tier in range(3):
        var crown := MeshInstance3D.new()
        var mesh := PrismMesh.new()
        mesh.size = Vector3(3.8 - tier * 0.7, 1.4, 3.4 - tier * 0.55)
        crown.mesh = mesh
        crown.position.y = 2.2 + float(tier) * 0.85
        crown.rotation.y = float(tier) * 0.35
        crown.material_override = _material(crown_color.lightened(0.05 * float(tier)))
        tree.add_child(crown)

func _add_ice(position: Vector3, index: int) -> void:
    var ice := MeshInstance3D.new()
    ice.name = "IceFormation_%02d" % index
    var mesh := PrismMesh.new()
    mesh.size = Vector3(1.2, 3.0 + float(index % 2), 1.0)
    ice.mesh = mesh
    ice.position = position
    ice.rotation.y = float(index) * 0.7
    ice.material_override = _material(Color("a9e5ef"), 0.12)
    add_child(ice)

func _add_crystal(position: Vector3, index: int) -> void:
    var crystal := MeshInstance3D.new()
    crystal.name = "DuskCrystal_%02d" % index
    var mesh := PrismMesh.new()
    mesh.size = Vector3(0.9, 2.6 + float(index % 2), 0.9)
    crystal.mesh = mesh
    crystal.position = position
    crystal.rotation.y = float(index) * 0.8
    crystal.material_override = _material(Color("a979df"), 0.24)
    add_child(crystal)

func _add_rock(position: Vector3, index: int, color: Color) -> void:
    var rock_resource := ResourceNode3D.new()
    rock_resource.resource_id = "stone"
    rock_resource.amount = 1
    rock_resource.add_to_group("resource_nodes")
    rock_resource.position = position
    add_child(rock_resource)
    var rock := MeshInstance3D.new()
    rock.name = "Rock_%02d" % index
    var mesh := PrismMesh.new()
    mesh.size = Vector3(2.0, 1.1, 1.6)
    rock.mesh = mesh
    rock.position = position
    rock.rotation.y = float(index) * 0.8
    rock.material_override = _material(color)
    add_child(rock)

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

func _on_astrix_state_received(state: Dictionary) -> void:
    var remote_buildings: Array = state.get("buildings", [])
    var world_state := get_node_or_null("/root/WorldState")
    if world_state:
        world_state.day = int(state.get("day", world_state.day))
        world_state.food = int(state.get("food", world_state.food))
        var remote_resources: Variant = state.get("resources", {})
        if remote_resources is Dictionary:
            for key in remote_resources:
                world_state.resources[str(key)] = int(remote_resources[key])
        world_state.buildings.clear()
        for building in remote_buildings:
            if building is Dictionary:
                world_state.buildings[str(building.get("id", "building"))] = building.duplicate(true)

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

func _build_player() -> void:
    player = AstrixPlayer3D.new()
    player.name = "Player"
    player.position = Vector3(22.0, 3.65, 30.0)
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
    camera.size = CAMERA_SIZE
    camera.position = Vector3(50.0, CAMERA_HEIGHT, 67.0)
    add_child(camera)
    camera.look_at(Vector3(50.0, 0.0, 30.0), Vector3.UP)
    camera.current = true

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
    material.roughness = 0.88
    if emission_energy > 0.0:
        material.emission_enabled = true
        material.emission = color
        material.emission_energy_multiplier = emission_energy
    return material
