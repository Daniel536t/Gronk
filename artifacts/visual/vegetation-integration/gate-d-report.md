# Gate D — island-scale ecological rollout (staging only, NO promotion)

Mode: ?staging=island&density=low|med|ref&focus=hero|civic|highland|shore|harbor|sforest|sreef|sharbor.
Staging copy of the whole authored island. No deploy, no restart. Core, WorldState,
CommandBus, approval, verification, events, MagicBlock, authority boundaries untouched.
Manifest: 41 assets, unchanged. server/static + src untouched by this gate.

## How it works (files)
- astrix-three/staging-grove.js: GROVES (Gate C, byte-identical) + ISLAND_GROVES
  (16 new authored stands, interleaved layers, ~150 items ref).
- astrix-three/staging-island.js (new, staging only): production-style batching —
  one InstancedMesh per template part per asset; raycast grounding; water guard
  (land veg needs h>=0, aquatics need h<=0.6, 2 honest lagoon rejects); exposes
  window.__island / __causal / __probeGround (staging interrogation only).
- astrix-three/main.js (staging-gated additions only): island boot runs the REAL
  causal path first (poll -> reconcileDynamic -> reconcile -> 14 NPC pool), then
  authored decor; tick reconciles in island mode; sforest/sreef/sharbor cameras.

## Causal test (authoritative snapshot vs render, LIVE day-1)
snapshot buildings [house-001, bridge-003, farm-004, storage-007]
  -> rendered [house-001, farm-004, field:farm-004, storage-007, bridge:bridge-003]
  (bridge_segment excluded by design; bridge via bridges[] berth) EXACT.
crops [crop-005] -> [crop:crop-005] EXACT. population 4 -> npcsVisible 4 EXACT.
Decorative vegetation is representation; stateful entities remain Core-governed.
Zero page errors across all captures.

## Ecological hierarchy (all zones, masses not scatter)
highland stands W/main/E -> feather edge -> meadow copses -> settlement lanes/gardens
-> farm windbreaks (N+E, never in plots) -> coastal scrub/palms -> beach/lagoon ->
reef aquatics (breaching) + islets + harbor point + falls-mist proxy.
Wilderness gaps: NE highlands, far W headland (deliberately empty).
Resites in-loop: reef aquatics off dry bar into shallows; harbor fringe off deep
water onto raycast-verified point [102,121]; water guard 0.3->0.0 for beach items.

## View gates (this dir)
isle-hero-ref (177 inst, 258 draws/302k tris): forest mass, copse rhythm, windbreaks,
legible settlement, honest meadow. isle-hero-low (66 inst, 258 draws/171k): skeleton holds.
isle-settlement-ref: garden gradient, NPCs, backdrop forest. isle-ridge-ref: full
rock->forest->edge->settlement transect. isle-coast-ref (285 draws): bar/lagoon/reef
transect, reef connected to water. isle-harbor2-ref (128 draws): bay + point + bar.
Silhouette readable; terrain forms visible; beaches/reef legible; no architecture burial.

## Perf (production-style instancing, unoptimized parts)
Draws ~= part count (236) + terrain/stateful (~22): 258 hero, 128-285 by view
(frustum culling works). Instances scale free (66->177, draws flat). Tris 93k-310k.
Recorded optimization (NOT done — composition first): merge per-asset parts by
material (flowers 51, clifttuft 57, coral 38 parts dominate) -> ~-150 draws, then re-measure.

## Status ledger
- Island-scale coherent ecology: PROVEN at staging (masses, transitions, hierarchy)
- Causal connection: PROVEN (exact snapshot mirror + decor separation)
- Instanced batching path: IMPLEMENTED (staging), merge pass: NOT DONE (recorded)
- Bamboo/cane: NOT TESTED, recorded gap — no required zone was materially damaged
  (falls-mist covered by fern/flowers; wet gullies not a required Gate D zone)
- Buildings on slopes show plinth gaps (pre-existing spawn behavior, not vegetation)
- White row-posts in settlement view: unidentified pre-existing production detail
- Promotion/deployment: BLOCKED by design. Gate D passes on review, not on fullness.
