# DESIGN.md — Gronk's Hoard Visual & Design Specification

> **Status:** authoritative design document. Source of truth for Phase 6 and all
> future frontend/client presentation work.
>
> **Revision (Phase 6 pre-flight, animation art direction):** a human playtest
> of the live Phase 5 build found that **the character animation feels bad** —
> characters read as small procedural UI objects translating across a canvas,
> not physical animated game characters. This revision adds the animation art
> direction (character rig, per-state animation language, hiding as the
> signature mechanic, furniture reactions, Gronk direction, event pipeline,
> procedural-vs-assets decision, architecture, and implementation order) that
> the next implementation phase must follow. Automated pixel probes cannot
> judge animation quality; the human visual finding takes precedence.
>
> **How this audit was performed (honesty note):** the client source
> (`render.ts`, `character.ts`, `objects.ts`, `audio.ts`, `particles.ts`,
> `effects.ts`, `main.ts`, `input.ts`, `style.css`, `index.html`) was read in
> full. The 19 screenshots under `qa/screenshots/` were inspected
> **programmatically** (custom PNG decoder: mean luminance/RGB, dark-pixel
> fraction, hue distribution, identity-color presence per state) — this
> environment has no image viewer, so **subjective visual judgment of the
> screenshots requires a human**. What pixel analysis proved: the world palette
> is highly coherent across every state (mean luminance 62–68/255, ~60–62% dark
> pixels, gray-dominant ~58% with balanced muted color), players/Gronk/gold are
> present and readable at gameplay zoom (0.1–0.4% of pixels each), and room
> tint differences are extremely subtle (ΔRGB ≈ 2/255 between rooms). Where
> this document asserts something looks a certain way, treat it as a design
> rule to enforce, not as a claim that it was visually verified.

---

# GAME IDENTITY

**Personality:** playful danger. A cozy-but-creepy dungeon crawl you play with
friends — hiding under a couch is funny *and* tense.

**Emotional tone:** mischievous warmth with real threat. Laughing at a friend
getting revealed, then jumping when Gronk's nose flares.

**Visual genre:** dark-fantasy interior. Top-down miniature diorama of a
mysterious building (cafeteria / library / reactor / storage), drawn with
chunky cartoon props — the readability of Among Us, the identity of a fantasy
hide-and-seek game. **Original characters, not Among Us characters.**

**Atmosphere:** dim, soft, slightly magical. Deep navy/charcoal base, muted
material colors, restrained warm-gold magic accent. Rooms are lit from above
with colored light pools; the world is never flat-black and never neon.

**Target feeling:** "tiny fantasy adventurers running around inside a
beautifully illustrated mysterious building."

**Visual direction (revised by the animation pre-flight):** "Among-Us-level
readability + polished RPG-level animation + an original fantasy party-game
identity." Readability discipline comes from Among Us (big simple silhouettes,
instant state readability, soft shadows); animation ambition comes from polished
2D RPG/party games (weight, anticipation, secondary motion, expressive poses);
the identity is entirely original. Explicitly **NOT** "Among Us but fantasy"
and **NOT** a conventional RPG — this is a fantasy party game where hiding is
the signature move. The game must be visually compelling enough that the
TrueForge orchestration (agents deciding, Gronk hunting, treasure secrecy,
human approval) is instantly understandable in a demo.

**Visual references (categories, not copies):** Among Us (readability, big
simple silhouettes, soft shadows, room vignettes); Hearthstone / Goblin
interiors (chunky fantasy props, warm firelight); old-school top-down
adventure games (clear silhouettes, readable state); dark-fantasy concept art
(low-key lighting, restrained palette).

**What the game should NOT feel like:**
- a SaaS dashboard or generic web app UI
- a neon/synthwave party scene
- a Minecraft-style blocky sandbox
- flat HTML rectangles with labels doing the work
- a particle showcase or screen-shake simulator

---

# COLOR SYSTEM

Semantic tokens. One hue can serve multiple semantic roles, but each **role**
has one token. Never introduce a new hex for a role that already has a token.

## Core surfaces
| Token | Value | Use |
|---|---|---|
| `bg-deep` | `#05070d` | canvas clear / deepest space behind the world |
| `bg-app` | `#0b0e14` | page background, outer wall frame (`#0a0e17`) |
| `bg-screen` | radial `#1a2233` → `#0b0e14` | menu screens backdrop |
| `bg-panel` | `#10161f` | inputs, team columns, modal surface |
| `bg-raised` | `#182032` | buttons, seats, chips |
| `bg-raised-hover` | `#232e47` | hover of the above |
| `surface-border` | `#3a4660` | the default UI border everywhere |
| `surface-border-soft` | `rgba(60,72,100,0.6)` | chips / secondary borders |

## World
| Token | Value | Use |
|---|---|---|
| `world-floor` | gradient `#141a27` → `#1a2231` → `#131925` | base slab |
| `world-wall` | `#2c3448` | interior wall face (beveled) |
| `world-wall-outer` | `#232a3c` | outer wall face |
| `world-wall-frame` | `#0a0e17` | outer frame |
| `world-jamb` | `#39435c` | door jambs |
| `world-decor` | `#3a4660` / `#46536e` / `#5b6a8a` | vents, pipes, hatches |

## Text
| Token | Value | Use |
|---|---|---|
| `text-primary` | `#e8ecf4` | headings, buttons |
| `text-secondary` | `#c7d2e4` | body, HUD text |
| `text-muted` | `#9aa7bd` | taglines, hints, room-code labels |
| `text-dim` | `#4a5670` / `#6b7688` | empty seats, closeted state |

## Semantic accents
| Token | Value | Use |
|---|---|---|
| `accent-gold` | `#ffd166` | THE magic/treasure/CTA color: title, primary button, treasure, carrying, riddle banner, room code, "you" marker, affordance. Dark companion `#7a4b00` (title shadow), warm `#ffe08a`/`#ffe9b0` (eyes, highlights) |
| `danger` | `#ff7b72` | errors, sudden-death timer, toast borders, reactor accent. Toast surface `rgba(120,20,20,0.92)` with `#ffd9d6` text |
| `success` | `#4fc36b` | "active/healthy" status dot only |
| `info` | `#4fc3f7` | team-0 identity, library accent, poster blue |
| `gold-trim` | `#c9a34a` | metal/gold details on props (throne trim, lock, finials) — the *muted* gold for props vs the *bright* `accent-gold` for gameplay/magic |
| `danger-surface` | `rgba(120,20,20,0.92)` / solid `#781414` | danger toast surface; the solid form is the danger **button** fill (hover `#93201d`) — one danger family, no third red |
| `success/info/warning-surface` | `rgba(23,80,44,.92)` / `rgba(21,66,94,.92)` / `rgba(122,75,0,.92)` | dark toast surfaces derived per semantic family (warning = the `gold-dark` family), with a state dot in the semantic color as the second cue |

