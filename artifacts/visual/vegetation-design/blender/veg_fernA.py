# Fern A — Blender-authored broad ground-cover for forest floor + falls mist.
# run: blender --background --python assets/blender/veg_fernA.py
# ROLE: 0.5m arching frond rosette; fills ground between grass tufts and shrubs.
# 9 fronds: tapered, flattened, outward-arched boxes (vertex-sculpted, NOT raw
# primitives) + small crown bud. Two greens. Deterministic seed 511.
# Origin: ground center. Exports assets/glb/ASTX_VEG_FERN_A.glb (STAGED).
import bpy
import math
import os
import random
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

OUT = "/home/ubuntu/ba/assets/glb/ASTX_VEG_FERN_A.glb"
ASTX = "ASTX_VEG_FERN_A"
SEED = 511
bpy = zbpy.bpy
for o in list(bpy.data.objects):
    if o.name.startswith(ASTX):
        bpy.data.objects.remove(o, do_unlink=True)

M = {"frond": zbpy.MAT("M_fern", (0.22, 0.55, 0.28), 0.9),
     "frondL": zbpy.MAT("M_fernL", (0.35, 0.70, 0.32), 0.9)}

random.seed(SEED)


def finish(o, material):
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = False
    return o


def frond(idx, a, leng, arch, wid, mat):
    # tapered box, long axis X, arched: rises mid-length, tip falls back —
    # fern read comes from the arch silhouette, not flat spokes
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = f"{ASTX}_fr{idx:02d}"
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # a raw cube has verts ONLY at corners (t in {0,1}) so no arch is possible;
    # subdivide 3x -> 8 length segments for a smooth arch + V-fold
    bpy.ops.object.mode_set(mode='EDIT')
    for _ in range(3):
        bpy.ops.mesh.subdivide()
    bpy.ops.object.mode_set(mode='OBJECT')
    me = o.data
    for v in me.vertices:
        t = (v.co.x + 0.5)  # 0 butt .. 1 tip
        w = v.co.y  # -0.5..0.5 across width (pre-scale)
        v.co.x = t * leng
        v.co.y *= wid * (1.0 - 0.7 * t)  # taper to tip
        v.co.z = 0.03 + math.sin(t * math.pi) * arch * leng \
            + abs(w) * 0.06 + v.co.z * 0.03  # arch + shallow V-fold
    me.update()
    o.rotation_euler[2] = -a
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish(o, mat)


# outer ring: 7 long arching fronds
for i in range(7):
    a = (i / 7) * math.pi * 2 + (random.random() - 0.5) * 0.3
    frond(i, a, 0.50 + random.random() * 0.22, 0.38 + random.random() * 0.12,
          0.13 + random.random() * 0.04, M["frond"] if i % 3 else M["frondL"])
# inner ring: 5 short steep fronds for crown fullness
for j in range(5):
    a = (j / 5) * math.pi * 2 + 0.3 + (random.random() - 0.5) * 0.3
    frond(7 + j, a, 0.28 + random.random() * 0.12, 0.55 + random.random() * 0.15,
          0.11 + random.random() * 0.03, M["frondL"] if j % 2 else M["frond"])

# crown bud: small squashed displaced sphere at center
bpy.ops.mesh.primitive_ico_sphere_add(radius=0.09, location=(0, 0, 0.08), subdivisions=1)
bud = bpy.context.active_object
bud.name = ASTX + "_bud"
zbpy._sel(bud)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
me = bud.data
for v in me.vertices:
    v.co.z *= 0.7
    v.co.x += (random.random() - 0.5) * 0.03
    v.co.y += (random.random() - 0.5) * 0.03
me.update()
finish(bud, M["frond"])

low = min((o.matrix_world @ v.co).z
          for o in bpy.data.objects if o.name.startswith(ASTX) and o.type == 'MESH'
          for v in o.data.vertices)
print("GROUND-LOW", round(low, 3))
for o in bpy.data.objects:
    if o.name.startswith(ASTX) and o.type == 'MESH':
        o.location.z -= (low + 0.02)

zbpy.EXPORT(OUT, ASTX)
bpy.ops.wm.save_as_mainfile(
    filepath="/home/ubuntu/ba/artifacts/visual/vegetation-design/blender/fern-a.blend")
print("exported", OUT)
