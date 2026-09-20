# Props set D — harbor family (rope coil, buoy, drying rack). Blender loop.
# run: blender --background --python assets/blender/props_setD.py
# New ids: ASTX_PROP_ROPECOIL, ASTX_PROP_BUOY, ASTX_PROP_DRYRACK.
# Origin: ground/seabed center. Deterministic.
import math
import os
import random
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

bpy = zbpy.bpy
random.seed(921)


def wipe(prefix):
    for o in list(bpy.data.objects):
        if o.name.startswith(prefix):
            bpy.data.objects.remove(o, do_unlink=True)


M = {"rope": zbpy.MAT("M_rope", (0.72, 0.60, 0.42)),
     "buoyR": zbpy.MAT("M_buoyR", (0.85, 0.25, 0.20)),
     "buoyW": zbpy.MAT("M_buoyW", (0.93, 0.90, 0.84)),
     "iron": zbpy.MAT("M_ironD", (0.25, 0.25, 0.28), 0.5),
     "timberD": zbpy.MAT("M_timberD", (0.36, 0.20, 0.09)),
     "fish": zbpy.MAT("M_fish", (0.60, 0.70, 0.75))}

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


# ---- ROPE COIL (0.5m): 3 stacked tori + loose end ----
P = "ASTX_PROP_ROPECOIL"
wipe(P)
for i, (r, y) in enumerate(((0.22, 0.05), (0.19, 0.12), (0.15, 0.19))):
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=0.05, location=(0, 0, y), major_segments=12, minor_segments=6)
    o = bpy.context.active_object
    o.name = f"{P}_loop{i}"
    finish(o, M["rope"])
B(P + "_tail", 0.5, 0.07, 0.07, 0.35, 0.03, 0, M["rope"])
ground(P)
zbpy.EXPORT("/home/ubuntu/ba/assets/glb/ASTX_PROP_ROPECOIL.glb", P)

# ---- BUOY (1.1m): two-tone body + iron ring + tip pole ----
P = "ASTX_PROP_BUOY"
wipe(P)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.30, location=(0, 0, 0.32), segments=10, ring_count=7)
o = bpy.context.active_object
o.name = P + "_body"
zbpy._sel(o)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
finish(o, M["buoyR"])
o.data.materials.append(M["buoyW"])
for p in o.data.polygons:
    if p.center.z > 0.05:  # white cap: upper-hemisphere polys (LOCAL verts)
        p.material_index = 1
bpy.ops.mesh.primitive_torus_add(major_radius=0.10, minor_radius=0.03, location=(0, 0, 0.68), major_segments=10, minor_segments=6)
r = bpy.context.active_object
r.name = P + "_ring"
finish(r, M["iron"])
zbpy.CYL(P + "_tip", 0.04, 0.35, 0, 0.75, 0, M["timberD"], verts=8)
ground(P)
zbpy.EXPORT("/home/ubuntu/ba/assets/glb/ASTX_PROP_BUOY.glb", P)

# ---- DRYING RACK (1.8m): 2 end frames + crossbar + 5 hanging fish ----
P = "ASTX_PROP_DRYRACK"
wipe(P)
for ex in (-0.8, 0.8):
    B(f"{P}_post{ex}", 0.1, 1.7, 0.1, ex, 0, 0, M["timberD"])
    B(f"{P}_foot{ex}", 0.5, 0.1, 0.3, ex, 0, 0, M["timberD"])
B(P + "_bar", 1.9, 0.1, 0.1, 0, 1.62, 0, M["timberD"])
for i in range(5):
    fx = -0.6 + i * 0.3
    B(f"{P}_line{i}", 0.02, 0.22, 0.02, fx, 1.32, 0, M["rope"])
    B(f"{P}_fish{i}", 0.09, 0.28, 0.06, fx, 1.02, 0, M["fish"])
ground(P)
zbpy.EXPORT("/home/ubuntu/ba/assets/glb/ASTX_PROP_DRYRACK.glb", P)

print("setD done")
