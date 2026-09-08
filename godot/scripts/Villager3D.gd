extends Node3D
class_name AstrixVillager
## A villager: the visual representation of ONE unit of Core's authoritative
## `population`. Presentation only — this node never creates, destroys or
## modifies authoritative population. World3D spawns/frees villagers so the
## rendered count always equals `WorldState.population`.
##
## Population = people, and the audience has to SEE the people. So this is a
## real articulated figure — legs, torso, arms, head, hair, clothing, a role
## accessory — with walk / idle / work animation, not a coloured cylinder.
##
## Behaviour is a deterministic patrol between authoritative anchors (buildings,
## plaza) with a per-villager seed. The walking is COSMETIC; the number of
## villagers and which anchors exist are authoritative.
##
## WHAT IS AUTHORITATIVE, WHAT IS NOT
##   authoritative: how many villagers exist (`population`), which island they
##     are on (they are only ever routed inside ONE island's anchor set), which
##     structures and resource nodes their anchors stand on, whether the world
##     clock is advancing, the season.
##   presentation:  the gait, the stride phase, which anchor comes next.
## Core has no per-villager entity, so this node never claims one: no villager
## has an identity, a job record, a destination outside its island, or cargo it
## moved from somewhere else.
##
## Two rules follow from that, and both are enforced below rather than by
## convention:
##   1. `work` animation only plays at an anchor that carries an authoritative
##      thing to work on (a crop, a resource node). At every other anchor the
##      villager simply pauses. Bending over an empty patch of grass is a claim
##      that farming is happening where Core says nothing is.
##   2. When authoritative world time is HELD (the steward is awaiting a human
##      decision), villagers stop travelling and working and hold at idle. A
##      village that keeps bustling through a frozen clock tells the viewer the
##      world is progressing when it is not.


enum Role { FARMER, BUILDER, CARRIER }

const WALK_SPEED := 1.55
## Metres/second^2. Reaching full stride over ~0.5s (and stopping over ~0.35s)
## is what removes the teleport-in/teleport-out quality of a constant-velocity
## walk, and it costs one lerp per frame.
const ACCEL := 3.1
const DECEL := 4.4
## Distance at which the villager starts braking, so the stop lands ON the anchor
## instead of overshooting it and snapping back.
const BRAKE_RADIUS := 1.3
const ARRIVE_RADIUS := 0.6
const WORK_SECONDS := 4.0
## Pause at an anchor that holds nothing authoritative to work on: the villager
## stands, looks around, moves on. Shorter than WORK_SECONDS because standing
## still with no reason to is not the story.
const IDLE_SECONDS := 1.6
## Scaled so a villager is ~2.15 units tall against 1.95-unit house walls: at the
## observatory ortho height that is ~52 screen px, which reads as a person.
## At 1.0 they measured 29px and review reported them as unreadable pawns; at
## 1.16 they were still called "tiny" and confused with signposts.
const BODY_SCALE := 1.38

var role: int = Role.FARMER
var seed_index: int = 0
## Waypoints as {"pos": Vector3, "work": String}. `work` is "" when Core places
## nothing workable at that anchor, "crop" at a farm that authoritatively holds
## crops, "gather" at an authoritative resource node.
var route: Array[Dictionary] = []

var _rig: Node3D
var _hip: Node3D
var _torso: Node3D
var _leg_l: Node3D
var _leg_r: Node3D
var _arm_l: Node3D
var _arm_r: Node3D
var _head: Node3D
var _tool: Node3D
var _carried: Node3D
var _cloak: MeshInstance3D
var _phase := 0.0
var _target := 0
var _work_timer := 0.0
var _working := false
## "crop" or "gather" — which authoritative thing the current anchor holds, and
## therefore which work motion is truthful here.
var _work_kind := ""
var _speed := 0.0
var _speed_blend := 0.0
## Mirrors whether AUTHORITATIVE world time is advancing (World3D reads it from
## the steward's LoopState). Defaults true so an offline fixture render is not a
## frozen tableau.
var _world_live := true
var _rng := RandomNumberGenerator.new()

