# Iteration 08 — ground/ecology layer (world-map driven, no new assets)
Reference: hero Image 3 ground variation. Frames: hero.png/civic.png (checked).

## Built
Zoned vertex-color treatment in build_terrain_v1.py (real-Blender coords):
patchy two-tone grass, wet dark waterline band, worn civic earth ring (r~30),
farm soil apron (r~55), sun-bleached southern slopes, moss creep on high rock,
depth-graded underwater. Deployed live (GLB only, no restart).

## Explicit diff vs reference (not complete)
1. Civic earth ring: STRONG — settlement visibly anchors (best item this pass).
2. Grass variation: WEAK at frame distance — reads near-uniform green in hero.
3. Wet band, beach fills, moss: present in bytes, unproven visually at range.
4. Corduroy terracing stripes persist on slopes (landform character, Phase B debt).
5. Farm apron unverified in close frame (farms E, out of civic view).

## Preserved
271/271 tests (no TS changes; typecheck carries over clean). Core/bus/gate/
verify/MagicBlock untouched. Live world untouched.
