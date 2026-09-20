# Region 2 — Civic + Settlement, first serious pass (staging only, no deploy)

## Settlement study vs reference (macro/meso/micro)
- Macro: settlement now has a CENTER (hall + plaza + market row); previously
  scattered houses with empty civic middle. Matches ref3 Z1/Z2/Z3 structure.
- Meso: hall (N) -> plaza/fountain -> market row (E) -> houses (W/S) reads as
  deliberate composition with garden infill. Civic exclusion grew r18->r22 to
  protect hall forecourt (4 veg items yielded; composition improved).
- Micro: hall (tower/belfry/bell/cupola/clock/stairs/colonnade/banners/trim),
  stalls (striped gable/stripes/valance/counter/crates/fruit/rug), plaza
  (pad/ring/basin/water/pillar/bowl/finial/bollards) all authored, none primitive.

## Blender loops this pass
- TOWNHALL v2 (new): v1 roof slabs oversized (airplane-wing) -> recomputed slope
  geometry; v2 tower buried behind roof -> raised shaft above ridge (landmark read).
  Isolated PASS front+back (townhall-v3front.png; 10.7x8.8x11.9m).
- MARKET v2 (new): v0 poles+slab FAIL -> striped gabled canopy (house idiom,
  axis corrected pre-render), counter + crates + fruit mounds + rug. PASS.
- PLAZA v3: pre-existing full idiom, visually verified PASS (no remodel).
- HOUSES: pre-existing full loop (foundation/gables/ridge/windows/porch) — not
  the problem, untouched.

## Civic ensemble (authored infra, NOT Core entities)
- Staging: ISLAND_GROVES 'civic anchor' @ [10,-2]: plaza [10,0], hall [10,-20]
  facing S, 2 stalls E angled. civic-ensemble.png proves the composition.
- Classification: plaza/hall/stalls are PLACE (authored-world infra, fixed,
  state-independent), like terrain/paths. House/barn/farm stay Core-mirrored.
  Future phase may promote civic structures to Core entities; boundary untouched.
- Infra support: ryExact (no jitter), bypass (no self-exclusion), architecture
  exempt from density knob (a plaza must not vanish at low density).
- Manifest dims/materials updated for hall + market; 8/8 contract tests pass.

## Remaining (queued)
- Plaza pad half-buried on N edge (skirt like buildings; minor).
- Barn/farm/greenhouse still build_glbs primitives (next Region 2 slice).
- Paths from lots to plaza (Region 2 detail: path network per sheet §2).
- Fences/courtyards/work areas/props (Region 2 detail).
- No public deploy (not requested). Governance frozen throughout.
