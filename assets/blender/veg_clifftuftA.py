# Cliff Tuft — Blender-authored ledge vegetation. run: blender --background --python assets/blender/veg_clifftuftA.py
# Low mat of 6 small rosettes (star spikes) + 3 trailing strands over edges,
# mossy grey-green. Small by contract (~0.5m): must never obscure geology.
# Real-Blender Z-up. deterministic seed 707.
import bpy
import math
import os
import random
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

OUT = "/home/ubuntu/ba/assets/glb/ASTX_VEG_CLIFFTUFT_A.glb"
ASTX = "ASTX_VEG_CLIFFTUFT_A"
SEED = 707
bpy = zbpy.bpy
for o in list(bpy.data.objects):
    if o.name.startswith(ASTX):
        bpy.data.objects.remove(o, do_unlink=True)

M = {"moss": zbpy.MAT("M_moss", (0.35, 0.52, 0.28), 0.95),
     "mossD": zbpy.MAT("M_mossD", (0.27, 0.42, 0.22), 0.95)}

random.seed(SEED)


def finish(o, material):
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = False
    return o


def rosette(name, cx, cy, cz, r, material):
    # (centers spread wide; spikes are the visible structure, crown is minor)
    # 8 spikes radiating low around center + short crown cone
    for k in range(8):
        a = k * math.pi / 4 + random.random() * 0.3
        leng = r * (1.1 + random.random() * 0.6)
        tilt = 0.5 + random.random() * 0.5  # mostly flat, some lift
        bpy.ops.mesh.primitive_cone_add(
            radius1=0.035, radius2=0.004, depth=leng,
            location=(cx + math.cos(a) * leng * 0.4, cy + math.sin(a) * leng * 0.4, cz + leng * 0.18),
            vertices=5)
        o = bpy.context.active_object
        o.name = f"{name}_sp{k:02d}"
        o.rotation_euler[1] = math.pi / 2 - tilt
        o.rotation_euler[2] = -a
        zbpy._sel(o)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
        zbpy._sel(o)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        finish(o, material)
    bpy.ops.mesh.primitive_cone_add(radius1=r * 0.35, radius2=0.01, depth=r * 0.5,
                                    location=(cx, cy, cz + r * 0.2), vertices=7)
    o = bpy.context.active_object
    o.name = name + "_crown"
    finish(o, material)


for i, (x, y) in enumerate([(0, 0), (0.34, 0.14), (-0.28, 0.2), (0.08, -0.3), (-0.16, -0.26), (0.36, -0.14)]):
    rosette(f"{ASTX}_ros{i:02d}", x, y, 0.02, 0.16, M["moss"] if i % 2 else M["mossD"])

# 3 trailing strands over the (putative) ledge edge, +X side
for i in range(3):
    bpy.ops.mesh.primitive_cone_add(radius1=0.03, radius2=0.004, depth=0.4,
                                    location=(0.3 + i * 0.08, -0.1 + i * 0.09, -0.12), vertices=5)
    o = bpy.context.active_object
    o.name = f"{ASTX}_trail{i:02d}"
    o.rotation_euler[1] = math.pi / 2 + 0.5
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish(o, M["mossD"])

low = min((o.matrix_world @ v.co).z
          for o in bpy.data.objects if o.name.startswith(ASTX) and o.type == 'MESH'
          for v in o.data.vertices)
for o in bpy.data.objects:
    if o.name.startswith(ASTX) and o.type == 'MESH':
        o.location.z -= (low + 0.01)

zbpy.EXPORT(OUT, ASTX)
bpy.ops.wm.save_as_mainfile(
    filepath="/home/ubuntu/ba/artifacts/visual/vegetation-design/blender/cliff-tuft.blend")
print("exported", OUT)