## Players (identity colors — fixed, non-negotiable)
| Seat | Body | Dark (trim/boots) | Team |
|---|---|---|---|
| wizard-0 | `#4aa8e8` cyan | `#2f6fa3` | 0 (blue family) |
| wizard-1 | `#f2765b` coral | `#b04b36` | 1 (red family) |
| wizard-2 | `#8ee36b` leaf | `#5ba83f` | 1 (red family) |
| wizard-3 | `#e072f0` bloom | `#a843bd` | 0 (blue family) |

Team is NOT a color change of the body — it is the floor pip + the dark trim.
`TEAM_COLORS` = `#4aa8e8` / `#f2765b` for pedestals and team indicators.

## Gronk
| Token | Value | Use |
|---|---|---|
| `gronk-body` | `#c8322b` | normal |
| `gronk-enraged` | `#8a1414` | enraged (darker + screen edge pulse `rgba(255,40,40,…)`) |
| `gronk-eyes` | `#ffe08a` | glowing eyes, nose-flare ring `rgba(255,209,102,0.85)` |

## Usage rules
- Gold = single "magic/treasure/CTA" color. Players' carried-treasure gold IS the
  same gold as the UI accent. Never add a second gold.
- Color communicates hierarchy and state; never decoration. If a color doesn't
  mean something, it doesn't exist.
- Red is overloaded on purpose and MUST be distinguishable by context: Gronk
  red (body), danger red (UI), reactor accent (room). Keep their placements
  separate so they never compete in one view.

---

# TYPOGRAPHY

Two separate type systems — **screen-space** (DOM UI) and **world-space**
(canvas labels). Never mix them.

## Screen-space
- **Families:** UI = `"Segoe UI", system-ui, sans-serif` (default). Numeric /
  code = `ui-monospace, monospace` (timer, room code).
- **Display:** title only — `clamp(2.5rem, 8vw, 5rem)`, gold, `letter-spacing
  0.06em`, hard drop shadow `0 4px 0 #7a4b00` + soft `0 8px 24px rgba(0,0,0,0.6)`.
  Used on Title and Result. Decorative casing (caps) is for display type only.
- **Headings:** a two-level hierarchy. H1 = display above. H2 = screen headers
  (Multiplayer, Lobby, modal titles) — must be styled (see
  `CURRENT INCONSISTENCIES` — currently browser-default).
- **Body/tagline:** muted, default weight.
- **Buttons:** `1.1rem / 600`, primary CTA text is dark (`#3a2400`) on gold.
- **Labels:** HUD chips `0.82rem`; room-code `2.4rem / 800 / +0.12em` mono;
  code input `1.3rem / +0.2em` uppercase; toast `0.95rem`; riddle `0.95rem`;
  timer `1.2rem` mono; desktop hint `0.78rem / +0.04em`.
- **Numbers/timers:** always mono, tabular by construction (`MM:SS` zero-padded).
- **Casing:** UI labels and hints are UPPERCASE where they are *verbs/actions*
  (TRANSFORM, ACTION, BANK, HIDE, SEARCH); prose (riddle, tagline, toast) is
  sentence case.
- **Decorative type is limited to the title.** Everything else is functional.

## World-space (canvas, drawn in world units — scales with the camera)
| Element | Size / weight | Notes |
|---|---|---|
| Room floor labels | `800 3.2px`, alpha 0.4 | reference only, painted into the floor |
| Name tags | `600 0.85px` | secondary to the character; hidden while transformed |
| GRONK label | `700 0.9px` | above the troll |
| Affordance chip | `700 0.8px` | "HIDE · E" |

---

# SPACING

A 4-based scale: **4 · 8 · 12 · 16 · 24 · 32 · 48**. Map existing values onto it;
no one-off numbers for new UI.

| Token | Value | Existing uses |
|---|---|---|
| `sp-1` | 4px | chip dot gaps, tiny paddings |
| `sp-2` | 8px | seat padding, small radii (8px) |
| `sp-3` | 12px | HUD edge margins (top/left/right 12–14px) |
| `sp-4` | 16px | team-col radius, modal radius 20px ≈ sp-4+, gap 16px |
| `sp-5` | 24px | controls/joystick inset (26px ≈ sp-5) |
| `sp-6` | 32px | lobby gap (2rem), large padding |
| `sp-7` | 48px | section breaks on menu screens |

- Screen margins: 12px game HUD; 26px touch controls; menu screens center with
  `gap: 1rem` (16px).
- Riddle banner `max-width: min(640px, 90vw)`; modal `max-width: 420px, width 90%`.
- Buttons: `padding 0.7rem 1.6rem` (≈ 11×26px), `min-width 220px` on menus.

---

# HUD

Feels like part of the game world: dark translucent panels, 1px soft borders,
mono numbers, gold for anything "magical/objective". No web-page cards.

**Layout (game screen):**
- **Timer** — top-right, `12px` inset. Mono, `MM:SS / MM:SS` (elapsed / duration).
  Sudden death: danger color + 1s pulse.
- **Players strip** — top-left, column of compact pills: seat-colored avatar,
  name (`(you)` suffix for self), state dot. Self pill gets a gold border +
  soft glow. Fingerprint-based DOM updates only (no churn per poll).
- **Riddle banner** — top-center, under the top edge: dark panel, `border-left
  4px` gold, gold text, centered, `max-width min(640px, 90vw)`. Fades in/out on
  phase change only.
- **Toasts** — top-center below the banner, stacked, pill-shaped, danger-styled
  ("Gronk got X!"), 0.25s slide-in, 3.2s auto-dismiss. Rare and meaningful.
- **Mute** — icon button below the timer (top-right, `58px`).
- **Desktop hint** — bottom-center, faint, `WASD move · Space action · E transform`.
- **Sudden-death treasure pings** — canvas-drawn expanding gold rings (world).
- **Enrage** — screen-edge red pulse + Gronk darkening (screen-space, canvas).

**Hierarchy rules:** objective/gold first, threat second, environment last.
HUD opacity 0.8–0.88 panels — enough to read, never enough to block the world.

---

# BUTTONS

One family, consistent everywhere.

