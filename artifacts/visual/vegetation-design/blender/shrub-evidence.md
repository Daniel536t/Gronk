# Shrub A — pipeline proof (NOT a rollout)
BLENDER: veg_shrubA.py (3 displaced icosphere lobes, asymmetric triplet,
  ground-flare skirts) + .blend. Loop found a REAL bug: grounding measured
  local verts while locations were unapplied → floated 0.27; fixed by
  world-space grounding (matrix_world) — a reusable recipe for offset parts.
BOUNDS: 2.1 wide, y −0.05..0.97 (grounded ✓).
THREE.JS: close/mid renders (dist param added to asset-test.html for small
  assets). Reads as irregular 3-lobe mass, faceted, 3-tone, grounded shade.
  NOT ball+stick. Small by design (connector between trees and ground cover).
GLB staged only. Live world untouched.
