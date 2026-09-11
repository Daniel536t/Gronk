extends CharacterBody3D
class_name AstrixPlayer3D
## Local presentation/controller layer. Movement is a thin, responsive wrapper
## around the shared AstrixInput actions; authoritative networking remains in
## the existing GameClient and is intentionally not rewritten here.

signal swimming_changed(is_swimming: bool)

@export var move_speed: float = 7.0
@export var run_multiplier: float = 1.5
@export var acceleration: float = 18.0
@export var deceleration: float = 24.0
@export var water_level: float = -0.05

var is_swimming: bool = false

var _visual: Node3D
var _body_group: Node3D        # animated (bob/lean/sway) part of the character
var _cape: MeshInstance3D       # cloak base that flares with motion
var _backpack: Node3D           # accessory that bobs with the body
var _shadow: MeshInstance3D
var _animation_time: float = 0.0
var _walk_phase := 0.0
var _idle_bob := 0.0
var _move_amount := 0.0
var _presentation_state := "idle"   # idle|walk|run|interact|hide|emerge|stun

# Presentation interface: a rigged GLB can drive these without touching
# GameClient/WorldState/server. Procedural visuals consume them directly.
func play_state(state: String) -> void:
    if state == _presentation_state:
        return
    _presentation_state = state
    # Stun freezes all procedural motion; emerge/hide control garment scale.
    match _presentation_state:
        "hide":
            if is_instance_valid(_cape): _cape.scale = Vector3(1.25, 1.25, 1.25)
        "emerge", "idle":
            if is_instance_valid(_cape): _cape.scale = Vector3.ONE
        "stun":
            _body_group.rotation.z = 0.5


func _ready() -> void:
    _visual = _build_visual()
    add_child(_visual)
    # The action button (and keyboard E) both emit interact_triggered through
    # AstrixInput; without this wiring the visible action button was inert.
    AstrixInput.interact_triggered.connect(_on_interact_triggered)

func _on_interact_triggered() -> void:
    gather_nearest()

func _physics_process(delta: float) -> void:
    var input_vector := AstrixInput.movement_vector()
    var running := AstrixInput.is_running()
    var speed := move_speed * (run_multiplier if running else 1.0)
    var desired := Vector3(input_vector.x, 0.0, input_vector.y) * speed
    var rate := acceleration if desired.length_squared() > 0.0 else deceleration
    velocity.x = move_toward(velocity.x, desired.x, rate * delta)
    velocity.z = move_toward(velocity.z, desired.z, rate * delta)
    move_and_slide()
    _update_swimming(delta)
    _animate(delta, desired)

## Gather from the nearest resource node.
##
## TRUST RULE (hardened): this function keeps NO inventory and credits NOTHING.
## An earlier version optimistically added the node's whole stock to a local
## ledger on request dispatch — a competing resource truth that disagreed with
## Core (which yields exactly 1 per action, only on success) and was never
## reconciled. The Observatory owns no quantities: the authoritative stock is
## Core's `resources`, rendered by the world and the HUD from snapshots. The
## return value reports dispatch only (`pending`), never ownership.
func gather_nearest(max_distance: float = 2.5) -> Dictionary:
    var nearest: ResourceNode3D
    var nearest_distance := max_distance
    for node in get_tree().get_nodes_in_group("resource_nodes"):
        if node is ResourceNode3D:
            var distance := global_position.distance_to(node.global_position)
            if distance < nearest_distance and not node.gathered:
                nearest = node
                nearest_distance = distance
    if not nearest:
        return {"ok": false, "error": "no resource nearby"}
    # Dispatch only. Ownership changes only when the server confirms, and the
    # confirmation path (ResourceNode3D._on_command_succeeded) updates the
    # WORLD, never a local ledger.
    return nearest.gather()

func _update_swimming(delta: float) -> void:
    var should_swim := global_position.y <= water_level
    if should_swim != is_swimming:
        is_swimming = should_swim
        swimming_changed.emit(is_swimming)
    if is_swimming:
        _animation_time += delta
        global_position.y = water_level + 0.12 + sin(_animation_time * 3.0) * 0.05
        _visual.scale.y = lerpf(_visual.scale.y, 0.86, delta * 5.0)
    else:
        _visual.scale.y = lerpf(_visual.scale.y, 1.0, delta * 5.0)

