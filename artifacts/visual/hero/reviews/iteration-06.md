# Iteration 06 — terrain-first reconstruction
Reference: hero Image 3, judged from hero.png/civic.png (checked).

## What changed
Retired the tile grid. `astrix-three/terrain.js`: deterministic analytic
heightfield (seeded value-noise, no Math.random) — angular coastline with
coves, north-ridge massif (windmill 8.5), civic plateau, harbor bay SE,
SW hut islet, E lighthouse rock, N skerry, S reef shelf. Vertex colors by
height/slope (sand/grass/rock). `heightAt()` grounds every entity; boats/dock/
bridge ride water level. Scatter deterministic (mulberry32). Landmarks moved
onto the landform (windmill ridge, lighthouse rock, farms plateau).

## Result
Hero reads as an island: cliffs W, beaches S, lighthouse rock E, reef shallows,
harbor bay with boats, settlement clustered around plaza+fountain, farms E.
Civic reads as a settlement: fountain court, houses with chimneys/porches,
market canopy, paths, lanterns, elevation behind town hall.
4/1/1 counts hold; 271 tests + typecheck green; deployed live (main.js +
terrain.js, no restart).

## Open (next passes, not this one)
Waterfall hidden behind ridge from default cam; E-islet palms arch oddly;
2 boats near frame edge; hero 289 draws (terrain 28k tris — reduce segments);
reef reads as sandbars; NPCs small at overview.
