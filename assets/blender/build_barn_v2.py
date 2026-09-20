# ASTX_BUILDING_BARN v2 — barn, full Blender art loop.
# run: blender --background --python assets/blender/build_barn_v2.py
# Replaces tools/build_glbs.py black-box primitive (same id, manifest safe).
# Reference: LONG working barn (5.5 x 10m, ridge along Z per house idiom), blue
# gabled roof, weathered timber, OPEN east side (dark interior + grain stacks),
# sliding doors on S gable, gable vent, lean-to shed on W, stone base.
# Authored via zbpy (fiction Y-up intent). Origin: ground center.
import math
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

OUT = "/home/ubuntu/ba/assets/glb/ASTX_BUILDING_BARN.glb"
ASTX = "ASTX_BUILDING_BARN"
for o in list(zbpy.bpy.data.objects):
    if o.name.startswith(ASTX):
        zbpy.bpy.data.objects.remove(o, do_unlink=True)

M = {"timber": zbpy.MAT("M_barnTimber", (0.55, 0.36, 0.20)),
     "timberD": zbpy.MAT("M_timberD", (0.36, 0.20, 0.09)),
     "roofB": zbpy.MAT("M_roofB", (0.18, 0.50, 0.79)),
     "stone": zbpy.MAT("M_stone", (0.60, 0.60, 0.63)),
     "dark": zbpy.MAT("M_barnDark", (0.16, 0.11, 0.07)),
     "grain": zbpy.MAT("M_grain", (0.87, 0.76, 0.52)),
     "glass": zbpy.MAT("M_glass", (0.62, 0.85, 0.92))}

B = lambda *a, **k: zbpy.BOX(*a, **k)
W, D = 5.5, 10.0  # long axis Z (ridge along Z, house idiom)

# --- stone base + closed walls (N/S/W; E open) ---
B(ASTX + "_base", W + 0.4, 0.5, D + 0.4, 0, 0, 0, M["stone"], bevel=0.05)
B(ASTX + "_wallN", W, 2.8, 0.25, 0, 0.5, -D / 2, M["timber"])
B(ASTX + "_wallS", W, 2.8, 0.25, 0, 0.5, D / 2, M["timber"])
B(ASTX + "_wallW", 0.25, 2.8, D, -W / 2, 0.5, 0, M["timber"])
# corner boards + girts + battens (timber framing read)
for cx, cz in ((-W / 2, -D / 2), (W / 2, -D / 2), (-W / 2, D / 2), (W / 2, D / 2)):
    B(f"{ASTX}_corner{cx}{cz}", 0.35, 3.0, 0.35, cx, 0.5, cz, M["timberD"])
for gy in (1.1, 2.2, 3.0):
    B(f"{ASTX}_girtN{gy}", W, 0.14, 0.1, 0, gy, -D / 2 + 0.14, M["timberD"])
    B(f"{ASTX}_girtW{gy}", 0.1, 0.14, D, -W / 2 + 0.14, gy, 0, M["timberD"])
z = -D / 2 + 0.75
while z < D / 2 - 0.5:
    B(f"{ASTX}_bat{z:.2f}", 0.1, 2.6, 0.12, -W / 2 + 0.12, 0.6, z, M["timberD"])
    z += 1.5

# --- open east side: posts + header beam + dark interior + grain stacks ---
for pz in (-D / 2 + 0.5, -1.7, 1.7, D / 2 - 0.5):
    B(f"{ASTX}_post{pz:.1f}", 0.22, 2.9, 0.22, W / 2, 0.5, pz, M["timberD"])
B(ASTX + "_header", 0.24, 0.3, D, W / 2, 3.1, 0, M["timberD"])
# interior: dark BACK panel only (depth cue) + grain stacks FORWARD between posts
B(ASTX + "_backwall", 0.2, 2.6, D - 0.6, -2.2, 0.5, 0, M["timber"])
B(ASTX + "_loftfloor", W - 1.0, 0.18, D - 0.8, 0.2, 2.5, 0, M["timberD"])
# one stack inside (shade) + two in the sunlit yard (cream read sells the farm)
B(ASTX + "_stackIn", 1.4, 1.0, 1.1, 1.3, 0.5, 0.2, M["grain"])
B(ASTX + "_stackInTop", 1.1, 0.45, 0.85, 1.3, 1.5, 0.2, M["grain"])
for i, (gx, gz) in enumerate(((4.6, -3.2), (4.6, 3.2))):
    B(f"{ASTX}_stackY{i}", 1.4, 1.1, 1.2, gx, 0, gz, M["grain"])
    B(f"{ASTX}_stackYTop{i}", 1.1, 0.5, 0.9, gx, 1.1, gz, M["grain"])

# --- gables + blue roof (ridge along Z) ---
zbpy.GABLE(ASTX + "_gableN", W, 2.0, 0.3, 0, 3.3, -D / 2, M["timber"])
zbpy.GABLE(ASTX + "_gableS", W, 2.0, 0.3, 0, 3.3, D / 2, M["timber"])
ang = math.radians(32)
B(ASTX + "_roofW", 4.2, 0.18, D + 1.2, -1.85, 4.15, 0, M["roofB"], tilt_z=ang)
B(ASTX + "_roofE", 4.2, 0.18, D + 1.2, 1.85, 4.15, 0, M["roofB"], tilt_z=-ang)
zbpy.BEAM_Z(ASTX + "_ridge", 0.16, D + 1.2, 0, 5.5, 0, M["timberD"], verts=8)

# --- sliding doors on S gable + rail + gable vent ---
B(ASTX + "_rail", W - 1.0, 0.14, 0.14, 0, 2.7, D / 2 + 0.18, M["timberD"])
B(ASTX + "_doorL", 1.7, 2.2, 0.12, -1.35, 0.5, D / 2 + 0.2, M["timberD"])
B(ASTX + "_doorR", 1.7, 2.2, 0.12, 1.35, 0.5, D / 2 + 0.2, M["timberD"])
B(ASTX + "_braceL", 1.9, 0.14, 0.1, -1.35, 1.4, D / 2 + 0.28, M["timber"], tilt_z=math.radians(38))
B(ASTX + "_braceR", 1.9, 0.14, 0.1, 1.35, 1.4, D / 2 + 0.28, M["timber"], tilt_z=-math.radians(38))
for i in range(3):
    B(f"{ASTX}_vent{i}", 1.2, 0.12, 0.1, 0, 3.9 + i * 0.3, D / 2 + 0.16, M["timberD"])
# small loft window N
B(ASTX + "_winFrameN", 0.9, 0.9, 0.1, -1.2, 1.7, -D / 2 - 0.02, M["timberD"])
B(ASTX + "_winN", 0.7, 0.7, 0.12, -1.2, 1.7, -D / 2 - 0.02, M["glass"])

# --- lean-to shed on W (posts + sloped roof): agricultural motif ---
for pz in (-3.5, 0, 3.5):
    B(f"{ASTX}_shedPost{pz}", 0.16, 2.5, 0.16, -W / 2 - 1.6, 0, pz, M["timberD"])
B(ASTX + "_shedRoof", 2.2, 0.12, 8.0, -W / 2 - 0.8, 2.6, 0, M["timberD"], tilt_z=-math.radians(14))
B(ASTX + "_woodpile", 1.2, 0.8, 2.5, -W / 2 - 0.9, 0, 1.0, M["timber"])

zbpy.EXPORT(OUT, ASTX)
print("exported", OUT)
