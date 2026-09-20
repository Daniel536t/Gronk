# ASTX terrain reconstruction (world-map driven, authored landforms).
# run: blender --background --python assets/blender/build_terrain_v1.py
# Grid over 860x640; displacement = DESIGNED zone stack (map coords, N-up in
# fiction = Blender Y? NO — zbpy fiction: heights in Y. We author directly in
# fiction via zbpy-style mapping is overkill here; instead author in TRUE
# Blender Z-up: grid in XY, height = Z. Export converts to Y-up file.
# Zones (map coords, meters, N up = -Y_world? map N-up with y_map; world x=E,
# world z=S; map pixel (mx,my) -> fiction (mx, -my) since map y grows down
# while world z grows down... define care: MAP_NORTH_UP my; fiction z = -my.)
import bpy
import bmesh
import math
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zbpy

OUT_MAIN = "/home/ubuntu/ba/assets/glb/ASTX_TERRAIN_MAIN.glb"
OUT_ISLETS = "/home/ubuntu/ba/assets/glb/ASTX_TERRAIN_ISLETS.glb"
PREFIX = "ASTX_TERRAIN_"
for o in list(bpy.data.objects):
    if o.name.startswith(PREFIX):
        bpy.data.objects.remove(o, do_unlink=True)

SEA = -0.35

def gauss(x, y, cx, cy, s):
    dx = (x - cx) / s
    dy = (y - cy) / s
    return math.exp(-(dx * dx + dy * dy))

def sstep(a, b, t):
    t = max(0.0, min(1.0, (t - a) / (b - a)))
    return t * t * (3 - 2 * t)

# deterministic detail noise (SURFACE ONLY, never landform)
def hash2(ix, iy):
    h = (ix * 374761393 + iy * 668265263) & 0xFFFFFFFF
    h = (h ^ (h >> 13)) * 1274126177 & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFFFF) / 4294967295.0

def detail(x, y):
    return (hash2(int(math.floor(x * 0.35)), int(math.floor(y * 0.35))) - 0.5) * 0.9 \
         + (hash2(int(math.floor(x * 0.9)) + 40, int(math.floor(y * 0.9)) - 17) - 0.5) * 0.35

W, D, NX, NY = 720.0, 560.0, 150, 112  # ~17k verts main
CX, CY = 10.0, 8.0  # world center of island (world x, world z)
SKIRT_DROP = -7.0  # border verts drop below seabed: no see-through edge anywhere
CX, CY = 10.0, 8.0  # world center of island (world x, world z)

def peak(x, z, cx, cz, h, sx, sz_n, sz_s):
    """Asymmetric peak: steep north face (z < cz uses sz_n), gentler south.
    Gives the spine its cliff character instead of a smooth dome."""
    dx = (x - cx) / sx
    dz = (z - cz) / (sz_n if z < cz else sz_s)
    return h * math.exp(-(dx * dx + dz * dz))


def rgauss(x, z, cx, cz, sx, sz, ang, h):
    """Rotated anisotropic gauss for headlands/points."""
    dx, dz = x - cx, z - cz
    ca, sa = math.cos(ang), math.sin(ang)
    u = (dx * ca + dz * sa) / sx
    v = (-dx * sa + dz * ca) / sz
    return h * math.exp(-(u * u + v * v))


