# Shrub A — Blender-authored understory connector. run: blender --background --python assets/blender/veg_shrubA.py
# 3 merged foliage lobes (wider than tall), broken silhouette, gapped, ground
# flare (no stick, no floating). Real-Blender Z-up coords. deterministic seed.
import bpy
import os
import random
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

OUT = "/home/ubuntu/ba/assets/glb/ASTX_VEG_SHRUB_A.glb"
ASTX = "ASTX_VEG_SHRUB_A"
SEED = 307
bpy = zbpy.bpy
for o in list(bpy.data.objects):
    if o.name.startswith(ASTX):
        bpy.data.objects.remove(o, do_unlink=True)

M = {"leafD": zbpy.MAT("M_leafD", (0.18, 0.49, 0.23), 0.9),
     "leaf": zbpy.MAT("M_leaf", (0.25, 0.62, 0.28), 0.9),
     "leafL": zbpy.MAT("M_leafL", (0.37, 0.75, 0.35), 0.9)}

random.seed(SEED)


def finish(o, material):
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = False
    return o


def lobe(name, cx, cy, cz, r, squash, material, seed, sink=0.0):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=r, location=(cx, cy, cz), subdivisions=2)
    o = bpy.context.active_object
    o.name = name
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    random.seed(seed)
    me = o.data
    for v in me.vertices:
        n = (random.random() - 0.5) * 2 * 0.30 * r
        v.co.x += n * 0.8
        v.co.y += n * 0.8
        v.co.z += n * 0.45
        v.co.z *= squash
        if v.co.z < sink:  # ground flare: clamp skirt verts to earth
            v.co.z = sink + (v.co.z - sink) * 0.25
    me.update()
    return finish(o, material)


# low wide asymmetric triplet; lobes interpenetrate (merged read, gapped silhouette)
lobe(ASTX + "_lobeL", -0.42, -0.1, 0.52, 0.62, 0.72, M["leafD"], 21, sink=-0.15)
lobe(ASTX + "_lobeR", 0.44, 0.12, 0.48, 0.58, 0.70, M["leaf"], 22, sink=-0.15)
lobe(ASTX + "_lobeT", 0.02, 0.0, 0.86, 0.55, 0.78, M["leafL"], 23, sink=0.0)

# ground: drop assembly so lowest WORLD vertex sits slightly embedded.
# (verts are local — locations unapplied — so measure in world space and move
# the objects, preserving internal arrangement.)
low = min((o.matrix_world @ v.co).z
          for o in bpy.data.objects if o.name.startswith(ASTX) and o.type == 'MESH'
          for v in o.data.vertices)
print("GROUND-LOW", round(low, 3))
for o in bpy.data.objects:
    if o.name.startswith(ASTX) and o.type == 'MESH':
        o.location.z -= (low + 0.05)

zbpy.EXPORT(OUT, ASTX)
bpy.ops.wm.save_as_mainfile(
    filepath="/home/ubuntu/ba/artifacts/visual/vegetation-design/blender/shrub-a.blend")
print("exported", OUT)
