#!/usr/bin/env python3
"""Build ASTX GLB library (starter slice + full set). Run: python3 tools/build_glbs.py
Writes assets/glb/*.glb + assets/manifests/asset-manifest.json
All origins bottom-anchored (y=0), meters, +Y up. Node names = ASTX_*.
"""
import os, json, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
from astx_glb import GLB, box, prism_gable, cylinder

OUT = "/home/ubuntu/ba/assets/glb"
MAN = "/home/ubuntu/ba/assets/manifests/asset-manifest.json"
os.makedirs(OUT, exist_ok=True)
os.makedirs(os.path.dirname(MAN), exist_ok=True)

PAL = {
 "wall": (0.93, 0.87, 0.76, 1), "roofO": (0.79, 0.44, 0.18, 1),
 "roofB": (0.18, 0.50, 0.79, 1), "timber": (0.54, 0.35, 0.20, 1),
 "timberD": (0.36, 0.20, 0.09, 1), "stone": (0.60, 0.60, 0.63, 1),
 "sand": (0.91, 0.81, 0.60, 1), "grass": (0.37, 0.75, 0.35, 1),
 "leaf": (0.18, 0.49, 0.23, 1), "leafD": (0.13, 0.36, 0.18, 1),
 "trunk": (0.42, 0.28, 0.15, 1), "glass": (0.62, 0.85, 0.92, 1),
 "fabricR": (0.91, 0.36, 0.36, 1), "metal": (0.42, 0.42, 0.44, 1),
 "gold": (1.0, 0.69, 0.18, 1), "cream": (0.95, 0.90, 0.75, 1),
 "water": (0.12, 0.62, 0.75, 1), "coralB": (0.23, 0.65, 0.79, 1),
 "coralP": (0.61, 0.36, 0.90, 1), "soil": (0.36, 0.20, 0.09, 1),
 "white": (0.96, 0.95, 0.92, 1), "red": (0.80, 0.20, 0.20, 1),
 "lamp": (1.0, 0.85, 0.45, 1),
 "waterfall": (0.55, 0.85, 0.95, 1),
 "foam": (0.91, 0.98, 1.0, 1),
 "reefgrey": (0.45, 0.52, 0.58, 1),
}
manifest = []

def emit(asset_id, category, dims, build_fn, instanced=False, lods=("LOD0",)):
    g = GLB(asset_id)
    mat_cache = {}
    def M(name):
        if name not in mat_cache:
            em = (1.0, 0.7, 0.25) if name == "lamp" else None
            op = 0.75 if name == "waterfall" else (0.9 if name == "foam" else None)
            mat_cache[name] = g.add_material(f"M_{name}", PAL[name], doubleside=(name in ("glass",)),
                                             emissive=em, opacity=op)
        return mat_cache[name]
    build_fn(g, M)
    path = os.path.join(OUT, asset_id + ".glb")
    g.save(path)
    manifest.append({"id": asset_id, "category": category, "glb": f"assets/glb/{asset_id}.glb",
                     "dimensions": dims, "origin": {"at": "ground_center", "y0": 0},
                     "units": "meters", "up": "+Y", "materials": sorted(mat_cache.keys()),
                     "lods": list(lods), "instanced": instanced})
    print(f"wrote {asset_id} ({os.path.getsize(path)} B)")

def P(g, M, geo, mat, name):
    p, n = geo
    g.add_tris(p, n, M(mat), node_name=name)

# ---- STARTER SLICE ----
def house(g, M):
    P(g, M, box(5.0, 2.6, 4.2, y0=0.3), "wall", "ASTX_BUILDING_HOUSE_walls")
    P(g, M, box(5.4, 0.3, 4.6, y0=0), "stone", "ASTX_BUILDING_HOUSE_foundation")
    P(g, M, prism_gable(5.6, 1.6, 4.8, y0=2.9), "roofO", "ASTX_BUILDING_HOUSE_roof")
    P(g, M, box(0.5, 1.5, 0.5, x=1.2, y0=3.4), "stone", "ASTX_BUILDING_HOUSE_chimney")
    P(g, M, box(1.0, 1.8, 0.15, z=2.12, y0=0.3), "timberD", "ASTX_BUILDING_HOUSE_door")
    P(g, M, box(0.9, 0.9, 0.12, x=-1.4, y0=1.2, z=2.12), "glass", "ASTX_BUILDING_HOUSE_win")
