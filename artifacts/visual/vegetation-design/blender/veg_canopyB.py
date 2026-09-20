# Canopy Broadleaf B — Blender-authored EMERGENT hero tree. NOT primitive stacking.
# run: blender --background --python assets/blender/veg_canopyB.py
# CONTRAST vs Canopy A (spreading 3-mass, bent trunk, ~6.5m): B is a tall
# straight emergent (~9m): columnar tapered trunk with root flare, narrow
# vertical crown (2 stacked masses + small leader spike), cool dark green.
# In a forest B reads as the overstory spire above A's spreading umbrellas.
# Origin: ground center. Exports assets/glb/ASTX_VEG_CANOPY_B.glb (STAGED only).
import bpy
import math
import os
import random
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

OUT = "/home/ubuntu/ba/assets/glb/ASTX_VEG_CANOPY_B.glb"
ASTX = "ASTX_VEG_CANOPY_B"
SEED = 211
bpy = zbpy.bpy
for o in list(bpy.data.objects):
    if o.name.startswith(ASTX):
        bpy.data.objects.remove(o, do_unlink=True)

M = {"trunk": zbpy.MAT("M_trunkB", (0.38, 0.27, 0.20), 0.95),
     "leafD": zbpy.MAT("M_leafBD", (0.13, 0.42, 0.22), 0.9),
     "leaf": zbpy.MAT("M_leafB", (0.19, 0.55, 0.26), 0.9)}

random.seed(SEED)


def finish(o, material, smooth=False):
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = smooth
    return o


# --- trunk: tall straight column, strong root flare, slight taper ---
H = 6.4
bpy.ops.mesh.primitive_cylinder_add(radius=0.30, depth=H, location=(0, 0, H / 2), vertices=9)
trunk = bpy.context.active_object
trunk.name = ASTX + "_trunk"
zbpy._sel(trunk)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
me = trunk.data
for v in me.vertices:
    t = v.co.z / H
    flare = 1.0 + 0.9 * max(0.0, 1.0 - t * 6.0)  # root flare near base
    v.co.x *= (1.15 - 0.45 * t) * flare
    v.co.y *= (1.15 - 0.45 * t) * flare
me.update()
finish(trunk, M["trunk"])

# --- branches: short spars from upper trunk into crown masses ---
import mathutils


def branch(name, tip, r0=0.12):
    base = (0, 0, H - 0.4)
    mx, my, mz = (base[0] + tip[0]) / 2, (base[1] + tip[1]) / 2, (base[2] + tip[2]) / 2
    dx, dy, dz = tip[0] - base[0], tip[1] - base[1], tip[2] - base[2]
    leng = math.sqrt(dx * dx + dy * dy + dz * dz)
    bpy.ops.mesh.primitive_cylinder_add(radius=r0, depth=leng, location=(mx, my, mz), vertices=7)
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


# --- crown: narrow vertical stack (spire read), cool dark greens ---
def blob(name, cx, cy, cz, r, squash, material, seed, detail=0.40):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=r, location=(cx, cy, cz), subdivisions=2)
    o = bpy.context.active_object
    o.name = name
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    random.seed(seed)
    me = o.data
    for v in me.vertices:
        n = (random.random() - 0.5) * 2 * detail * r
        v.co.x += n * 0.6
        v.co.y += n * 0.6
        v.co.z += n * 0.7
        v.co.z *= squash
    me.update()
    return finish(o, material)


masses = [
    ("massLow", 0.3, -0.2, 6.4, 2.2, 0.9, M["leafD"], 41),
    ("massTop", -0.2, 0.25, 7.7, 1.8, 0.95, M["leaf"], 42),
]
for name, cx, cy, cz, r, sq, material, seed in masses:
    blob(ASTX + "_" + name, cx, cy, cz, r, sq, material, seed)
    branch(ASTX + "_br_" + name, (cx, cy, cz - 0.5))

# leader spike: small cone above crown (emergent tip)
bpy.ops.mesh.primitive_cone_add(radius1=0.6, radius2=0.05, depth=1.4,
                                location=(0.0, 0.1, 8.9), vertices=7)
leader = bpy.context.active_object
leader.name = ASTX + "_leader"
zbpy._sel(leader)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
finish(leader, M["leafD"])

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
    filepath="/home/ubuntu/ba/artifacts/visual/vegetation-design/blender/canopy-broadleaf-b.blend")
print("exported", OUT)
