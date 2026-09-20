# Deployment record — Region 2 settlement release (staging-verified)

RELEASE BUILD: region2-settlement-20260919b
- base revision: 1609372ac157b2655bb8d073cb10faf966df9539 (+ working tree)
- manifest: v1, 64 assets (41 base + 14 veg + 9 props; 3 prop refreshes)
- main.js md5: 46f5d116d4536b27840322c794d5025d (pre-build; bundle hash below)
- build timestamp: 2026-09-19T17:35:14Z
- tests: 272/272 PASS (25 files); typecheck: clean (both tsconfigs)
- bundle: scripts/build-three-observatory.sh -> server/static (live root)
- ASSET_V: 20260919a (GLB cache-buster; static served no-cache + Last-Modified)

Scope shipped (all staging-verified, zero runtime errors in staging):
Region 1 spine/outcrop/terrace/notch terrain + twin; collision law + exclusion;
Town Hall v2, Market v2, Plaza v3+fountain drum; path network (8 routes);
homesteads (courtyard+fences, signature-guarded); barn/farmhouse/greenhouse v2;
storage->farm pool; greenhouse + windmill authored infra; 12 prop families;
4 activity compositions; spawn-side merge (152 draws hero).
Live state before: day 1, pop 4, food 40, spring; buildings
[bridge-003, farm-004, house-001, storage-007]; crops 1; bridges 1.
Live state after: IDENTICAL (verified GET comparison; no writes performed).

## Deployment regression found + fixed (during byte verification)
staging-homestead.js missing from build script output list -> public boot would
404 on the dynamic import. Fixed by adding the file to build-three-observatory.sh
(regression fix only, no architecture change), rebuilt, re-verified IDENTICAL.
Lesson: build script output list must cover every main.js dynamic import.

## Public smoke (6 views, all PASS, zero failed requests, zero errors)
pub-hero/civic/residential/farm/harbor/overview in region2/deploy/.
Staging comparison: identical framing/lighting/materials/density/silhouettes.
One expected delta: draws lower publicly in civic (123 vs 185 staging) because
spawn-side merge landed after the staging capture; tris identical (306020).
No floats, burials, collisions, misplaced props, or path breaks observed.
