# ASTX_PLAZA_CIVIC v3 (zbpy) — run: blender --background --python assets/blender/build_plaza_v1.py
# Civic anchor, decor only. See zbpy.py for the orientation system.
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

OUT = "/home/ubuntu/ba/assets/glb/ASTX_PLAZA_CIVIC.glb"
ASTX = "ASTX_PLAZA_CIVIC"
for o in list(zbpy.bpy.data.objects):
    if o.name.startswith(ASTX):
        zbpy.bpy.data.objects.remove(o, do_unlink=True)

M = {"stone": zbpy.MAT("M_stone", (0.60, 0.60, 0.63)),
     "stoneD": zbpy.MAT("M_stoneD", (0.42, 0.43, 0.47)),
     "water": zbpy.MAT("M_water", (0.12, 0.62, 0.75), 0.4),
     "gold": zbpy.MAT("M_gold", (1.0, 0.69, 0.18), 0.5)}

C = lambda *a, **k: zbpy.CYL(*a, **k)
# foundation drum: pad sits IN grade, drum face reads as stonework on slopes
C(ASTX + "_foundation", 9.2, 0.75, 0, -0.42, 0, M["stoneD"], verts=36, smooth=False)
C(ASTX + "_pad", 9.0, 0.3, 0, 0, 0, M["stone"], verts=36, smooth=False)
zbpy.RING(ASTX + "_ring", 8.2, 0.18, 0, 0.32, 0, M["stoneD"], major_seg=20, minor_seg=6)
C(ASTX + "_basin", 3.0, 0.8, 0, 0.3, 0, M["stoneD"])
C(ASTX + "_water", 2.7, 0.15, 0, 0.98, 0, M["water"])
C(ASTX + "_pillar", 0.45, 2.6, 0, 1.0, 0, M["stone"], verts=12)
C(ASTX + "_bowl", 1.2, 0.35, 0, 3.55, 0, M["stoneD"], verts=16)
zbpy.BALL(ASTX + "_finial", 0.3, 0, 4.2, 0, M["gold"])
for x, z in [(6.5, 0), (-6.5, 0), (0, 6.5), (0, -6.5)]:
    C(ASTX + f"_bollard{x}{z}", 0.28, 0.9, x, 0.3, z, M["stoneD"], verts=8, smooth=False)
zbpy.EXPORT(OUT, ASTX)
