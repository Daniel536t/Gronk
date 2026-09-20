# zbpy — shared TRUE-Z-up authoring helpers for ASTrix Blender scripts.
# Iteration-05 axis audit, final resolution:
#   * Blender viewports are Z-up; the glTF exporter converts Z-up .blend to
#     Y-up files. Our old scripts authored fictional-Y-up numbers directly AND
#     added euler "corrections" that fought the exporter. Three.js showed the
#     truth (sideways content); the turntable masked it (it un-does conversion).
#   * These helpers take FICTION coordinates (Y-up intent: heights in Y, front
#     +Z — the same numbers Three.js must finally contain) and author the
#     equivalent TRUE-Z-up Blender content via R = Rx(+90): (x,y,z)->(x,-z,y).
#   * Cylinders/cones/tori: native Z-axial primitives ARE already correct in
#     Z-up Blender — no euler hacks, ever. Boxes: swapped dims. Tilts about
#     fiction-Z become euler-Y(-theta).
#   * After export, the FILE contains fiction numbers verbatim (verify by RAW
#     byte parse — never trust viewport/BB probes alone for orientation).
#   * NEVER run tools/fix_glb_yup.py on files built with these helpers
#     (it was the wrong fix for the old scripts and corrupts correct files).
import bpy
import math


def MAT(name, rgba, rough=0.85, emission=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*rgba, 1.0)
    b.inputs["Roughness"].default_value = rough
    if emission:
        b.inputs["Emission Color"].default_value = (*emission, 1.0)
        b.inputs["Emission Strength"].default_value = 3.0
    return m


def _sel(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def _finish(o, material, smooth=False):
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = smooth
    return o


def BOX(name, w, h, d, x, y0, z, material, bevel=0.0, tilt_z=0.0):
    """Fiction box (w,h,d @ (x,y0,z), optional tilt about fiction-Z)."""
    bpy.ops.mesh.primitive_cube_add(size=2, location=(x, -z, y0 + h / 2))
    o = bpy.context.active_object
    o.name = name
    o.dimensions = (w, d, h)
    if tilt_z:
        o.rotation_euler[1] = -tilt_z
        _sel(o)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    _sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        mod = o.modifiers.new("bev", 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = 'ANGLE'
        _sel(o)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=False)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return _finish(o, material)


def CYL(name, r, h, x, y0, z, material, r2=None, verts=16, smooth=True):
    """Fiction-upright cylinder/cone (axis = fiction Y). Native primitive +
    NO euler: R mapping keeps native Z-axial correct after export."""
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, location=(x, -z, y0 + h / 2), vertices=verts)
    else:
        # radius1 must end DOWN (-Z real): native radius1 sits at -Z already.
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=h,
                                        location=(x, -z, y0 + h / 2), vertices=verts)
    o = bpy.context.active_object
    o.name = name
    _sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(o, material, smooth)


def BEAM_Z(name, r, length, x, y, z, material, verts=10):
    """Beam along fiction-Z (ridge caps, axles facing viewer). Fiction ẑ maps
    to real −Y, so rotate the native Z-axial cylinder +90° about X, then place
    at mapped P(x,y,z). Verified by raw-parse (ridge spans fiction-Z)."""
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=length, location=(x, -z, y), vertices=verts)
    o = bpy.context.active_object
    o.name = name
    o.rotation_euler[0] = math.pi / 2
    _sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    _sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(o, material)


def RING(name, major, minor, x, y0, z, material, major_seg=24, minor_seg=8):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
                                     location=(x, -z, y0), major_segments=major_seg,
                                     minor_segments=minor_seg)
    o = bpy.context.active_object
    o.name = name
    _sel(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(o, material)


def BALL(name, r, x, y, z, material):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=(x, -z, y))
    o = bpy.context.active_object
    o.name = name
    return _finish(o, material)


def GABLE(name, w, h, d, x, y0, z, material):
    """Fiction gable prism (ridge along fiction Z). Verts mapped to real."""
    m = bpy.data.meshes.new(name + "_mesh")
    x0, x1, y1, z0, z1 = x - w / 2, x + w / 2, y0 + h, z - d / 2, z + d / 2
    raw = [(x0, y0, z0), (x1, y0, z0), (x, y1, z0),
           (x0, y0, z1), (x1, y0, z1), (x, y1, z1)]
    verts = [(vx, -vz, vy) for (vx, vy, vz) in raw]
    faces = [(0, 2, 1), (3, 4, 5), (0, 1, 4, 3), (1, 2, 5, 4), (2, 0, 3, 5)]
    m.from_pydata(verts, [], faces)
    m.update()
    o = bpy.data.objects.new(name, m)
    bpy.context.collection.objects.link(o)
    return _finish(o, material)


def EXPORT(out_path, prefix):
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.data.objects:
        if o.name.startswith(prefix):
            o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', use_selection=True,
                               export_apply=True, export_yup=True)
    print("exported", out_path)
