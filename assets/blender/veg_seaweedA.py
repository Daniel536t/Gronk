# Seaweed A — Blender-authored aquatic ribbon cluster for reef shelf.
# run: blender --background --python assets/blender/veg_seaweedA.py
# Reference family 11: seaweed ribbons #2E7D5A on reef shelf. 7 tapered
# ribbons (subdivided planes, sine-sway sculpted — NOT flat quads), varied
# height/lean, shared root mound. Deterministic seed 711. STAGED only.
import bpy
import math
import os
import random
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

OUT = "/home/ubuntu/ba/assets/glb/ASTX_VEG_SEAWEED_A.glb"
ASTX = "ASTX_VEG_SEAWEED_A"
SEED = 711
bpy = zbpy.bpy
for o in list(bpy.data.objects):
    if o.name.startswith(ASTX):
        bpy.data.objects.remove(o, do_unlink=True)

M = {"weed": zbpy.MAT("M_seaweed", (0.18, 0.49, 0.35), 0.85),
     "weedL": zbpy.MAT("M_seaweedL", (0.25, 0.62, 0.42), 0.85)}

random.seed(SEED)


def finish(o, material):
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = False
    return o


# root mound: low squashed reef-rock anchor (kept small so ribbons dominate)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.16, location=(0, 0, -0.04), segments=8, ring_count=4)
mound = bpy.context.active_object
mound.name = ASTX + "_mound"
zbpy._sel(mound)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
me = mound.data
for v in me.vertices:
    if v.co.z < 0.0:
        v.co.z *= 0.15
    n = (random.random() - 0.5) * 0.06
    v.co.x += n
    v.co.y += n * 0.8
me.update()
finish(mound, M["weed"])


def ribbon(idx, a, h, lean, wid, mat, phase, root):
    # subdivided vertical plane ribbon, sine-sway + taper sculpt.
    # root offset spreads ribbons across the mound so they fan, not column.
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = f"{ASTX}_rb{idx:02d}"
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.mode_set(mode='EDIT')
    for _ in range(3):  # 8 height segments for smooth sway curve
        bpy.ops.mesh.subdivide()
    bpy.ops.object.mode_set(mode='OBJECT')
    me = o.data
    for v in me.vertices:
        t = v.co.y + 0.5  # 0 base .. 1 tip
        sway = math.sin(t * math.pi * 1.2 + phase) * 0.30 * t * h
        v.co.x = root[0] + v.co.x * wid * (1.0 - 0.65 * t) + sway + lean[0] * t * t
        v.co.z = t * h + lean[1] * t * t
        v.co.y = root[1]
    me.update()
    o.rotation_euler[2] = -a
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # double-sided read: solidify sliver so backfaces aren't culled dark
    mod = o.modifiers.new("sol", 'SOLIDIFY')
    mod.thickness = 0.015
    zbpy._sel(o)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier="sol")
    finish(o, mat)


for i in range(7):
    a = (i / 7) * math.pi * 2 + (random.random() - 0.5) * 0.4
    # root offset radial (fan from mound), lean outward along same radial dir
    rr = 0.05 + random.random() * 0.09
    rx, ry = math.cos(a) * rr, math.sin(a) * rr
    out = 0.35 + random.random() * 0.35
    ribbon(i, a, 0.7 + random.random() * 0.7,
           (rx / max(rr, 1e-3) * out, ry / max(rr, 1e-3) * out),
           0.14 + random.random() * 0.08,
           M["weed"] if i % 3 else M["weedL"], random.random() * 6.28, (rx, ry))

low = min((o.matrix_world @ v.co).z
          for o in bpy.data.objects if o.name.startswith(ASTX) and o.type == 'MESH'
          for v in o.data.vertices)
print("GROUND-LOW", round(low, 3))
for o in bpy.data.objects:
    if o.name.startswith(ASTX) and o.type == 'MESH':
        o.location.z -= (low + 0.02)

zbpy.EXPORT(OUT, ASTX)
bpy.ops.wm.save_as_mainfile(
    filepath="/home/ubuntu/ba/artifacts/visual/vegetation-design/blender/seaweed-a.blend")
print("exported", OUT)