- **Shape:** pill (`border-radius 999px`), `2px` border, `font 1.1rem/600`.
- **Primary (gold):** `bg #ffd166`, border same, text `#3a2400`; hover `#ffdf8e`.
  Reserved for THE one action on a screen (Single Player, Create, Start, Approve).
- **Secondary:** `bg #182032`, border `#3a4660`, text `#e8ecf4`; hover `#232e47`.
- **Danger:** `bg #c0392b` (see inconsistency — must adopt the `danger` token
  family), white text; used only for Reject.
- **Ghost:** transparent; used for Back/quiet exits.
- **Icon buttons:** circular `44px` (mute) — set to 44px on all pointers
  (satisfies the ≥44px coarse-pointer target with one rule; the 2px desktop
  difference is imperceptible).
- **Mobile action buttons:** big circles, not pills. ACTION `96px`, TRANSFORM
  `64px`, weight 800, hard drop shadow + inner top highlight. Context label
  changes are the tutorial (SEARCH / PICK UP / BANK / STUN / HIDE / UNTRANSFORM).
- **States:** hover = raised bg; pressed = `scale(0.96)` (instant, `0.05s`);
  disabled = `opacity 0.4` + `not-allowed`; focus = gold outline (see
  accessibility — currently missing).

---

# INTERACTION STATES

| State | Visual behavior |
|---|---|
| Idle | breathing bob (characters), static UI |
| Hover | `bg-raised-hover` |
| Pressed | `scale 0.96`, instant |
| Disabled | `opacity 0.4` |
| Nearby interactable | the single nearest hideable object gets a pulsing gold outline + "HIDE · E" chip that scales in over 0.25s with one tick sound |
| Hiding (enter) | 300ms slide into the object + cover fade + motes + whoosh + tiny camera bump |
| Hidden | character occluded behind furniture; no ring, no name tag; furniture fully rendered |
| Emerging | 300ms slide out + cover fade-down + motes + whoosh |
| Stunned | white flash alternating, orbiting gold stars, slouch; strong impact feedback on reveal |
| Carrying | gold glow aura, gold diamond above head, sparkle burst on pickup |
| Closeted | desaturated body, dim HUD chip |

Durations: micro-interactions ≤0.3s; HUD fades 0.6s; particles 0.4–1.5s.
Easing: enter/exit = cubic in-out; appear = ease-out cubic; UI = `ease`.

---

# ICONS

- **Style:** minimal geometric glyphs drawn at 1px weight; the only "rich" icon
  is the mute speaker (emoji — acceptable, replaceable).
- **Stroke/fill:** filled circles/dots for status; no outlined-card icons.
- **Scale:** 9px status dots, 20px HUD avatars, 42px icon buttons, 96px action.
- **Icon-with-text rule:** icons accompany text on state dots and status; the
  action button is text-only (the label IS the icon).
- **Never mix** emoji icons with canvas glyphs in the same view.

---

# PLAYER STATUS

Presentation of existing authoritative states — never new states.

| State | In world | In HUD chip |
|---|---|---|
| active | normal adventurer, breathing | green dot |
| walking | bob + feet shuffle + dust, speed-scaled | — |
| carrying | gold aura + floating diamond + slower | gold glow on avatar + gold dot |
| transformed | local: translucent ghost + motes; enemies: invisible (they ARE the furniture) | — |
| hidden | occluded behind furniture | — |
| stunned | white flash + orbiting stars + slouch | gold pulsing dot |
| in_closet | desaturated | dim chip (opacity 0.45, gray dot) |
| revealed | = stunned (engine reveals just before stun) | — |

Color is NEVER the only signal: stunned = flash + stars + motion; closeted =
desaturation + dim; carrying = aura + gold object. Each state has ≥2 cues.

---

# ROOM STATUS

Rooms communicate identity through **floor pattern + props + decor + ambient
audio**; tint is a whisper. Do not make rooms shout.

| Room | Floor | Tint / accent | Signature props | Ambience |
|---|---|---|---|---|
| Cafeteria (top) | large tiles + grout | warm `#ffd9a0` / gold | fridge, barrels, chest, tables | warm kitchen hum |
| Library (center) | wood planks, staggered seams | cool `#9fd8ff` / info blue | bookshelf, couch, tapestry, books | quiet air / paper |
| Reactor (bottom-left) | metal panels + rivets | `#ff9d7a` / danger | brazier (fire), statue, vents | low mechanical hum |
| Storage (bottom-right) | concrete slabs | `#8ee36b` | cauldron (vapor), crates, barrels | hollow room tone |

Motifs must stay readable without labels: a player should know they're in the
Library from the planks + books, not the floor text. Floor labels remain as
faint reference (alpha 0.4).

---

# MODALS

- **Surface:** dark panel (`bg-panel`), `2px surface-border`, radius 20px,
  padding `2.5rem 2rem`, `max-width 420px / 90%`, centered.
- **Backdrop:** `rgba(0,0,0,0.7)`, full-screen, `z-index 100`.
- **Title:** gold, `1.8rem`, sentence caps ("Team 1 is banking the treasure!").
- **Buttons:** primary + danger for approval; primary for reconnect.
- **Behavior:** appears/disappears with the authoritative `pendingBank` /
  reconnect state; no animation yet (Phase 6 may add a 0.2s fade/scale — keep
  it short). Mobile: same panel, `width 90%`.
- **Reconnect modal:** states "Reconnecting…" (retrying) vs "Room no longer
  exists" (server restarted, Back to Title shown).

**Known defect to fix in Phase 6:** the modal surface currently references
undefined CSS variables (`--bg-secondary`, `--border`, `--accent`,
`--text-muted`) — see `CURRENT INCONSISTENCIES` P0-1.

---

# TOASTS

- **Placement:** top-center, below the riddle banner, stacked downward.
- **Use:** only notable events — "Gronk got NAME!" and bank approval/rejection
  results. NOT for empty searches, NOT for footsteps, NOT for riddle lines.
- **Style:** danger pill (dark red surface, `#ff7b72` border, `#ffd9d6` text),
  0.95rem, slide-in 0.25s, fade after 3.2s.
- **Stacking:** newest on top; max ~3 visible; auto-remove.

---

# MOBILE CONTROLS

- **Joystick:** bottom-left, 150px circle, translucent white ring (`rgba(255,
  255,255,0.22)` border + faint radial fill), 60px gold radial knob with
  highlight; knob translates with finger, clamped to radius; drop = reset.
- **Action buttons:** bottom-right column; ACTION 96px gold circle (primary),
  TRANSFORM 64px dark circle above it. Text labels change contextually.
