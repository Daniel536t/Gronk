# Iteration 01 — house v2 Blender turntable vs. reference language
Date: 2026-09-18. Reference: artifacts/visual/hero/reference/image3-hero.png (checked).
Render: artifacts/visual/hero/renders/ + reviews/house-v2-turntable.png (`visual:hero` + Blender turntable).

## Observed defects (render, not code)
1. ROOF BROKEN (critical): slabs near-vertical/floating, detached from walls. Cause: wrong
   rotation centers + 38° too steep for the span; ridge cylinder rotated onto wrong axis.
   Ref language: shallow-pitched slabs with overhang meeting at a ridge cap.
2. Chimney floats free of the roof (consequence of #1).
3. Camera framing too close/top-down; GLB imports Z-up, script assumed Y-up.
4. In-world wide shots: v2 reads as "exploded assembly" next to gen1 neighbors.

## Fix (this iteration)
- Roof recomputed from span: half-span 3.0 (incl. overhang), rise 1.7 → 29.5°,
  slab 3.6 long centered (±1.5, 3.65); ridge cylinder unrotated (axis Z = ridge).
- Turntable: convert imports to Y-up modeling space, pull camera back, 35mm.
- Re-render turntable + hero; compare silhouette against reference roofs.

## Result
- Turntable `reviews/house-v2g-turntable.png`: assembled house — slab roof at ridge,
  chimney + cap through slope, porch canopy + posts, framed door/windows. Matches
  reference roof language at this fidelity.
- Loop lessons (pipeline, not just asset): (1) Blender 5 importer keeps Y-up →
  turntable MUST convert to Z-up or photos lie sideways; (2) CYCLES CPU is the
  headless engine (EEVEE has no EGL surface here); (3) Three.js in-world shot is
  what caught the real y0 bug — turntable alone would have "verified" a broken roof.
- Deployed to live site (static copy, no restart, world untouched).
- Open nits for director: roof saturation vs reference terracotta; chimney scale;
  gable noise (16-sample review renders).
