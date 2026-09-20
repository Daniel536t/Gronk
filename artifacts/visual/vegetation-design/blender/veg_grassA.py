# Grass Tuft — Blender-authored ground mass. run: blender --background --python assets/blender/veg_grassA.py
# Cluster of 9 tapered blades: varied lean/height/rotation, V-folded cross
# section (3 verts across), pointed tips. Real-Blender Z-up. deterministic.
import bpy
import math
import os
import random
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

OUT = "/home/ubuntu/ba/assets/glb/ASTX_VEG_GRASS_A.glb"
ASTX = "ASTX_VEG_GRASS_A"
SEED = 407
bpy = zbpy.bpy
for o in list(bpy.data.objects):
    if o.name.startswith(ASTX):
        bpy.data.objects.remove(o, do_unlink=True)

M = {"grass": zbpy.MAT("M_grassTuft", (0.32, 0.68, 0.30), 0.95),
     "grassD": zbpy.MAT("M_grassTuftD", (0.25, 0.55, 0.24), 0.95)}

random.seed(SEED)


def finish(o, material):
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = False
    return o


def blade(name, yaw, lean, length, width, material):
    # tapered 4-sided spike leaning outward; base at origin
    segs = 3
    verts = []
    dx, dy = math.cos(yaw), math.sin(yaw)
    for i in range(segs + 1):
        t = i / segs
        cx, cy = dx * lean * t * length, dy * lean * t * length
        cz = t * length
        w = width * (1 - t * 0.9) / 2
        # diamond cross-section shrinking to a point
        verts.append((cx - dy * w, cy + dx * w, cz))
        verts.append((cx + dy * w, cy - dx * w, cz))
        verts.append((cx, cy, cz + w * 0.5))
        verts.append((cx, cy, cz - w * 0.5))
    faces = []
    for i in range(segs):
        r0 = i * 4
        faces.append((r0, r0 + 1, r0 + 5, r0 + 4))
        faces.append((r0 + 1, r0 + 3, r0 + 7, r0 + 5))
        faces.append((r0 + 3, r0 + 2, r0 + 6, r0 + 7))
        faces.append((r0 + 2, r0, r0 + 4, r0 + 6))
    mesh = bpy.data.meshes.new(name + "_mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    return finish(o, material)


for i in range(9):
    yaw = (i / 9.0) * math.pi * 2 + (random.random() - 0.5) * 0.5
    blade(f"{ASTX}_blade{i:02d}", yaw, 0.15 + random.random() * 0.35,
          0.35 + random.random() * 0.25, 0.09,
          M["grass"] if i % 3 else M["grassD"])

# ground the assembly in world space (locations unapplied: measure world)
low = min((o.matrix_world @ v.co).z
          for o in bpy.data.objects if o.name.startswith(ASTX) and o.type == 'MESH'
          for v in o.data.vertices)
for o in bpy.data.objects:
    if o.name.startswith(ASTX) and o.type == 'MESH':
        o.location.z -= (low + 0.02)

zbpy.EXPORT(OUT, ASTX)
bpy.ops.wm.save_as_mainfile(
    filepath="/home/ubuntu/ba/artifacts/visual/vegetation-design/blender/grass-tuft.blend")
print("exported", OUT)
