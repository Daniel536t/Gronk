# ASTX_BUILDING_TOWNHALL v2 — civic anchor, full Blender art loop.
# run: blender --background --python assets/blender/build_townhall_v2.py
# Replaces the tools/build_glbs.py box+prism primitive (same id, manifest safe).
# Reference sheet §3B: 9x8x7.5m double-gable, clock tower + cupola + bell, grand
# stairs, colonnade porch, banner anchors, cream plaster + blue roof + gold trim.
# Authored via zbpy (fiction Y-up intent). Origin: ground center.
import math
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

OUT = "/home/ubuntu/ba/assets/glb/ASTX_BUILDING_TOWNHALL.glb"
ASTX = "ASTX_BUILDING_TOWNHALL"
for o in list(zbpy.bpy.data.objects):
    if o.name.startswith(ASTX):
        zbpy.bpy.data.objects.remove(o, do_unlink=True)

M = {"cream": zbpy.MAT("M_cream", (0.95, 0.90, 0.75)),
     "roofB": zbpy.MAT("M_roofB", (0.18, 0.50, 0.79)),
     "stone": zbpy.MAT("M_stone", (0.60, 0.60, 0.63)),
     "timberD": zbpy.MAT("M_timberD", (0.36, 0.20, 0.09)),
     "glass": zbpy.MAT("M_glass", (0.62, 0.85, 0.92)),
     "ivory": zbpy.MAT("M_ivory", (0.97, 0.95, 0.88)),
     "fabricR": zbpy.MAT("M_fabricR", (0.91, 0.36, 0.36)),
     "brass": zbpy.MAT("M_brass", (0.85, 0.62, 0.20), 0.5)}

B = lambda *a, **k: zbpy.BOX(*a, **k)

# --- foundation + main double-gable mass ---
B(ASTX + "_base", 9.4, 0.4, 8.4, 0, 0, 0, M["stone"], bevel=0.05)
B(ASTX + "_walls", 9.0, 3.4, 8.0, 0, 0.4, 0, M["cream"], bevel=0.06)
zbpy.GABLE(ASTX + "_gableN", 9.0, 1.8, 0.3, 0, 3.8, -3.9, M["cream"])
zbpy.GABLE(ASTX + "_gableS", 9.0, 1.8, 0.3, 0, 3.8, 3.9, M["cream"])
ang = math.radians(21.9)  # slope (0,5.6)->(5.1,3.55): eaves just past walls
B(ASTX + "_roofL", 6.0, 0.18, 8.8, -2.55, 4.49, 0, M["roofB"], tilt_z=ang)
B(ASTX + "_roofR", 6.0, 0.18, 8.8, 2.55, 4.49, 0, M["roofB"], tilt_z=-ang)
zbpy.BEAM_Z(ASTX + "_ridge", 0.16, 8.8, 0, 5.6, 0, M["timberD"], verts=8)
# gold trim caps on gable ends (thin ridge-end boxes)
B(ASTX + "_trimN", 0.5, 0.18, 0.5, 0, 5.55, -4.35, M["brass"])
B(ASTX + "_trimS", 0.5, 0.18, 0.5, 0, 5.55, 4.35, M["brass"])

# --- clock tower (front-center): shaft rises ABOVE main ridge (landmark read) ---
B(ASTX + "_tower", 2.2, 6.2, 2.2, 0, 0, 4.6, M["cream"], bevel=0.04)
B(ASTX + "_towerBand", 2.5, 0.25, 2.5, 0, 6.0, 4.6, M["stone"])
for px, pz in ((-0.9, 3.7), (0.9, 3.7), (-0.9, 5.5), (0.9, 5.5)):
    B(f"{ASTX}_belfry_{px}_{pz}", 0.22, 1.4, 0.22, px, 6.2, pz, M["timberD"])
