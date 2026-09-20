# ASTX_BUILDING_MARKET v2 — market stall, full Blender art loop.
# run: blender --background --python assets/blender/build_market_v2.py
# Replaces tools/build_glbs.py poles+slab primitive (same id, manifest safe).
# Reference sheet §3C: 3.5x2.8x3.0m, 4 posts, STRIPED gabled canopy (double-sided
# read via thickness), counter, goods crates + fruit piles, rug ground plane.
# Authored via zbpy (fiction Y-up intent). Origin: ground center.
import math
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

OUT = "/home/ubuntu/ba/assets/glb/ASTX_BUILDING_MARKET.glb"
ASTX = "ASTX_BUILDING_MARKET"
for o in list(zbpy.bpy.data.objects):
    if o.name.startswith(ASTX):
        zbpy.bpy.data.objects.remove(o, do_unlink=True)

M = {"timberD": zbpy.MAT("M_timberD", (0.36, 0.20, 0.09)),
     "fabricR": zbpy.MAT("M_fabricR", (0.91, 0.36, 0.36)),
     "cream": zbpy.MAT("M_cream", (0.95, 0.90, 0.75)),
     "fruitO": zbpy.MAT("M_fruitO", (1.0, 0.55, 0.15)),
     "fruitG": zbpy.MAT("M_fruitG", (0.50, 0.75, 0.30)),
     "rug": zbpy.MAT("M_rug", (0.62, 0.25, 0.22))}

B = lambda *a, **k: zbpy.BOX(*a, **k)

# --- rug + posts ---
B(ASTX + "_rug", 4.2, 0.06, 3.4, 0, 0, 0, M["rug"])
for px, pz in ((-1.6, -1.3), (1.6, -1.3), (-1.6, 1.3), (1.6, 1.3)):
    B(f"{ASTX}_post{px}{pz}", 0.14, 2.4, 0.14, px, 0.06, pz, M["timberD"])
zbpy.BEAM_Z(ASTX + "_beamL", 0.07, 3.0, -1.7, 2.46, 0, M["timberD"], verts=8)
zbpy.BEAM_Z(ASTX + "_beamR", 0.07, 3.0, 1.7, 2.46, 0, M["timberD"], verts=8)

# --- striped gabled canopy: ridge along Z (house idiom), 4 alternating
# panels per slope facing +-X (stripes run down-slope, read both sides) ---
ang = math.radians(22)
for i in range(4):
    z = -1.3125 + i * 0.875
    mat = M["fabricR"] if i % 2 == 0 else M["cream"]
    B(f"{ASTX}_panL{i}", 1.9, 0.08, 0.875, -0.85, 2.6, z, mat, tilt_z=ang)
    B(f"{ASTX}_panR{i}", 1.9, 0.08, 0.875, 0.85, 2.6, z, mat, tilt_z=-ang)
zbpy.BEAM_Z(ASTX + "_ridge", 0.07, 3.5, 0, 3.05, 0, M["timberD"], verts=8)
# scalloped front valance: alternating short drops
for i in range(7):
    x = -1.5 + i * 0.5
    mat = M["cream"] if i % 2 == 0 else M["fabricR"]
    B(f"{ASTX}_val{i}", 0.5, 0.3, 0.06, x, 2.1, 1.42, mat)

# --- counter + goods ---
B(ASTX + "_counter", 3.0, 0.9, 1.4, 0, 0.06, 0.2, M["timberD"])
B(ASTX + "_counterTop", 3.2, 0.1, 1.6, 0, 0.96, 0.2, M["cream"])
# crates with fruit piles (flattened displaced spheres skinned by loops below)
for i, (cx, mat) in enumerate(((-0.9, M["fruitO"]), (0.0, M["fruitG"]), (0.9, M["fruitO"]))):
    B(f"{ASTX}_crate{i}", 0.7, 0.35, 0.7, cx, 1.06, 0.2, M["timberD"])
    zbpy.BALL(f"{ASTX}_pile{i}", 0.3, cx, 1.35, 0.2, mat)

zbpy.EXPORT(OUT, ASTX)
print("exported", OUT)