const TUNIC := {
    Role.FARMER: AstrixPalette.TUNIC_FARMER,
    Role.BUILDER: AstrixPalette.TUNIC_BUILDER,
    Role.CARRIER: AstrixPalette.TUNIC_CARRIER,
}

func setup(villager_role: int, index: int, waypoints: Array[Dictionary]) -> void:
    role = villager_role
    seed_index = index
    route = waypoints.duplicate()
    _rng.seed = 9001 + index * 7919
    # Deterministic stride offset so the group never marches in lockstep.
    _phase = float(index) * 1.37
    _target = index % maxi(1, route.size())
    if route.size() > 0:
        global_position = _waypoint((index + 1) % route.size())
    _build()

## Position of a waypoint, tolerant of an empty route.
func _waypoint(index: int) -> Vector3:
    if route.is_empty():
        return global_position
    var entry: Dictionary = route[index % route.size()]
    return entry.get("pos", global_position)

## What Core authoritatively places at a waypoint: "crop", "gather", or "".
func _waypoint_work(index: int) -> String:
    if route.is_empty():
        return ""
    return str((route[index % route.size()] as Dictionary).get("work", ""))

## World3D calls this whenever the authoritative clock changes between advancing
## and held. Presentation-only: it never touches world state, it only stops this
## figure from implying activity that is not occurring.
func set_world_live(live: bool) -> void:
    if live == _world_live:
        return
    _world_live = live
    if not live:
        # Drop the in-progress errand rather than resuming it mid-stride later:
        # the pause must read as a pause, not as a stutter.
        _work_timer = 0.0
        _working = false
        _speed = 0.0