def land_h(x, z):
    """Authored height. (x,z) world meters. Map: NORTH = -z."""
    # --- coastline: hand-tuned angular footprint (from world map) ---
    dx, dz = (x - CX) / 245.0, (z - CY) / 175.0
    r = math.hypot(dx, dz)
    th = math.atan2(dz, dx)
    # headlands/coves per map: W headland, N bulge, E point, S coves
    coast = 1.0 + 0.10 * math.cos(2 * th + 0.6) - 0.08 * math.cos(3 * th - 1.1) \
        + 0.06 * math.cos(5 * th + 2.0)
    # harbor bay carve (SE, toward new harbor geography at ~(170,135))
    bth = math.atan2((135 - CY) / 175.0, (170 - CX) / 245.0)
    dth = abs(th - bth)
    if dth > math.pi:
        dth = 2 * math.pi - dth
    coast -= 0.30 * math.exp(-(dth * dth) / 0.09)
    land = sstep(1.03, 0.80, r / coast)
    # --- elevation zones ---
    up = 2.6
    # N mountain SPINE (replaces smooth massif): 3 peaks + saddles, steep N faces
    up += peak(x, z, -34, -108, 12.0, 24, 12, 30)   # Peak W
    up += peak(x, z, 6, -114, 14.5, 28, 13, 34)     # Peak C (crown)
    up += peak(x, z, 46, -106, 11.5, 22, 12, 28)    # Peak E
    up += 4.0 * gauss(x, z, 60, -118, 26)      # windmill knoll shoulder
    # saddles between spine peaks (skyline rhythm, not a whale-back)
    up -= 3.5 * gauss(x, z, -14, -111, 14)
    up -= 3.5 * gauss(x, z, 26, -110, 13)
    # south-flank crags (reference shows crags all around the massif)
    up += gauss(x, z, -10, -80, 9) * 4.0
    up += gauss(x, z, 30, -84, 8) * 3.5
    # mid-slope rock OUTCROPS: steep knobs breaking smooth flanks (terrace below)
    up += gauss(x, z, -62, -62, 10) * 5.0
    up += gauss(x, z, 52, -58, 9) * 4.5
    up += gauss(x, z, -18, -38, 8) * 4.0
    up += gauss(x, z, 92, -72, 11) * 5.0
    # headland wedges: E point + W headland (angular shoreline anchors)
    up += rgauss(x, z, 205, 55, 34, 13, -0.5, 3.5)
    up += rgauss(x, z, -175, 55, 30, 15, 0.4, 3.0)
    # civic plateau: ease toward 3.4 near (10,2)
    pm = sstep(60, 22, math.hypot(x - 10, z - 2))
    up = up * (1 - pm * 0.72) + 3.4 * pm
    # farm bench E: ease toward 3.0
    fm = sstep(46, 16, math.hypot(x - 150, z + 40))
    up = up * (1 - fm * 0.6) + 3.0 * fm
    up += detail(x, z) * land
    # cliff terracing on highland flanks: bold strata benches (authored, not noise)
    if up > 5.0:
        q = round((up - 5.0) / 1.8) * 1.8 + 5.0
        up = up * 0.25 + q * 0.75
    # shore -> shelf -> deep
    shore = sstep(0.0, 0.15, land)
    h = -6.0 + (up + 6.0) * shore
    # farm plateau landmass E + ridge landmass N (ensure design elevations exist)
    h = max(h, -6.0 + 15.0 * gauss(x, z, 14, -100, 42))
    h = max(h, -6.0 + 10.0 * gauss(x, z, 150, -38, 34))
    # waterfall channel: carve gully from ridge notch (-30,-64) to civic lake (8,6)
    # distance to segment (-30,-64)->(8,6)
    ax, az = -30.0, -64.0
    bx, bz = 8.0, 6.0
    abx, abz = bx - ax, bz - az
    tt = max(0.0, min(1.0, ((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz)))
    px, pz = ax + abx * tt, az + abz * tt
    dc = math.hypot(x - px, z - pz)
    h -= 2.2 * math.exp(-(dc * dc) / 36.0) * sstep(-70, -20, z) * land
    # waterfall NOTCH: widened carve near the ridge top (z -78..-58)
    h -= 2.0 * math.exp(-(dc * dc) / 100.0) * sstep(-80, -72, z) * (1 - sstep(-60, -52, z)) * land
    # plunge POOL basin at (-26,-50): dips to fresh-basin floor (clamped >= 1.2,
    # wet rock rim via slope colors; water ribbon is a Region 5 asset)
    dp = math.hypot(x + 26, z + 50)
    h -= 3.0 * math.exp(-(dp * dp) / 49.0) * land
    h = max(h, 1.2) if dp < 12.0 else h
    # beach coves: gentle dry-to-submerged profiles at measured shorelines.
    # S (0,171) r55 / E (187,80) r40 / W (-185,100) r45. Profile runs +1.1 (dry)
    # to -2.0 (submerged shelf) across the cove so the transition survives hero
    # viewing distance. This is geometry, not paint.
    for ccx, ccz, cr in ((0, 171, 55), (187, 80, 40), (-185, 100, 45)):
        dd = math.hypot(x - ccx, z - ccz)
        if dd < cr:
            prof = 1.1 - (dd / cr) * 3.1
            m = sstep(cr, cr * 0.55, dd) * 0.9 + 0.1
            h = h * (1 - m) + prof * m
    return max(h, -6.0)


def build_grid(name, x0, x1, z0, z1, nx, ny, hfn, mat_grass, mat_sand, mat_rock):
    mesh = bpy.data.meshes.new(name + "_mesh")
    verts = []
    for j in range(ny + 1):
        for i in range(nx + 1):
            x = x0 + (x1 - x0) * i / nx
            z = z0 + (z1 - z0) * j / ny
            verts.append((x, -z, hfn(x, z)))  # real-Blender: ground XY, up Z
    faces = []
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    # skirt: border ring drops below seabed so no gap is ever visible at edges
    # (real-Blender coords: ground XY with y = -world_z, up = +Z)
    for v in mesh.vertices:
        if abs(v.co.x - x0) < 0.01 or abs(v.co.x - x1) < 0.01 or abs(v.co.y + z0) < 0.01 or abs(v.co.y + z1) < 0.01:
            v.co.z = min(v.co.z, SKIRT_DROP)
    mesh.update()
    # vertex colors by height/slope in REAL terms (z = up)
    # COLORS PER-VERTEX (smooth interpolation kills the quilt) with slope from
    # averaged linked-face normals via bmesh (real slope response without
    # per-quad hard edges). Zones keyed off height + slope + geography.
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.normal_update()
    vnorm = []
    for v in bm.verts:
        ns = [f.normal for f in v.link_faces] or [(0, 0, 1)]
        nx = sum(n[0] for n in ns) / len(ns)
        ny = sum(n[1] for n in ns) / len(ns)
        nz = sum(n[2] for n in ns) / len(ns)
        vnorm.append(1.0 - abs(nz))
    bm.free()
    mesh.attributes.new("Color", 'FLOAT_COLOR', 'POINT')
    col = mesh.attributes["Color"]
    # deterministic hash for patchiness (surface detail only, never landform)
    def hh(ix, iy):
        h = (ix * 374761393 + iy * 668265263) & 0xFFFFFFFF
        h = (h ^ (h >> 13)) * 1274126177 & 0xFFFFFFFF
        return ((h ^ (h >> 16)) & 0xFFFFFFFF) / 4294967295.0
    mesh.calc_loop_triangles()
    # NOTE: colors are PER-VERTEX (smooth interpolation kills the quilt).
    # Slope comes from bmesh-averaged linked-face normals (vnorm[k]).
    for k, v in enumerate(mesh.vertices):
        h = v.co.z
        slope = vnorm[k]
        # real-Blender ground plane is XY: world_x = x, world_z = -y
        wx, wz = v.co.x, -v.co.y
        # depth-graded underwater: sand rim -> teal shelf -> dark deep (no sand desert)
        if h < SEA + 0.45 and h > -1.6:
            c = [0.91, 0.81, 0.60, 1.0]
        elif h <= -1.6 and h > -3.5:
            c = [0.35, 0.62, 0.62, 1.0]
        elif h <= -3.5:
            c = [0.10, 0.30, 0.42, 1.0]
        elif slope > 0.38 or h > 7.0:
            # exposed rock: steeper = greyer, with strata banding by height
            band = 0.5 + 0.5 * math.sin(h * 2.1)
            g = 0.46 + band * 0.08
            c = [g + 0.03, g + 0.02, g + 0.04, 1.0]
        elif h > 5.0:
            c = [0.45, 0.62, 0.35, 1.0]
        else:
            # broad grass patches (~30m cells) + fine grain: soft variation, no quilt
            n = hh(int(math.floor(wx * 0.033)), int(math.floor(wz * 0.033)))
            n2 = hh(int(math.floor(wx * 0.11)) + 99, int(math.floor(wz * 0.11)) - 31)
            n3 = hh(int(math.floor(wx * 0.9)) - 53, int(math.floor(wz * 0.9)) + 71)
            c = [0.37 + (n - 0.5) * 0.15 + (n3 - 0.5) * 0.07,
                 0.71 + (n2 - 0.5) * 0.12 + (n3 - 0.5) * 0.06,
                 0.33 + (n - 0.5) * 0.08, 1.0]
        # wet shoreline band: dark wet just above water, WHITE foam at the line
        if -0.45 < h < 0.35:
            w = 1.0 - abs(h + 0.05) / 0.55
            c = [c[0] * (1 - w) + 0.35 * w, c[1] * (1 - w) + 0.33 * w, c[2] * (1 - w) + 0.28 * w, 1.0]
        if -0.18 < h < 0.12:
            w = (1.0 - abs(h + 0.03) / 0.18) * 0.85
            c = [c[0] * (1 - w) + 0.91 * w, c[1] * (1 - w) + 0.98 * w, c[2] * (1 - w) + 1.0 * w, 1.0]
        # worn civic earth: trampled ring around plaza (world 10,0), r~34
        dc = math.hypot(wx - 10, wz - 0)
        if h > 0.3 and dc < 34:
            w = (1 - dc / 34) * 0.7
            c = [c[0] * (1 - w) + 0.58 * w, c[1] * (1 - w) + 0.46 * w, c[2] * (1 - w) + 0.30 * w, 1.0]
        # farm soil apron around farm bench (world 150,-38), r~60
        df = math.hypot(wx - 150, wz + 38)
        if h > 0.3 and df < 60:
            w = (1 - df / 60) * 0.55
            c = [c[0] * (1 - w) + 0.42 * w, c[1] * (1 - w) + 0.28 * w, c[2] * (1 - w) + 0.15 * w, 1.0]
        # dry southern slopes: sun-bleached grass where world z > 60
        if h > 0.3 and wz > 60 and c[1] > 0.45:
            w = min(1.0, (wz - 60) / 80) * 0.55
            c = [c[0] * (1 - w) + 0.66 * w, c[1] * (1 - w) + 0.70 * w, c[2] * (1 - w) + 0.38 * w, 1.0]
        # moss on high rock: green creeping into cliffs by noise
        if h > 5.5 and slope > 0.3:
            n = hh(int(math.floor(wx * 0.09)) - 7, int(math.floor(wz * 0.09)) + 13)
            if n > 0.52:
                w = min(1.0, (n - 0.52) * 2.0)
                c = [c[0] * (1 - w) + 0.35 * w, c[1] * (1 - w) + 0.55 * w, c[2] * (1 - w) + 0.30 * w, 1.0]
        col.data[k].color = c
    mesh.update()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    for mat in (mat_grass,):
        o.data.materials.append(mat)
    return o


Mg = zbpy.MAT("M_terrain", (1, 1, 1))
Mg.use_nodes = True
bsdf = Mg.node_tree.nodes.get("Principled BSDF")
# vertex-color driven: replace base color with Attribute node
nodes = Mg.node_tree.nodes
attr = nodes.new("ShaderNodeVertexColor")
attr.layer_name = "Color"
Mg.node_tree.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])

