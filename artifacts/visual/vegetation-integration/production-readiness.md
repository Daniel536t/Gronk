# Production Readiness — staging only. Live site NOT modified.

## 1. World defects (fixed in working tree, verified in staging — not via vegetation)
- Plinth gaps: spawn() now adds a stone foundation skirt under ASTX_BUILDING_*
  (footprint-measured Box3, 4-corner raycast, only when drop > 0.25m; child of the
  building so reconcile removal carries it). Verified: isle-skirt-close.png —
  house base meets slope as intentional stonework.
- Terrain banding: TWO components found by shadow-toggle bisection.
  (a) Fine ripple = shadow-map acne -> FIXED via normalBias 0.15 (bias kept
  -0.0006). nb 0.6 was measured to blacken the world (reverted with evidence);
  0.15/-0.0006 verified bright + ripple-free (bisect-a/b, diag-banding-after).
  (b) Coarse facet patchwork = baked terrain vertex colors -> KEPT deliberately
  (low-poly diorama aesthetic, matches reference; rebuild = terrain-pipeline task).

## 2. Optimization (locked composition, merge-by-material)
staging-island.js merges single-group same-attribute parts per material (rigid
vertex merge; multi-material parts e.g. FloorA log stay solo). Silhouettes
identical before/after (hero + settlement + close re-captures).
108 draws hero (was 258), 44-94 by view (frustum culling works), tris UNCHANGED
(~302k ref / 171-175k low). Instances scale free (66->177 draws flat).
31 merged groups + 13 solo parts. Rejected optimization: none (nothing damaged).

## 3. Production seam test (isolated: bundle /tmp/prod-seam + fresh :8791 + proxy :5200)
Build: scripts/build-three-observatory.sh now takes output dir (default unchanged)
and ships staging-island/grove.js; 55 GLBs; manifest 55 (14 promoted w/ measured
bounds+materials); tests updated 41->55 (272/272 PASS incl. promotion contract).
- No-flag load: full island (177 inst), zero failed requests, zero console/page errors.
- Causal: fresh snapshot [house-001] -> dyn [house-001], NPCs 4/4, crops 0/0. Exact.
- Governance via REAL UI buttons: REJECT -> zero mutation PASS; APPROVE -> mutation
  (nodes 5->4, wood 31) PASS; reload converges PASS. No state invented by renderer.
- Manifest promotion: 14 entries with measured bounds + GLB material names.
- Default-on: island assembles with no flags; ?bare=1 stays bare; ?staging=grove kept.

## 4. Camera walk (post-fix): walk-beach/lagoon-reef/farms/forest/ridge/cliff/harbor +
overview-low + hero/settlement/close. All clean, zero errors. Forest interior,
reef-flat, windbreaks, transects hold at close range.

## Status
GATE D: PROVEN
PRODUCTION READINESS: PROVEN (with noted defects below)
PUBLIC DEPLOYMENT: NOT YET (live astrixx.duckdns.org untouched; server/static
unmodified by this gate; live :8787 state untouched — reads only)

## Remaining defects (all pre-existing or explicitly deferred, none blocking)
1. Coarse terrain facet colors baked (kept as aesthetic; rebuild out of scope).
2. Bamboo/cane vocabulary missing (no required zone damaged; falls-mist covered).
3. Headless fps 0-1 is a llvmpipe artifact, not a production GPU signal (unmeasured).
4. Reef water renders as flat dark band (production water renderer, untouched).
5. White row-posts in settlement unidentified (pre-existing production detail).
6. 2 lagoon grass items honestly water-rejected by design (open-water guard).
