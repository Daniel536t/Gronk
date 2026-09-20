# Region 1 — Hero Landmass + Central Terrain (first serious terrain pass)

Reference: ref3-hero (jagged strata spine, valley bowl, pocket coves, turquoise
shallows, visible reef). Prior bare terrain: smooth gaussian dome + quilted hash,
no spine/cliffs/valley character. Verdict before: failed macro, meso, micro.

## Rebuilt (build_terrain_v1.py land_h + terrain.js twin)
- N mountain SPINE replaces smooth massif: peaks W(-34,-108,12)/C(6,-114,14.5)/
  E(46,-106,11.5) with steep north faces (asymmetric sigma), saddles carved
  between (-14,-111),(26,-110). Twin mirrors peaks (terraces/gully omitted as
  guard-irrelevant, documented in code).
- Bold strata terracing on flanks (step 1.8, blend 0.75; was 1.3/0.65).
- 4 mid-slope rock OUTCROPS + 2 south-flank crags (twin mirrors crags).
- E point + W headland wedges (rotated anisotropic gaussians).
- Waterfall NOTCH widened near ridge top + plunge POOL basin at (-26,-50)
  (floor clamped >=1.2; ribbon/foam are Region 5 assets).
- Retained: civic plateau, farm bench, harbor carve, 3 cove profiles, gully,
  islets, skirts, vertex-color system, grid resolution (no-res-upscaling rule kept).

## Evidence (artifacts/visual/region1/)
- bare-hero/ridge/shore.png (BEFORE) vs r1-hero/ridge-v2/shore.png (AFTER).
- r1-ridge-v2: multi-peak skyline with saddle, strata benches, outcrop knob.
- r1-island-check: full ecology on new topography (174 inst, 108 draws, no errors);
  ridge forest now grows through crags like the reference.

## Remaining discrepancies (honest)
- Spine still softer than ref3's jagged strata (4.8m cells + analytic functions;
  true sculpted crags need denser mesh or hand-placed rock kit — queued, Region 5/10).
- Shoreline still largely smooth ellipse + profiles; pocket-cove carving between
  headlands is the next shoreline pass (Region 6/7).
- No fresh-water plane/ribbon yet (Region 5). Pool basin reads dry.
- Twin omits terracing/gully/notch/pool (documented; guards use sea thresholds).

## Judgment
Bare island now reads as authored landmass with massif/outcrops/benches/coves at
meso scale; macro silhouette improved (spine + wedges); micro strata bands read.
It deserves architecture and ecology — which already stand on it unchanged.
No spatial-plan changes required (all groves re-grounded by raycast; audit clean).
No public deploy (not requested). Governance untouched throughout.