# ---------------------------------------------------------------------------
# RIG
# ---------------------------------------------------------------------------
func _build() -> void:
    _rig = Node3D.new()
    _rig.name = "Rig"
    _rig.scale = Vector3(BODY_SCALE, BODY_SCALE, BODY_SCALE)
    add_child(_rig)

    var tunic: Color = TUNIC.get(role, AstrixPalette.TUNIC_FARMER)

    # Hip pivot: legs hang from it, torso stacks on it. Bobbing the hip moves
    # the whole body as one, which is what makes the walk read as a body.
    _hip = Node3D.new()
    _hip.position = Vector3(0.0, 0.46, 0.0)
    _rig.add_child(_hip)

    _leg_l = _limb(_hip, Vector3(-0.11, 0.0, 0.0), Vector3(0.15, 0.46, 0.16), AstrixPalette.TROUSERS)
    _leg_r = _limb(_hip, Vector3(0.11, 0.0, 0.0), Vector3(0.15, 0.46, 0.16), AstrixPalette.TROUSERS)
    # Boots, so the feet have weight and the stride lands.
    _leg_l.get_child(0).add_child(AstrixMesh.box("BootL", Vector3(0.18, 0.11, 0.24), Vector3(0.0, -0.22, 0.03), AstrixPalette.BARK_DARK))
    _leg_r.get_child(0).add_child(AstrixMesh.box("BootR", Vector3(0.18, 0.11, 0.24), Vector3(0.0, -0.22, 0.03), AstrixPalette.BARK_DARK))

    _torso = Node3D.new()
    _torso.position = Vector3(0.0, 0.0, 0.0)
    _hip.add_child(_torso)
    # Tapered chest: wider at the shoulders than the waist.
    _torso.add_child(AstrixMesh.box("Waist", Vector3(0.36, 0.2, 0.24), Vector3(0.0, 0.1, 0.0), tunic.darkened(0.1)))
    _torso.add_child(AstrixMesh.box("Chest", Vector3(0.44, 0.36, 0.27), Vector3(0.0, 0.36, 0.0), tunic))
    _torso.add_child(AstrixMesh.box("Belt", Vector3(0.4, 0.07, 0.27), Vector3(0.0, 0.19, 0.0), AstrixPalette.BARK_DARK))
    _torso.add_child(AstrixMesh.box("Buckle", Vector3(0.09, 0.07, 0.03), Vector3(0.0, 0.19, 0.145), AstrixPalette.THATCH))
    _torso.add_child(AstrixMesh.box("Shoulders", Vector3(0.5, 0.1, 0.28), Vector3(0.0, 0.53, 0.0), tunic.darkened(0.16)))

    _arm_l = _limb(_torso, Vector3(-0.28, 0.5, 0.0), Vector3(0.11, 0.42, 0.12), tunic.darkened(0.06))
    _arm_r = _limb(_torso, Vector3(0.28, 0.5, 0.0), Vector3(0.11, 0.42, 0.12), tunic.darkened(0.06))
    # Hands read as separate from the sleeve.
    _arm_l.get_child(0).add_child(AstrixMesh.box("HandL", Vector3(0.12, 0.12, 0.13), Vector3(0.0, -0.24, 0.0), AstrixPalette.SKIN))
    _arm_r.get_child(0).add_child(AstrixMesh.box("HandR", Vector3(0.12, 0.12, 0.13), Vector3(0.0, -0.24, 0.0), AstrixPalette.SKIN))

    # Head with hair, face and a visible nose: facing direction is unambiguous.
    _head = Node3D.new()
    _head.position = Vector3(0.0, 0.62, 0.0)
    _torso.add_child(_head)
    _head.add_child(AstrixMesh.box("Skull", Vector3(0.28, 0.28, 0.26), Vector3(0.0, 0.14, 0.0), AstrixPalette.SKIN))
    _head.add_child(AstrixMesh.box("Hair", Vector3(0.31, 0.11, 0.29), Vector3(0.0, 0.27, -0.01), AstrixPalette.HAIR))
    _head.add_child(AstrixMesh.box("HairBack", Vector3(0.3, 0.18, 0.07), Vector3(0.0, 0.17, -0.12), AstrixPalette.HAIR))
    _head.add_child(AstrixMesh.box("EyeL", Vector3(0.05, 0.05, 0.02), Vector3(-0.065, 0.16, 0.135), Color("2b2118")))
    _head.add_child(AstrixMesh.box("EyeR", Vector3(0.05, 0.05, 0.02), Vector3(0.065, 0.16, 0.135), Color("2b2118")))
    _head.add_child(AstrixMesh.box("Nose", Vector3(0.05, 0.06, 0.05), Vector3(0.0, 0.11, 0.15), AstrixPalette.SKIN.darkened(0.08)))

    _build_role_kit(tunic)
    _build_contact_shadow()

