# ASTX_BUILDING_FARM v2 — farmhouse, full Blender art loop.
# run: blender --background --python assets/blender/build_farm_v2.py
# Replaces tools/build_glbs.py beige-box primitive (same id, manifest safe).
# Reference: SMALL secondary farmhouse — thatch roof (thick + ragged fringe),
# timber frame + mud walls, open veranda front, big side barn-door, small window.
# Poor on purpose next to the barn. Authored via zbpy. Origin: ground center.
import math
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

OUT = "/home/ubuntu/ba/assets/glb/ASTX_BUILDING_FARM.glb"
ASTX = "ASTX_BUILDING_FARM"
for o in list(zbpy.bpy.data.objects):
    if o.name.startswith(ASTX):
        zbpy.bpy.data.objects.remove(o, do_unlink=True)

M = {"mud": zbpy.MAT("M_mud", (0.72, 0.58, 0.42)),
     "timberD": zbpy.MAT("M_timberD", (0.36, 0.20, 0.09)),
     "thatch": zbpy.MAT("M_thatch", (0.78, 0.66, 0.42)),
     "thatchD": zbpy.MAT("M_thatchD", (0.60, 0.48, 0.30)),
     "stone": zbpy.MAT("M_stone", (0.60, 0.60, 0.63)),
     "glass": zbpy.MAT("M_glass", (0.62, 0.85, 0.92))}

B = lambda *a, **k: zbpy.BOX(*a, **k)

# --- stone base + mud walls + timber frame ---
B(ASTX + "_base", 6.4, 0.4, 5.4, 0, 0, 0, M["stone"], bevel=0.05)
B(ASTX + "_walls", 6.0, 2.2, 5.0, 0, 0.4, 0, M["mud"], bevel=0.05)
for cx, cz in ((-3.0, -2.5), (3.0, -2.5), (-3.0, 2.5), (3.0, 2.5)):
    B(f"{ASTX}_corner{cx}{cz}", 0.3, 2.5, 0.3, cx, 0.4, cz, M["timberD"])
B(ASTX + "_plateN", 6.0, 0.16, 0.16, 0, 2.5, -2.5, M["timberD"])
B(ASTX + "_plateS", 6.0, 0.16, 0.16, 0, 2.5, 2.5, M["timberD"])

# --- thatch roof: thick slabs + ragged fringe (offset thin edge boxes) ---
ang = math.radians(34)
B(ASTX + "_thatchL", 4.6, 0.35, 5.8, -2.0, 3.0, 0, M["thatch"], tilt_z=ang)
B(ASTX + "_thatchR", 4.6, 0.35, 5.8, 2.0, 3.0, 0, M["thatch"], tilt_z=-ang)
# ragged eave fringe: thin thatch tabs along both eave edges, staggered drop
for i in range(9):
    z = -2.8 + i * 0.7
    B(f"{ASTX}_fringeL{i}", 0.45, 0.12, 0.5, -3.85, 1.82 - (i % 2) * 0.09, z, M["thatchD"], tilt_z=ang)
    B(f"{ASTX}_fringeR{i}", 0.45, 0.12, 0.5, 3.85, 1.82 - ((i + 1) % 2) * 0.09, z, M["thatchD"], tilt_z=-ang)
zbpy.BEAM_Z(ASTX + "_ridgepole", 0.14, 5.8, 0, 4.62, 0, M["timberD"], verts=8)
# gable infill (thatch triangles close the roof ends)
zbpy.GABLE(ASTX + "_gableN", 6.0, 2.0, 0.25, 0, 2.6, -2.5, M["thatch"])
zbpy.GABLE(ASTX + "_gableS", 6.0, 2.0, 0.25, 0, 2.6, 2.5, M["thatch"])

# --- open veranda (front +Z): posts + shed roof + bench ---
for px in (-2.4, 0, 2.4):
    B(f"{ASTX}_verPost{px}", 0.16, 2.2, 0.16, px, 0.4, 3.3, M["timberD"])
B(ASTX + "_verRoof", 6.4, 0.12, 1.8, 0, 2.6, 3.3, M["thatch"], tilt_z=0)
B(ASTX + "_bench", 1.8, 0.4, 0.5, -1.2, 0.4, 3.1, M["timberD"])

# --- big side barn-door (E) + small window (W) + door (S under veranda) ---
B(ASTX + "_barnDoor", 0.14, 1.9, 2.0, 3.02, 0.4, 0, M["timberD"])
B(ASTX + "_barnBrace", 0.1, 0.14, 2.2, 3.1, 1.3, 0, M["thatchD"], tilt_z=0)
B(ASTX + "_door", 1.0, 1.8, 0.12, 1.2, 0.4, 2.52, M["timberD"])
B(ASTX + "_winFrame", 0.9, 0.9, 0.1, -1.6, 1.4, 2.5, M["timberD"])
B(ASTX + "_win", 0.7, 0.7, 0.12, -1.6, 1.4, 2.5, M["glass"])

zbpy.EXPORT(OUT, ASTX)
print("exported", OUT)
