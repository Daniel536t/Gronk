# Canopy Broadleaf A — Blender-authored hero tree. NOT primitive stacking.
# run: blender --background --python assets/blender/veg_canopyA.py
# Techniques: bent tapered trunk (vertex-sculpted cylinder), angled branch
# cylinders grown into the crown, 3 displaced icosphere canopy masses
# (seeded, asymmetric, gapped), flat-shaded low-poly finish.
# Origin: ground center. ~6.5m. Exports assets/glb/ASTX_VEG_CANOPY_A.glb.
import bpy
import math
import os
import random
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

OUT = "/home/ubuntu/ba/assets/glb/ASTX_VEG_CANOPY_A.glb"
ASTX = "ASTX_VEG_CANOPY_A"
SEED = 117
bpy = zbpy.bpy
for o in list(bpy.data.objects):
    if o.name.startswith(ASTX):
        bpy.data.objects.remove(o, do_unlink=True)

M = {"trunk": zbpy.MAT("M_trunk", (0.42, 0.29, 0.21), 0.95),
     "leafD": zbpy.MAT("M_leafD", (0.18, 0.49, 0.23), 0.9),
     "leaf": zbpy.MAT("M_leaf", (0.25, 0.62, 0.28), 0.9),
     "leafL": zbpy.MAT("M_leafL", (0.37, 0.75, 0.35), 0.9)}

random.seed(SEED)


def finish(o, material, smooth=False):
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = smooth
    return o


# --- trunk: tapered cylinder, bent + flared via vertex sculpt ---
bpy.ops.mesh.primitive_cylinder_add(radius=0.34, depth=3.4, location=(0, 0, 1.7), vertices=9)
trunk = bpy.context.active_object
trunk.name = ASTX + "_trunk"
zbpy._sel(trunk)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
me = trunk.data
for v in me.vertices:
    t = v.co.z / 3.4  # 0 base .. 1 top
    v.co.x *= (1.35 - 0.75 * t)      # flare at base, taper at top
    v.co.y *= (1.35 - 0.75 * t)
    v.co.x += 0.55 * t * t            # gentle bend
me.update()
finish(trunk, M["trunk"])

# --- branches: tapered spars from trunk top into each canopy mass ---
def branch(name, tip, r0=0.13):
    base = (0.55, 0, 2.9)  # near trunk top (bent); all coords real-Blender Z-up
    mx, my, mz = (base[0] + tip[0]) / 2, (base[1] + tip[1]) / 2, (base[2] + tip[2]) / 2
    dx, dy, dz = tip[0] - base[0], tip[1] - base[1], tip[2] - base[2]
    leng = math.sqrt(dx * dx + dy * dy + dz * dz)
    bpy.ops.mesh.primitive_cylinder_add(radius=r0, depth=leng, location=(mx, my, mz), vertices=7)
    o = bpy.context.active_object
    o.name = name
    # aim local +Z along the branch dir (already real-Blender coords: no mapping)
    import mathutils
    d = mathutils.Vector((dx, dy, dz)).normalized()
    q = mathutils.Vector((0, 0, 1)).rotation_difference(d)
    o.rotation_euler = q.to_euler()
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(o, M["trunk"])


# --- canopy: 3 displaced icospheres, asymmetric, gapped ---
# Authored DIRECTLY in real-Blender Z-up (ground XY, up +Z); zbpy only supplies
# materials/selection/export (frame-neutral helpers). Export converts to Y-up.
def blob(name, cx, cy, cz, r, squash, material, seed, detail=0.35):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=r, location=(cx, cy, cz), subdivisions=2)
    o = bpy.context.active_object
    o.name = name
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    random.seed(seed)
    me = o.data
    for v in me.vertices:
        n = (random.random() - 0.5) * 2 * detail * r
        v.co.x += n * 0.7
        v.co.y += n * 0.7
        v.co.z += n * 0.5
        v.co.z *= squash
    me.update()
    return finish(o, material)


masses = [
    ("massL", -1.5, -0.4, 4.3, 2.1, 0.78, M["leafD"], 11),
    ("massR", 1.6, 0.5, 4.1, 2.3, 0.75, M["leaf"], 12),
    ("massT", 0.2, 0.1, 5.5, 2.0, 0.82, M["leafL"], 13),
]
for name, cx, cy, cz, r, sq, material, seed in masses:
    blob(ASTX + "_" + name, cx, cy, cz, r, sq, material, seed)
    branch(ASTX + "_br_" + name, (cx, cy, cz - 0.6))

zbpy.EXPORT(OUT, ASTX)
print("exported", OUT)
