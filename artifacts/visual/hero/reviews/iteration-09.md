# Iteration 09 — ground second pass (bare-mode review; NOT declared complete)
Frames: bare-top/hero/opposite/shore/highland/civic (all captured this pass).

## Changed
- Bare mode fixed structurally (group visibility; dynamic spawns stay hidden).
- Ground colors reworked per-LOOP with true polygon-normal slope response.
- Patch scale 8m→30m cells + fine grain; rock darkened (chalk fix); wet band kept.
- Lighting baseline: key 2.6 + shadow bias/radius, warm bounce, dimmer hemi.
- 6 test views wired (top/opposite/shore/highland/civic + hero).

## Top-3 defects found → fixed
1. Bare mode leaked farm/dock/bridge (dynamic spawns) → group-hiding fix. VERIFIED (14/6 draws).
2. Checkerboard ground → 30m patches + grain. IMPROVED, still quilt-ish close up.
3. Chalk-white ridge → darker strata rock. IMPROVED (highland frame reads geological).

## Explicit remaining diff vs reference (ground NOT passed)
1. Shore test WEAK: no single frame cleanly reads land→beach→shallow→deep; S beach
   exists but framing never lands it. Needs a dedicated shoreline composition.
2. Close-range ground still quilts (per-quad tones at 5m cells).
3. Water flat: no sun lane/foam/gradient (water phase owns this, not ground).
4. Civic worn ring exists but faint; farm apron unverified visually.
5. Reef/shelf color zones exist in bytes, invisible at hero distance.

## Preserved
271/271, typecheck, Core/bus/gate/verify/MagicBlock untouched, live world untouched.
No vegetation/architecture added during this pass (per rule).
