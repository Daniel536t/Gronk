# Iteration 05 — orientation system (the axis audit) + composition proof
Reference: hero Image 3 (checked against hero.png/civic.png this pass).

## The bug (found by the loop, invisible to all other checks)
All 6 bpy assets shipped lying sideways in Three.js: Blender is Z-up and its
exporter bakes Rx(−90) into files, but scripts authored fictional-Y-up numbers
AND added euler "corrections" that fought the exporter. 26/26 layer tests
passed, turntables looked right (its +90 conversion exactly undoes the damage),
BB probes looked right (import conversion) — only the Three.js venue told the
truth. Three independent theories died against raw-byte parses before the
calibration export (known box in, converted coords out) settled it.

## The fix (structural, not per-asset)
`assets/blender/zbpy.py`: fiction-Y-up intent → true-Z-up Blender content via
R = Rx(+90), exporter converts properly, files land true Y-up. Shared helpers
(BOX/CYL/RING/BALL/GABLE/BEAM_Z/EXPORT) so the mapping lives in ONE place.
`tools/fix_glb_yup.py` (the wrong fix) DELETED — it corrupted correct files.
Methodology addition: raw-parse bounds are the orientation ground truth;
viewport/BB probes are views, not truth.

## Composition result (this pass)
Plaza flat with ring + fountain + bollards; houses standing with roofs seated;
windmill tower + rotor + cap correct; field rows readable; cliffs layered.
Hero 266 draws / civic 178 — perf is a later phase; noted, not chased.
