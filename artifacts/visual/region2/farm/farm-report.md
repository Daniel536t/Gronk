# Farm architecture loop — first serious pass (staging only, no deploy)

## Study (farm-study.md)
Agricultural language: LONG open-sided barn, small thatch farmhouses, glass
greenhouse, DIFFERENTIATED fenced plots (gold/green/tilled), ridge-line soil,
grain stacks, windmill over fields, work yard. Weathered timber > plaster.

## Audit (pre-loop)
- Barn: FAIL (black box, no openings). Farm: FAIL (beige box). Greenhouse:
  PARTIAL (glass box, frame lines, no gable/door/foundation/interior).
- Field: PARTIAL-KEEP (tilled ridge beds read; needs borders in ensemble).
- Windmill tower: PASS (v2 loop had run); blades unverified until now.

## Blender loops
- BARN v2 (new): timber frame + girts/battens, blue gable roof, OPEN east side
  (posts/header/backwall/loft), sliding gable doors + rail + braces + vent,
  lean-to + woodpile, stone base. Revisions: roof math, interior black-void ->
  backwall + yard grain stacks (sunlit cream read), shed posts to roof.
  Isolated PASS 4 sides (barn-v2open/back/east/west/yard).
- FARMHOUSE v2 (new): thatch (thick slabs + staggered fringe tabs), mud +
  timber frame, veranda + bench, side barn-door, windows. Gable infill added
  after v1 showed open triangles. PASS.
- GREENHOUSE v2 (new): white frame rhythm + mullions, TRUE translucency
  (blend-method alpha 0.35 — first asset to use it), gabled glass, purlins,
  planter beds + seedling rows visible inside, end door. PASS.

## Ensemble (farm-ensemble2.png)
Farmhouse + field rows + courtyard fence, glasshouse, windbreaks, farm lane:
production -> storage -> work -> settlement reads. Storage-007 now claims FARM
plots first (claimLot: storage joins farm pool — placement, not authority).
Greenhouse + windmill placed as authored infra (fixed, state-independent;
windmill blades static by design — no invented causal motion).
Windmill verified coherent: tower/cap/axle/hub/4 lattice blades on knoll.
Manifest dims/materials/sources updated (barn/farm/greenhouse); 8/8 tests pass.

## Gaps (honest)
- Field borders/edges still minimal (beds read, boundaries don't).
- No differentiated crop states beyond growthStage tufts (state-driven, frozen).
- Water-tower asset missing (sheet mentions; no Blender source, not built).
- Barn interior in shade reads flat grey-cream (lighting condition, not geometry).
- No public deploy. Governance frozen throughout.
