# Forest vocabulary — pipeline proof (NOT a rollout)
Reference: vegetation-reference-analysis.md (ref3 hero: broad-canopy 5–8m,
medium round 3–5m, saplings 2–3m, ragged lower edges, sunlit tops).

## Canopy Broadleaf B (ASTX_VEG_CANOPY_B) — emergent spire
BLENDER: veg_canopyB.py (tall straight trunk H6.4 w/ root flare, 2 stacked
cool-dark displaced masses, leader spike). REVISION v1: crown read as
pole-with-bush → masses widened (1.7/1.4 → 2.2/1.8) and lowered (7.0/8.3 →
6.4/7.7). BOUNDS: 9.55 tall, 5.2 wide, grounded ✓. Role: overstory spire
above A's umbrellas; distinct silhouette (vertical vs spreading).
## Canopy Broadleaf C (ASTX_VEG_CANOPY_C) — banyan form
BLENDER: veg_canopyC.py (short thick trunk, 4 low flat warm-green pads +
2 aerial prop roots + 4 limbs). BOUNDS: 4.4 tall, 7.3 wide, grounded ✓.
Role: broad mid-canopy ceiling. NOTE: prop-root tops partly occluded by pads
in some views — junctions verified in geometry (limbs meet pads at 2.8–2.9);
acceptable, re-check in forest composition.
## Understory Tree A (ASTX_VEG_UNDERSTORY_A) — mid-layer
BLENDER: veg_understoryA.py (thin S-bent trunk, 3 spars, asymmetric crown +
light cap). BOUNDS: 4.4 tall, grounded ✓. Fills 2.5–4m gap between shrub
(~1m) and canopy (>5m). One spar tip pokes just outside crown — reads as
broken twig, natural, kept.
## Fern A (ASTX_VEG_FERN_A) — ground cover
BLENDER: veg_fernA.py (7 outer + 5 inner arching fronds + bud).
REVISIONS: v1 read as flat starfish (fronds paper-thin, no arch — root cause:
cube has verts only at corners so sin-arch sculpt was identically zero) →
subdivided 3x (8 length segments), true arch (peaks 0.29–0.37m), V-fold,
two-tier fullness. BOUNDS: 1.3 wide, 0.37 tall, grounded ✓.
## Forest Floor A (ASTX_VEG_FLOOR_A) — debris/rock vocabulary
BLENDER: veg_floorA.py (2 half-buried displaced rocks + moss mound + fallen
log). REVISION v1: separate moss-cap cylinder read as machined slab →
moss applied as top-facing polys of the SAME log mesh (wood still reads on
sides/ends). BOUNDS: 1.4 wide, 0.57 tall, grounded ✓.
THREE.JS: all five verified isolated (bounds above); flat-shaded, shadows on.
GLBs staged only (assets/glb/ASTX_VEG_{CANOPY_B,CANOPY_C,UNDERSTORY_A,FERN_A,FLOOR_A}.glb).
Manifest untouched. Live world untouched.
