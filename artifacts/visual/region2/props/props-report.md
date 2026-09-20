# Activity & Props pass (staging only, no deploy)

## Study (activity-study.md)
Per-zone patterns from ref3: civic commerce/gathering, residential domesticity,
farm production/storage, harbor transport/fishing. Every prop answers
who/what/why/relationship; plaza center, door swings, path middles stay clear.

## Families (12, Blender loops, isolated PASS each)
- Storage: crate (framed+slats, replaces primitive), barrel (bulged+hoops+lid,
  replaces primitive), sack (tied, new).
- Civic/lane: bench, signpost (3 painted arms), lantern (foot/post/cage/cap,
  replaces cube-on-stick).
- Harvest/market: grain stack (stepped+band), woodpile (end-grain slots added
  after v1 read black; posts shortened), basket + produce.
- Harbor: rope coil, buoy (white-cap fixed after all-red v1), drying rack + fish.
- Revisions were all real (woodpile end-grain, buoy cap, signpost yaw cleanup).

## Compositions (density-invariant non-VEG; exclusion applies to veg only)
- Market row: stalls + crates/barrel/basket + bench + signpost at path fork +
  lanterns + fountain bench. Commerce reads.
- Residential lane: bench + woodpile + basket + lantern along lane. Habitation reads.
- Farm yard: grain stack + crates + sacks + barrel + signpost at lane junction.
- Harbor point: dryrack + coil + buoy + crate + barrel + lantern. Transport reads.
- Overview: connected town, landmarks readable, no clutter, paths/entrances clear.

## Performance (composition preserved)
- Prop + building part counts pushed hero to 260 draws -> spawn-side merge
  (pivot-exempt, pure batching) brought it to 152, tris identical. Budget holds.

## Gaps / notes
- No mooring posts, cart, scarecrow, washing lines (observed but unbuilt; harbor
  works without dock until Region 6; cart needs wheels/pivot design).
- Barn interior shade-flat (lighting condition, recorded earlier).
- Drying-rack fish are static (no invented motion/state).
- Manifest 64 (9 new props + 3 refreshed); contract tests 8/8; full suite 272/272.
- Governance frozen; live site untouched; no deploy.

## Evaluation: does the settlement look inhabited? YES — with restraint intact.
Recommendation: proceed to settlement-wide polish pass when ready.
