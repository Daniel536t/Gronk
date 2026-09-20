# Iteration 07 — terrain-first reconstruction (world-map driven)
Reference: hero Image 3. Frames: hero.png (tight civic-side), harbor.png.

## Built (no new asset modeling this pass)
- Blender-authored main island (17k verts, zone gaussians per map: ridge,
  plateau, farm bench, bay carve, waterfall gully, terraced strata) + 4 islets.
- Vertex-color ecology bands incl. depth-graded underwater (no sand desert).
- Terrain skirt (raw-verified edge verts at -7) + 2400m ocean/seabed: the grey
  see-through triangle is gone.
- Raycast grounding for every entity (heightAt stays as analytic twin/filter).
- Landmarks moved onto the landform (windmill ridge, lighthouse rock, farms).
- Harbor recomposed from shoreline transects: rooted dock, moored boats,
  rock landing. Cameras reframed per view.

## Explicit diff vs reference (what still differs)
1. Settlement density ~10% of reference (composition phase work, forbidden here).
2. Waterfall ribbon not clearly readable in hero (falls assets placed, weak read).
3. Water flat-shaded: no sun lane, no foam, no depth gradient in-shader.
4. Reef reads as sandbars, not coral gardens.
5. Farm belt has 1 house + 1 plot vs reference's 6-plot operation.
6. Hero framing can't hold harbor + settlement detailed at once (scale truth:
   reference compresses via dense composition; ours needs that density first).
7. Hero 207-289 draws (terrain 28k tris; perf phase later, not chased).

## Preserved
271/271 tests, typecheck, Core/bus/gate/verify untouched (representation-only
diff: astrix-three/*, assets/blender/build_terrain_v1.py, 2 GLBs). Live world
(bridge-003, farm-004, crop-005, storage-007) untouched — no restart.