## The accessory turns "a person" into "a person doing a job" — readable at a
## glance, which is how population becomes an economy on screen.
func _build_role_kit(tunic: Color) -> void:
    _tool = Node3D.new()
    _torso.add_child(_tool)
    match role:
        Role.FARMER:
            # Straw hat: instantly reads as a farmer, including from above.
            _head.add_child(AstrixMesh.box("HatBrim", Vector3(0.46, 0.05, 0.46), Vector3(0.0, 0.3, 0.0), AstrixPalette.THATCH))
            _head.add_child(AstrixMesh.box("HatCrown", Vector3(0.24, 0.11, 0.24), Vector3(0.0, 0.36, 0.0), AstrixPalette.THATCH.darkened(0.12)))
            # Hoe carried at the side, blade near the ground.
            var shaft := AstrixMesh.box("HoeShaft", Vector3(0.045, 0.9, 0.045), Vector3(0.3, 0.28, 0.08), AstrixPalette.TIMBER_LIT)
            shaft.rotation_degrees.z = -12.0
            _tool.add_child(shaft)
            _tool.add_child(AstrixMesh.box("HoeBlade", Vector3(0.2, 0.06, 0.12), Vector3(0.42, -0.12, 0.08), AstrixPalette.ROCK))
        Role.CARRIER:
            # Basket held in front: the "carrying resources" silhouette.
            _carried = Node3D.new()
            _torso.add_child(_carried)
            _carried.add_child(AstrixMesh.box("Basket", Vector3(0.32, 0.24, 0.22), Vector3(0.0, 0.32, 0.28), AstrixPalette.TIMBER_LIT))
            _carried.add_child(AstrixMesh.box("BasketRim", Vector3(0.35, 0.05, 0.25), Vector3(0.0, 0.45, 0.28), AstrixPalette.TIMBER))
            _carried.add_child(AstrixMesh.blob("Grain", 0.13, Vector3(0.0, 0.46, 0.28), AstrixPalette.CROP_HARVEST, 6, 3))
        Role.BUILDER:
            # Plank over the shoulder + tool belt.
            var plank := AstrixMesh.box("Plank", Vector3(1.0, 0.08, 0.2), Vector3(0.1, 0.62, -0.02), AstrixPalette.TIMBER_LIT)
            plank.rotation_degrees.z = 8.0
            _tool.add_child(plank)
            _tool.add_child(AstrixMesh.box("Mallet", Vector3(0.1, 0.16, 0.1), Vector3(-0.24, 0.16, 0.16), AstrixPalette.TIMBER))

## Small dark contact quad directly under the feet. Real sun shadows do the
## heavy lifting; this only guarantees the figure never looks like it hovers.
## Kept tiny, alpha-blended and depth-write-off so it can never draw over a roof
## (the old build's oversized blob discs did exactly that).
func _build_contact_shadow() -> void:
    var shadow := AstrixMesh.ground_quad("Contact", Vector2(0.44, 0.32), Vector3(0.0, 0.02, 0.0),
        Color(0.08, 0.09, 0.12, 0.3), 1, true)
    var mat := shadow.material_override as StandardMaterial3D
    if mat:
        mat.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
    add_child(shadow)

## Limb with the pivot at the top (hip / shoulder), so rotation swings the limb.
func _limb(parent: Node3D, offset: Vector3, size: Vector3, color: Color) -> Node3D:
    var pivot := Node3D.new()
    pivot.position = offset
    parent.add_child(pivot)
    pivot.add_child(AstrixMesh.box("Limb", size, Vector3(0.0, -size.y * 0.5, 0.0), color))
    return pivot

# ---------------------------------------------------------------------------
# BEHAVIOUR (cosmetic patrol between authoritative anchors)
# ---------------------------------------------------------------------------
func _physics_process(delta: float) -> void:
    # AUTHORITATIVE GATE. While Core's clock is held, nothing in the world is
    # happening, so nothing here may look like it is. Idle breathing continues:
    # the villagers are still THERE, they are just not doing anything.
    if not _world_live:
        _speed = 0.0
        _animate(delta, 0.0)
        return
    if route.is_empty():
        _animate(delta, 0.0)
        return
    if _work_timer > 0.0:
        _work_timer -= delta
        _animate(delta, 0.0, _working)
        return
    var target: Vector3 = _waypoint(_target)
    var to_target := target - global_position
    to_target.y = 0.0
    var distance := to_target.length()
    if distance <= ARRIVE_RADIUS:
        # Arrive. Work only if Core actually puts something workable here;
        # otherwise pause briefly and move on. See rule 1 in the header.
        var work_kind := _waypoint_work(_target)
        _working = work_kind != ""
        _work_kind = work_kind
        var jitter := 0.6 + float((seed_index * 37) % 13) / 16.0
        _work_timer = (WORK_SECONDS if _working else IDLE_SECONDS) * jitter
        _speed = 0.0
        _target = (_target + 1) % route.size()
        return
    # Eased gait: accelerate away from an anchor, brake into the next one. The
    # animation blend already eased; the VELOCITY did not, so departures and
    # arrivals were instantaneous at full stride.
    var ceiling := WALK_SPEED * (clampf(distance / BRAKE_RADIUS, 0.18, 1.0) if distance < BRAKE_RADIUS else 1.0)
    _speed = move_toward(_speed, ceiling, (ACCEL if _speed < ceiling else DECEL) * delta)
    var dir := to_target.normalized()
    global_position += dir * _speed * delta
    global_position.y = target.y
    rotation.y = lerp_angle(rotation.y, atan2(dir.x, dir.z), minf(1.0, delta * 8.0))
    _animate(delta, _speed / WALK_SPEED)

