# Props set A — storage family (crate, barrel, sack). Blender art loop.
# run: blender --background --python assets/blender/props_setA.py
# Replaces ASTX_PROP_CRATE / ASTX_PROP_BARREL primitives (same ids).
# Adds ASTX_PROP_SACK (new id). Origin: ground center. Deterministic.
import math
import os
import random
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

bpy = zbpy.bpy
random.seed(918)


def wipe(prefix):
    for o in list(bpy.data.objects):
        if o.name.startswith(prefix):
            bpy.data.objects.remove(o, do_unlink=True)


M = {"timber": zbpy.MAT("M_crateTimber", (0.62, 0.44, 0.26)),
     "timberD": zbpy.MAT("M_timberD", (0.36, 0.20, 0.09)),
     "iron": zbpy.MAT("M_ironD", (0.25, 0.25, 0.28), 0.5),
     "sack": zbpy.MAT("M_sack", (0.78, 0.68, 0.50)),
     "rope": zbpy.MAT("M_rope", (0.72, 0.60, 0.42))}

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


# ---- CRATE (0.9m): slatted box + corner battens + lid rim ----
P = "ASTX_PROP_CRATE"
wipe(P)
B(P + "_core", 0.86, 0.86, 0.86, 0, 0.02, 0, M["timber"])
for cx, cz in ((-0.43, -0.43), (0.43, -0.43), (-0.43, 0.43), (0.43, 0.43)):
    B(f"{P}_bat{cx}{cz}", 0.1, 0.94, 0.1, cx, 0.0, cz, M["timberD"])
for sy in (0.06, 0.86):
    B(f"{P}_rim{sy}", 0.98, 0.1, 0.98, 0, sy, 0, M["timberD"])
ground(P)
zbpy.EXPORT("/home/ubuntu/ba/assets/glb/ASTX_PROP_CRATE.glb", P)

# ---- BARREL (0.95m): bulged staves + 2 iron hoops + lid ----
P = "ASTX_PROP_BARREL"
wipe(P)
bpy.ops.mesh.primitive_cylinder_add(radius=0.34, depth=0.9, location=(0, 0, 0.47), vertices=12)
o = bpy.context.active_object
o.name = P + "_body"
zbpy._sel(o)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
me = o.data
for v in me.vertices:
    t = v.co.z / 0.9 + 0.5  # 0 bottom .. 1 top
    bulge = 1.0 + 0.16 * math.sin(t * math.pi)
    v.co.x *= bulge
    v.co.y *= bulge
me.update()
finish(o, M["timber"])
for hy in (0.18, 0.76):
    r = 0.34 * (1.0 + 0.16 * math.sin((hy / 0.9) * math.pi)) + 0.015
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=0.025, location=(0, 0, hy), major_segments=14, minor_segments=6)
    h = bpy.context.active_object
    h.name = f"{P}_hoop{hy}"
    finish(h, M["iron"])
bpy.ops.mesh.primitive_cylinder_add(radius=0.30, depth=0.05, location=(0, 0, 0.93), vertices=12)
lid = bpy.context.active_object
lid.name = P + "_lid"
finish(lid, M["timberD"])
ground(P)
zbpy.EXPORT("/home/ubuntu/ba/assets/glb/ASTX_PROP_BARREL.glb", P)

# ---- SACK (0.75m): squashed displaced body + tied neck + cinch ring ----
P = "ASTX_PROP_SACK"
wipe(P)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.34, location=(0, 0, 0.30), segments=10, ring_count=7)
o = bpy.context.active_object
o.name = P + "_body"
zbpy._sel(o)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
me = o.data
for v in me.vertices:
    v.co.z *= 0.85
    n = (random.random() - 0.5) * 0.07
    v.co.x += n
    v.co.y += n * 0.8
    if v.co.z > 0.42:  # gather toward the tie
        v.co.x *= 0.55
        v.co.y *= 0.55
me.update()
finish(o, M["sack"])
bpy.ops.mesh.primitive_cylinder_add(radius=0.13, depth=0.12, location=(0, 0, 0.62), vertices=8)
t = bpy.context.active_object
t.name = P + "_tie"
finish(t, M["rope"])
bpy.ops.mesh.primitive_torus_add(major_radius=0.13, minor_radius=0.03, location=(0, 0, 0.57), major_segments=10, minor_segments=6)
c = bpy.context.active_object
c.name = P + "_cinch"
finish(c, M["rope"])
ground(P)
zbpy.EXPORT("/home/ubuntu/ba/assets/glb/ASTX_PROP_SACK.glb", P)

print("setA done")