emit("ASTX_BUILDING_HOUSE", "building", {"x": 5.0, "y": 4.5, "z": 4.2}, house)

def palm(g, M):
    P(g, M, cylinder(0.14, 4.2, 7), "trunk", "ASTX_VEG_PALM_trunk")
    for i, (dx, dz) in enumerate([(1.1, 0), (-1.1, 0), (0, 1.1), (0, -1.1), (0.7, 0.7), (-0.7, -0.7)]):
        P(g, M, box(2.2, 0.08, 0.5, x=dx, y0=4.2, z=dz), "leaf", f"ASTX_VEG_PALM_frond{i}")
    P(g, M, box(0.4, 0.4, 0.4, y0=4.0), "timber", "ASTX_VEG_PALM_nuts")
emit("ASTX_VEG_PALM", "vegetation", {"x": 3.0, "y": 4.6, "z": 3.0}, palm, instanced=True)

def crate(g, M):
    P(g, M, box(1.0, 1.0, 1.0, y0=0), "timber", "ASTX_PROP_CRATE")
emit("ASTX_PROP_CRATE", "prop", {"x": 1, "y": 1, "z": 1}, crate, instanced=True)

def dock(g, M):
    P(g, M, box(6.0, 0.25, 2.5, y0=0.8), "timber", "ASTX_INFRA_DOCK_deck")
    for x in (-2.5, -0.8, 0.8, 2.5):
        for z in (-1.0, 1.0):
            P(g, M, cylinder(0.13, 1.8, 7, x=x, y0=-0.8, z=z), "timberD", f"ASTX_INFRA_DOCK_pile{x}{z}")
    P(g, M, box(0.15, 1.0, 2.5, x=-2.9, y0=1.0), "timberD", "ASTX_INFRA_DOCK_rail")
emit("ASTX_INFRA_DOCK", "infrastructure", {"x": 6, "y": 2, "z": 2.5}, dock)

def tile(g, M):
    P(g, M, box(16, 1.0, 16, y0=-1.0), "stone", "ASTX_TERRAIN_TILE_base")
    P(g, M, box(16, 0.35, 16, y0=0.0), "grass", "ASTX_TERRAIN_TILE_grass")
emit("ASTX_TERRAIN_TILE", "terrain", {"x": 16, "y": 1.35, "z": 16}, tile, instanced=True)

# ---- FULL SET (compact but real geometry, same kit language) ----
def townhall(g, M):
    P(g, M, box(9.0, 3.4, 8.0, y0=0.4), "wall", "ASTX_BUILDING_TOWNHALL_main")
    P(g, M, box(9.4, 0.4, 8.4, y0=0), "stone", "ASTX_BUILDING_TOWNHALL_base")
    P(g, M, prism_gable(9.6, 2.0, 8.6, y0=3.8), "roofB", "ASTX_BUILDING_TOWNHALL_roof")
    P(g, M, box(2.2, 5.5, 2.2, x=0, y0=0, z=-2.5), "cream", "ASTX_BUILDING_TOWNHALL_tower")
    P(g, M, prism_gable(2.8, 1.2, 2.8, y0=5.5, z=-2.5), "roofB", "ASTX_BUILDING_TOWNHALL_cupola")
    P(g, M, box(3.0, 0.5, 2.0, y0=0, z=4.8), "stone", "ASTX_BUILDING_TOWNHALL_steps")
emit("ASTX_BUILDING_TOWNHALL", "building", {"x": 9, "y": 7.5, "z": 8}, townhall)

def stall(g, M):
    for x, z in [(-1.4, -1.0), (1.4, -1.0), (-1.4, 1.0), (1.4, 1.0)]:
        P(g, M, cylinder(0.07, 2.4, 6, x=x, y0=0, z=z), "timber", f"ASTX_BUILDING_MARKET_post{x}{z}")
    P(g, M, box(3.5, 0.15, 2.8, y0=2.4), "fabricR", "ASTX_BUILDING_MARKET_canopy")
    P(g, M, box(3.0, 0.9, 1.6, y0=0.5), "timber", "ASTX_BUILDING_MARKET_counter")
