# ASTX_BUILDING_WINDMILL v3 (zbpy) — run: blender --background --python assets/blender/build_windmill_v2.py
# Tapered tower, cap, 4 lattice blades on hub empty ASTX_BUILDING_WINDMILL_hubPIVOT
# (Three.js rotates hub around local Z). See zbpy.py for orientation.
import math
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

OUT = "/home/ubuntu/ba/assets/glb/ASTX_BUILDING_WINDMILL.glb"
ASTX = "ASTX_BUILDING_WINDMILL"
bpy = zbpy.bpy
for o in list(bpy.data.objects):
    if o.name.startswith(ASTX):
        bpy.data.objects.remove(o, do_unlink=True)

M = {"wall": zbpy.MAT("M_wall", (0.93, 0.87, 0.76)),
     "timber": zbpy.MAT("M_timber", (0.54, 0.35, 0.20)),
     "timberD": zbpy.MAT("M_timberD", (0.36, 0.20, 0.09)),
     "stone": zbpy.MAT("M_stone", (0.60, 0.60, 0.63)),
     "cream": zbpy.MAT("M_cream", (0.95, 0.90, 0.75)),
     "glass": zbpy.MAT("M_glass", (0.62, 0.85, 0.92))}

B = lambda *a, **k: zbpy.BOX(*a, **k)
B(ASTX + "_base", 5.2, 0.8, 5.2, 0, 0, 0, M["stone"], bevel=0.05)
B(ASTX + "_shaftLo", 4.4, 3.0, 4.4, 0, 0.8, 0, M["wall"], bevel=0.05)
B(ASTX + "_shaftHi", 3.8, 2.8, 3.8, 0, 3.8, 0, M["wall"], bevel=0.05)
B(ASTX + "_trimLo", 4.7, 0.25, 4.7, 0, 3.6, 0, M["timberD"])
B(ASTX + "_trimHi", 4.1, 0.25, 4.1, 0, 6.4, 0, M["timberD"])
# cap: 4-gon pyramid (radius1 wide down), 45° plan alignment
bpy.ops.mesh.primitive_cone_add(radius1=3.0, radius2=0.1, depth=1.8, location=(0, -0.0, 7.5), vertices=4)
o = bpy.context.active_object
o.name = ASTX + "_cap"
o.rotation_euler = (0, math.radians(-45), 0)
zbpy._sel(o)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
zbpy._sel(o)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
zbpy._finish(o, M["timber"])
B(ASTX + "_door", 1.1, 2.0, 0.15, 0, 0.8, 2.28, M["timberD"])
B(ASTX + "_doorIn", 0.9, 1.8, 0.16, 0, 0.8, 2.28, M["cream"])
for i, y in enumerate((2.2, 4.6)):
    x = -1.2 if i == 0 else 1.2
    B(f"{ASTX}_winF{i}", 0.7, 0.7, 0.12, x, y, 2.26, M["glass"])
    B(f"{ASTX}_winFrameF{i}", 0.9, 0.9, 0.1, x, y, 2.24, M["timberD"])
B(ASTX + "_winS", 0.12, 0.7, 0.7, 2.06, 4.6, 0, M["glass"])

HUB = (0, 7.6, 2.6)
bpy.ops.object.empty_add(location=(HUB[0], -HUB[2], HUB[1]))
hub = bpy.context.active_object
hub.name = ASTX + "_hubPIVOT"
zbpy.BEAM_Z(ASTX + "_axle", 0.12, 0.8, 0, 7.6, 2.3, M["timberD"], verts=8)

def blade_part(name, w, h, d, cx, cy, cz, tilt, material, parent):
    bpy.ops.mesh.primitive_cube_add(size=2, location=(cx, -cz, cy))
    o = bpy.context.active_object
    o.name = name
    o.dimensions = (w, d, h)
    o.rotation_euler[1] = -tilt
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.parent = parent
    return zbpy._finish(o, material)

for i in range(4):
    a = math.radians(45 + i * 90)
    dx, dy = math.cos(a), math.sin(a)
    t = a - math.radians(90)
    mx, my = HUB[0] + dx * 2.6, HUB[1] + dy * 2.6
    blade_part(f"{ASTX}_spar{i}", 0.18, 5.2, 0.18, mx, my, HUB[2], t, M["timberD"], hub)
    px, py = HUB[0] + dx * 3.4, HUB[1] + dy * 3.4
    blade_part(f"{ASTX}_sail{i}", 1.5, 3.2, 0.06, px, py, HUB[2] - 0.05, t, M["cream"], hub)

zbpy.EXPORT(OUT, ASTX)