- **Touch feedback:** instant (`scale 0.96` on press); joystick is 1:1 finger.
- **Safe-area:** controls inset 26px from corners; keep 96px action clear of
  the joystick arc; mute button must not sit under the thumb zone.
- **Portrait/landscape:** controls are corner-anchored so both orientations
  work; verify no HUD overlap in portrait (players strip vs riddle banner).
- **Desktop vs touch is decided by pointer type** (`(pointer: fine)` vs
  `(pointer: coarse)`), not by width — this is deliberate and stays.

---

# ANIMATION LANGUAGE

Philosophy: **subtle by default, responsive on interaction, impactful only on
major events.** Restraint is the identity. Animation exists to answer "what
just happened?" — never to decorate. It must be readable during real gameplay
at the gameplay camera zoom, on desktop, tablet, and mobile.

## The problem (human playtest finding — P1)

The live Phase 5 build's environment reads well, but the **characters animate
badly**: they feel like small procedural UI objects translating around a
canvas rather than physical animated game characters. Root causes, verified in
code:
1. **A rigid vertical icon, not a body.** The torso is one fixed trapezoid, the
   hood one fixed cone. Only the bob, two tiny arm sleeves, and two boots move;
   nothing articulates (no torso lean, no stride, no hip sway, no arm reach).
2. **Amplitudes too small to read.** At the gameplay zoom the character is
   ~3.4 units tall (≈85px on a 900px viewport). Walk bob is 0.13u (≈3px), arm
   swing 0.13u (≈3px), boot lift 0.07u (≈2px). These read as jitter, not
   walking. The feet are nearly invisible when stationary.
3. **Facing barely changes the silhouette.** Left/right mirror; up/down differ
   only by a 0.16u face offset and a lean constant. There is no back view (the
   face stays visible when walking away) and no directional stride pose.
4. **No anticipation or settle.** Walking starts and stops instantly. No
   crouch before moving, no body settling after stopping, no cloak/accessory
   follow-through (secondary motion).
5. **Stun has no slouch.** The code comment claims a slouch; the code only
   swaps colors to white and orbits stars. The body never droops.
6. **Hide is a slide + fade, not an entry.** The character translates and
   fades behind furniture; there is no crouch/compress, no directional
   approach, no cloak fold, and the furniture never reacts.
7. **Gronk is a single rigid ellipse** with eyes — no feet, no arms, no head,
   no nostrils, no posture, no catch lunge. The most important character in
   the game is currently the weakest.

## Character art direction

The hooded-adventurer identity (Phase 3) is kept as a **concept**; the
internal rig is rebuilt so the character reads as a physical body:
- **Strong readable silhouette** — cloak + pointed hood + wand, but built from
  an articulated skeleton (hip anchor, torso, head/hood, two arms, two feet)
  with pose parameters driving each part. Parts move together, never as
  independent primitives.
- **Readable facing** — up/down/left/right must produce visibly different
  silhouettes: a back view (hood opening hidden, hood tip forward), a front
  view (eyes + buckle visible, feet step toward camera), and two profile views
  (stride visible, wand leading). Diagonal facings may interpolate the nearest
  two.
- **Physical weight** — torso leans into movement (lean scales with speed, not
  a per-facing constant), feet plant and push, the body settles on stop.
- **Expressive state poses** — one clear pose per state (idle stand, walk
  stride, carry hunch, stun droop, hide crouch), not color swaps.
- **Secondary motion** — cloak hem and hood-tip tassel lag movement on a
  spring; the wand sways; nothing snaps to a new direction.
- **Accessories stay recognizable** — belt + gold buckle, star-tipped wand,
  boots, glowing eyes. These are identity, not noise.

## Per-state animation language

| State | Required motion | Must NOT |
|---|---|---|
| **IDLE** | breathing scale 1→1.018 (60fps), blink every ~3.4s, occasional tiny head/hood tilt; no constant movement | bounce constantly; sway like a UI element |
| **WALK** | speed-driven cycle: vertical bob + hip sway + alternating stride (feet plant/push) + torso counter-rotation + arm swing + cloak sway; amplitude scales with speed; cycle rate tied to speed | look identical to idle; slide without stepping |
| **RUN/CHASE** | stronger forward lean, bigger stride, faster cycle, cloak streaming behind | reuse the walk cycle with a speed multiplier only |
| **STOP** | deceleration: lean relaxes over ~150–250ms, body settles (tiny 1.03→1 squash), cloak swings forward past the body then returns | freeze instantly mid-stride |
| **STUN** | impact anticipation (flinch), droop/slouch (torso leans, shoulders drop, head down), wobble, orbiting stars, white flash; recovery on exit | only a color swap + stars |
| **CARRY** | arms shift to hold position (both hands toward the gold diamond), slight hunch, slower cadence, treasure bobs | walk normally with a floating gem |
| **HIDE ENTRY** | approach → anticipate (crouch) → compress (squash toward the object) → cloak folds → magical motes → move behind the object → cover fades up → furniture settles | instant disappear; pure alpha fade |
| **HIDE EXIT** | furniture reacts (cushion/door/lid) → character unfolds (scale up) → steps out → lands (tiny settle) → normal idle | teleport out; pop-in |
| **TRANSFORM** | magical language: silhouette compresses, motes/light particles stream into the object, a brief gold shimmer at the contact point, then the object is "settled"; audio syncs to the shimmer | instant state swap |
| **REVEAL** | sharp impact: character pushed out of the object, white flash, star burst, screen shake, then the stun droop | a text label or color change |

Durations: anticipation 80–120ms; action 200–350ms (hide enter/exit stays
300ms); settle 150–250ms. Easing: anticipation = ease-in, action = ease-out
cubic, settle = spring-ish decay (one overshoot ≤3%, no bouncing). All motion
is time-based (`dt`/`timeMs`), never frame-counted.

## Hiding — the signature mechanic

The single most important animation in the game. It must communicate "I
physically entered this object," not "my state variable changed and my sprite
disappeared":

`wizard approaches couch → crouches → compresses → cloak folds → magical
motes → slides behind the couch → cover fades up → couch settles`

and the reverse on emerge: `cushion stirs → character unfolds → steps out →
lands → resumes idle`. The furniture may react subtly (cushion dip, fridge
door swing, chest lid shift, barrel ring, tiny dust puff) — restrained, fast
(~250–350ms), and never gameplay-affecting. The authoritative state changes
instantly; every part of this sequence is presentation. Opponent *entry*
stays skipped (disguised enemies are invisible — they ARE the furniture);
their *emerge* anim runs for everyone.