emit("ASTX_BUILDING_MARKET", "building", {"x": 3.5, "y": 3.0, "z": 2.8}, stall)

def farmhouse(g, M):
    P(g, M, box(6.0, 2.4, 5.0, y0=0.2), "cream", "ASTX_BUILDING_FARM_walls")
    P(g, M, prism_gable(6.6, 1.8, 5.6, y0=2.6), "timber", "ASTX_BUILDING_FARM_thatch")
    P(g, M, box(2.0, 1.8, 0.15, z=2.5, y0=0.2), "timberD", "ASTX_BUILDING_FARM_door")
emit("ASTX_BUILDING_FARM", "building", {"x": 6, "y": 4.5, "z": 5}, farmhouse)

def windmill(g, M):
    P(g, M, box(4.5, 7.0, 4.5, y0=0), "wall", "ASTX_BUILDING_WINDMILL_tower")
    P(g, M, prism_gable(5.0, 1.5, 5.0, y0=7.0), "timber", "ASTX_BUILDING_WINDMILL_cap")
    P(g, M, box(0.5, 0.5, 0.5, y0=8.0, z=2.6), "timberD", "ASTX_BUILDING_WINDMILL_hubPIVOT")
    # 4-blade + rotor on +Z face, hub at (0, 8.2, 2.9); blades separate objects sharing hub pivot
    P(g, M, box(0.35, 2.8, 0.1, y0=8.2 + 1.4, z=2.9), "cream", "ASTX_BUILDING_WINDMILL_blade0_PIVOT")
    P(g, M, box(0.35, 2.8, 0.1, y0=8.2 - 4.2 + 1.4, z=2.9), "cream", "ASTX_BUILDING_WINDMILL_blade1_PIVOT")
    P(g, M, box(2.8, 0.35, 0.1, x=-1.4, y0=8.2, z=2.9), "cream", "ASTX_BUILDING_WINDMILL_blade2_PIVOT")
    P(g, M, box(2.8, 0.35, 0.1, x=1.4, y0=8.2, z=2.9), "cream", "ASTX_BUILDING_WINDMILL_blade3_PIVOT")
emit("ASTX_BUILDING_WINDMILL", "building", {"x": 5, "y": 11, "z": 5}, windmill)

def lighthouse(g, M):
    P(g, M, cylinder(1.8, 2.0, 10, y0=0), "stone", "ASTX_BUILDING_LIGHTHOUSE_plinth")
    P(g, M, cylinder(1.3, 8.0, 10, y0=2.0), "white", "ASTX_BUILDING_LIGHTHOUSE_tower")
    P(g, M, cylinder(1.35, 1.6, 10, y0=5.0), "red", "ASTX_BUILDING_LIGHTHOUSE_band")
    P(g, M, cylinder(1.0, 1.6, 8, y0=10.0), "glass", "ASTX_BUILDING_LIGHTHOUSE_lamp")
    P(g, M, cylinder(0.2, 0.8, 6, y0=11.6), "metal", "ASTX_BUILDING_LIGHTHOUSE_lampPIVOT")
emit("ASTX_BUILDING_LIGHTHOUSE", "building", {"x": 4, "y": 12, "z": 4}, lighthouse)

def greenhouse(g, M):
    P(g, M, box(7.0, 0.3, 4.5, y0=0), "stone", "ASTX_BUILDING_GREENHOUSE_base")
    for i in range(5):
        P(g, M, box(0.12, 2.2, 4.5, x=-3.0 + i * 1.5, y0=0.3), "metal", f"ASTX_BUILDING_GREENHOUSE_rib{i}")
    P(g, M, box(7.0, 2.0, 4.5, y0=0.5), "glass", "ASTX_BUILDING_GREENHOUSE_glass")
emit("ASTX_BUILDING_GREENHOUSE", "building", {"x": 7, "y": 3.5, "z": 4.5}, greenhouse)

def barn(g, M):
    P(g, M, box(8.0, 3.0, 5.0, y0=0), "timber", "ASTX_BUILDING_BARN_main")
    P(g, M, prism_gable(8.6, 1.6, 5.6, y0=3.0), "metal", "ASTX_BUILDING_BARN_roof")
    P(g, M, box(2.2, 2.2, 0.15, z=2.5, y0=0), "timberD", "ASTX_BUILDING_BARN_door")
