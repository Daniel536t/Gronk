# Canopy Broadleaf C — Blender-authored BANYAN-form hero tree. NOT primitive stacking.
# run: blender --background --python assets/blender/veg_canopyC.py
# CONTRAST vs A (spreading umbrella) and B (tall spire): C is low and WIDE —
# short thick trunk (~2.2m) with 4 low flat canopy pads + 2 aerial prop roots.
# Reads as the broad mid-canopy ceiling of the forest. Warm light green.
# Origin: ground center. Exports assets/glb/ASTX_VEG_CANOPY_C.glb (STAGED only).
import bpy
import math
import os
import random
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

OUT = "/home/ubuntu/ba/assets/glb/ASTX_VEG_CANOPY_C.glb"
ASTX = "ASTX_VEG_CANOPY_C"
SEED = 311
bpy = zbpy.bpy
for o in list(bpy.data.objects):
    if o.name.startswith(ASTX):
        bpy.data.objects.remove(o, do_unlink=True)

M = {"trunk": zbpy.MAT("M_trunkC", (0.45, 0.32, 0.22), 0.95),
     "leaf": zbpy.MAT("M_leafC", (0.30, 0.64, 0.30), 0.9),
     "leafL": zbpy.MAT("M_leafCL", (0.42, 0.76, 0.38), 0.9)}

random.seed(SEED)


def finish(o, material, smooth=False):
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = smooth
    return o


# --- trunk: short, thick, slight lean ---
H = 2.4
bpy.ops.mesh.primitive_cylinder_add(radius=0.42, depth=H, location=(0.15, 0, H / 2), vertices=9)
trunk = bpy.context.active_object
trunk.name = ASTX + "_trunk"
zbpy._sel(trunk)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
me = trunk.data
for v in me.vertices:
    t = v.co.z / H
    v.co.x *= (1.5 - 0.6 * t)  # heavy base flare
    v.co.y *= (1.5 - 0.6 * t)
me.update()
finish(trunk, M["trunk"])

# --- aerial prop roots: 2 thin angled cylinders from low limbs to ground ---
import mathutils


def spar(name, base, tip, r0):
    mx, my, mz = (base[0] + tip[0]) / 2, (base[1] + tip[1]) / 2, (base[2] + tip[2]) / 2
    dx, dy, dz = tip[0] - base[0], tip[1] - base[1], tip[2] - base[2]
    leng = math.sqrt(dx * dx + dy * dy + dz * dz)
    bpy.ops.mesh.primitive_cylinder_add(radius=r0, depth=leng, location=(mx, my, mz), vertices=6)
    o = bpy.context.active_object
    o.name = name
    d = mathutils.Vector((dx, dy, dz)).normalized()
    q = mathutils.Vector((0, 0, 1)).rotation_difference(d)
    o.rotation_euler = q.to_euler()
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(o, M["trunk"])


# prop roots run limb-tip -> ground AND continue up into the pads above, so no
# free-floating stick end is visible from any angle (tops buried in foliage)
spar(ASTX + "_root0", (2.3, 0.5, 0.0), (1.6, 0.3, 3.1), 0.09)
spar(ASTX + "_root1", (-2.1, -0.7, 0.0), (-1.4, -0.4, 3.0), 0.08)
spar(ASTX + "_limb0", (0.15, 0, 2.2), (1.6, 0.3, 2.9), 0.14)
spar(ASTX + "_limb1", (0.15, 0, 2.2), (-1.4, -0.4, 2.8), 0.14)
spar(ASTX + "_limb2", (0.15, 0, 2.2), (0.2, 1.5, 2.9), 0.12)
spar(ASTX + "_limb3", (0.15, 0, 2.2), (0.0, -1.6, 2.8), 0.12)


# --- canopy: 4 low flat pads, gapped, warm greens ---
def blob(name, cx, cy, cz, r, squash, material, seed, detail=0.38):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=r, location=(cx, cy, cz), subdivisions=2)
    o = bpy.context.active_object
    o.name = name
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    random.seed(seed)
    me = o.data
    for v in me.vertices:
        n = (random.random() - 0.5) * 2 * detail * r
        v.co.x += n * 0.8
        v.co.y += n * 0.8
        v.co.z += n * 0.35
        v.co.z *= squash
    me.update()
    return finish(o, material)


pads = [
    ("padE", 2.0, 0.3, 3.4, 1.7, 0.55, M["leaf"], 51),
    ("padW", -1.8, -0.4, 3.3, 1.6, 0.55, M["leafL"], 52),
    ("padN", 0.2, 1.9, 3.5, 1.5, 0.55, M["leaf"], 53),
    ("padS", 0.0, -2.0, 3.2, 1.45, 0.55, M["leafL"], 54),
]
for name, cx, cy, cz, r, sq, material, seed in pads:
    blob(ASTX + "_" + name, cx, cy, cz, r, sq, material, seed)

# ground: drop assembly so lowest WORLD vertex sits slightly embedded
low = min((o.matrix_world @ v.co).z
          for o in bpy.data.objects if o.name.startswith(ASTX) and o.type == 'MESH'
          for v in o.data.vertices)
print("GROUND-LOW", round(low, 3))
for o in bpy.data.objects:
    if o.name.startswith(ASTX) and o.type == 'MESH':
        o.location.z -= (low + 0.05)

zbpy.EXPORT(OUT, ASTX)
bpy.ops.wm.save_as_mainfile(
    filepath="/home/ubuntu/ba/artifacts/visual/vegetation-design/blender/canopy-broadleaf-c.blend")
print("exported", OUT)
