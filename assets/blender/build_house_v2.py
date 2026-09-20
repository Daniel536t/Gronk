# ASTX_BUILDING_HOUSE v3 — run: blender --background --python assets/blender/build_house_v2.py
# Authored via zbpy (true-Z-up helpers; fiction Y-up intent). See zbpy.py.
import math
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

OUT = "/home/ubuntu/ba/assets/glb/ASTX_BUILDING_HOUSE.glb"
ASTX = "ASTX_BUILDING_HOUSE"
for o in list(zbpy.bpy.data.objects):
    if o.name.startswith(ASTX):
        zbpy.bpy.data.objects.remove(o, do_unlink=True)

M = {"wall": zbpy.MAT("M_wall", (0.93, 0.87, 0.76)),
     "roofO": zbpy.MAT("M_roofO", (0.79, 0.44, 0.18)),
     "stone": zbpy.MAT("M_stone", (0.60, 0.60, 0.63)),
     "timberD": zbpy.MAT("M_timberD", (0.36, 0.20, 0.09)),
     "glass": zbpy.MAT("M_glass", (0.62, 0.85, 0.92)),
     "cream": zbpy.MAT("M_cream", (0.95, 0.90, 0.75))}

B = lambda *a, **k: zbpy.BOX(*a, **k)
B(ASTX + "_foundation", 5.4, 0.35, 4.6, 0, 0, 0, M["stone"], bevel=0.05)
B(ASTX + "_walls", 5.0, 2.6, 4.2, 0, 0.35, 0, M["wall"], bevel=0.06)
zbpy.GABLE(ASTX + "_gableN", 5.0, 1.5, 0.25, 0, 2.95, -2.0, M["wall"])
zbpy.GABLE(ASTX + "_gableS", 5.0, 1.5, 0.25, 0, 2.95, 2.0, M["wall"])
ang = math.radians(29.5)
B(ASTX + "_roofL", 3.6, 0.16, 5.0, -1.5, 3.57, 0, M["roofO"], tilt_z=ang)
B(ASTX + "_roofR", 3.6, 0.16, 5.0, 1.5, 3.57, 0, M["roofO"], tilt_z=-ang)
zbpy.BEAM_Z(ASTX + "_ridge", 0.14, 5.0, 0, 4.5, 0, M["timberD"], verts=8)
B(ASTX + "_chimney", 0.55, 1.7, 0.55, 1.3, 3.6, 0, M["stone"], bevel=0.03)
B(ASTX + "_chimneyCap", 0.8, 0.15, 0.8, 1.3, 5.3, 0, M["timberD"])
B(ASTX + "_doorFrame", 1.3, 2.0, 0.12, 0, 0.35, 2.12, M["timberD"])
B(ASTX + "_door", 1.0, 1.8, 0.14, 0, 0.35, 2.12, M["cream"])
B(ASTX + "_step", 1.6, 0.18, 0.6, 0, 0, 2.5, M["stone"])
for i, x in enumerate((-1.6, 1.6)):
    B(f"{ASTX}_winFrameF{i}", 1.0, 1.0, 0.1, x, 1.5, 2.1, M["timberD"])
    B(f"{ASTX}_winF{i}", 0.8, 0.8, 0.12, x, 1.5, 2.1, M["glass"])
    B(f"{ASTX}_sillF{i}", 1.1, 0.1, 0.25, x, 1.0, 2.15, M["timberD"])
B(ASTX + "_winFrameW", 0.1, 0.9, 0.9, -2.5, 1.5, 0, M["timberD"])
B(ASTX + "_winW", 0.12, 0.7, 0.7, -2.5, 1.5, 0, M["glass"])
for x in (-2.2, 2.2):
    B(f"{ASTX}_porch{x}", 0.16, 2.3, 0.16, x, 0.35, 2.75, M["timberD"])
B(ASTX + "_porchRoof", 5.0, 0.12, 1.3, 0, 2.55, 2.7, M["roofO"])
zbpy.EXPORT(OUT, ASTX)
