# Flower Cluster — Blender-authored accent. run: blender --background --python assets/blender/veg_flowerA.py
# 7 stems (varied height/lean) with bud+petal heads: center bud sphere + 5 petal
# quads angled outward, 3 palette colors distributed. Leaf pair at stem mid.
# Real-Blender Z-up. deterministic seed 507.
import bpy
import math
import os
import random
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

OUT = "/home/ubuntu/ba/assets/glb/ASTX_VEG_FLOWERS_A.glb"
ASTX = "ASTX_VEG_FLOWERS_A"
SEED = 507
bpy = zbpy.bpy
for o in list(bpy.data.objects):
    if o.name.startswith(ASTX):
        bpy.data.objects.remove(o, do_unlink=True)

M = {"stem": zbpy.MAT("M_stem", (0.25, 0.45, 0.22), 0.95),
     "pink": zbpy.MAT("M_flowerPk", (1.0, 0.43, 0.78), 0.7),
     "white": zbpy.MAT("M_flowerWh", (0.96, 0.94, 0.91), 0.7),
     "yellow": zbpy.MAT("M_flowerYl", (1.0, 0.85, 0.30), 0.7)}

random.seed(SEED)


def finish(o, material):
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = False
    return o


def stem(name, x, y, h, lean, material):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.015, depth=h, location=(x, y, h / 2), vertices=5)
    o = bpy.context.active_object
    o.name = name
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    me = o.data
    for v in me.vertices:
        t = v.co.z / h
        v.co.x += lean[0] * t * t
        v.co.y += lean[1] * t * t
    me.update()
    # world-space grounding handled at assembly end
    return finish(o, material)


def head(name, cx, cy, cz, r, material):
    # bud sphere + 5 angled petal quads
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r * 0.45, location=(cx, cy, cz))
    o = bpy.context.active_object
    o.name = name + "_bud"
    finish(o, material)
    for k in range(5):
        a = k * 2 * math.pi / 5 + random.random() * 0.3
        px, py = cx + math.cos(a) * r * 0.8, cy + math.sin(a) * r * 0.8
        mesh = bpy.data.meshes.new(name + f"_p{k}_mesh")
        s = r * 0.55
        mesh.from_pydata(
            [(px - s, py - s * 0.4, cz - 0.02), (px + s, py + s * 0.4, cz - 0.02),
             (px + s * 0.4, py + s, cz + 0.06), (px - s * 0.4, py - s, cz + 0.06)],
            [], [(0, 1, 2, 3)])
        mesh.update()
        po = bpy.data.objects.new(name + f"_p{k}", mesh)
        bpy.context.collection.objects.link(po)
        finish(po, material)


colors = [M["pink"], M["white"], M["yellow"]]
for i in range(7):
    a = (i / 7.0) * math.pi * 2 + (random.random() - 0.5) * 0.4
    rr = 0.05 + random.random() * 0.16
    x, y = math.cos(a) * rr, math.sin(a) * rr
    h = 0.22 + random.random() * 0.20
    stem(f"{ASTX}_stem{i:02d}", x, y, h, ((random.random() - 0.5) * 0.12,) * 2, M["stem"])
    head(f"{ASTX}_fl{i:02d}", x, y, h + 0.02, 0.055 + random.random() * 0.02, colors[i % 3])

# leaf pair on two stems
for i, (x, y) in enumerate([(0.08, 0.02), (-0.07, -0.05)]):
    mesh = bpy.data.meshes.new(f"{ASTX}_leaf{i}_mesh")
    mesh.from_pydata([(x, y, 0.12), (x + 0.09, y + 0.02, 0.14),
                      (x + 0.04, y + 0.01, 0.22), (x - 0.05, y - 0.01, 0.20)],
                     [], [(0, 1, 2, 3)])
    mesh.update()
    o = bpy.data.objects.new(f"{ASTX}_leaf{i}", mesh)
    bpy.context.collection.objects.link(o)
    finish(o, M["stem"])

low = min((o.matrix_world @ v.co).z
          for o in bpy.data.objects if o.name.startswith(ASTX) and o.type == 'MESH'
          for v in o.data.vertices)
for o in bpy.data.objects:
    if o.name.startswith(ASTX) and o.type == 'MESH':
        o.location.z -= (low + 0.01)

zbpy.EXPORT(OUT, ASTX)
bpy.ops.wm.save_as_mainfile(
    filepath="/home/ubuntu/ba/artifacts/visual/vegetation-design/blender/flower-cluster.blend")
print("exported", OUT)
