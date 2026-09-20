# Iteration 03 — windmill v2 (kinetic structure)
Reference: hero Image 3 windmill-on-ridge + sheet specs (checked).

## Proven in order
1. Static right: `reviews/windmill-v2b-turntable.png` — tapered shaft, trim bands,
   pyramid cap, X rotor (spars + sails), door/windows. Matches reference massing.
2. Pivot behaves: hub empty `ASTX_BUILDING_WINDMILL_hubPIVOT` survives export with
   8 children; live page finds 1 hub, angle advances 1.621 rad / ~3 s (= t*0.5).
3. State relationship: HONESTLY NONE. Core has no wind/mill state (verified in
   state.ts). Rotation is labeled ambient presentation (same category as boat
   bobbing) in code comments. If milling ever becomes authoritative, the hub
   speed must be driven from snapshot — noted at the drive site.
- Deployed live (GLB + main.js, no restart). In-world: rotor reads at distance.

## Open nits
Sails read grey-blue in the CYCLES turntable but cream in Three.js — turntable
ambient bias (blue world background as IBL), recorded as pipeline limitation.
Gen1 windmill fully replaced (no vocabulary clash).
