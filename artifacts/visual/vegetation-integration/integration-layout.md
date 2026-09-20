# Integration layout (staging only — live world untouched)
Mode: ?staging=grove (+ ?density=low|med|ref, ?focus=...). Staged GLBs load
direct from /assets/glb (never manifest). Tick skips reconcile visuals.
HUD/state polling unchanged (read-only mirror intact).

Groves (authored arrays in astrix-three/staging-grove.js):
1. settlement-edge SW @ (-38,28): 3 canopy + 1 palm + 4 shrubs + 5 grass +
   3 flowers (16 items ref). Tests edge/garden/path interplay.
2. south-beach coast @ barrier bar + mainland fringe: 3 palms + 3 scrub +
   3 grass + 1 shrub. Tests land→sand→lagoon→bar→sea + directional lean.
3. ridge cliff foot @ (-48,-58): 4 clifttufts + 1 shrub + 2 grass. Tests
   geology-dominant composition (tufts must not hide rock).

4. ridge forest N slope @ (8,-88): B/A/C canopy core + understory + fern/floor,
   sightline corridor, foreground frame (28 items ref). Tests canopy closure,
   layering, skyline, forest-edge transition.
5. reef shelf + lagoon @ (0,143): corals + seaweed IN shallows (crowns breach),
   grass/scrub on dry bar. Tests waterline transition.

Cameras: sedge / scoast / scliff / smid / sclose / slow / hero + sforest / sreef / sharbor.

Gate D (?staging=island): full-island staging copy — causal mirror
(reconcileDynamic/reconcile + NPC pool from snapshot) + ISLAND_GROVES as instanced
decor (staging-island.js, one InstancedMesh per part). 177 instances ref, 66 low.
See gate-d-report.md.
