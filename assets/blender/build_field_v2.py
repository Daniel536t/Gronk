# ASTX_FIELD_PLOT v2 (zbpy) — run: blender --background --python assets/blender/build_field_v2.py
# Tilled field module: soil base, 5 ridge rows, timber borders, corner posts.
# EMPTY rows by design (crop tufts reconcile from snap.crops, never baked).
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

OUT = "/home/ubuntu/ba/assets/glb/ASTX_FIELD_PLOT.glb"
ASTX = "ASTX_FIELD_PLOT"
for o in list(zbpy.bpy.data.objects):
    if o.name.startswith(ASTX):
        zbpy.bpy.data.objects.remove(o, do_unlink=True)

M = {"soil": zbpy.MAT("M_soil", (0.36, 0.20, 0.09)),
     "soilD": zbpy.MAT("M_soilD", (0.28, 0.15, 0.07)),
     "timberD": zbpy.MAT("M_timberD", (0.36, 0.20, 0.09)),
     "grass": zbpy.MAT("M_grass", (0.37, 0.75, 0.35))}

B = lambda *a, **k: zbpy.BOX(*a, **k)
B(ASTX + "_soil", 12.0, 0.3, 8.0, 0, 0, 0, M["soil"])
B(ASTX + "_lipN", 12.6, 0.22, 0.6, 0, 0, -4.3, M["grass"])
B(ASTX + "_lipS", 12.6, 0.22, 0.6, 0, 0, 4.3, M["grass"])
widths = [1.0, 1.15, 0.95, 1.1, 1.0]
z = -3.2
for i, w in enumerate(widths):
    B(f"{ASTX}_ridge{i}", 11.2, 0.35, w, 0, 0.3, z + w / 2, M["soilD"] if i % 2 else M["soil"])
    z += w + 0.55
B(ASTX + "_edgeN", 12.4, 0.35, 0.25, 0, 0.05, -4.05, M["timberD"])
B(ASTX + "_edgeS", 12.4, 0.35, 0.25, 0, 0.05, 4.05, M["timberD"])
B(ASTX + "_edgeW", 0.25, 0.35, 8.4, -6.1, 0.05, 0, M["timberD"])
B(ASTX + "_edgeE", 0.25, 0.35, 8.4, 6.1, 0.05, 0, M["timberD"])
for x, zz in [(-6.1, -4.05), (6.1, -4.05), (-6.1, 4.05), (6.1, 4.05)]:
    B(f"{ASTX}_post{x}{zz}", 0.22, 0.9, 0.22, x, 0, zz, M["timberD"])
zbpy.EXPORT(OUT, ASTX)
