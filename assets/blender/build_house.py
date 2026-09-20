# ASTX_BUILDING_HOUSE — run inside Blender (Text Editor → Run Script).
# Builds: foundation, walls, gable roof (ridge along Z), chimney, door, window.
# Origin at ground center, meters, transforms applied, M_* materials shared.
import bpy, math

ASTX = "ASTX_BUILDING_HOUSE"
for o in list(bpy.data.objects):
    if o.name.startswith(ASTX):
        bpy.data.objects.remove(o, do_unlink=True)

def mat(name, rgba):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgba, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.85
    return m

M = {"wall": mat("M_wall", (0.93, 0.87, 0.76)),
     "roofO": mat("M_roofO", (0.79, 0.44, 0.18)),
     "stone": mat("M_stone", (0.60, 0.60, 0.63)),
     "timberD": mat("M_timberD", (0.36, 0.20, 0.09)),
     "glass": mat("M_glass", (0.62, 0.85, 0.92))}

def box(name, w, h, d, x, y0, z, material):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y0 + h / 2, z))
    o = bpy.context.active_object
    o.name = name
    o.dimensions = (w, h, d)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(M[material])
    return o

def gable(name, w, h, d, x, y0, z, material):
    m = bpy.data.meshes.new(name + "_mesh")
    x0, x1, y1, z0, z1 = x - w / 2, x + w / 2, y0 + h, z - d / 2, z + d / 2
    verts = [(x0, y0, z0), (x1, y0, z0), (x, y1, z0),
             (x0, y0, z1), (x1, y0, z1), (x, y1, z1)]
    faces = [(0, 2, 1), (3, 4, 5), (0, 1, 4, 3), (1, 2, 5, 4), (2, 0, 3, 5)]
    m.from_pydata(verts, [], faces)
    m.update()
    o = bpy.data.objects.new(name, m)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(M[material])
    return o

box(ASTX + "_foundation", 5.4, 0.3, 4.6, 0, 0, 0, "stone")
box(ASTX + "_walls", 5.0, 2.6, 4.2, 0, 0.3, 0, "wall")
gable(ASTX + "_roof", 5.6, 1.6, 4.8, 0, 2.9, 0, "roofO")
box(ASTX + "_chimney", 0.5, 1.5, 0.5, 1.2, 3.4, 0, "stone")
box(ASTX + "_door", 1.0, 1.8, 0.15, 0, 0.3, 2.12, "timberD")
box(ASTX + "_win", 0.9, 0.9, 0.12, -1.4, 1.2, 2.12, "glass")
print("Built", ASTX)
