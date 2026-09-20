# Vegetation zones + composition rules (spatial grammar)
Zones (map refs): ridge forest | falls mist | civic gardens | residential lanes |
market fringe | farm windbreak+edge | shore palm band | coastal scrub | cliff
ledges | reef shelf | gully bamboo | clearings | path edges.

## Composition rules (hard)
1. Masses, not scatter: every planting is a CLUSTER (3–9 canopy, 5–15 understory)
   with a defined center, radius, and edge falloff; clearings are DESIGNED voids.
2. Sightlines first: no canopy within plaza view cone (plaza→ridge, plaza→harbor);
   houses keep portion of facade visible; paths never fully swallowed (edge only).
3. Terrain fit: raycast grounding mandatory; slope>0.55 → tufts only; sand → palms/
   scrub only; water → aquatics only; buildings keep 2m clear ring.
4. Vertical rhythm: canopy emergents poke above rooflines (scale cue); shrubs hide
   foundation seams; grass knits ground between.
5. Settlement edge: gardens BETWEEN houses and wild (transition band, never
   buildings-on-lawn and never forest-against-wall).
6. Coast: palm band + scrub pockets; palms lean seaward (rotation bias, not random).
7. Falls: lush ring (flowers + bamboo + dark greens) within 15m of plunge pools.
8. Deterministic: seeded cluster list (world-layout.json `groves`); rotation/scale
   from id hash (controlled variation); NO per-load RNG in placement.
9. Counts: decor only — never presented as state, never counted in HUD.
