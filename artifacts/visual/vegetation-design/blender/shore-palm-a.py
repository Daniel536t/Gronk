# Shore Palm A — Blender-authored. run: blender --background --python assets/blender/veg_palmA.py
# Trunk: tapered, curved, ringed. Crown: 9 individually arched fronds (custom
# ribbon meshes: length segments x V-folded cross-section, tapered, drooped),
# varied lengths/angles/tilts, coconut cluster. Real-Blender Z-up coords.
import bpy
import math
import os
import random
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

OUT = "/home/ubuntu/ba/assets/glb/ASTX_VEG_PALM_A.glb"
ASTX = "ASTX_VEG_PALM_A"
SEED = 207
bpy = zbpy.bpy
for o in list(bpy.data.objects):
    if o.name.startswith(ASTX):
        bpy.data.objects.remove(o, do_unlink=True)

M = {"trunk": zbpy.MAT("M_trunkP", (0.45, 0.33, 0.22), 0.95),
     "crown": zbpy.MAT("M_crownP", (0.32, 0.55, 0.28), 0.9),
     "frond": zbpy.MAT("M_palmLeaf", (0.23, 0.62, 0.44), 0.9),
     "nut": zbpy.MAT("M_nut", (0.54, 0.35, 0.20), 0.9)}

random.seed(SEED)
H = 4.6  # trunk top


def finish(o, material, smooth=False):
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = smooth
    return o


# --- trunk: tapered cylinder, curved in x, ring bulges ---
bpy.ops.mesh.primitive_cylinder_add(radius=0.22, depth=H, location=(0, 0, H / 2), vertices=10)
trunk = bpy.context.active_object
trunk.name = ASTX + "_trunk"
zbpy._sel(trunk)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
me = trunk.data
for v in me.vertices:
    t = v.co.z / H
    s = 1.35 - 0.55 * t  # flare base -> taper top
    v.co.x = v.co.x * s + 0.5 * t * t
    v.co.y = v.co.y * s
    ring = 1.0 + 0.06 * math.sin(v.co.z * 9.0)  # ring texture
    v.co.x *= ring
    v.co.y *= ring
me.update()
finish(trunk, M["trunk"])

topx = 0.5  # trunk top after bend


# --- frond: custom arched ribbon mesh ---
def frond(name, yaw, tilt, length, width, droop, phase):
    # yaw: compass dir (Blender XY), tilt: elevation of frond base (deg, +up),
    # droop: tip curl-down amount, phase: twist variation
    segs, across = 7, 3
    verts = []
    dyaw = yaw + (random.random() - 0.5) * 0.12
    dx, dy = math.cos(dyaw), math.sin(dyaw)
    tilt_r = math.radians(tilt)
    for i in range(segs + 1):
        t = i / segs
        # arch: rise then droop
        reach = length * t
        lift = math.sin(tilt_r) * reach - droop * (t ** 2) * length * 0.55
        cx, cy = topx + dx * reach * math.cos(tilt_r), dy * reach * math.cos(tilt_r)
        cz = H + lift
        w = width * (1 - t * 0.85) / 2
        fold = 0.35 * w * math.sin(t * math.pi)  # V-fold peaks mid-frond
        verts.append((cx - dy * w, cy + dx * w, cz - fold))
        verts.append((cx, cy, cz + fold * 0.4))
        verts.append((cx + dy * w, cy - dx * w, cz - fold))
    faces = []
    for i in range(segs):
        r0 = i * across
        faces.append((r0, r0 + 1, r0 + 4, r0 + 3))
        faces.append((r0 + 1, r0 + 2, r0 + 5, r0 + 4))
    mesh = bpy.data.meshes.new(name + "_mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    return finish(o, M["frond"])


# 9 fronds: 3 tiers (upright spear leaves, mid archers, low droopers), jittered
tiers = [(3, 28, 2.5), (3, 2, 2.2), (3, -24, 2.0)]
fi = 0
for count, tilt, base_len in tiers:
    for k in range(count):
        yaw = (fi / 9.0) * math.pi * 2 + (random.random() - 0.5) * 0.35
        frond(f"{ASTX}_frond{fi:02d}", yaw, tilt + (random.random() - 0.5) * 10,
              base_len * (0.88 + random.random() * 0.24), 0.34,
              0.9 + random.random() * 0.5, fi)
        fi += 1

# coconuts under crown
for i in range(3):
    a = i * 2.1 + 0.4
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=0.16, location=(topx + math.cos(a) * 0.3, math.sin(a) * 0.3, H - 0.25))
    o = bpy.context.active_object
    o.name = f"{ASTX}_nut{i}"
    finish(o, M["nut"])

zbpy.EXPORT(OUT, ASTX)
bpy.ops.wm.save_as_mainfile(
    filepath="/home/ubuntu/ba/artifacts/visual/vegetation-design/blender/shore-palm-a.blend")
print("exported", OUT)
