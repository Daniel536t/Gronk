# Iteration 02 — lighthouse v2 (landmark: emissive + pivot path)
Reference: hero Image 3 lighthouse-on-rock + sheet lighthouse specs (checked).

## Defects found in turntable
1. Tower read as stacked beads (5 coarse segments, visible steps).
2. Railing rings were vertical hoops (torus default encircles Z; needed Y).
3. Door floated off the tower face.
4. Turntable framing stranded tall assets (35mm too tight) — pipeline fix, applies to all.

## Fixes
- 7 shaft segments (smoother taper), torus rotated to horizontal, door seated on
  plinth/tower transition, 50mm lens fit.
- Result: `reviews/lighthouse-v2c-turntable.png` — profile, bands, gallery +
  railing, lantern drum, red cap + finial, seated door. Lamp object
  `ASTX_BUILDING_LIGHTHOUSE_lamp` carries emissive for Three.js control.
- Deployed live (static copy, no restart).

## Open nits
Cap reads salmon under direct sun (palette-light interaction); shaft steps still
faintly visible (honest low-poly); lantern glass occludes lamp in opaque turntable
(Three.js transparency is the real venue).