zbpy.BALL(ASTX + "_bell", 0.35, 0, 6.7, 4.6, M["brass"])
zbpy.GABLE(ASTX + "_cupolaF", 2.6, 1.0, 0.25, 0, 7.6, 3.5, M["roofB"])
zbpy.GABLE(ASTX + "_cupolaB", 2.6, 1.0, 0.25, 0, 7.6, 5.7, M["roofB"])
B(ASTX + "_cupolaL", 2.4, 0.16, 2.5, -0.85, 8.02, 4.6, M["roofB"], tilt_z=math.radians(30))
B(ASTX + "_cupolaR", 2.4, 0.16, 2.5, 0.85, 8.02, 4.6, M["roofB"], tilt_z=-math.radians(30))
# clock face (ivory disc + timber rim + hands, facing +Z, no rotation hacks)
B(ASTX + "_clockRim", 1.2, 1.2, 0.1, 0, 3.6, 5.72, M["timberD"])
B(ASTX + "_clockFace", 0.95, 0.95, 0.12, 0, 3.6, 5.72, M["ivory"])
B(ASTX + "_handH", 0.1, 0.35, 0.14, -0.08, 3.65, 5.72, M["timberD"])
B(ASTX + "_handM", 0.08, 0.5, 0.14, 0.1, 3.7, 5.72, M["timberD"])

# --- grand stairs (3 steps, front) ---
B(ASTX + "_stair0", 4.0, 0.18, 1.0, 0, 0, 6.6, M["stone"])
B(ASTX + "_stair1", 3.6, 0.18, 0.7, 0, 0.18, 6.4, M["stone"])
B(ASTX + "_stair2", 3.2, 0.22, 0.5, 0, 0.36, 6.2, M["stone"])

# --- colonnade porch (4 posts + blue porch roof) ---
for px in (-3.6, -1.2, 1.2, 3.6):
    B(f"{ASTX}_porch{px}", 0.2, 2.6, 0.2, px, 0.4, 5.9, M["timberD"])
B(ASTX + "_porchRoof", 7.4, 0.14, 1.4, 0, 2.95, 5.9, M["roofB"])

# --- double door + windows (house idiom) ---
B(ASTX + "_doorFrame", 2.2, 2.4, 0.14, 0, 0.4, 4.02, M["timberD"])
B(ASTX + "_doorL", 0.9, 2.1, 0.16, -0.48, 0.4, 4.02, M["timberD"])
B(ASTX + "_doorR", 0.9, 2.1, 0.16, 0.48, 0.4, 4.02, M["timberD"])
for i, x in enumerate((-3.2, 3.2)):
    B(f"{ASTX}_winFrameF{i}", 1.1, 1.1, 0.1, x, 1.6, 4.0, M["timberD"])
    B(f"{ASTX}_winF{i}", 0.85, 0.85, 0.12, x, 1.6, 4.0, M["glass"])
    B(f"{ASTX}_sillF{i}", 1.2, 0.12, 0.28, x, 1.05, 4.05, M["timberD"])
for i, z in enumerate((-2.0, 2.0)):
    B(f"{ASTX}_winFrameW{i}", 0.1, 1.0, 1.0, -4.5, 1.6, z, M["timberD"])
    B(f"{ASTX}_winW{i}", 0.12, 0.75, 0.75, -4.5, 1.6, z, M["glass"])
    B(f"{ASTX}_winFrameE{i}", 0.1, 1.0, 1.0, 4.5, 1.6, z, M["timberD"])
    B(f"{ASTX}_winE{i}", 0.12, 0.75, 0.75, 4.5, 1.6, z, M["glass"])

# --- banner anchors (poles + fabric, flanking stairs) ---
for i, x in enumerate((-3.0, 3.0)):
    zbpy.CYL(f"{ASTX}_bannerPole{i}", 0.07, 3.2, x, 0, 7.2, M["timberD"], verts=8)
    B(f"{ASTX}_banner{i}", 0.7, 1.4, 0.06, x, 1.6, 7.2, M["fabricR"])

zbpy.EXPORT(OUT, ASTX)
print("exported", OUT)
