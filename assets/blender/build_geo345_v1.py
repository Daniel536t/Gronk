# ASTX geology 3-5: terraced hillside, coastal sea-stack, waterfall cleft.
# run: blender --background --python assets/blender/build_geo345_v1.py
# Same mass() language as build_geo12_v1.py (proven): displaced flat-shaded
# masses, strata terracing, grass caps fitted. Fiction Y-up intent, zbpy mapping.
import os
import random
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

bpy = zbpy.bpy
OUTD = "/home/ubuntu/ba/assets/glb"

M = {"stone": zbpy.MAT("M_geoStone", (0.55, 0.55, 0.58), 0.95),
     "stoneD": zbpy.MAT("M_geoStoneD", (0.40, 0.41, 0.45), 0.95),
     "grass": zbpy.MAT("M_grass", (0.37, 0.75, 0.35))}


def clear(prefix):
    for o in list(bpy.data.objects):
        if o.name.startswith(prefix):
            bpy.data.objects.remove(o, do_unlink=True)


def mass(name, w, h, d, x, y0, z, material, seed, jag=0.45, cuts=3, cap=None):
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


def carve_channel(obj_name, cx, cz, half_w, depth):
    """Carve a vertical waterfall cleft through a mass (edit-mode vertex pull)."""
    o = bpy.data.objects.get(obj_name)
    zbpy._sel(o)
    bpy.ops.object.mode_set(mode='EDIT')
    me = o.data
    for v in me.vertices:
        # fiction coords: channel along x=cx, z either side of cz
        if abs(v.co.x - cx) < half_w:
            v.co.z -= depth * max(0.0, 1.0 - abs(v.co.x - cx) / half_w)
    me.update()
    bpy.ops.object.mode_set(mode='OBJECT')


clear("ASTX_GEO_")
# 3. layered hillside: broad stepped terraces grass->rock (foothill dressing)
mass("ASTX_GEO_terrace", 22, 5, 14, 0, 0, 0, M["stone"], seed=301, jag=0.35, cuts=3,
     cap=(M["grass"], 0.5))
zbpy.EXPORT(OUTD + "/ASTX_GEO_TERRACE.glb", "ASTX_GEO_terrace")
clear("ASTX_GEO_")
# 4. coastal sea-stack: tall narrow pillar with grass crown (offshore marker)
mass("ASTX_GEO_stack", 6, 13, 6, 0, -3, 0, M["stoneD"], seed=302, jag=0.4, cuts=3,
     cap=(M["grass"], 0.6))
zbpy.EXPORT(OUTD + "/ASTX_GEO_STACK.glb", "ASTX_GEO_stack")
clear("ASTX_GEO_")
# 5. waterfall cleft mass: cliff block with carved central channel
mass("ASTX_GEO_fallRock", 10, 12, 7, 0, 0, 0, M["stone"], seed=303, jag=0.4, cuts=3,
     cap=(M["grass"], 0.6))
carve_channel("ASTX_GEO_fallRock", 0, 0, 1.6, 3.0)
zbpy.EXPORT(OUTD + "/ASTX_GEO_FALLROCK.glb", "ASTX_GEO_fallRock")
print("geo 3-5 done")
