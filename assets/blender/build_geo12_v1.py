# ASTX geology 1-2: cliff mass + exposed rock. run: blender --background --python <this>
# Orientation system (zbpy, PROVEN): fiction Y-up intent -> real-Blender Z-up
# content via (x,y,z)->(x,-z,y); exporter converts to Y-up files. Verify by RAW
# byte parse, never by viewport impression alone.
import os
import random
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

bpy = zbpy.bpy
OUTD = "/home/ubuntu/ba/assets/glb"

M = {"stone": zbpy.MAT("M_geoStone", (0.55, 0.55, 0.58), 0.95),
     "stoneD": zbpy.MAT("M_geoStoneD", (0.40, 0.41, 0.45), 0.95),
     "grass": zbpy.MAT("M_grass", (0.37, 0.75, 0.35)),
     "sand": zbpy.MAT("M_sand", (0.91, 0.81, 0.60))}


def clear(prefix):
    for o in list(bpy.data.objects):
        if o.name.startswith(prefix):
            bpy.data.objects.remove(o, do_unlink=True)


def mass(name, w, h, d, x, y0, z, material, seed, jag=0.45, cuts=3, cap=None):
    """Displaced rock mass. Fiction args (w,h,d @ (x,y0,z), y0 = base height).
    Real-Blender: dims (w,d,h) at (x,-z,y0+h/2); strata quantized on real Z."""
    bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    o.dimensions = (w, d, h)
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.subdivide(number_cuts=cuts)
    bpy.ops.object.mode_set(mode='OBJECT')
    random.seed(seed)
    me = o.data
    for v in me.vertices:
        fx = abs(v.co.x / (w / 2 + 1e-6))
        q = round(v.co.z / 1.4) * 1.4
        v.co.z = v.co.z * 0.45 + q * 0.55
        v.co.x += (random.random() - 0.5) * jag * w * 0.22 * fx
        v.co.y += (random.random() - 0.5) * jag * d * 0.22
    me.update()
    o.location = (x, -z, y0 + h / 2)
    zbpy._sel(o)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    for p in me.polygons:
        p.use_smooth = False
    o.data.materials.append(material)
    if cap:
        cmat, cth = cap
        mass(name + "_cap", w * 0.92, cth, d * 0.92, x, y0 + h - 0.15, z,
             cmat, seed + 1000, jag * 0.7, cuts=2)
    return o


clear("ASTX_GEO_")
mass("ASTX_GEO_cliffMass", 14, 11, 9, 0, 0, 0, M["stone"], seed=41, jag=0.5, cuts=3,
     cap=(M["grass"], 0.7))
zbpy.EXPORT(OUTD + "/ASTX_GEO_CLIFFMASS.glb", "ASTX_GEO_cliffMass")
clear("ASTX_GEO_")
mass("ASTX_GEO_rockBig", 5, 4, 4.5, 0, 0, 0, M["stoneD"], seed=97, jag=0.65, cuts=2)
zbpy.EXPORT(OUTD + "/ASTX_GEO_ROCKBIG.glb", "ASTX_GEO_rockBig")
print("geo 1-2 done")
