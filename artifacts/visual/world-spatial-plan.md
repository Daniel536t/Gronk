# ASTrix World Spatial Plan v1 — fixed architectural layout
Authority order: reference images > this plan > world-layout.json > existing implementation.
Nothing in this plan may collide. Every entry names its keep-clears.
Frame: world meters, +X east, +Z south, Y up. Sea level -0.35.

## 0. Collision law (enforced, not advised)
- staging-island.js `exclude[]` = housing lots (r7) + farm plots (r10) +
  civic circle (r18 @ [10,0]) + every RENDERED building incl. fields (r8).
- Audit script: node import of staging-grove.js vs lots/plots must print AUDIT CLEAN.
- New placements must pass the audit BEFORE visual review.
- 09-19 incident: 2 canopies authored dead-on housing lots (lot-01/03). Fixed by
  resite + runtime guard (guard caught 3 more: field ghost x2, bridge berth x1).

## 1. Region registry (build order per phase spec)
| # | Region | Anchor | Keep-clears | Status |
|---|---|---|---|---|
| 1 | Hero landmass + central terrain | island mass | — (base) | geography in progress |
| 2 | Civic / settlement | plaza [10,0] r18, 10 lots | lots r7, plaza r18 | placed, collision-fixed |
| 3 | Highland / forest | ridge [8,-108] r70 | rockline h>7.2 (no canopy) | 3 stands + feather |
| 4 | Farm belt | plots x104-168 z-28/-58 | plots r10, fields r8 (runtime) | windbreaks N+E |
| 5 | Waterfall / cliff | cliff foot [-48,-58] | geology dominant | tufts+ferns, proxy falls-mist |
| 6 | Harbor / coast | dock [130,93], bar z158-182 | dock r8 (runtime), berth | point [102,121], sandbar |
| 7 | Lagoon / reef | lagoon z~140 | open water (guard) | aquatics breaching |
| 8 | Islets | [-95,175],[-195,45],[228,105] | rock crown | palms/tufts placed |
| 9 | Connective landscape | meadow copses [-30,-30],[60,-10] | lots (audited) | placed |
| 10 | World-wide polish | — | — | NOT STARTED |

## 2. Placement rules per family (no-scatter law)
- Canopy: only in stands (6-9m spacing, overlap) or as lone landmarks (max 1 per
  40m outside stands). NEVER within lot/plot/civic radii. NEVER on rock (h>7.2).
- Understory: stand infill, lane gaps (between lots, never on), windbreak rows.
- Palms: beach waterlines +5..15m inland, islets, harbor point. Never inland.
- Scrub: sand/rock backs, cove bands, bar fringe. Never on grass interior.
- Aquatics: shallows only (seabed h in [-1.2, 0.6]); crowns must breach.
- Floor/rocks: forest interiors, cliff feet, NEVER paths/lots (no trip hazards
  visually blocking doors — keep 3m from lot centers... lots already excluded r7).
- Flowers: gardens, plaza edge (outside r18), falls-mist, corridors. Doses <=3/20m.
- Buildings: lots only (claimed), civic only outside r18, farms on farm plots.
- Fields: farm plot +15m east ghost — windbreak E must respect runtime guard.

## 3. Vertical hierarchy (per region, top-down)
Highland: rock crown (empty) -> B emergents -> A/C canopy -> understory ->
fern/floor -> feather grass -> meadow.
Settlement: roofs (4.5m) -> garden canopy -> understory -> shrubs -> flowers/grass.
Farm: windbreak canopy (N+E walls) -> barns -> field rows -> margins.
Coast: palms (7m accents) -> scrub -> grass -> sand -> waterline -> reef.
Cliff: bare face -> tuft ledges -> fern cracks -> foot debris -> forest/meadow.

## 4. Sightlines (must survive every density)
- Civic plaza: open cones E (market) + S (shore) + W (lanes). No canopy in cones.
- Harbor: open water view from dock root N/NE.
- Ridge: hero camera sees forest band, not wall (corridor gaps every ~25m).
- Reef: low sightline along lagoon (no tall aquatics; max 1.5m).

## 5. Wilderness gaps (deliberate, not unfinished)
NE highlands (x60-120, z-140..-80), far W headland. Rock/terrain reads. No veg.
Revisit only if reference comparison demands.

## 6. Queued renovations (not started)
- Terrain authored forms (ridges/shelves/terraces/valleys) — Region 1.
- Water system (depth gradient/shallows/foam) — Region 7 detail.
- Architecture Blender loop (houses/barn/farm civic structures) — Region 2 detail.
- Bamboo/cane only if a required zone is materially damaged (none yet).
