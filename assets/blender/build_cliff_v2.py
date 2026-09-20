# ASTX_TERRAIN_CLIFF v3 (zbpy) — run: blender --background --python assets/blender/build_cliff_v2.py
# Angular low-poly sea cliff: deterministic displaced rock, grass lip, ledge.
import os
import random
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

OUT = "/home/ubuntu/ba/assets/glb/ASTX_TERRAIN_CLIFF.glb"
ASTX = "ASTX_TERRAIN_CLIFF"
bpy = zbpy.bpy
random.seed(7)
for o in list(bpy.data.objects):
    if o.name.startswith(ASTX):
        bpy.data.objects.remove(o, do_unlink=True)

M = {"stone": zbpy.MAT("M_stone", (0.60, 0.60, 0.63)),
     "stoneD": zbpy.MAT("M_stoneD", (0.42, 0.43, 0.47)),
     "grass": zbpy.MAT("M_grass", (0.37, 0.75, 0.35))}

# NOTE: displacement runs in FICTION space (heights = fiction Y). zbpy.BOX
# centers parts; we jitter mesh verts here in fiction coords (x=width,
# y=height, z=depth) BEFORE zbpy maps placement — so displace first, then move.
def rock(name, w, h, d, x, y0, z, material, disp, seed):
    bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    o.dimensions = (w, h, d)
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.subdivide(number_cuts=2)
    bpy.ops.object.mode_set(mode='OBJECT')
    random.seed(seed)
    me = o.data
    for v in me.vertices:
        f = 0.35 + 0.65 * abs(v.co.x / (w / 2 + 1e-6))
        v.co.x += (random.random() - 0.5) * disp * f
        v.co.y += (random.random() - 0.5) * disp * 0.6
        v.co.z += (random.random() - 0.5) * disp * f
    me.update()
    for p in me.polygons:
        p.use_smooth = False
    # place: fiction (x, y0+h/2, z) -> real (x, -z, y0+h/2)
    o.location = (x, -z, y0 + h / 2)
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    return zbpy._finish(o, material)

rock(ASTX + "_base", 8.0, 3.2, 6.0, 0, -2.0, 0, M["stoneD"], 0.9, 11)
rock(ASTX + "_mid", 6.6, 2.8, 5.0, 0.2, 0.8, 0, M["stone"], 0.8, 23)
rock(ASTX + "_crown", 5.2, 1.6, 4.0, 0.1, 2.9, 0, M["stone"], 0.6, 37)
B = lambda *a, **k: zbpy.BOX(*a, **k)
B(ASTX + "_lip", 5.6, 0.5, 4.4, 0.1, 4.35, 0, M["grass"])
B(ASTX + "_ledge", 1.6, 0.4, 1.8, 3.2, 1.6, 1.0, M["grass"])
zbpy.EXPORT(OUT, ASTX)
