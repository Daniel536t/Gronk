# tools/visual/render_glb.py — deterministic Blender asset turntable.
# Usage: blender --background --python tools/visual/render_glb.py -- <glb> <out.png>
# Camera fit to bounds, warm key + cool fill, transparent bg off (sky), fixed seed.
import bpy, sys, math, os

argv = sys.argv[sys.argv.index("--") + 1:]
GLB, OUT = argv[0], argv[1]
# optional: AZ deg (compass, 0 = -Y side) EL deg elevation, LENS mm
AZ = float(argv[2]) if len(argv) > 2 else -38.0
EL = float(argv[3]) if len(argv) > 3 else 24.0
LENS = float(argv[4]) if len(argv) > 4 else 50.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

# Blender is natively Z-up: rotate imports +90° about X (Y-up -> Z-up) and
# apply, so camera/up/lights behave normally. (An earlier revision skipped this
# and produced sideways-looking turntables — see iteration-01.)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.transform.rotate(value=math.pi / 2, orient_axis='X')
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.context.scene.objects:
    if o.type in ('MESH', 'LIGHT', 'CAMERA'):
        o.select_set(True)
bpy.context.view_layer.objects.active = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
bpy.ops.object.select_all(action='DESELECT')

# bounds
ws = [o.matrix_world @ v.co for o in bpy.context.scene.objects if o.type == 'MESH' for v in o.data.vertices]
xs = [v[0] for v in ws]; ys = [v[1] for v in ws]; zs = [v[2] for v in ws]
cx, cy, cz = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2
size = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))

# camera: 3/4 aerial from the door side (-Y after conversion); flat-wide assets
# (plaza, fields) need a higher eye or they read edge-on
sxz = max(max(xs) - min(xs), max(zs) - min(zs))
sy = max(ys) - min(ys)
high = sy < sxz * 0.4
hx, hy, hz = (0.9, 1.1, 1.1) if high else (1.1, 1.4, 0.75)
bpy.ops.object.camera_add(location=(
    cx + size * 1.35 * math.sin(math.radians(AZ)) * math.cos(math.radians(EL)),
    cy - size * 1.35 * math.cos(math.radians(AZ)) * math.cos(math.radians(EL)),
    cz + size * (0.55 + 1.15 * math.sin(math.radians(EL)))))
cam = bpy.context.active_object
cam.data.lens = LENS
t = bpy.data.objects.new("target", None)
bpy.context.collection.objects.link(t)
t.location = (cx, cy, cz)
track = cam.constraints.new('TRACK_TO')
track.target = t
bpy.context.scene.camera = cam

# lights: warm key upper-left-front-above (door side) + cool fill, no randomness
bpy.ops.object.light_add(type='SUN', location=(-8, -6, 10))
sun = bpy.context.active_object
sun.data.energy = 1.4
sun.data.color = (1.0, 0.98, 0.95)
bpy.ops.object.light_add(type='SUN', location=(7, 6, 4))
fill = bpy.context.active_object
fill.data.energy = 0.4
fill.data.color = (1.0, 1.0, 1.0)
if bpy.context.scene.world is None:
    bpy.context.scene.world = bpy.data.worlds.new("World")
bpy.context.scene.world.use_nodes = True
bg = bpy.context.scene.world.node_tree.nodes.get("Background")
bg.inputs["Color"].default_value = (0.10, 0.28, 0.42, 1.0)
bg.inputs["Strength"].default_value = 0.35

# EEVEE needs an EGL surface (absent headless here); CYCLES CPU is deterministic.
bpy.context.scene.render.engine = 'CYCLES'
bpy.context.scene.cycles.device = 'CPU'
bpy.context.scene.cycles.samples = 16
bpy.context.scene.render.resolution_x = 640
bpy.context.scene.render.resolution_y = 480
bpy.context.scene.render.film_transparent = False
bpy.context.scene.render.filepath = OUT
bpy.context.scene.render.image_settings.file_format = 'PNG'
bpy.ops.render.render(write_still=True)
print("rendered", OUT)
