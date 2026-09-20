# Coral A — Blender-authored reef-shelf accent (blue/purple heads).
# run: blender --background --python assets/blender/veg_coralA.py
# Reference family 11: coral blue #3AA7C9 / purple #9B5DE5 on reef shelf.
# 3 branching staghorn clusters (angled tapered cylinders grown tip-to-tip,
# NOT stacked boxes) + 1 dome head + rock base. Deterministic seed 811.
# STAGED only.
import bpy
import math
import os
import random
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy
import mathutils

OUT = "/home/ubuntu/ba/assets/glb/ASTX_VEG_CORAL_A.glb"
ASTX = "ASTX_VEG_CORAL_A"
SEED = 811
bpy = zbpy.bpy
for o in list(bpy.data.objects):
    if o.name.startswith(ASTX):
        bpy.data.objects.remove(o, do_unlink=True)

M = {"coralB": zbpy.MAT("M_coralB", (0.23, 0.65, 0.79), 0.7),
     "coralP": zbpy.MAT("M_coralP", (0.61, 0.36, 0.90), 0.7),
     "rock": zbpy.MAT("M_coralRock", (0.45, 0.44, 0.40), 0.95)}

random.seed(SEED)


def finish(o, material):
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = False
    return o


# rock base
bpy.ops.mesh.primitive_ico_sphere_add(radius=0.30, location=(0, 0, -0.05), subdivisions=1)
base = bpy.context.active_object
base.name = ASTX + "_base"
zbpy._sel(base)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
me = base.data
for v in me.vertices:
    n = (random.random() - 0.5) * 0.12
    v.co.x += n
    v.co.y += n * 0.8
    v.co.z *= 0.6
me.update()
finish(base, M["rock"])


def limb(name, root, tip, r, material, taper=0.55, knob=True):
    # tapered (not piped): sculpt radius down toward local +Z tip BEFORE aiming,
    # plus a corallite knob at the tip so branches read as grown, not welded
    mx, my, mz = (root[0] + tip[0]) / 2, (root[1] + tip[1]) / 2, (root[2] + tip[2]) / 2
    dx, dy, dz = tip[0] - root[0], tip[1] - root[1], tip[2] - root[2]
    leng = math.sqrt(dx * dx + dy * dy + dz * dz)
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=leng, location=(mx, my, mz), vertices=6)
    o = bpy.context.active_object
    o.name = name
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    me = o.data
    for v in me.vertices:
        t = v.co.z / leng + 0.5  # 0 root .. 1 tip (local Z = length axis)
        s = 1.0 - taper * max(0.0, min(1.0, t))
        v.co.x *= s
        v.co.y *= s
    me.update()
    d = mathutils.Vector((dx, dy, dz)).normalized()
    q = mathutils.Vector((0, 0, 1)).rotation_difference(d)
    o.rotation_euler = q.to_euler()
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish(o, material)
    if knob:
        bpy.ops.mesh.primitive_ico_sphere_add(radius=r * 0.95, location=tip, subdivisions=1)
        k = bpy.context.active_object
        k.name = name + "_knob"
        finish(k, material)
    return tip


def cluster(prefix, cx, cy, mat, seed, h=0.55):
    random.seed(seed)
    # main stem + 2 fork tips each side
    top = (cx, cy, h)
    limb(f"{prefix}_stem", (cx, cy, 0.05), top, 0.055, mat)
    for s in range(4):
        a = s * math.pi / 2 + random.random() * 0.6
        tip = (cx + math.cos(a) * 0.28, cy + math.sin(a) * 0.28, h + 0.18 + random.random() * 0.12)
        limb(f"{prefix}_t{s}", top, tip, 0.035, mat)
        # sub-fork knobs
        knob = (tip[0] + math.cos(a) * 0.10, tip[1] + math.sin(a) * 0.10, tip[2] + 0.10)
        limb(f"{prefix}_k{s}", tip, knob, 0.022, mat)


cluster(ASTX + "_blue", -0.28, 0.05, M["coralB"], 81, 0.55)
cluster(ASTX + "_purp", 0.30, -0.08, M["coralP"], 82, 0.45)

# dome head: small displaced sphere (brain-coral read)
bpy.ops.mesh.primitive_ico_sphere_add(radius=0.20, location=(0.02, 0.28, 0.12), subdivisions=2)
dome = bpy.context.active_object
dome.name = ASTX + "_dome"
zbpy._sel(dome)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
me = dome.data
for v in me.vertices:
    n = (random.random() - 0.5) * 0.07
    v.co.x += n
    v.co.y += n
    v.co.z += abs(n) * 0.5
    if v.co.z < 0.0:
        v.co.z *= 0.2
me.update()
finish(dome, M["coralB"])

low = min((o.matrix_world @ v.co).z
          for o in bpy.data.objects if o.name.startswith(ASTX) and o.type == 'MESH'
          for v in o.data.vertices)
print("GROUND-LOW", round(low, 3))
for o in bpy.data.objects:
    if o.name.startswith(ASTX) and o.type == 'MESH':
        o.location.z -= (low + 0.02)

zbpy.EXPORT(OUT, ASTX)
bpy.ops.wm.save_as_mainfile(
    filepath="/home/ubuntu/ba/artifacts/visual/vegetation-design/blender/coral-a.blend")
print("exported", OUT)