# Procedural animation: readable bob, stride and lean that scale with speed.
# Idle stays calm (breathing only) so a standing player never looks like walking.
func _animate(delta: float, desired: Vector3) -> void:
    _animation_time += delta
    var speed := Vector2(desired.x, desired.z).length()
    var is_moving := speed > 0.3
    _move_amount = lerpf(_move_amount, 1.0 if is_moving else 0.0, minf(1.0, delta * 6.0))
    var speed_factor := clampf(speed / move_speed, 0.0, 1.2)
    # Publish the readable presentation state (walk vs run) so an authored rig
    # can play a matching animation from the same entry point.
    if _presentation_state != "hide" and _presentation_state != "stun":
        if is_moving and speed >= move_speed * 0.98:
            play_state("run")
        elif is_moving:
            play_state("walk")
        else:
            play_state("idle")

    if is_moving:
        _walk_phase += delta * (4.0 + speed_factor * 6.0)
        # Body bob + forward lean that reads at gameplay zoom.
        _body_group.position.y = absf(sin(_walk_phase)) * 0.10 * (0.6 + speed_factor * 0.6)
        _body_group.rotation.x = lerp_angle(_body_group.rotation.x, 0.06 * speed_factor, minf(1.0, delta * 6.0))
        _body_group.rotation.z = sin(_walk_phase) * 0.05 * (0.5 + speed_factor * 0.5)
        # Cloak flares with speed; backpack sways opposite to the stride.
        if is_instance_valid(_cape):
            _cape.rotation.z = sin(_walk_phase) * 0.06 * (0.5 + speed_factor * 0.8)
        if is_instance_valid(_backpack):
            _backpack.position.y = 1.15 + absf(sin(_walk_phase + 0.4)) * 0.05
    else:
        _walk_phase = 0.0
        # Idle breathing: tiny torso lift only.
        _idle_bob = sin(_animation_time * 1.6) * 0.02
        _body_group.position.y = lerpf(_body_group.position.y, 0.0, minf(1.0, delta * 5.0))
        _body_group.rotation.x = lerp_angle(_body_group.rotation.x, _idle_bob * 0.5, minf(1.0, delta * 5.0))
        _body_group.rotation.z = lerp_angle(_body_group.rotation.z, 0.0, minf(1.0, delta * 5.0))

    # Face the direction of travel.
    if is_moving and Vector2(desired.x, desired.z).length() > 0.05:
        _visual.rotation.y = lerp_angle(_visual.rotation.y, atan2(velocity.x, velocity.z), minf(1.0, delta * 10.0))

    # Contact shadow stays glued just above the base of the character.
    if is_instance_valid(_shadow):
        _shadow.visible = not is_swimming
        _shadow.scale.x = lerpf(_shadow.scale.x, 0.8 + _move_amount * 0.35, delta * 6.0)
        _shadow.scale.z = _shadow.scale.x