emit("ASTX_BUILDING_BARN", "building", {"x": 8, "y": 4.5, "z": 5}, barn)

def bridge(g, M):
    P(g, M, box(4.0, 0.2, 3.0, y0=1.0), "timber", "ASTX_INFRA_BRIDGE_deck")
    for z in (-1.3, 1.3):
        P(g, M, box(4.0, 0.15, 0.15, y0=1.9, z=z), "timberD", f"ASTX_INFRA_BRIDGE_rail{z}")
        for x in (-1.8, 0, 1.8):
            P(g, M, box(0.12, 0.9, 0.12, x=x, y0=1.0, z=z), "timberD", f"ASTX_INFRA_BRIDGE_post{x}{z}")
emit("ASTX_INFRA_BRIDGE", "infrastructure", {"x": 4, "y": 2, "z": 3}, bridge, instanced=True)

def pathseg(g, M):
    P(g, M, box(2.0, 0.12, 2.0, y0=0), "sand", "ASTX_INFRA_PATH")
emit("ASTX_INFRA_PATH", "infrastructure", {"x": 2, "y": 0.12, "z": 2}, pathseg, instanced=True)

def broadleaf(g, M):
    P(g, M, cylinder(0.18, 2.6, 7), "trunk", "ASTX_VEG_TREE_trunk")
    P(g, M, box(2.6, 1.8, 2.6, y0=2.4), "leaf", "ASTX_VEG_TREE_crown1")
    P(g, M, box(1.8, 1.2, 1.8, y0=3.6), "leafD", "ASTX_VEG_TREE_crown2")
emit("ASTX_VEG_TROPICAL_TREE", "vegetation", {"x": 3, "y": 5, "z": 3}, broadleaf, instanced=True)

def bush(g, M):
    P(g, M, box(1.2, 0.8, 1.2, y0=0.1), "leaf", "ASTX_VEG_BUSH")
emit("ASTX_VEG_BUSH", "vegetation", {"x": 1.2, "y": 0.9, "z": 1.2}, bush, instanced=True)

def npc(g, M, aid, shirt):
    g2 = g  # closure uses M dict directly
    P(g, M, box(0.5, 0.7, 0.3, y0=0), shirt, aid + "_legs")
    P(g, M, box(0.55, 0.7, 0.35, y0=0.7), shirt, aid + "_torso")
    P(g, M, box(0.32, 0.32, 0.32, y0=1.4), "cream", aid + "_head")
    P(g, M, box(0.6, 0.08, 0.6, y0=1.7), "timber", aid + "_hat")

import functools
for aid, shirt in [("ASTX_NPC_VILLAGER", "white"), ("ASTX_NPC_FARMER", "leaf"),
                   ("ASTX_NPC_FISHERMAN", "roofB"), ("ASTX_NPC_GUARD", "red")]:
    emit(aid, "npc", {"x": 0.6, "y": 1.8, "z": 0.6},
         functools.partial(lambda g, M, a=aid, s=shirt: npc(g, M, a, s)))

def boat(g, M, aid, L):
    P(g, M, box(L, 0.8, 2.0, y0=0.2), "timber", aid + "_hull")
    P(g, M, box(L * 0.7, 0.5, 1.6, y0=1.0), "timberD", aid + "_gunwale")
    P(g, M, cylinder(0.08, 5.0, 6, y0=1.0), "trunk", aid + "_mastPIVOT")

for aid, L in [("ASTX_BOAT_FISHING", 5.0), ("ASTX_BOAT_SAIL", 6.5), ("ASTX_BOAT_ROW", 3.5), ("ASTX_BOAT_CARGO", 8.0)]:
    emit(aid, "boat", {"x": L, "y": 6, "z": 2}, functools.partial(lambda g, M, a=aid, l=L: boat(g, M, a, l)))

def barrel(g, M):
    P(g, M, cylinder(0.4, 0.9, 9, y0=0), "timber", "ASTX_PROP_BARREL")
emit("ASTX_PROP_BARREL", "prop", {"x": 0.8, "y": 0.9, "z": 0.8}, barrel, instanced=True)