## Walk / idle / work animation. Amplitudes are tuned to read at diorama zoom
## rather than up close, and blend so starts and stops are not instant.
func _animate(delta: float, moving: float, working: bool = false) -> void:
    _speed_blend = lerpf(_speed_blend, moving, minf(1.0, delta * 7.0))
    _phase += delta * lerpf(1.8, 8.2, _speed_blend)

    if working:
        # Two distinct motions, because the two authoritative things a villager
        # can stand at look nothing alike from a distance: tending a crop is a
        # low stoop over the ground, working a resource node is an upright swing.
        var gathering := _work_kind == "gather"
        var beat := sin(_phase * (3.1 if gathering else 2.4))
        if is_instance_valid(_torso):
            _torso.rotation_degrees.x = (8.0 + beat * 12.0) if gathering else (20.0 + beat * 7.0)
        if is_instance_valid(_arm_r):
            _arm_r.rotation_degrees.x = (-96.0 + beat * 62.0) if gathering else (-58.0 + beat * 30.0)
        if is_instance_valid(_arm_l):
            _arm_l.rotation_degrees.x = (-74.0 + beat * 48.0) if gathering else -22.0
        if is_instance_valid(_leg_l):
            _leg_l.rotation_degrees.x = 4.0
        if is_instance_valid(_leg_r):
            _leg_r.rotation_degrees.x = -6.0
        if is_instance_valid(_hip):
            _hip.position.y = 0.44
        return

    var swing := sin(_phase) * lerpf(2.5, 30.0, _speed_blend)
    if is_instance_valid(_leg_l):
        _leg_l.rotation_degrees.x = swing
    if is_instance_valid(_leg_r):
        _leg_r.rotation_degrees.x = -swing
    if is_instance_valid(_arm_l):
        _arm_l.rotation_degrees.x = -swing * 0.62
    if is_instance_valid(_arm_r):
        _arm_r.rotation_degrees.x = swing * 0.62
    if is_instance_valid(_torso):
        # Lean into the walk; breathe when idle.
        _torso.rotation_degrees.x = lerpf(sin(_phase * 0.7) * 1.4, 7.0, _speed_blend)
        _torso.rotation_degrees.y = sin(_phase) * 3.0 * _speed_blend
    if is_instance_valid(_head):
        # Head counter-rotates slightly: secondary motion, cheap and effective.
        _head.rotation_degrees.y = -sin(_phase) * 4.0 * _speed_blend
    if is_instance_valid(_hip):
        _hip.position.y = 0.46 + absf(sin(_phase)) * lerpf(0.012, 0.06, _speed_blend)
    if is_instance_valid(_carried):
        _carried.position.y = absf(sin(_phase)) * 0.03 * _speed_blend

## Seasonal presentation: a winter cloak, so the cold reads on the inhabitants
## and not only on the terrain. Driven by the authoritative season.
func apply_season(season: String) -> void:
    var cold := season == "winter"
    if cold and _cloak == null and is_instance_valid(_torso):
        _cloak = AstrixMesh.box("Cloak", Vector3(0.52, 0.6, 0.16), Vector3(0.0, 0.36, -0.14), AstrixPalette.CLOAK_WINTER)
        _torso.add_child(_cloak)
    elif not cold and _cloak != null:
        _cloak.queue_free()
        _cloak = null
