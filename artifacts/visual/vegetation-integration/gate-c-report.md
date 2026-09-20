# Gate C — forest vocabulary + reef ecology (staging only, NO promotion)

Mode: ?staging=grove&density=low|med|ref&focus=sforest|sreef|sedge|scoast|scliff|smid|slow|sclose.
Staged GLBs load direct from /assets/glb (never manifest: 41 assets, unchanged).
No deploy, no restart, no Core/CommandBus/approval/verification/events/MagicBlock/
renderer/manifest/live-world changes.

## Asset list (exact)
Prior 7 (kept, untouched): CANOPY_A, PALM_A, SHRUB_A, GRASS_A, FLOWERS_A, SCRUB_A, CLIFFTUFT_A.
New 7 (staged only): CANOPY_B (emergent spire 9.55m), CANOPY_C (banyan 4.4x7.3m),
UNDERSTORY_A (mid-layer 4.4m), FERN_A (arching rosette), FLOOR_A (debris/rock),
SEAWEED_A (ribbons 1.5m), CORAL_A (blue/purple 1.15m).
Isolated proofs: artifacts/visual/vegetation-design/blender/{canopy-b,canopy-c,
understory-a,fern-a,floor-a,seaweed-a,coral-a}.png + forest-evidence.md + reef-evidence.md.
Revisions in-loop: canopyB crown widened; fern re-architected (corner-vert sin bug);
floorA moss-as-polys; seaweed fan-out; coral taper+knobs; canopyC root junctions.

## Groves (astrix-three/staging-grove.js — 3 original kept byte-identical)
4. ridge forest N slope @ [8,-88] (28 items ref): B/A/C canopy core (6-9m spacing,
overlap), understory, shrub/fern, floor/grass, flower accent, sightline corridor,
foreground frame. Interleaved by layer so low/med keep vertical structure.
5. reef shelf + lagoon @ [0,143] (10 items): corals + seaweed IN shallows (resited
from dry bar after v1), grass/scrub on dry bar behind waterline.

## Density ladder (forest)
ref (73 total): open highland stand, closed core at W, interior sightline. PROVEN stand-scale.
med (36): savanna structure. low (27): structural skeleton (emergent+umbrella+ground).
Low reveals authored skeleton, not random decor — correct behavior for the knob.

## Status ledger
- Forest formation at stand scale: PROVEN (overlap, layers, shadows, edge transition)
- Island-scale wilderness: NOT TESTED (needs rollout — Gate D)
- Reef ecology: PROVEN at reef-flat scale (breaching crowns, waterline transition)
- C root junctions: PROVEN fixed (artifact-croots.png)
- Palm shadow acne: NOT OBSERVED (artifact-palmshadow.png clean) — no action
- Grass moire: source = production TERRAIN facet banding (artifact-terrain.png bare),
  not vegetation. No vegetation action; terrain-material task out of Gate C scope.
- Perf: ref forest 256 draws/97k tris, reef 206/58k, low 86/68k — staging uninstanced
  by design; production must instance + re-measure.
- Bamboo/cane (ref family 8), crops rows: NOT TESTED (no assets) — vocabulary gap for
  wet gullies/farm edges, flagged for next loop if Gate D requires.
- Promotion/deployment: BLOCKED by design (Gate C remains open until review).

## Files
forest-{ref,med,low}.png, reef-ref.png, artifact-{croots,palmshadow,terrain}.png (this dir).
