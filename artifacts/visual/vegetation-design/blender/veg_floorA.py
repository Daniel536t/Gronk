# Forest Floor A — Blender-authored floor debris/rock vocabulary.
# run: blender --background --python assets/blender/veg_floorA.py
# ROLE: sells the forest floor so canopy layers don't float on bare terrain:
# 2 half-buried displaced rocks + 1 moss mound + 1 fallen log with moss cap.
# Grey stone + moss greens shared with cliff/fern families (visual rhyme).
# Deterministic seed 611. Origin: ground center. STAGED only.
import bpy
import math
import os
import random
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

OUT = "/home/ubuntu/ba/assets/glb/ASTX_VEG_FLOOR_A.glb"
ASTX = "ASTX_VEG_FLOOR_A"
SEED = 611
bpy = zbpy.bpy
for o in list(bpy.data.objects):
    if o.name.startswith(ASTX):
        bpy.data.objects.remove(o, do_unlink=True)

M = {"stone": zbpy.MAT("M_floorStone", (0.45, 0.44, 0.40), 0.95),
     "moss": zbpy.MAT("M_floorMoss", (0.30, 0.52, 0.26), 0.95),
     "wood": zbpy.MAT("M_floorWood", (0.42, 0.31, 0.22), 0.95)}

random.seed(SEED)


def finish(o, material):
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = False
    return o


def rock(name, cx, cy, cz, r, seed):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=r, location=(cx, cy, cz), subdivisions=1)
    o = bpy.context.active_object
    o.name = name
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    random.seed(seed)
    me = o.data
    for v in me.vertices:
        n = (random.random() - 0.5) * 0.35 * r
        v.co.x += n
        v.co.y += n * 0.8
        v.co.z += n * 0.5
    me.update()
    return finish(o, M["stone"])


# half-buried: centers below grade so only backs read
rock(ASTX + "_rock0", -0.45, 0.15, 0.02, 0.28, 71)
rock(ASTX + "_rock1", 0.50, -0.20, 0.0, 0.20, 72)


# moss mound: squashed displaced hemisphere hugging ground
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.30, location=(0.05, 0.25, 0.02), segments=9, ring_count=5)
mound = bpy.context.active_object
mound.name = ASTX + "_moss"
zbpy._sel(mound)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
me = mound.data
for v in me.vertices:
    if v.co.z < 0.02:
        v.co.z = 0.02 + (v.co.z - 0.02) * 0.15
    n = (random.random() - 0.5) * 0.08
    v.co.x += n
    v.co.y += n * 0.8
    v.co.z += abs(n) * 0.35
me.update()
finish(mound, M["moss"])


# fallen log: horizontal tapered cylinder + thin moss cap
import mathutils
bpy.ops.mesh.primitive_cylinder_add(radius=0.13, depth=1.1, location=(-0.1, -0.35, 0.13), vertices=8)
log = bpy.context.active_object
log.name = ASTX + "_log"
log.rotation_euler[1] = math.pi / 2
log.rotation_euler[2] = 0.25
zbpy._sel(log)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
zbpy._sel(log)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
me = log.data
for v in me.vertices:
    t = (v.co.x + 0.55) / 1.1
    s = 1.0 - 0.3 * t  # taper one end (broken tip)
    v.co.y *= s
    v.co.z *= s
me.update()
finish(log, M["wood"])
# moss skin: top-facing polys of the SAME log mesh get the moss slot, so wood
# still reads on the sides/ends (a separate cap cylinder read as a slab)
log.data.materials.append(M["moss"])
for p in log.data.polygons:
    if p.normal.z > 0.45:
        p.material_index = 1

low = min((o.matrix_world @ v.co).z
          for o in bpy.data.objects if o.name.startswith(ASTX) and o.type == 'MESH'
          for v in o.data.vertices)
print("GROUND-LOW", round(low, 3))
for o in bpy.data.objects:
    if o.name.startswith(ASTX) and o.type == 'MESH':
        o.location.z -= (low + 0.02)

zbpy.EXPORT(OUT, ASTX)
bpy.ops.wm.save_as_mainfile(
    filepath="/home/ubuntu/ba/artifacts/visual/vegetation-design/blender/floor-a.blend")
print("exported", OUT)
