# Coastal Scrub — Blender-authored wind-pruned shoreline shrub.
# run: blender --background --python assets/blender/veg_scrubA.py
# DISTINCT from Shrub A: lower profile, sparser (2 sheared lobes + gaps),
# exposed woody base stems, baked +X lean (prevailing sea wind), salt-pale
# foliage. Real-Blender Z-up. deterministic seed 607.
import bpy
import math
import os
import random
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

OUT = "/home/ubuntu/ba/assets/glb/ASTX_VEG_SCRUB_A.glb"
ASTX = "ASTX_VEG_SCRUB_A"
SEED = 607
bpy = zbpy.bpy
for o in list(bpy.data.objects):
    if o.name.startswith(ASTX):
        bpy.data.objects.remove(o, do_unlink=True)

M = {"wood": zbpy.MAT("M_driftwood", (0.52, 0.44, 0.34), 0.95),
     "leaf": zbpy.MAT("M_scrubLeaf", (0.33, 0.58, 0.30), 0.9),
     "leafP": zbpy.MAT("M_scrubPale", (0.52, 0.66, 0.38), 0.9)}

random.seed(SEED)


def finish(o, material):
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = False
    return o


LEAN = 0.35  # prevailing wind pushes everything +X


def stem(name, x, y, h, r):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, location=(x, y, h / 2), vertices=6)
    o = bpy.context.active_object
    o.name = name
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    me = o.data
    for v in me.vertices:
        t = v.co.z / h
        v.co.x += LEAN * t * t * h * 0.6
    me.update()
    return finish(o, M["wood"])


def lobe(name, cx, cy, cz, r, material, seed):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=r, location=(cx, cy, cz), subdivisions=2)
    o = bpy.context.active_object
    o.name = name
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    random.seed(seed)
    me = o.data
    for v in me.vertices:
        n = (random.random() - 0.5) * 2 * 0.30 * r
        # sheared: flattened top, ragged lee side
        v.co.x += n + LEAN * 0.3 * r
        v.co.y += n * 0.8
        v.co.z += n * 0.35
    me.update()
    return finish(o, material)


# two sheared lobes riding high on exposed stems (see-through gaps below)
stem(ASTX + "_stem0", -0.28, -0.02, 0.62, 0.055)
stem(ASTX + "_stem1", 0.48, 0.06, 0.50, 0.045)
lobe(ASTX + "_lobe0", -0.30, -0.05, 0.78, 0.50, M["leaf"], 31)
lobe(ASTX + "_lobe1", 0.55, 0.08, 0.62, 0.38, M["leafP"], 32)

# sparse dry grass spikes at base (salt meadow feel)
for i in range(5):
    a = random.random() * math.pi * 2
    rr = 0.35 + random.random() * 0.25
    x, y = math.cos(a) * rr, math.sin(a) * rr
    h = 0.18 + random.random() * 0.15
    bpy.ops.mesh.primitive_cone_add(radius1=0.035, radius2=0.004, depth=h,
                                    location=(x, y, h / 2), vertices=5)
    o = bpy.context.active_object
    o.name = f"{ASTX}_spike{i:02d}"
    o.rotation_euler[1] = -0.25 - random.random() * 0.2  # lean with wind
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish(o, M["leafP"])

low = min((o.matrix_world @ v.co).z
          for o in bpy.data.objects if o.name.startswith(ASTX) and o.type == 'MESH'
          for v in o.data.vertices)
for o in bpy.data.objects:
    if o.name.startswith(ASTX) and o.type == 'MESH':
        o.location.z -= (low + 0.02)

zbpy.EXPORT(OUT, ASTX)
bpy.ops.wm.save_as_mainfile(
    filepath="/home/ubuntu/ba/artifacts/visual/vegetation-design/blender/coastal-scrub.blend")
print("exported", OUT)