## Furniture reaction direction

Furniture is part of the core mechanic, not decoration. The Phase 2 object
renderers are already rich enough (multi-part silhouettes: couch cushions,
bookshelf shelves+books, chest lid, fridge body). The animation pass adds a
per-object **settle reaction** on hide/emerge — 1–2 primitives re-drawn with a
brief offset/dip (e.g. the couch's seat cushions compress 0.1u for 250ms; the
fridge door nudges 0.15u). Implemented as a small `reactT` map in the renderer
feeding the existing `drawVisualObject`/`drawVisualObjectFront` calls — no
object-system rewrite, no new gameplay. Restraint: never animate everything at
once; only the object being entered/exited reacts.

## Gronk animation direction

Gronk gets a **different animation language** from the wizards — heavy,
physical, exaggerated, slightly comedic but threatening (players: agile /
magical / sneaky; Gronk: heavy / loud / predictable):
- **Body:** a hulking shape with visible feet (heavy stomping on the walk
  cycle), arms that swing and reach on catch, a distinct head with nostrils,
  and a belly that sways with his weight. Not a rigid ellipse.
- **Idle:** slow breathing, occasional head turn, heavy foot-shift.
- **Sniff / nose flare (the tell):** the existing pre-sniff pulse stays — it is
  the "freeze!" moment — plus a head lift and nostril flare; the ring pulse
  remains the readable cue.
- **Pursuit:** forward lean, big heavy stride, dust puffs per step, louder
  footstep sounds; the whole body commits to the direction.
- **Catch:** a lunge/reach (arm extends) at the moment of touch — the game
  needs a visually obvious "catch event" for the commentator/analyst story
  ("Gronk just caught Wizard 2!").
- **Enrage:** existing darkening + edge pulse stay; add a faster, heavier
  stride and faint rage motes.
- **Comedic-but-threatening:** the waddle stays, but grounded — his weight
  makes the floor feel his steps.

## Animation hierarchy (priority — never visual noise)

1. **CRITICAL:** hide entry/exit, transform, reveal/stun, catch, treasure
   pickup/drop — these are the game's story beats.
2. **HIGH:** walk/run cycles, Gronk pursuit — constantly on screen, must read
   at a glance.
3. **MEDIUM:** idle breathing, accessory motion, interaction affordance.
4. **LOW:** ambient secondary motion (cloak sway at rest, dust, embers).

An effect from a lower tier may never obscure a higher tier (a cloak sway may
not hide the stun flash; particles may not cover a hide entry).

## Event → animation → audio → particle pipeline

Presentation is **driven by authoritative state transitions** — the engine is
the only truth; the client renders those transitions deterministically. The
mapping below is the canonical table the animation pass implements (all
current events exist today; the pass deepens their animation):

| Authoritative event | Visual event | Animation | Audio | Particles / camera |
|---|---|---|---|---|
| state → `transformed` | hide entry | crouch→compress→slide→cover (300ms) | hideStart whoosh (+ hideComplete at cover) | motes; tiny camera bump; furniture settle |
| `transformed` → active | emerge | unfold→step out→land (300ms) | emerge whoosh | motes; tiny shake; furniture settle |
| → `stunned` | reveal + stun | flinch→droop + wobble + stars | reveal + stun | star burst; white flash; shake 1.2; slouch pose |
| carrying false→true | treasure pickup | arms-to-hold pose shift, hunch | pickup shimmer | sparkles; camera bump |
| carrying true→false | treasure drop | drop pose relax | drop clink | shake 0.6 |
| Gronk target set (chase) | pursuit begins | Gronk commits: lean + heavy stride | Gronk alert (cooldowned) | shake 0.8; dust per step |
| Gronk catch (player → closet) | catch event | Gronk lunge/reach + player snatched | heavy thud | shake; dust |
| `enraged` true | enrage | darker body + heavier stride + edge pulse | Gronk alert | red flash; rage motes |
| match start | game start | characters reveal, banner fades in | gameStart | flash 0.2; confetti-free |
| match end | game end | result state, characters relax | gameEnd | existing result feedback |
| walk (per cycle) | footsteps | stride cycle phase | footstep (per cycle, scaled) | dust (throttled) |

## TrueForge / replay compatibility

- **Agents reason about events, never frames.** The LLM agents already decide
  from public state at 2.5–15s cadences; the client renders those outcomes.
  The animation pass keeps this split — no agent code touches animation.
