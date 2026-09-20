# Props set B — civic/lane family (bench, signpost, lantern). Blender art loop.
# run: blender --background --python assets/blender/props_setB.py
# Replaces ASTX_PROP_LANTERN primitive (same id). Adds ASTX_PROP_BENCH,
# ASTX_PROP_SIGNPOST (new ids). Origin: ground center. Deterministic.
import math
import os
import random
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

bpy = zbpy.bpy
random.seed(919)


def wipe(prefix):
    for o in list(bpy.data.objects):
        if o.name.startswith(prefix):
            bpy.data.objects.remove(o, do_unlink=True)


M = {"timberD": zbpy.MAT("M_timberD", (0.36, 0.20, 0.09)),
     "timber": zbpy.MAT("M_crateTimber", (0.62, 0.44, 0.26)),
     "iron": zbpy.MAT("M_ironD", (0.25, 0.25, 0.28), 0.5),
     "stoneD": zbpy.MAT("M_stoneD", (0.42, 0.43, 0.47)),
     "glassWarm": zbpy.MAT("M_lampGlow", (1.0, 0.85, 0.60), 0.4, emission=(1.0, 0.75, 0.40)),
     "paintB": zbpy.MAT("M_signBlue", (0.18, 0.50, 0.79)),
     "paintC": zbpy.MAT("M_signCream", (0.95, 0.90, 0.75))}

B = lambda *a, **k: zbpy.BOX(*a, **k)


def finish(o, material):
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = False
    return o


def ground(prefix):
    low = min((o.matrix_world @ v.co).z
              for o in bpy.data.objects if o.name.startswith(prefix) and o.type == 'MESH'
              for v in o.data.vertices)
    for o in bpy.data.objects:
        if o.name.startswith(prefix) and o.type == 'MESH':
            o.location.z -= (low + 0.02)


# ---- BENCH (1.8m): seat slab + backrest + 2 leg frames ----
P = "ASTX_PROP_BENCH"
wipe(P)
B(P + "_seat", 1.8, 0.09, 0.45, 0, 0.45, 0, M["timber"])
B(P + "_back", 1.8, 0.4, 0.08, 0, 0.62, -0.24, M["timber"])
for lx in (-0.7, 0.7):
    B(f"{P}_legF{lx}", 0.09, 0.45, 0.09, lx, 0, 0.16, M["timberD"])
    B(f"{P}_legB{lx}", 0.09, 0.85, 0.09, lx, 0, -0.22, M["timberD"])
    B(f"{ASTX if False else P}_arm{lx}", 0.08, 0.08, 0.45, lx, 0.68, -0.02, M["timberD"])
ground(P)
zbpy.EXPORT("/home/ubuntu/ba/assets/glb/ASTX_PROP_BENCH.glb", P)

# ---- SIGNPOST (2.2m): post + cap + 3 arms with painted tips ----
P = "ASTX_PROP_SIGNPOST"
wipe(P)
zbpy.CYL(P + "_post", 0.09, 2.2, 0, 0, 0, M["timberD"], verts=8)
B(P + "_cap", 0.24, 0.12, 0.24, 0, 2.2, 0, M["timberD"])
# arm i: board from post outward along fiction yaw ry + painted tip block.
# Fiction yaw about Y-up == real rotation about Z by -ry (axis audit).
arms = [(0.0, 1.7, M["paintB"]), (math.pi, 1.35, M["paintC"]), (0.5, 1.0, M["paintB"])]
for i, (ry, y, mat) in enumerate(arms):
    dx, dz = math.cos(ry), math.sin(ry)
    B(f"{P}_arm{i}", 1.1, 0.14, 0.1, dx * 0.55, y - 0.07, dz * 0.55, M["timberD"])
    o = bpy.context.active_object
    o.rotation_euler[2] = -ry
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    B(f"{P}_tip{i}", 0.4, 0.18, 0.14, dx * 1.2, y - 0.07, dz * 1.2, mat)
    t = bpy.context.active_object
    t.rotation_euler[2] = -ry
    zbpy._sel(t)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
ground(P)
zbpy.EXPORT("/home/ubuntu/ba/assets/glb/ASTX_PROP_SIGNPOST.glb", P)

# ---- LANTERN POST (2.6m): stone foot + thick post + glass cage + cap roof ----
P = "ASTX_PROP_LANTERN"
wipe(P)
B(P + "_foot", 0.4, 0.3, 0.4, 0, 0, 0, M["stoneD"])
zbpy.CYL(P + "_post", 0.09, 2.0, 0, 0.3, 0, M["iron"], verts=8)
B(P + "_cageBase", 0.4, 0.08, 0.4, 0, 2.3, 0, M["iron"])
B(P + "_glow", 0.26, 0.34, 0.26, 0, 2.38, 0, M["glassWarm"])
for cx, cz in ((-0.15, -0.15), (0.15, -0.15), (-0.15, 0.15), (0.15, 0.15)):
    B(f"{P}_cage{cx}{cz}", 0.06, 0.4, 0.06, cx, 2.36, cz, M["iron"])
B(P + "_cap", 0.5, 0.1, 0.5, 0, 2.6, 0, M["iron"])
B(P + "_capTop", 0.3, 0.12, 0.3, 0, 2.7, 0, M["iron"])
ground(P)
zbpy.EXPORT("/home/ubuntu/ba/assets/glb/ASTX_PROP_LANTERN.glb", P)

print("setB done")
