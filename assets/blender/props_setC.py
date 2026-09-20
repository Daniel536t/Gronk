# Props set C — harvest/market family (grain stack, woodpile, basket). Blender loop.
# run: blender --background --python assets/blender/props_setC.py
# New ids: ASTX_PROP_GRAINSTACK, ASTX_PROP_WOODPILE, ASTX_PROP_BASKET.
# Origin: ground center. Deterministic.
import math
import os
import random
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

bpy = zbpy.bpy
random.seed(920)


def wipe(prefix):
    for o in list(bpy.data.objects):
        if o.name.startswith(prefix):
            bpy.data.objects.remove(o, do_unlink=True)


M = {"grain": zbpy.MAT("M_grain", (0.87, 0.76, 0.52)),
     "grainD": zbpy.MAT("M_grainD", (0.72, 0.60, 0.38)),
     "timberD": zbpy.MAT("M_timberD", (0.36, 0.20, 0.09)),
     "bark": zbpy.MAT("M_bark", (0.52, 0.38, 0.25)),
     "cut": zbpy.MAT("M_cutWood", (0.82, 0.66, 0.44)),
     "wicker": zbpy.MAT("M_wicker", (0.70, 0.52, 0.32)),
     "fruitO": zbpy.MAT("M_fruitO", (1.0, 0.55, 0.15)),
     "fruitG": zbpy.MAT("M_fruitG", (0.50, 0.75, 0.30))}

B = lambda *a, **k: zbpy.BOX(*a, **k)


def finish(o, material):
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = False
    return o


def ground(prefix):
    low = min((o.matrix_world @ v.co).z
              for o in bpy.data.objects if o.name.startswith(prefix) and o.type == 'MESH'
              for v in o.data.vertices)
    for o in bpy.data.objects:
        if o.name.startswith(prefix) and o.type == 'MESH':
            o.location.z -= (low + 0.02)


# ---- GRAIN STACK (2.2m): stepped tapered cone stack + cap + tie band ----
P = "ASTX_PROP_GRAINSTACK"
wipe(P)
bpy.ops.mesh.primitive_cylinder_add(radius=0.85, depth=1.1, location=(0, 0, 0.55), vertices=9)
o = bpy.context.active_object
o.name = P + "_base"
zbpy._sel(o)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
me = o.data
for v in me.vertices:
    t = v.co.z / 1.1 + 0.5
    s = 1.0 - 0.25 * t + (random.random() - 0.5) * 0.06
    v.co.x *= s
    v.co.y *= s
me.update()
finish(o, M["grain"])
bpy.ops.mesh.primitive_cone_add(radius1=0.62, radius2=0.08, depth=0.9, location=(0, 0, 1.55), vertices=9)
c = bpy.context.active_object
c.name = P + "_cap"
finish(c, M["grainD"])
bpy.ops.mesh.primitive_torus_add(major_radius=0.72, minor_radius=0.04, location=(0, 0, 1.0), major_segments=12, minor_segments=6)
t = bpy.context.active_object
t.name = P + "_band"
finish(t, M["timberD"])
ground(P)
zbpy.EXPORT("/home/ubuntu/ba/assets/glb/ASTX_PROP_GRAINSTACK.glb", P)

# ---- WOODPILE (1.6m): stacked log rows + end posts ----
P = "ASTX_PROP_WOODPILE"
wipe(P)
import mathutils
for row in range(3):
    for k in range(5 - row):
        x = (k - (5 - row - 1) / 2) * 0.30
        y = 0.15 + row * 0.26
        bpy.ops.mesh.primitive_cylinder_add(radius=0.14, depth=1.5, location=(x, 0, y), vertices=8)
        o = bpy.context.active_object
        o.name = f"{P}_log{row}_{k}"
        o.rotation_euler[1] = math.pi / 2
        zbpy._sel(o)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
        zbpy._sel(o)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        finish(o, M["bark"])
        # cut end-grain: length-axis end caps get the pale cut slot
        o.data.materials.append(M["cut"])
        for p in o.data.polygons:
            if abs(p.normal.x) > 0.9:
                p.material_index = 1
for ex in (-0.75, 0.75):
    B(f"{P}_end{ex}", 0.12, 0.68, 0.12, ex, 0, 0, M["timberD"])
ground(P)
zbpy.EXPORT("/home/ubuntu/ba/assets/glb/ASTX_PROP_WOODPILE.glb", P)

# ---- BASKET (0.6m): tapered open basket + rim + produce mounds ----
P = "ASTX_PROP_BASKET"
wipe(P)
bpy.ops.mesh.primitive_cylinder_add(radius=0.30, depth=0.32, location=(0, 0, 0.16), vertices=10)
o = bpy.context.active_object
o.name = P + "_body"
zbpy._sel(o)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
me = o.data
for v in me.vertices:
    t = v.co.z / 0.32 + 0.5
    s = 0.8 + 0.35 * t  # flare outward to rim
    v.co.x *= s
    v.co.y *= s
me.update()
finish(o, M["wicker"])
bpy.ops.mesh.primitive_torus_add(major_radius=0.35, minor_radius=0.035, location=(0, 0, 0.32), major_segments=12, minor_segments=6)
r = bpy.context.active_object
r.name = P + "_rim"
finish(r, M["timberD"])
for i, (px, py, mat) in enumerate(((-0.1, 0.05, M["fruitO"]), (0.12, -0.06, M["fruitG"]), (0.0, 0.12, M["fruitO"]))):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=0.11, location=(px, py, 0.36), subdivisions=1)
    f = bpy.context.active_object
    f.name = f"{P}_fruit{i}"
    finish(f, mat)
ground(P)
zbpy.EXPORT("/home/ubuntu/ba/assets/glb/ASTX_PROP_BASKET.glb", P)

print("setC done")
