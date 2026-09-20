# ASTX_BUILDING_LIGHTHOUSE v4 (zbpy) — run: blender --background --python assets/blender/build_lighthouse_v2.py
import math
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

OUT = "/home/ubuntu/ba/assets/glb/ASTX_BUILDING_LIGHTHOUSE.glb"
ASTX = "ASTX_BUILDING_LIGHTHOUSE"
for o in list(zbpy.bpy.data.objects):
    if o.name.startswith(ASTX):
        zbpy.bpy.data.objects.remove(o, do_unlink=True)

M = {"white": zbpy.MAT("M_white", (0.96, 0.95, 0.92)),
     "red": zbpy.MAT("M_red", (0.80, 0.20, 0.20)),
     "stone": zbpy.MAT("M_stone", (0.60, 0.60, 0.63)),
     "timberD": zbpy.MAT("M_timberD", (0.36, 0.20, 0.09)),
     "glass": zbpy.MAT("M_glass", (0.62, 0.85, 0.92)),
     "metal": zbpy.MAT("M_metal", (0.42, 0.42, 0.44), 0.4),
     "lamp": zbpy.MAT("M_lamp", (1.0, 0.85, 0.45), 0.5, emission=(1.0, 0.72, 0.30))}

C = lambda *a, **k: zbpy.CYL(*a, **k)
C(ASTX + "_plinth", 2.2, 1.0, 0, 0, 0, M["stone"], verts=12, smooth=False)
C(ASTX + "_plinthTop", 1.8, 0.8, 0, 1.0, 0, M["stone"], verts=12, smooth=False)
for rb, rt, y0, y1, material, name in [
        (1.45, 1.38, 1.8, 3.0, "white", "shaftLoA"),
        (1.38, 1.32, 3.0, 4.2, "white", "shaftLoB"),
        (1.32, 1.24, 4.2, 5.4, "red", "bandLo"),
        (1.24, 1.17, 5.4, 6.7, "white", "shaftMidA"),
        (1.17, 1.10, 6.7, 8.0, "white", "shaftMidB"),
        (1.10, 1.04, 8.0, 9.0, "red", "bandHi"),
        (1.04, 0.95, 9.0, 10.2, "white", "shaftHi")]:
    C(ASTX + "_" + name, rb, y1 - y0, 0, y0, 0, M[material], r2=rt)
C(ASTX + "_gallery", 1.45, 0.25, 0, 10.2, 0, M["stone"], smooth=False)
for i in range(12):
    a = math.pi * 2 * i / 12
    C(ASTX + f"_rail{i:02d}", 0.04, 0.9, math.cos(a) * 1.35, 10.45, math.sin(a) * 1.35, M["metal"], verts=6, smooth=False)
for y in (11.15, 11.35):
    zbpy.RING(ASTX + f"_railRing{int(y * 10)}", 1.35, 0.045, 0, y, 0, M["metal"])
C(ASTX + "_lanternGlass", 0.85, 1.5, 0, 10.45, 0, M["glass"], verts=12, smooth=False)
C(ASTX + "_lamp", 0.35, 1.1, 0, 10.65, 0, M["lamp"], verts=10, smooth=False)
C(ASTX + "_lanternBase", 1.0, 0.18, 0, 10.32, 0, M["metal"], verts=12, smooth=False)
C(ASTX + "_cap", 1.15, 1.3, 0, 11.95, 0, M["red"], r2=0.05)
zbpy.BALL(ASTX + "_finial", 0.12, 0, 13.35, 0, M["metal"])
B = lambda *a, **k: zbpy.BOX(*a, **k)
B(ASTX + "_door", 0.9, 1.9, 0.15, 0, 1.0, 1.48, M["timberD"])
for y in (4.8, 7.0):
    B(ASTX + f"_slit{int(y * 10)}", 0.35, 0.8, 0.12, 0, y - 0.4, 1.30, M["glass"])
zbpy.EXPORT(OUT, ASTX)
