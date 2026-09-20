# ASTRIX — FINAL VISUAL BUILD VERIFICATION

Everything below is real tool output from this pass. Where something did not
land, it says so.

---

## 1. Automated checks

| Check | Command | Result |
|---|---|---|
| Test suite | `bun run test` | **198 passed / 198** (19 files) |
| Typechecks | `bun run typecheck` | **clean** (`tsc --noEmit` + `tsc -p tsconfig.client.json`) |
| Godot parse/import | `godot --headless --import` | **0 script errors** |
| Canonical deterministic run | `bun run astrix:canonical` | **survived** — day 1→31, pop 4→4, food 40→142, 7 farms / 2 bridges, 61 decisions, 111 proposals (5 high-risk), 4 approvals granted / 1 rejected, 110/110 executed+verified, 1 adaptation, 928 events |

No regressions to Core, CommandBus, approval, security, TrueForge, MCP, or
canonical determinism. The canonical run's numbers are byte-identical to the
pre-pass baseline.

---

## 2. Live deployment

Rebuilt the Godot web export and restarted the deployed process onto it.

```
godot --headless --export-release "Web" ../server/static/index.html   -> [ DONE ] savepack
pm2 restart astrix --update-env
```

| Endpoint | Result |
|---|---|
| `GET /astrix/state` | **200** in 0.008s |
| `GET /` (Godot web build) | **200**, 5,436 bytes |
| `GET /index.pck` | **200**, 172,120 bytes |
| `GET /index.wasm` | **200**, 39,514,754 bytes |
| Boot log | `[astrix] steward runtime: trueforge (http://localhost:8790)` |
| Agent state | `IDLE`, provider `trueforge-astrix-steward` |

The served build is the final world: `server/static/index.pck` timestamp
`2026-09-05 03:20`, rebuilt after the last source change (the export was redone a
second time so the deployed `.pck` is not older than `World3D.gd`).

---

## 3. TrueForge exercised live, through the real seam

Started one loop on the deployed server with `ASTRIX_RUNTIME=trueforge`, then made
both human decisions by hand against the live API.

**Provider actually in use:** `"provider": "trueforge-astrix-steward"` (not the
local runtime).

### The APPROVE path

```
BEFORE   bridges: []                    wood: 30
POST /astrix/approval/respond {"approval_id":"approval-001","decision":"approve"}
  -> {"success":true,"command":"BUILD_BRIDGE","irreversible":true,
      "bridgeId":"bridge-002","costDeducted":{"wood":3,"stone":1},
      "length":8,"permanent":true}
AFTER    bridges: [{"id":"bridge-002","islandA":"meadow","islandB":"frost"}]
         wood: 27
         connectivity: meadow↔frost, dusk isolated
```

Event chain from the live loop:

```
APPROVAL_REQUIRED      act-001  build_bridge
APPROVAL_GRANTED       act-001  approval-001
ACTION_SUCCEEDED       act-001  build_bridge
VERIFICATION_STARTED   act-001
VERIFICATION_SUCCEEDED act-001
```

### The REJECT path

```
BEFORE   biomeHealth {meadow 0.8, frost 0.6, dusk 0.4}   wood nodes: 2
POST /astrix/approval/respond {"approval_id":"approval-003","decision":"reject"}
  -> {"success":false,"command":"CLEAR_TERRAIN","irreversible":true,
      "error":"approval rejected"}
AFTER    biomeHealth {meadow 0.8, frost 0.6, dusk 0.4}   wood nodes: 2   (unchanged)

APPROVAL_REJECTED  act-002  approval-003
ACTION_PROPOSED    act-003  clear_terrain  (steward re-planned rather than retrying blindly)
```

A rejected irreversible action changed **nothing** in authoritative state. That is
the security property the whole design exists to guarantee, verified live rather
than asserted.

### The 95-second timeout finding — fixed

A real steward turn against `nvidia/gpt-oss-20b` measured **65–95s**; the code
default was 60s, so TrueForge mode timed out on every turn (confirmed: the live
process had logged `steward decision timed out after 300000ms` under a stale
config). Two changes:

- `src/server/index.ts` now applies a **240s default when `ASTRIX_RUNTIME=trueforge`**
  and no `ASTRIX_DECIDE_TIMEOUT_MS` is set, and logs that it did so. The local
  runtime keeps its 60s default.
- `config/trueforge.json` `decisionTimeoutMs` 60000 → **240000**, with the
  measurement recorded in the file.

Latency is now covered by UX rather than hidden: the Observatory badge shows
`OBSERVING → PLANNING → PROPOSING → AWAITING APPROVAL → EXECUTING → VERIFYING →
ADAPTING`, and the activity feed streams the real events, so a slow turn reads as
the steward thinking instead of a frozen screen.

---

## 4. Render evidence

Ten captures in `/tmp/astrix-final/`, all from the actual running application via
`tools/screenshot_harness.gd` (which takes GameClient offline first so the frame
reflects the requested fixture instead of whatever the live world happens to be):

