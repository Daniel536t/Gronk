# ASTX_BUILDING_GREENHOUSE v2 — greenhouse, full Blender art loop.
# run: blender --background --python assets/blender/build_greenhouse_v2.py
# Replaces tools/build_glbs.py glass-box primitive (same id, manifest safe).
# Reference: white frame rhythm, gabled TRANSLUCENT glazing (alpha blend),
# planter rows visible inside, stone curb foundation, end door.
# Authored via zbpy (fiction Y-up intent). Origin: ground center.
import math
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

OUT = "/home/ubuntu/ba/assets/glb/ASTX_BUILDING_GREENHOUSE.glb"
ASTX = "ASTX_BUILDING_GREENHOUSE"
for o in list(zbpy.bpy.data.objects):
    if o.name.startswith(ASTX):
        zbpy.bpy.data.objects.remove(o, do_unlink=True)

M = {"frame": zbpy.MAT("M_frameWh", (0.92, 0.92, 0.88)),
     "stone": zbpy.MAT("M_stone", (0.60, 0.60, 0.63)),
     "soil": zbpy.MAT("M_soilBed", (0.35, 0.24, 0.15)),
     "crop": zbpy.MAT("M_cropRow", (0.30, 0.62, 0.28)),
     "timberD": zbpy.MAT("M_timberD", (0.36, 0.20, 0.09))}
gm = zbpy.MAT("M_greenGlass", (0.75, 0.92, 0.95), 0.25)
gm.blend_method = 'BLEND'
gm.node_tree.nodes.get("Principled BSDF").inputs["Alpha"].default_value = 0.35
M["glass"] = gm

B = lambda *a, **k: zbpy.BOX(*a, **k)
W, D, WH = 4.5, 7.0, 1.7  # walls to 1.7, ridge 3.4

# --- stone curb + corner posts + rails ---
B(ASTX + "_curb", W + 0.4, 0.4, D + 0.4, 0, 0, 0, M["stone"], bevel=0.04)
for cx, cz in ((-W / 2, -D / 2), (W / 2, -D / 2), (-W / 2, D / 2), (W / 2, D / 2)):
    B(f"{ASTX}_corner{cx}{cz}", 0.18, WH, 0.18, cx, 0.4, cz, M["frame"])
for y in (0.45, 2.0):
    B(f"{ASTX}_railN{y}", W, 0.12, 0.12, 0, y, -D / 2, M["frame"])
    B(f"{ASTX}_railS{y}", W, 0.12, 0.12, 0, y, D / 2, M["frame"])
    B(f"{ASTX}_railW{y}", 0.12, 0.12, D, -W / 2, y, 0, M["frame"])
    B(f"{ASTX}_railE{y}", 0.12, 0.12, D, W / 2, y, 0, M["frame"])

# --- glass walls (between rails) ---
B(ASTX + "_glassN", W, 1.5, 0.06, 0, 0.5, -D / 2, M["glass"])
B(ASTX + "_glassS", W, 1.5, 0.06, 0, 0.5, D / 2, M["glass"])
B(ASTX + "_glassW", 0.06, 1.5, D, -W / 2, 0.5, 0, M["glass"])
B(ASTX + "_glassE", 0.06, 1.5, D, W / 2, 0.5, 0, M["glass"])
# mullions over glass (frame rhythm)
x = -W / 2 + 1.1
while x < W / 2 - 0.5:
    B(f"{ASTX}_mullN{x:.2f}", 0.1, 1.5, 0.1, x, 0.5, -D / 2, M["frame"])
    B(f"{ASTX}_mullS{x:.2f}", 0.1, 1.5, 0.1, x, 0.5, D / 2, M["frame"])
    x += 1.1
z = -D / 2 + 1.15
while z < D / 2 - 0.5:
    B(f"{ASTX}_mullW{z:.2f}", 0.1, 1.5, 0.1, -W / 2, 0.5, z, M["frame"])
    B(f"{ASTX}_mullE{z:.2f}", 0.1, 1.5, 0.1, W / 2, 0.5, z, M["frame"])
    z += 1.15

# --- gabled glass roof + ridge + purlins ---
zbpy.GABLE(ASTX + "_gableN", W, 1.7, 0.25, 0, WH, -D / 2, M["glass"])
zbpy.GABLE(ASTX + "_gableS", W, 1.7, 0.25, 0, WH, D / 2, M["glass"])
ang = math.radians(29)  # slope (0,3.4)->(2.55,2.0): eaves clear of walls
B(ASTX + "_roofW", 3.2, 0.08, D + 0.4, -1.275, 2.66, 0, M["glass"], tilt_z=ang)
B(ASTX + "_roofE", 3.2, 0.08, D + 0.4, 1.275, 2.66, 0, M["glass"], tilt_z=-ang)
zbpy.BEAM_Z(ASTX + "_ridge", 0.09, D + 0.4, 0, 3.42, 0, M["frame"], verts=8)
for px in (-1.28, 1.28):
    B(f"{ASTX}_purlin{px}", 0.1, 0.1, D + 0.4, px, 2.78, 0, M["frame"])

# --- end door (S): frame + glass panel ---
B(ASTX + "_doorFrameL", 0.14, 1.6, 0.14, -0.55, 0.4, D / 2 + 0.02, M["frame"])
B(ASTX + "_doorFrameR", 0.14, 1.6, 0.14, 0.55, 0.4, D / 2 + 0.02, M["frame"])
B(ASTX + "_doorTop", 1.24, 0.14, 0.14, 0, 1.9, D / 2 + 0.02, M["frame"])
B(ASTX + "_door", 0.96, 1.5, 0.08, 0, 0.42, D / 2 + 0.02, M["glass"])

# --- interior planter rows (visible through glass) ---
for bx in (-1.1, 1.1):
    B(f"{ASTX}_bed{bx}", 1.3, 0.35, 5.6, bx, 0.4, 0, M["soil"])
    for i in range(6):
        B(f"{ASTX}_seed{bx}_{i}", 0.28, 0.3, 0.28, bx, 0.75, -2.2 + i * 0.88, M["crop"])

zbpy.EXPORT(OUT, ASTX)
print("exported", OUT)
