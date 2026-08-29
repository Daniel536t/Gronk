# VISUAL TRANSFORMATION PLAN — Gronk's Hoard

Target direction per brief: **stylized 2.5D fantasy stealth/adventure** — rich
silhouettes, illustrated forms, depth, expressive animation, warm environmental
lighting, strong visual hierarchy. Turns the mechanically-complete build into a
polished miniature fantasy world.

**Scope boundary (respected):** no engine migration, no architecture rewrite,
no gameplay/network/TrueForge changes. The plan below is pure client-side
presentation. `DESIGN.md` remains the source of truth; this doc is the concrete
delta plan for the transformation pass.

**Honesty note:** this environment cannot view renders, so I cannot claim
"looks good" — the plan is grounded in what the code actually draws (read
`character.ts`, `render.ts` Gronk/lighting, `objects.ts`, `effects.ts`,
`particles.ts`, `main.ts`, `style.css`) and in the QA screenshot list. Human
visual review of the result is still the final gate.

---

## Audit summary — where the build stands

- **Character rig already exists** (`character.ts` `computePose`/`drawPose`):
  articulated stride, lean, droop, hunch, cloak hemisp sway, directional
  front/back/profile faces. The *movement* is good. What reads weak is **flat
  material**: every part is a solid fill (`roundRect`/ellipse/one path) with no
  outline, no form-defining shading, no rim light — so it looks like colored
  sticker shapes, not a lit adventurer.
- **Gronk** is a featureless red ellipse blob + separate head ellipse + two arm
  ellipses + feet. Feet/arms/lunge exist (better than DESIGN.md claims), but the
  body has no form; at zoom it reads as a red smudge.
- **Furniture** (`objects.ts` `drawVisualObject`) is already chunky and
  multi-part with back/front occlusion. The gap is **contact shadows** (mostly
  absent/flat ellipses) and **flat interior fills** — no depth inside shelves,
  no lit/soom side on fridge/couch, no wood/metal material cue beyond color.
- **Lighting** is additive alpha "pools" only (flicker light ellipses,
  vignette, enrage edge pulse, sudden-death pings). No soft shadow-map pass, no
  form shading, no warm-room-to-cool-room light falloff gradient. Depth comes
  only from layering, not light.
- **HUD** (Phase 6B) is done and clean — keep as-is, minor-only.
- **Treasure/magic** is good: gold aura, floating diamond, sparkles, expanding
  pings, confetti. Biggest lever here is making the gold *light* the character
  (a warm rim/glow rise on the carrier), not just a halo behind it.

---

## The transformation levers, by target

### 1. Character art
- **Replace:** flat-fill parts, no outline, no inner shading, no rim.
- **Enhance (best ROI, already have the rig):** add a **form pass** on top of
  the existing pose rig —
  - a thin darker outline (`rgba` of `darkColor`, lineWidth ~0.06u) around the
    full silhouette so it separates from the dark floor;
  - a **rim-light** on the cloak side facing the nearest warm light (cheap: one
    lighter stroke on the lit edge, fine when warm rooms);
  - a vertical **form gradient** on the cloak (already partially present) plus
    a soft fold line (2 darker strokes) so the cloak reads as draped cloth;
  - **rim glow on the hood opening** (a faint gold arc around the dark face
    opening) so the eyes pop against dark rooms.
- **Biggest quality jump:** this — ~30–60 lines, no assets.

### 2. Gronk
- **Replace:** the silhouette-less red ellipse blob.
- **Enhance:** add form to the existing body/head — darker under-belly outline,
  a **belly highlight** (lighter red arc up-front), wrinkle strokes, thicker
  nostrils, horn/shoulder tufts silhouette, and a **grounded heavier shadow**
  (wider, denser) so his weight reads. Keep the nose-flare tell, lunge, arms,
  feet exactly as-is (they work).
- **ROI:** medium-high; Gronk is the hero of the demo story.

### 3. Furniture / environment
- **Replace:** flat interior fills; near-absent contact shadows.
- **Enhance:**
  - **Contact shadows** — one soft dark ellipse under each object footprint
    (already partial) plus a tighter, darker core at the base so objects sit
    *in* the room rather than float.
  - **Material cue per room** — a 1-stop light face on the lit side (upper-left
    by default) and 1-stop shadow on the opposite side for the big props
    (fridge, couch, shelf, throne). Cheap shading pass, not a redraw.
  - **Room identity** — slightly strengthen the (currently Δ2/255) room tint so
    Cafeteria/Library/Reactor/Storage are distinguishable at a glance, per
    DESIGN.md's flag.