- **Deterministic presentation.** The event table above is declarative: given
  the same authoritative event stream, the client produces the same visual
  event. This lets a future **analyst/replay layer** reconstruct hide/emerge,
  catches, and pursuits purely from public state + events, and lets a future
  **commentator agent** reference named events ("catch", "pickup", "bank
  approval") that the game already renders visibly.
- **Optional event log (future, not now):** a ring-buffered client-side log of
  named events `(event, player, x, y, tick)` could feed replay/heatmaps. Do
  not build it in the animation pass — just keep the mapping table declarative
  so it can be added without changing the renderer.
- **No animation invents gameplay.** Interpolation, anticipation, and settle
  are presentation-only. A player can never appear to move, hide, or act in a
  way the authoritative state does not support.

## Procedural Canvas vs SVG vs sprites — recommendation

**Stay on procedural Canvas 2D, upgraded to an articulated pose-based rig.**

Why not sprites/SVG:
- Sprites need an asset pipeline, art source, and loading — an artist is not
  available and the hackathon timeline does not allow commissioning frames.
- Sprite sheets cost mobile memory and complicate the existing back/front
  occlusion + hide-fade + state-swap machinery (the character must stay
  composable with cover alpha, scaleMul, ghost translucency).
- SVG per-frame would re-parse/measure per draw or need Path2D caching — no
  readability win over canvas paths.

Why procedural wins here:
- On-screen characters are large (~3.4u ≈ **85px** at the 900px viewport) —
  plenty of room for a 15–25 part articulated rig to read clearly.
- A pose-parameter rig (compute pose params from state + speed + direction +
  time, then draw the body from params) is ~200–300 lines in character.ts —
  no pipeline, no loading, no new assets, mobile-safe.
- The walk cycle can be driven by a small keyframe pose set (4–8 poses
  interpolated by phase) or by summed sines (bob + hip + stride + arm phases)
  — both are deterministic and QA-testable via pose-param hooks.
- Camera, world projection, occlusion, particles, effects, and audio are
  already complete and stay untouched.

**Answer to the required question: YES — the current procedural Canvas
renderer can realistically reach the target quality within the remaining
hackathon timeline**, via: (1) rebuild character.ts as an articulated
pose-based rig with real stride/lean/settle (the single biggest win);
(2) directional back/front/profile silhouettes; (3) anticipation/settle +
cloak secondary motion; (4) stun slouch + carry hunch poses; (5) hide
crouch/compress + furniture settle reactions; (6) Gronk upgrade
(feet/arms/head/nostrils/lunge); (7) reduced-motion + QA hooks. If a further
quality jump is ever needed, the fallback is **pre-rendered vector poses**
(draw each pose once into an offscreen canvas, blit per frame) — a code-only
path change that keeps the drawCharacter contract, so it can be layered on
later without rewriting the renderer.

## Proposed animation architecture

- **`character.ts` becomes a rig.** Input stays `CharacterOpts` (state, speed,
  facing, walkPhase, timeMs, carrying, ghost, alphaMul/scaleMul — the contract
  is preserved so render.ts and QA hooks keep working). Internally:
  `computePose(opts) → Pose` then `drawPose(ctx, pose, colors)`. Pose carries
  torsoLean, shoulderY, armSwing, stride (per-foot offset + lift), hoodTilt,
  cloakSway, squash/stretch, eye state, droop (stun), hunch (carry).
- **Animation state is derived, not stored.** speed → gait (idle/walk);
  velocity change → anticipation/settle envelope (a small smoothing value with
  a release curve); state → pose modifier (stun droop, carry hunch, hide
  crouch). A `motion` envelope tracks acceleration so stopping settles.
- **Walk cycle:** phase advanced by speed as today; amplitudes scale with
  speed; a direction-aware stride (feet step along the facing axis; back view
  shows heels, front view shows toes).
- **Hide enter/exit:** keep the 300ms timeline and cover fade; add a crouch
  phase (scale/compress toward the object), a directional approach, and a
  furniture settle reaction (`reactT` map in render.ts feeding object
  draw calls). No timeout governs correctness — server state stays instant.
- **QA hooks:** extend `__ghChars` with pose params (torsoLean, stride,
  droop, hunch) so probes can assert the walk cycle actually articulates and
  states pose differently — determinism without claiming artistic quality.
- **Gronk:** a small separate rig (body + head + nostrils + 2 arms + 2 feet +
  belly) with its own pose params (lean, stride, lungeT, sniffT).

## Performance

The rig adds a handful of matrix transforms per character (4 wizards + Gronk)
and a few extra primitives per frame — negligible next to the existing scene.
Budget rules: no per-frame allocations in the hot path (reuse pose objects or
stack-allocate), no new canvases, no per-frame DOM, no path re-parsing.
Furniture reactions redraw 1–2 primitives for the reacting object only.
Particles stay pooled and bounded (350). Verify on a mid-range phone: 60fps
with all four wizards + Gronk + hide animations on screen.

## Accessibility (animation)

- **Every state communicates through ≥2 channels.** Hidden = occlusion + no
  ring/name; stunned = flash + stars + droop; carrying = gold aura + gold
  diamond + hunch; transformed = ghost + motes (self) / furniture (others);
  Gronk alert = growl + shake + nose flare. Never color alone.
- **`prefers-reduced-motion`:** halve walk bob/stride amplitude and cloak
  sway, disable camera shake + flash + confetti, keep hide/emerge as a short
  fade (essential state changes must stay readable). The reduced-motion gate
  must not remove gameplay information — only amplitude and shake.

## Implementation order (the animation pass — next implementation phase)

1. Character rig: `computePose` + `drawPose` with real stride/lean/settle
   (walk + idle + stop). Keep `drawCharacter` signature; QA hooks extended.
2. Directional silhouettes (back/front/profile) + cloak secondary motion.
3. Stun droop/wobble + carry hunch pose states.
4. Hide crouch/compress + emerge unfold + furniture settle reactions
   (`reactT`), synced to the existing event pipeline.
5. Gronk rig upgrade (feet/arms/head/nostrils/lunge) + enrage stride.
6. Reduced-motion gate + perf pass (verify 60fps mobile) + Playwright probes
   (pose params articulate, states pose differently, hide reaction fires).
7. Typecheck, 64+ unit tests, build, full visual QA green; Qodo-reviewed PR.

**Explicitly out of scope for the animation pass:** Phase 6 UI redesign
(title/lobby/HUD/result screens), engine/server/API changes, commentator and
analyst agents, custom-bot sandboxing, dynamic riddles, `cmdSeq` ordering.

## Risks / tradeoffs

- **Visual noise risk:** more moving parts can read as busy. Mitigation: the
  hierarchy + restraint rules above; articulation is gated by state (idle
  breathes, only walkers stride).
- **QA churn:** pose hooks change `__ghChars`; existing probes must stay green
  (extend, don't replace).
- **Scope creep into Phase 6 UI:** explicitly excluded above.
- **"Rig still feels flat" risk:** mitigation is the reference-quality pose
  set (directional stride, anticipation, settle) — validated by a human
  playtest before proceeding to later phases.
- **Reduced-motion correctness:** the gate must preserve ≥2 cues per state.

## Animation rules (existing, reinforced)

- Camera: exponential follow `k = 1 − e^(−7·dt)`, snap on teleport (>60 units),
  clamped to world; presentation impulses decay (`e^(−8t)`), shake decays
  `e^(−5t)` halved on touch; never expose outside the map.
- World lerp: `k = 14/s`, snap >8 units.
- No bouncing/elastic motion. No constant movement. No flashing beyond the
  defined stun/sudden-death pulses. (One ≤3% overshoot on settle is allowed.)
- All motion is time-based (`dt` or `timeMs`) — never frame-count based.

---

# AUDIO LANGUAGE

- **Identity:** dark-fantasy, warm, slightly magical; short procedural tones —
  NO sci-fi beeps, no copyrighted music.
- **Ambience:** per-room beds (low sine hum + detuned second oscillator +
  lowpass), crossfaded over ~2.5s on room change; very quiet.
- **Hierarchy (loudness):** game-start/end ≈ stun/reveal ≈ Gronk > pickup/drop >
  hide/emerge > interaction > footsteps. All sounds are quiet (gain 0.03–0.12).
- **Repetition:** per-sound cooldowns (footstep 130ms, interaction 250ms,
  Gronk 2s, etc.) — no spam; footsteps scale with movement and stop when
  stationary.
- **Silence is a tool:** empty searches make no sound cue beyond the ambient bed.
- **Failure safety:** audio failure is a silent no-op; never blocks gameplay.
- **Master mute** exists; init happens on first user gesture only.

---

# ACCESSIBILITY

- **Text:** HUD ≥ 0.82rem; in-world labels are reference-only, never load-bearing.
- **Contrast:** muted text (`#9aa7bd` on `#0b0e14`) passes 4.5:1+; gold on dark
  passes for large text; danger text on dark passes.
- **Focus:** add a visible focus ring (gold outline) — currently missing for
  keyboard navigation on menus/modals.
- **Reduced motion:** respect `prefers-reduced-motion` — drop shake, flash,
  confetti, and heavy particle bursts.
- **Color-independent state:** every state has ≥2 cues (see PLAYER STATUS) —
  this is already the rule; keep it.
- **Touch targets:** ≥44px (mute is 44px on all pointers).
- **Audio-independent feedback:** every sound has a visual twin (whoosh→motes,
  growl→shake, stun→flash).
- **Screen readers:** toasts should use `aria-live="polite"`; buttons need
  `aria-label`s (mute has one; action/transform labels are textual).
- **Keyboard:** full flow reachable — Title → menu → lobby → game controls are
  all keyboard-accessible today; verify focus order on modals.

---

# RESPONSIVE BREAKPOINTS

The game's responsive model is **not width-breakpoint based** — it is:

1. **Pointer type** — `(pointer: fine)` hides touch controls + shows the hint;
   `(pointer: coarse)` shows joystick + action buttons.
2. **Camera zoom** — `scale = max(fitWholeWorld, viewportHeight / 36)`; the
   camera zooms to keep ~36 world units vertical, and only falls back to
   "whole 100×60 map fits" when the window is too small (letterbox + stars).
3. **Constrained HUD** — riddle `min(640px, 90vw)`, modal `min(420px, 90%)`,
   timer/chips corner-anchored.

Changes to define/verify at each form factor (Phase 6):
- **Desktop (≥1024px, fine pointer):** full HUD; no touch controls.
- **Tablet (768–1024px, coarse):** touch controls shown; verify players strip
  (left) and riddle (center) never collide; camera zoom unchanged.
- **Mobile portrait/landscape (≤767px, coarse):** touch controls; portrait
  should stack HUD elements tighter (chips full-width under timer?) — verify
  overlap; effects shake halved (already) + particle cap reduced (candidate).
- **Small/letterbox windows:** whole-world fit; keep HUD intact.

Do not invent arbitrary 480/768/1024 width rules unless testing shows a real
breakage at that size.

---

# DESIGN TOKENS

Centralized conceptual token layer (Phase 6 should implement as CSS custom
properties on `:root`):

- **Colors:** the COLOR SYSTEM table above.
- **Typography:** family (UI/mono), sizes (0.78 / 0.82 / 0.95 / 1.0 / 1.1 /
  1.2 / 1.8 / 2.4 / clamp display), weights (600 / 700 / 800).
- **Spacing:** 4 / 8 / 12 / 16 / 24 / 32 / 48 (the SPACING scale).
- **Radii:** 8 / 10 / 12 / 16 / 20 / 999 (pill).
- **Shadows:** hard UI `0 4px 0 #7a4b00` (display only); soft `0 6–16px
  rgba(0,0,0,0.4)` (buttons, knobs); glow `0 0 8px rgba(255,209,102,0.35)` (self).
- **Opacity:** HUD panels 0.8–0.88; disabled 0.4; floor labels 0.4; shadows
  0.1–0.4.
- **Motion:** durations (0.05 press / 0.25 appear / 0.3 hide / 0.6 fade),
  easings (linear press, ease-out cubic appear, ease-in-out cubic hide,
  exponential decays for camera/shake/flash).
- **Z-index:** world canvas (base) → HUD → mute 30 → ping 50 → modal 100 →
  confetti 200.
- **State tokens:** hover / pressed / disabled / focus / error / nearby /
  carrying / stunned / closeted, each mapped to a concrete visual above.

---

# VISUAL HIERARCHY

Attention order (already implemented; keep it):

1. **The local player** — predicted at 60fps, white ring, camera follows.
2. **Immediate interaction** — the one highlighted hideable object + HIDE chip.
3. **Threat/event** — Gronk (nose flare, growl, enrage pulse), toasts, stuns.
4. **Important objective** — gold riddle banner, treasure glow, timer, pings.
5. **Environment** — rooms, props, decor, floor patterns.
6. **Atmosphere** — dust, embers, vapor, vignette, ambience.

Any effect that pushes a lower layer above a higher one is a bug (e.g. particles
obscuring the player, HUD covering the action, room glow washing out a wizard).

---

# DO / DON'T

**DO**
- Preserve player readability above everything.
- Use effects purposefully; each effect answers "what happened?"
- Keep one gold, one danger, one success, one info — semantic, not decorative.
- Use silhouette + details over labels; labels are reference-only.
- Keep the world dark, muted, and softly lit; let gold pop by contrast.
- Keep HUD translucent, compact, mono-numbered, part of the world.
- Respect the animation hierarchy (subtle / responsive / impactful).
- Make every state readable without color alone.
- Keep audio quiet, cooldowned, and failure-safe.

**DON'T**
- Add random gradients, neon, or extra glow.
- Use generic SaaS/dashboard styling (rounded white cards, blue links, hover
  shadows everywhere).
- Overuse rounded cards; pills are for buttons, not content panels.
- Make every element animate, bounce, or glow.
- Use color as the only state indicator.
- Let particles, shake, or HUD block gameplay.
- Introduce a second visual language (new font, new radius system, new
  palette family) without updating DESIGN.md first.
- Draw Among-Us crewmates (or beans with visors) anywhere — the HUD avatar is
  currently one; see inconsistencies.

---

# CURRENT INCONSISTENCIES

| # | Location | Current behavior | Why inconsistent | Recommended rule | Priority |
|---|---|---|---|---|---|
| 1 | `style.css` `.modal` (lines ~479–496) | Uses `var(--bg-secondary)`, `var(--border)`, `var(--accent)`, `var(--text-muted)` — **never defined anywhere** | Modal surfaces render with transparent background / no border / inherited title color; approval + reconnect modals are visually broken | Define the CSS token layer on `:root` (or inline the literal values); modals use `bg-panel` + `surface-border` + `accent-gold` | **P0** |
| 2 | `.btn-danger` | `#c0392b` / hover `#e74c3c` | Third red family (error `#ff7b72`, Gronk `#c8322b`, this generic SaaS red) | Danger UI uses the `danger` token family (`#ff7b72`-derived) | **P0** |
| 3 | `index.html` / screens | `h2` screen headers (Multiplayer, Lobby, modal titles) have **no CSS rule** — browser default | Not part of the type system; clashes with the gold display title | Add H2 token (size/weight/spacing/case) in Phase 6 | **P1** |
| 4 | `main.ts` `spawnConfetti` | Bright web hexes `#ffd700 #ff6b6b #4ecdc4 #ffe66d #a29bfe #55efc4` | Arbitrary palette outside the system (teal/mint/indigo); reads as generic party, not Gronk's world | Confetti = gold/warm family + the 4 seat colors only | **P1** |
| 5 | `style.css` `.player-chip .bean` + `::after` visor | HUD avatar is a **bean with a visor** (Among-Us crewmate) | Directly contradicts the Phase 3 decision to remove Among-Us identity; in-world characters are hooded adventurers | Replace with a mini hooded-adventurer glyph or seat-colored pip; HUD mirrors character identity | **P1** |
| 6 | Room tint washes | ΔRGB between rooms ≈ 2/255 (measured) | Rooms may read as identical floors except for pattern/props; tint is *too* restrained to help wayfinding | Slightly strengthen room tint/glow (still subtle) OR rely on props + floor + ambience and document that choice | **P1** |
| 7 | `style.css` `.btn-mute` | 42px circle | Below the 44px touch-target guideline on coarse pointers; sits in the thumb zone | ≥44px on coarse pointers; keep top-right under timer | **P1** |
| 8 | Keyboard/focus | No `:focus-visible` styling anywhere | Keyboard users get no visible focus on menus/modals | Gold outline focus token; verify modal focus trap | **P1** |
| 9 | State dot green | `#4fc36b` (success) vs seat leaf `#8ee36b` | Two unrelated greens in the HUD | `success` token is the active-dot color; document it as separate from seat colors | **P2** |
| 10 | `.btn-ghost` | `margin-top: 1rem` + `min-width: 0` one-offs | Magic numbers outside the spacing scale | Fold into spacing tokens (`sp-4` top margin) | **P2** |
| 11 | World-space type | Three ad-hoc sizes (3.2px room, 0.85px names, 0.8px chip, 0.9px Gronk) | Not formalized anywhere; easy to drift | Promote to the world-space type scale in DESIGN.md (done — enforce) | **P2** |
| 12 | `prefers-reduced-motion` | Not handled | Shake/flash/confetti run regardless | Add a reduced-motion gate for shake, flash, confetti, big particle bursts | **P2** |
| 13 | `character.ts` walk animation | Walk = bob (0.13u) + arm swing (0.13u) + boot lift (0.07u) on a fixed trapezoid/cone body — ≈3px on an 85px character | The character reads as a translating icon, not a body; amplitudes are below perception at gameplay zoom | Articulated pose-based rig with speed-scaled stride/lean/settle (see ANIMATION LANGUAGE) | **P1** |
| 14 | `character.ts` stunned branch | Comment claims a slouch; code only swaps body to white + orbits stars | Doc/code mismatch; stun lacks the promised droop | Draw a real droop/slouch pose + wobble (see per-state table) | **P2** |
| 15 | Facing | Up/down differ by a 0.16u face offset + a lean constant; face stays visible walking away | No back/front/profile silhouettes; direction reads weakly | Directional posing: back view hides the face, profile shows stride, front shows toes | **P1** |
| 16 | Start/stop | Movement starts and stops instantly; no anticipation or settle; no cloak secondary motion | Characters teleport into/out of motion; nothing feels physical | Anticipation/settle envelope + cloak follow-through spring | **P1** |
| 17 | Gronk (`drawGronk`) | Single rigid ellipse + eyes + nose ring; no feet/arms/head/nostrils/posture | The most important character is the weakest; catch has no visible lunge | Gronk rig upgrade (see Gronk animation direction) | **P1** |
| 18 | Hide enter/exit | Linear slide + alpha/cover fade; no crouch, no directional approach, no furniture reaction | "State changed" rather than "I entered this object" | Hide crouch/compress + emerge unfold + furniture settle reactions | **P1** |
| 19 | No run/chase gait | Wizards have one walk gait; Gronk chase = same waddle faster | Chase moments don't read as urgent | Add a run/lean gait for chases (Gronk lean + stride; players on flee) | **P2** |
| 20 | Walk phase advances while stationary | `charPhase` advances at 4 rad/s even at speed 0 (masked by the speed gate today) | Latent smell; any future pose math reading phase directly would jitter | Advance phase only when speed > 0 (fix inside the rig work) | **P2** |

---

# PRESERVE

Do not change these without a strong, documented reason:

1. **Camera** — follow + exponential smoothing + lookahead + world clamping +
   whole-world fallback; presentation impulses stay out of the persistent
   camera.
2. **World palette coherence** — the dark navy/charcoal base, muted materials,
   single gold accent (verified coherent across all 19 screenshots).
3. **Floor patterns + beveled walls + vignette + flicker lights + dust** — the
   Phase 1 atmosphere layer.
4. **VisualObject system** (objects.ts) + back/front occlusion + 300ms hide
   enter/exit — the Phase 2/4 hiding architecture.
5. **Hooded adventurer identity** — pointed hood, glowing eyes, cloak, wand,
   boots; breathing idle, speed-driven walk, directional facing, stun/closet/
   ghost states. (The identity concept, colors, and the `drawCharacter` call
   contract are preserved; the internal rig is rebuilt to the new animation
   language — see ANIMATION LANGUAGE.)
6. **Seat colors** cyan / coral / leaf / bloom, with team carried by pip +
   dark trim.
7. **Gronk** — red troll, waddle, nose-flare tell, enrage darkening + edge pulse.
8. **Particle restraint** — pooled (max 350), throttled, on-screen-only spawns.
9. **Audio architecture** — semantic methods, per-sound cooldowns, room
   ambience beds, gesture-gated init, total failure safety.
10. **Effects restraint** — bounded shake (halved on touch), clamped camera
    impulses, short flashes.
11. **Interaction affordance** — single highlighted object + compact chip,
    scale-in once, one tick sound.
12. **Player strip HUD** — compact pills, fingerprint-based DOM updates.
13. **Pointer-type responsive model** (fine vs coarse) + camera-fit zoom —
    the game's responsive strategy.

---

# IMPLEMENTATION RULE

> DESIGN.md is the source of truth for Phase 6.
> Any Phase 6 UI or presentation implementation that contradicts DESIGN.md
> must be treated as a design inconsistency and resolved before proceeding.
> If a future implementation requires changing the design system itself,
> update DESIGN.md first, then implement the change.
