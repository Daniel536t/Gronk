# Iteration 04 — field plot v1 (systemic density)
Reference: hero Image 3 farm belt (tilled plots + crop rows) + ASTRIX_VISUAL_BUILD
"furrow ridges clearly readable" rule (checked).

## What was built
`ASTX_FIELD_PLOT` (bpy, 12x8 m): dark soil base (NOT timber-hued, per palette
lesson), 5 varied-width ridge rows, timber edge boards + corner posts, grass lips.
Turntable: `reviews/field-v1-turntable.png` — reads as tilled earth, not deck.

## Separation enforced
Rows are EMPTY by design. Crop tufts reconcile only from `snap.crops`
(existing path). A farm building now brings its plot (`field:<id>`, lives/dies
with the farm). Manifest + layer tests updated (33 assets).

## In-world (`renders/farm.png`, dyn 4, 170 draws, clean)
Field + farmhouse + windmill rotor compose; counts 4/1/1 hold.

## Known clash (queued, not fixed this pass)
The gen1 farmhouse (thatch prism) now sits beside the v2 field — vocabulary
mismatch. Farmhouse v2 is the natural next asset. House-roof material nits
remain in the polish queue per directive (not reopened).
