# ASTX_VEG_PALM — run inside Blender (Text Editor → Run Script).
# Builds: curved-approx trunk (cylinder), 6 fronds, nut cluster. Origin at base.
import bpy

ASTX = "ASTX_VEG_PALM"
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

M = {"trunk": mat("M_trunk", (0.42, 0.28, 0.15)),
     "leaf": mat("M_leaf", (0.18, 0.49, 0.23)),
     "timber": mat("M_timber", (0.54, 0.35, 0.20))}

bpy.ops.mesh.primitive_cylinder_add(radius=0.14, depth=4.2, location=(0, 2.1, 0))
trunk = bpy.context.active_object
trunk.name = ASTX + "_trunk"
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
trunk.data.materials.append(M["trunk"])

for i, (dx, dz) in enumerate([(1.1, 0), (-1.1, 0), (0, 1.1), (0, -1.1), (0.7, 0.7), (-0.7, -0.7)]):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(dx, 4.2, dz))
    f = bpy.context.active_object
    f.name = f"{ASTX}_frond{i}"
    f.dimensions = (2.2, 0.08, 0.5)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    f.data.materials.append(M["leaf"])

bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 4.2, 0))
nuts = bpy.context.active_object
nuts.name = ASTX + "_nuts"
nuts.dimensions = (0.4, 0.4, 0.4)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
nuts.data.materials.append(M["timber"])
print("Built", ASTX)