main = build_grid("ASTX_TERRAIN_main", CX - W / 2, CX + W / 2, CY - D / 2, CY + D / 2,
                  NX, NY, land_h, Mg, Mg, Mg)
print("main verts:", len(main.data.vertices))

# islets: SW hut, E lighthouse rock, W falls stack, N skerry (separate meshes)
def islet_h(x, z, hgt, rad):
    return max(-6.0, -6.0 + (hgt + 6.0) * math.exp(-(((x) ** 2 + (z) ** 2) / rad ** 2)))


def blob(name, cx, cz, hgt, rad, nx=28, ny=22):
    mesh = bpy.data.meshes.new(name + "_mesh")
    verts = []
    for j in range(ny + 1):
        for i in range(nx + 1):
            x = cx - rad * 1.9 + rad * 3.8 * i / nx
            z = cz - rad * 1.9 + rad * 3.8 * j / ny
            verts.append((x, -z, islet_h(x - cx, z - cz, hgt, rad)))
    faces = []
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    # skirt: border ring drops below seabed (real-Blender ground XY, y = -world_z)
    _x0, _x1 = cx - rad * 1.9, cx + rad * 1.9
    _y0, _y1 = -(cz + rad * 1.9), -(cz - rad * 1.9)
    for v in mesh.vertices:
        if abs(v.co.x - _x0) < 0.01 or abs(v.co.x - _x1) < 0.01 or abs(v.co.y - _y0) < 0.01 or abs(v.co.y - _y1) < 0.01:
            v.co.z = min(v.co.z, SKIRT_DROP)
    mesh.update()
    mesh.attributes.new("Color", 'FLOAT_COLOR', 'POINT')
    col = mesh.attributes["Color"]
    for k, v in enumerate(mesh.vertices):
        h = v.co.z
        c = (0.91, 0.81, 0.60, 1.0) if h < SEA + 0.45 else ((0.60, 0.60, 0.63, 1.0) if h > 4.5 else (0.37, 0.75, 0.35, 1.0))
        col.data[k].color = c
    mesh.update()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(Mg)
    return o


islets = [
    blob("ASTX_TERRAIN_isletSW", -95, 175, 3.2, 11),
    blob("ASTX_TERRAIN_isletE", 228, 105, 5.5, 8),
    blob("ASTX_TERRAIN_isletW", -195, 45, 7.0, 10),
    blob("ASTX_TERRAIN_skerryN", -15, -195, 5.0, 7),
]
print("islets:", [(o.name, len(o.data.vertices)) for o in islets])

zbpy._sel(main)
bpy.ops.export_scene.gltf(filepath=OUT_MAIN, export_format='GLB', use_selection=True,
                           export_apply=True, export_yup=True)
print("exported", OUT_MAIN)
bpy.ops.object.select_all(action='DESELECT')
for o in islets:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT_ISLETS, export_format='GLB', use_selection=True,
                           export_apply=True, export_yup=True)
print("exported", OUT_ISLETS)