func _build_visual() -> Node3D:
    var root := Node3D.new()
    root.name = "AstrixAdventurer"

    _body_group = Node3D.new()
    _body_group.name = "Animated"
    root.add_child(_body_group)

    # Body (hooded adventurer capsule silhouette, slightly exaggerated).
    # Deeper teal than the pale terrain so the protagonist pops as the anchor.
    var body := MeshInstance3D.new()
    var body_mesh := CapsuleMesh.new()
    body_mesh.radius = 0.58
    body_mesh.height = 1.7
    body.mesh = body_mesh
    body.position.y = 0.95
    body.material_override = _material(Color("5fb8a8"))
    _body_group.add_child(body)

    # Hood — warm coral-pink reads against both the teal body and the pale
    # ground, giving the head a clear focal silhouette.
    var hood := MeshInstance3D.new()
    var hood_mesh := CylinderMesh.new()
    hood_mesh.top_radius = 0.06
    hood_mesh.bottom_radius = 0.74
    hood_mesh.height = 1.0
    hood.mesh = hood_mesh
    hood.position.y = 2.0
    hood.material_override = _material(Color("e89ab8"))
    _body_group.add_child(hood)

    # Hood tip (directional readout gives the silhouette a point, not a bean).
    var tip := MeshInstance3D.new()
    var tip_mesh := PrismMesh.new()
    tip_mesh.size = Vector3(0.4, 0.5, 0.4)
    tip.mesh = tip_mesh
    tip.position = Vector3(0.0, 2.55, 0.05)
    tip.rotation.x = 0.15
    tip.material_override = _material(Color("e89ab8"))
    _body_group.add_child(tip)

    # Glowing eye — brighter so the face reads even at mobile size.
    var eye := MeshInstance3D.new()
    var eye_mesh := SphereMesh.new()
    eye_mesh.radius = 0.11
    eye_mesh.height = 0.22
    eye.mesh = eye_mesh
    eye.position = Vector3(0.0, 2.0, 0.62)
    eye.material_override = _material(Color("fff6c8"), 0.6)
    _body_group.add_child(eye)

    # Cloak base: a flared cone under the body that reads as a robe and gives
    # the silhouette a grounded, weighted hem instead of a floating capsule.
    _cape = MeshInstance3D.new()
    _cape.name = "CapeBase"
    var cape_mesh := CylinderMesh.new()
    cape_mesh.top_radius = 0.5
    cape_mesh.bottom_radius = 0.82
    cape_mesh.height = 0.9
    _cape.mesh = cape_mesh
    _cape.position.y = 0.5
    _cape.material_override = _material(Color("d87fa8"))
    _body_group.add_child(_cape)

    # Backpack accessory: reads at gameplay zoom, gives a traveller silhouette.
    _backpack = Node3D.new()
    _backpack.name = "Backpack"
    var pack := MeshInstance3D.new()
    var pack_mesh := BoxMesh.new()
    pack_mesh.size = Vector3(0.7, 0.8, 0.45)
    pack.mesh = pack_mesh
    pack.position = Vector3(-0.55, 1.15, 0.05)
    pack.rotation.y = 0.85
    pack.material_override = _material(Color("b9774a"))
    _backpack.add_child(pack)
    var strap := MeshInstance3D.new()
    var strap_mesh := BoxMesh.new()
    strap_mesh.size = Vector3(0.09, 1.3, 0.09)
    strap.mesh = strap_mesh
    strap.position = Vector3(0.42, 1.15, 0.18)
    strap.rotation.z = 0.25
    strap.material_override = _material(Color("8a5a3f"))
    _backpack.add_child(strap)
    _body_group.add_child(_backpack)

    # Contact shadow: tight dark core + wider soft falloff so the player visibly
    # anchors to the ground instead of hovering over the pale terrain.
    _shadow = MeshInstance3D.new()
    _shadow.name = "ContactShadow"
    var shadow_mesh := CylinderMesh.new()
    shadow_mesh.top_radius = 1.05
    shadow_mesh.bottom_radius = 1.05
    shadow_mesh.height = 0.03
    _shadow.mesh = shadow_mesh
    _shadow.position = Vector3(0.0, 0.04, 0.0)
    _shadow.material_override = _material(Color(0.04, 0.03, 0.05, 0.55))
    root.add_child(_shadow)
    var soft := MeshInstance3D.new()
    soft.name = "ContactShadowSoft"
    var soft_mesh := CylinderMesh.new()
    soft_mesh.top_radius = 1.6
    soft_mesh.bottom_radius = 1.6
    soft_mesh.height = 0.02
    soft.mesh = soft_mesh
    soft.position = Vector3(0.0, 0.035, 0.0)
    soft.material_override = _material(Color(0.04, 0.03, 0.05, 0.28))
    root.add_child(soft)

    return root

func _material(color: Color, emission_energy: float = 0.0) -> StandardMaterial3D:
    var material := StandardMaterial3D.new()
    material.albedo_color = color
    material.roughness = 0.82
    if emission_energy > 0.0:
        material.emission_enabled = true
        material.emission = color
        material.emission_energy_multiplier = emission_energy
    if color.a < 1.0:
        material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
    return material