- **Biggest quality jump:** contact shadows (+ unified light source direction).
  This is what sells "miniature diorama" vs "flat rectangles."

### 4. Lighting / depth
- **Replace:** flat additive pools only.
- **Enhance:**
  - **Directional light bias** — decide a single light origin (upper-left warm
    key) and shade the *world* sidebar: floor + object lit faces lean warm,
    far sides lean cool/dark. One global gradient pass.
  - **Deeper vignette + room-to-room falloff** so a huddle of light pools in
    the Reactor/Storage doesn't blend the rooms.
  - **Light as gameplay** — the local player's carrying gold casts a small warm
    pool + the carried diamond casts a moving highlight on the ground.
- **ROI:** medium — a consistent light source is the single strongest
  "polished game" signal.

### 5. HUD
- **Keep (replace nothing):** Phase 6B tokens, avatars, modals, joystick,
  timer/toast/status are done and DESIGN.md-aligned. Only micro-gap: make the
  carry state's HUD chip glow track the world aura (already gold-glow). No work.

### 6. Mobile controls
- **Keep.** Joystick is hardened (Phase 6A.1); only style tweak if any — the
  joystick/98% action buttons match the HUD already. No work.

### 7. Hide / emerge presentation
- **Keep architecture; enhance feel:** the 300ms slide + cover fade + motes is
  in place. Add the DESIGN.md "physical" beats that are still missing at draw
  time: a **crouch/compress squash** during entry (character rig already takes
  `scaleMul` — feed an eased squash from the hide anim), a **furniture settle
  reaction** (`reactT` already feeds object draws — verify it paints the dip),
  and a small **readability last-frame** (a few motes + brief object glow at the
  contact point). No architecture change — this is wiring the existing hooks.
- **ROI:** high; it's the signature mechanic.

### 8. Treasure / magic effects
- **Enhance, don't replace:** keep gold aura + diamond + sparkles + pings +
  confetti; add **light response** — carried gold casts the warm ground pool
  (see Lighting #4) and, on pickup, a quick 0.2s warm rim flash on the carrier.
  Make the bank/reveal moments use the existing flash/shake at readable strength.
- **ROI:** medium; the gold→light coupling sells "magic."

---

## External art assets — where they'd give the biggest jump

The procedural Canvas pipeline is *capable* of the target (per DESIGN.md), and
asset loading adds risk (pipeline, mobile memory). **I do not recommend pulling
in sprite/SVG assets for this pass.** If art assets ever ARE added, the order of
biggest payoff would be:

1. **Pre-rendered offscreen sprites** of each furniture kind (draw each once at
   high detail into offscreen canvases at asset-build time, blit per frame) —
   unlocks texture-level detail (wood grain, cloth folds, rivets) that flat
   paths can't cheaply reach. Keeps the `drawVisualObject` contract; pure
   client path change.
2. **Character face/accessory set** — a few authored hooded-adventurer portrait
   variants for the HUD and nameplate identity.
3. **Gronk idle/attack pose set** — 3–5 authored poses for the catch/reveal
   story beats.

None are required for the transformation pass; the in-place procedural form
pass achieves the biggest visual win in low risk.

---

## Proposed implementation order (this pass)

1. **Global light-source direction** — one warm key origin; add contact-shadow
   core + a light-face/shadow-face shading helper in `objects.ts` and apply to
   the big props. (Highest depth win, single pass.)
2. **Character form pass** — silhouette outline, cloth fold shading, hood-opening
   rim glow, warm rim on the lit side (reuse the light direction).
3. **Gronk form pass** — body outline, belly highlight, wrinkles, heavier shadow.
4. **Hide/emerge feel wiring** — feed squash from the hide anim, verify the
   furniture settle reaction paints.
5. **Lighting enrichment** — stronger room tint, deeper vignette falloff, gold
   carrier ground-pool + pickup rim flash.
6. **QA probes + screenshots** — extend `visual-qa.ts` with determinism probes
   (outline pixel present, contact shadow under object, room tint Δ increases,
   hide squash non-1, Gronk body highlight present). Run typecheck / 64+ unit /
   build / full visual QA. Reuse the Qodo PR workflow; keep all prior checks green.
7. **Human visual gate** before calling it done.

## What is deliberately NOT changed
`src/engine/*`, `src/server/*`, API/networking, movement/transform rules,
occlusion architecture, camera architecture, particle/audio/effects
architecture, HUD system, mobile movement semantics, TrueForge config/agents.