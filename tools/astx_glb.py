#!/usr/bin/env python3
"""ASTX minimal GLB builder — stdlib only. Real binary glTF 2.0.
Each asset: bottom-anchored origin (y=0 ground), +Y up, meters.
Nodes carry ASTX_* names. Materials use baseColorFactor (Blender-compatible).
Usage: imported by build_glbs.py
"""
import json, struct

def _pad(b: bytes) -> bytes:
    return b + b'\x00' * ((-len(b)) % 4)

class GLB:
    def __init__(self, name="ASTX_ASSET"):
        self.name = name
        self.bin = bytearray()
        self.views = []   # (byteOffset, byteLength, target?)
        self.accs = []
        self.meshes = []
        self.nodes = []
        self.mats = []
        self.mat_index = {}

    def add_material(self, name, rgba, metallic=0.0, roughness=0.85, doubleside=False, emissive=None, opacity=None):
        key = (name, tuple(rgba), opacity)
        if key in self.mat_index:
            return self.mat_index[key]
        m = {"name": name, "pbrMetallicRoughness": {
            "baseColorFactor": list(rgba), "metallicFactor": metallic, "roughnessFactor": roughness}}
        if doubleside: m["doubleSided"] = True
        if emissive:
            m["emissiveFactor"] = list(emissive)
        if opacity is not None:
            m["alphaMode"] = "BLEND"
            m["pbrMetallicRoughness"]["baseColorFactor"][3] = opacity
        self.mats.append(m)
        idx = len(self.mats) - 1
        self.mat_index[key] = idx
        return idx

    def _push_buf(self, data: bytes, target=None):
        off = len(self.bin)
        self.bin += _pad(data)
        self.views.append({"buffer": 0, "byteOffset": off, "byteLength": len(data),
                           **({"target": target} if target is not None else {})})
        return len(self.views) - 1

    def add_tris(self, positions, normals, mat_idx, uvs=None, node_name=None):
        import struct as st
        assert len(positions) % 3 == 0
        n = len(positions) // 3
        pos_b = st.pack('<%df' % len(positions), *positions)
        nor_b = st.pack('<%df' % len(normals), *normals)
        mins = [min(positions[i::3]) for i in range(3)]
        maxs = [max(positions[i::3]) for i in range(3)]
        pv = self._push_buf(pos_b, 34962)
        nv = self._push_buf(nor_b, 34962)
        attrs = {"POSITION": self._add_acc(pv, 5126, n, "VEC3", mins, maxs),
                 "NORMAL": self._add_acc(nv, 5126, n, "VEC3")}
        if uvs:
            uv_b = st.pack('<%df' % len(uvs), *uvs)
            uvv = self._push_buf(uv_b, 34962)
            attrs["TEXCOORD_0"] = self._add_acc(uvv, 5126, n, "VEC2")
        mi = len(self.meshes)
        self.meshes.append({"name": node_name or f"{self.name}_mesh{mi}",
                            "primitives": [{"attributes": attrs, "material": mat_idx}]})
        ni = len(self.nodes)
        self.nodes.append({"name": node_name or f"{self.name}_{mi}", "mesh": mi})
        return ni

    def _add_acc(self, view, comp, count, typ, mins=None, maxs=None):
        a = {"bufferView": view, "componentType": comp, "count": count, "type": typ}
        if mins is not None:
            a["min"] = mins; a["max"] = maxs
        self.accs.append(a)
        return len(self.accs) - 1

    def save(self, path):
        js = {"asset": {"version": "2.0", "generator": "ASTX-pipeline"},
              "scene": 0, "scenes": [{"nodes": list(range(len(self.nodes)))}],
              "nodes": self.nodes, "meshes": self.meshes,
              "materials": self.mats, "buffers": [{"byteLength": len(_pad(bytes(self.bin)))}],
              "bufferViews": self.views, "accessors": self.accs}
        js_raw = json.dumps(js).encode()
        jb = js_raw + b' ' * ((-len(js_raw)) % 4)
        bb = _pad(bytes(self.bin))
        total = 12 + 8 + len(jb) + 8 + len(bb)
        import struct as st
        out = st.pack('<III', 0x46546C67, 2, total)
        out += st.pack('<II', len(jb), 0x4E4F534A) + jb
        out += st.pack('<II', len(bb), 0x004E4942) + bb
        open(path, 'wb').write(out)

# --- mesh helpers (positions bottom-anchored, y=0 ground) ---
def box(w, h, d, x=0, y0=0, z=0):
    x0, x1 = x-w/2, x+w/2; y1 = y0+h; z0, z1 = z-d/2, z+d/2
    q = [(x0,y0,z0),(x1,y0,z0),(x1,y1,z0),(x0,y1,z0),
         (x0,y0,z1),(x1,y0,z1),(x1,y1,z1),(x0,y1,z1)]
    faces = [(0,1,2,3,(0,0,-1)),(4,6,5,7,(0,0,1)),(0,4,7,3,(-1,0,0)),
             (1,5,6,2,(1,0,0)),(0,1,5,4,(0,-1,0)),(3,7,6,2,(0,1,0))]
    P, N = [], []
    for a,b,c,d_,n in faces:
        for i,j,k in [(a,b,c),(a,c,d_)]:
            for v in (i,j,k):
                P += list(q[v]); N += list(n)
    return P, N

def prism_gable(w, h, d, x=0, y0=0, z=0):
    # triangular prism, ridge along Z
    x0, x1 = x-w/2, x+w/2; y1 = y0+h; z0, z1 = z-d/2, z+d/2
    A=(x0,y0,z0); B=(x1,y0,z0); C=(x,y1,z0)
    D=(x0,y0,z1); E=(x1,y0,z1); F=(x,y1,z1)
    tris = [(A,C,B),(D,E,F),
            (A,B,E,D),(B,C,F,E),(C,A,D,F),
            (A,D,B),(B,D,E)]
    P, N = [], []
    import math
    def nrm(p,q,r):
        ux,uy,uz = q[0]-p[0],q[1]-p[1],q[2]-p[2]
        vx,vy,vz = r[0]-p[0],r[1]-p[1],r[2]-p[2]
        nx,ny,nz = uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx
        l = math.sqrt(nx*nx+ny*ny+nz*nz) or 1
        return (nx/l,ny/l,nz/l)
    for t in tris:
        if len(t)==3:
            p,q,r = t; n = nrm(p,q,r)
            for v in (p,q,r): P += list(v); N += list(n)
        else:
            a,b,c,d_ = t; n = nrm(a,b,c)
            for v in (a,b,c,a,c,d_): P += list(v); N += list(n)
    return P, N

def cylinder(r, h, seg=8, x=0, y0=0, z=0):
    import math
    P, N = [], []
    for i in range(seg):
        a0 = 2*math.pi*i/seg; a1 = 2*math.pi*(i+1)/seg
        p0=(x+r*math.cos(a0),y0,z+r*math.sin(a0)); p1=(x+r*math.cos(a1),y0,z+r*math.sin(a1))
        q0=(p0[0],y0+h,p0[2]); q1=(p1[0],y0+h,p1[2])
        n0=(math.cos(a0),0,math.sin(a0)); n1=(math.cos(a1),0,math.sin(a1))
        for v,nn in [(p0,n0),(p1,n1),(q1,n1),(p0,n0),(q1,n1),(q0,n0)]:
            P += list(v); N += list(nn)
    return P, N