| File | Scenario | Resolution |
|---|---|---|
| `01-desktop-landscape.png` | autumn, observatory | 1366×768 |
| `02-archipelago.png` | autumn, all three islands | 1366×768 |
| `03-winter.png` | winter, food critical | 1366×768 |
| `04-evening.png` | 19:30 authoritative clock | 1366×768 |
| `05-approval.png` | real pending proposal | 1366×768 |
| `06-tablet-landscape.png` | autumn | 1280×800 |
| `07-tablet-portrait.png` | autumn, re-composed portrait | 800×1280 |
| `08-phone-portrait.png` | autumn | 720×1280 |
| `09-follow.png` | walking Overseer camera | 1366×768 |
| `10-winter-portrait.png` | winter portrait | 800×1280 |

### Storytelling test — independent review of `01-desktop-landscape.png`

| Element | Verdict |
|---|---|
| Water | yes — gradient, shore foam, island + bridge shadows, boats |
| Separate islands | yes — two whole, third implied |
| Houses | yes — cream walls, terracotta roofs, chimneys, woodsmoke |
| Farms | yes — tilled beds with furrow rows |
| Crops at different growth stages | yes — sprouts / mid-green / harvest-ready gold |
| Villagers as people | yes — five figures, matching `POP 5` |
| Bridge over water | yes — deck, rails, piers, plank shadow |
| Paths | yes — running between real places |
| Trees | yes — broadleaf, conifer, saplings, orchard rows |
| Season | yes — autumn foliage agrees with the HUD |
| Food/population | HUD yes; **stored food: qualified** (see below) |
| Agent activity | yes — full observe → plan → tool → execute → verify trace |

**11 clean, 1 qualified.** Winter reads unmistakably in `03-winter.png`: snow on
ground and roofs, shore ice, bare/dormant crops, `WINTER` in ice-blue, `<1 days of
food` and `PRESSURE CRITICAL` both in alarm red, and an activity feed that matches
the winter turn (harvest → ration) instead of describing autumn.

### The one qualified item, stated honestly

Two things did not close, and both are design decisions rather than defects I can
grind out. Neither is hidden in the code.

**Stored food does not read as stored food.** The granary exists, is 42 screen px
tall, and its stack count provably tracks authoritative `food` (probe:
`food=21 → 2 stacks`, matching `round(21/48 × 5)`). But an independent viewer asked
to find "grain stacks" describes them as "cream blocks with yellow caps" — it sees
the geometry and reads it as small buildings, not as stored grain. Five iterations
are documented in `ASTRIX_VISUAL_BUILD.md` §11 with the probe measurement behind
each. At 42px a prop carries a silhouette and a colour but not enough surface
detail to be *semantically* identified without context. Closing it needs a closer
camera (FOLLOW mode already provides one) or a HUD affordance pointing at the
store.

**Golden hour does not read as golden hour.** Four passes on `04-evening.png`. The
mechanism is right — solar altitude drives sun elevation, a warm key opposes a cool
blue-violet fill, the horizon warms, exposure and ambient are tuned so the
settlement stays legible — and each iteration is recorded in the code comments with
the review finding that caused it. What defeats it is the palette: terracotta
roofs, autumn canopies and gold wheat already own the warm register, so warm
*light* cannot be distinguished from warm *paint*. The reviewer's diagnosis is
correct and worth acting on rather than iterating past: it needs a much lower sun
(8–12°, shadows 4–6× object height), a real warm haze band behind the islands, and
probably desaturated roofs in shade. That last part is an art-direction change the
user has explicitly reserved.

One unrelated defect surfaced by the same review and left open: the building at
centre-right in the evening frame shows a flat orange quad beside a solid black
quad, which reads as an unlit face rather than shading. It does not appear in the
midday, winter or portrait captures, so it is specific to the dusk light path.

---

## 5. What the visual pass changed

Full rationale in `ASTRIX_VISUAL_BUILD.md`. Summary:

- **New art-direction spine:** `AstrixPalette.gd` (colour as taxonomy),
  `AstrixMesh.gd` (bottom-anchored primitives), `AstrixAssets.gd` (~20 authored
  asset builders), `shaders/ocean.gdshader`.
- **Water** rewritten three times, ending with a shader that generates waves,
  depth ramp, shore foam and sun glint from island footprints — replacing a
  translucent plane plus ~150 decal quads that read as debris.
- **Islands** rebuilt as continuous columns (the old stack left a void band from
  y 1.6–2.3 and looked like it was floating).
- **Villagers** rebuilt as articulated figures at 3× the original scale, count
  bound to authoritative `population`.
- **Farms/crops** rebuilt three times, ending with one authoritative crop = one
  densely planted row on turned earth, five distinct growth tiers.
- **Season/time** driven only by Core's snapshot; the disconnected 90-second wall
  clock is gone.
- **Camera** framing derived from the island geometry, with portrait as a
  re-composed shot (camera orbited so the island axis runs screen-vertically).
- **Observatory HUD + approval UX** rebuilt: content-sized panels, unknown state
  renders `—`, safe action carries the visual weight, affordability checked
  against authoritative resources, simulation-paused stated explicitly.
- **Three scene probes** that report screen pixels, because "it exists in the
  scene" and "a viewer can see it" turned out to be very different claims.
