# Understory Tree A — Blender-authored small tree for forest mid-layer.
# run: blender --background --python assets/blender/veg_understoryA.py
# ROLE: fills the 2.5-4m gap between shrub layer (~1m) and canopy (>5m).
# Thin trunk, single asymmetric displaced crown + 3 branch spars. Mid green
# with light-green top highlight. Distinct from Shrub A (lobed, no trunk).
# Origin: ground center. Exports assets/glb/ASTX_VEG_UNDERSTORY_A.glb (STAGED).
import bpy
import math
import os
import random
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

OUT = "/home/ubuntu/ba/assets/glb/ASTX_VEG_UNDERSTORY_A.glb"
ASTX = "ASTX_VEG_UNDERSTORY_A"
SEED = 411
bpy = zbpy.bpy
for o in list(bpy.data.objects):
    if o.name.startswith(ASTX):
        bpy.data.objects.remove(o, do_unlink=True)

M = {"trunk": zbpy.MAT("M_underTrunk", (0.40, 0.30, 0.21), 0.95),
     "leaf": zbpy.MAT("M_underLeaf", (0.24, 0.58, 0.27), 0.9),
     "leafL": zbpy.MAT("M_underLeafL", (0.36, 0.72, 0.34), 0.9)}

random.seed(SEED)


def finish(o, material):
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = False
    return o


# --- trunk: thin, slight S-bend (sapling reaching for light) ---
H = 2.6
bpy.ops.mesh.primitive_cylinder_add(radius=0.11, depth=H, location=(0, 0, H / 2), vertices=7)
trunk = bpy.context.active_object
trunk.name = ASTX + "_trunk"
zbpy._sel(trunk)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
me = trunk.data
for v in me.vertices:
    t = v.co.z / H
    v.co.x += 0.28 * math.sin(t * math.pi)  # bow out mid-height
    v.co.x *= (1.3 - 0.5 * t)
    v.co.y *= (1.3 - 0.5 * t)
me.update()
finish(trunk, M["trunk"])

import mathutils


def spar(name, base, tip, r0=0.06):
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


top = (0.28, 0, 2.5)
spar(ASTX + "_br0", top, (1.0, 0.3, 3.1))
spar(ASTX + "_br1", top, (-0.7, -0.4, 3.2))
spar(ASTX + "_br2", top, (0.1, 0.9, 3.0))


# --- crown: one asymmetric mass + light cap ---
def blob(name, cx, cy, cz, r, squash, material, seed, detail=0.42):
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


blob(ASTX + "_crown", 0.25, 0.05, 3.3, 1.15, 0.85, M["leaf"], 61)
blob(ASTX + "_cap", 0.1, -0.1, 3.95, 0.7, 0.8, M["leafL"], 62)

low = min((o.matrix_world @ v.co).z
          for o in bpy.data.objects if o.name.startswith(ASTX) and o.type == 'MESH'
          for v in o.data.vertices)
print("GROUND-LOW", round(low, 3))
for o in bpy.data.objects:
    if o.name.startswith(ASTX) and o.type == 'MESH':
        o.location.z -= (low + 0.05)

zbpy.EXPORT(OUT, ASTX)
bpy.ops.wm.save_as_mainfile(
    filepath="/home/ubuntu/ba/artifacts/visual/vegetation-design/blender/understory-a.blend")
print("exported", OUT)