def lantern(g, M):
    P(g, M, cylinder(0.07, 2.2, 6, y0=0), "metal", "ASTX_PROP_LANTERN_post")
    P(g, M, box(0.35, 0.45, 0.35, y0=2.2), "lamp", "ASTX_PROP_LANTERN_glass")
emit("ASTX_PROP_LANTERN", "prop", {"x": 0.4, "y": 2.7, "z": 0.4}, lantern, instanced=True)

# ---- TERRAIN KIT (modular, deterministic placement in main.js) ----
def cliff(g, M):
    P(g, M, box(8.0, 3.0, 6.0, y0=-2.0), "stone", "ASTX_TERRAIN_CLIFF_base")
    P(g, M, box(6.4, 2.6, 4.8, y0=0.6), "stone", "ASTX_TERRAIN_CLIFF_mid")
    P(g, M, box(5.0, 1.2, 3.6, y0=3.0), "grass", "ASTX_TERRAIN_CLIFF_lip")
emit("ASTX_TERRAIN_CLIFF", "terrain", {"x": 8, "y": 6.2, "z": 6}, cliff, instanced=True)

def beach(g, M):
    P(g, M, box(10.0, 0.5, 5.0, y0=-0.3), "sand", "ASTX_TERRAIN_BEACH_sand")
    P(g, M, box(10.0, 0.25, 1.2, y0=0.05, z=-1.6), "grass", "ASTX_TERRAIN_BEACH_grasslip")
emit("ASTX_TERRAIN_BEACH", "terrain", {"x": 10, "y": 0.6, "z": 5}, beach, instanced=True)

def waterfall(g, M):
    P(g, M, box(6.0, 9.0, 4.0, y0=-1.0), "stone", "ASTX_TERRAIN_WATERFALL_rock")
    P(g, M, box(4.6, 1.0, 3.0, y0=8.0), "grass", "ASTX_TERRAIN_WATERFALL_lip")
    P(g, M, box(1.6, 8.5, 0.3, y0=-0.5, z=2.1), "waterfall", "ASTX_TERRAIN_WATERFALL_ribbon")
    P(g, M, cylinder(2.2, 0.3, 10, y0=-1.0, z=3.2), "foam", "ASTX_TERRAIN_WATERFALL_pool")
emit("ASTX_TERRAIN_WATERFALL", "terrain", {"x": 6, "y": 10, "z": 6}, waterfall)

def reef(g, M):
    P(g, M, box(2.2, 1.0, 1.8, y0=-1.2), "reefgrey", "ASTX_TERRAIN_REEF_rock")
    P(g, M, cylinder(0.18, 1.1, 6, x=-0.5, y0=-0.6), "coralB", "ASTX_TERRAIN_REEF_coralB")
    P(g, M, cylinder(0.15, 0.9, 6, x=0.5, y0=-0.6), "coralP", "ASTX_TERRAIN_REEF_coralP")
    P(g, M, box(0.9, 0.7, 0.9, x=0.1, y0=-0.5), "leaf", "ASTX_TERRAIN_REEF_weed")
emit("ASTX_TERRAIN_REEF", "terrain", {"x": 2.5, "y": 1.5, "z": 2}, reef, instanced=True)

def boulder(g, M):
    P(g, M, box(1.6, 1.2, 1.4, y0=0), "stone", "ASTX_TERRAIN_BOULDER")
emit("ASTX_TERRAIN_BOULDER", "terrain", {"x": 1.6, "y": 1.2, "z": 1.4}, boulder, instanced=True)

def islet(g, M):
    P(g, M, cylinder(7.0, 2.0, 12, y0=-2.5), "stone", "ASTX_TERRAIN_ISLET_rock")
    P(g, M, cylinder(6.2, 1.0, 12, y0=-0.5), "grass", "ASTX_TERRAIN_ISLET_cap")
    P(g, M, cylinder(5.0, 0.4, 12, y0=0.5), "sand", "ASTX_TERRAIN_ISLET_sand")
emit("ASTX_TERRAIN_ISLET", "terrain", {"x": 14, "y": 4, "z": 14}, islet)

json.dump({"version": 1, "generator": "ASTX-pipeline", "assets": manifest},
          open(MAN, "w"), indent=1)
print(f"manifest: {len(manifest)} assets -> {MAN}")
