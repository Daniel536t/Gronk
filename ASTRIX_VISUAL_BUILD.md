# ASTRIX VISUAL BUILD — what the world renders, and why

Status: implementation notes for the final visual pass. Companion to
`ASTRIX_GODOT_SEAM_AUDIT.md` (which covers the authority seam) and
`godot/assets/ASSET_PIPELINE.md` (which covers authored-GLB integration).

This document exists because most of the visual work in this pass was
*root-cause* work, and the reasons are not obvious from reading the final code.
Each section states the defect that was observed in a render, the cause, and the
fix — so the next person does not re-introduce it.

---

## 1. Art direction

One source of truth: `godot/scripts/AstrixPalette.gd`.

Direction: **saturated low-poly settlement diorama** — a green / terracotta /
ocean-blue triad with desaturated cream and grey neutrals, flat Lambert
materials, no textures, one warm key light with real shadows plus a strong sky
ambient. Sampled from the project reference (`/home/ubuntu/refs/ref1.jpg`).

**Deliberate departure from the previous build.** The shipped palette was pale
parchment-lavender with violet water. Visual review found the violet water did
not read as water at all, and the whole frame collapsed into one dark value
band. Per the current objective (clarity + beauty + simulation legibility) the
water is now ocean blue and the meadow is actually green. The violet signature
is kept but *demoted to the Dusk biome and crystal props*, where it reads as
"strange island" instead of contaminating the world.

Colour is **taxonomy**, not decoration:

| Hue | Means |
|---|---|
| terracotta | built by people |
| green | alive / growing |
| gold (`CROP_HARVEST`) | harvest-ready — the only emissive accent |
| grey | stone / inert |
| blue | water |
| violet | arcane (Dusk only) |

### Palette lesson: soil vs timber

`SOIL` was `#7a5f32` and `TIMBER` was `#6b4a2e` — the same hue. Reviewers
consistently read farm fields as **wooden decks**. Soil is now a dark red-brown
(`#5b3418`), well away from every timber colour.

---

## 2. Construction language

`AstrixMesh.gd` holds every primitive. Two rules matter:

1. **`box_on` / `cylinder_on` / `cone_on` are BOTTOM-ANCHORED.** The pivot is at
   ground contact. This removes the entire class of "geometry floats / sinks /
   leaves a void band" bugs. The earlier island stack was centre-anchored and
   left an unoccupied band from y 1.6–2.3, which is why every island looked like
   it was hovering.
2. **`PrismMesh` ridges run along Z**, not X. A gable roof's ridge cap is
   therefore a long thin bar along Z. Getting this backwards produces a roof
   with a cap across its slope.

`AstrixAssets.gd` builds every physical thing from those primitives, and every
builder returns a node whose **origin is the ground contact point**, so callers
place assets with `node.position = Vector3(x, surface, z)` and they sit flush.

---

## 3. Water (`godot/shaders/ocean.gdshader`)

Three iterations, each driven by a specific review finding.

| Iteration | Finding | Change |
|---|---|---|
| translucent plane + 46 whitecap quads + ~100 foam dashes | "does not read as water; the quads read as broken slabs floating in the sea" | replaced entirely by one shader surface; **all decal geometry deleted** |
| v1 shader | "a flat blue backdrop with bloom" | hard two-step depth ramp, explicit crest streaks, scalloped shore foam, real analytic normals |
| v2 shader | "reads as sky — clouds and ripples in the same field" | white reserved **exclusively** for the shoreline band; open-water crests are blue-on-blue; added a directional sun glint aligned with the key light |

The shader receives the island footprints as uniforms (`island_a/b/c` =
`x, z, rx, rz`) and generates shallows, foam and surf **from actual land
positions**. There is no water dressing geometry at all.

Supporting cues, all of which were added because the ocean kept reading as sky:

- a **seabed** 6 units under the surface, so no gap ever shows through to nothing;
- island cliffs that continue **5 units below the waterline**;
- a near-black wet rock band at the waterline (pale rocks there read as *cloud
  puffs under a floating island*);
- **sailboats** scaled up and moved inside the observatory frame — a boat is the
  single strongest "this is water" signal available;
- one boat placed **mid-channel** between the islands, so the pair reads as one
  settlement with traffic rather than two unrelated sites.

---

## 4. Islands

Each island is a **continuous column**: submerged plinth → stone cliff → soil
band → grass cap, with a rocky rim of boulders straddling the waterline, an
optional sand spit, and (in winter) a snow blanket plus a shore-ice collar.

The sand spit sits **above** the waterline and overlaps the grass cap. An earlier
version floated a sand disc at water level and review reported it as "a detached
white blob in open water".

---

## 5. Core → world coordinate mapping

Core's coordinates are abstract: farmland clusters at one end of each island,
houses at the other, islands spread across x 10–84. The renderer places islands
where they compose well and maps authoritative positions onto them via
`_map_core_pos`.

```
offset = (core_pos - core_center) * core_flip * core_scale     # anisotropic
offset = clamp(offset, -radius*0.72, +radius*0.72)             # PER AXIS
```

Three details that are all load-bearing:

- **`core_scale` is a Vector2.** The meadow stretches X so Core's 4-unit farm
  spacing becomes ~5 world units — enough that two farm plots never overlap —
  while keeping Z inside the island.
- **The clamp is per-axis (a box, not an ellipse).** An ellipse clamp collapsed
  distinct farms onto the same rim arc and made them overlap.
- **`core_flip` mirrors both axes** so Core's farmland lands in the
  camera-facing foreground (the food story is what the demo has to show) and
  Core's houses sit up-screen behind it.

Composition is a presentation decision. Core's coordinates are never modified.

---

## 6. Farms and crops — three iterations

This failed visual review twice before it read correctly.

| Attempt | Review verdict | Cause |
|---|---|---|
| 3×4 slot grid, pale tan soil, corner posts + rails, thin stalks | "no farms exist" | 0.075-wide stalks are ~2px at the observatory camera; 12 slots holding 3 stalks read as empty |
| ridge bars + rails | "reads as a wooden deck with railings" | uniform-width bars at uniform spacing = planks; posts + rails = a boardwalk railing; soil hue = timber hue |
| **current** | "furrow ridges clearly readable; three stages distinguishable" | see below |

The current model: **one authoritative crop = one densely planted row** on a
ridge of turned earth built from overlapping *clumps* (not bars). The field is
sized by crop count, the boundary is a low earth bank (no railings anywhere),
and every station is a ~0.34-wide sheaf rather than a stalk.

Five growth tiers, each differing in height, mass **and** colour:

| `growthStage` | Reads as |
|---|---|
| `0.0` | bare seeded ridge — turned mounds only |
| `< 0.3` | seedlings — low green tufts |
| `< 0.65` | growing — mid green bushes |
| `< 1.0` | mature — tall sheaves with grain heads, colour turning |
| `1.0` | **harvestable** — gold, heavy, faintly emissive |

Unplanted rows stay as bare tilled ridges, so *spare capacity is visible* — "there
is room to plant" reads without any UI.

---

## 7. Villagers = authoritative population

`Villager3D.gd`. The invariant: **rendered villager count == `WorldState.population`**.
Villagers are spawned and freed only in response to authoritative snapshots, so
starvation visibly removes people.

The figure is a real articulated rig — hip pivot, torso, two legs with boots, two
arms with hands, head with hair/eyes/nose, plus a role accessory (hoe + straw hat
/ grain basket / plank + mallet) and a winter cloak. Walk, idle and work
animation blend so starts and stops are not instant.

`BODY_SCALE` went 1.0 → 1.16 → **1.38** across three reviews ("29px unreadable
pawns" → "still tiny, confused with signposts" → "read as people"). At 1.38 a
villager is ~2.15 units against 1.95-unit house walls, which is ~52px on a 768px
viewport at the observatory camera.

Movement is a deterministic patrol between authoritative anchors (buildings,
plaza). Farm anchors sit **in** the field so farmers are visibly at work in the
furrows. The walking is cosmetic; the *number* of villagers and *which anchors
exist* are authoritative.

---

## 8. Season and time come from Core

`_apply_season(season, time)` is driven only by the authoritative snapshot.
`_sim_phase` stays `-1` until a real snapshot arrives — there is no wall clock
fallback once Core has spoken.

- **Time of day** → sun elevation + azimuth arc, warm/cool grade, sky gradient,
  ambient energy, and water colour. Core's day runs 08:00 → 08:00 with peak sun
  near 13:00.
- **Season** → grass/foliage repaint, snow caps (roofs, island tops, farm plots,
  the frost watchtower), shore ice, and villager cloaks.

Two bugs worth remembering:

1. **Sim-materialized props are created after the first season is applied.**
   Registering a mesh as seasonal was not enough — it kept its constructor
   colour, which is why a bright green summer canopy stood in the snow.
   `_seasonal_mesh()` now repaints immediately if a season is already active.
2. **Roof snow has to be built by whoever built the roof.** A world-level box
   guess cannot match a gable. Assets emit `SnowCap*` children and
   `_register_snow_in()` hands them to the season system.

---

## 9. Camera

Three modes: `OBSERVATORY` (default), `ARCHIPELAGO`, `FOLLOW`.

Framing is **derived, not guessed**. The camera is orthogonal at 45° yaw / ~38°
pitch, so work in its own ground axes:

```
u = (x - z)/√2   runs screen-right
v = (x + z)/√2   runs screen-down (toward the camera)
visible patch    = size*aspect along u,  size/sin(38°) along v
```

`OBS_SIZE_LANDSCAPE = 32` because the meadow (r 14.5 at origin) plus Frost
(r 8 at 26,-14) need 50.3 along u and 30.5 along v; at 16:9 that frame provides
56.9 × 52.1. Both islands fit whole — an earlier value cropped Frost and sliced a
building in half.

**Portrait is a re-composed shot, not a shrunken desktop view.** In landscape the
meadow→frost axis runs screen-horizontally, which is exactly wrong for a tall
frame. Portrait *orbits* the camera so that axis runs screen-**vertically**
(`OBS_OFFSET_PORTRAIT` is aligned with the island axis), Frost sits nearer the
camera, and the settlement sits above it. Pitch and roll are unchanged, so the
diorama read and the light direction are identical. Orientation changes snap
rather than glide — lerping across a 60° yaw sweeps the camera through the sea.

---

## 10. Occlusion, shadows, z-fighting

- **Foreground occlusion:** tall vegetation is placed on island interiors and the
  far (north/west) rim only. The near corridor between camera and settlement
  carries low bushes, tufts and rocks. The plaza, the farm belt and the orchard
  block are explicitly excluded from scatter so they read as *cultivated*.
- **Shadows:** one shadow-casting directional light (`KeySun`, upper-left, 48°)
  plus a non-shadowing sky fill. The previous build's oversized blob-shadow
  discs — which drew on top of roofs — are gone. Villagers keep one small
  depth-write-disabled contact quad so they can never look like they hover.
- **Z-fighting:** every ground decal (paths, plaza, orchard strips, farm soil) is
  a **thin box with real thickness at a distinct height**, never a coplanar quad.
  That is the actual fix, rather than hiding the artifact with a camera angle.

---

## 11. Food store — stakes visible in the world

`AstrixAssets.food_store()` + `_materialize_food_store()`.

Review kept reporting the same thing across four renders: *"the stakes exist only
in text — the HUD says four days of food and pressure high, but the render is a
sunny prosperous idyll."* The fix is a granary at the settlement centre whose
stock is driven by authoritative `food` (0–9 sacks against
`FOOD_STORE_CAPACITY = 48`). A full store looks full; an empty one shows toppled
baskets. It rebuilds only when the sack count would actually change.

Getting it *visible* took five attempts, and each failure is a general lesson:

| Attempt | Probe said | Review said | Lesson |
|---|---|---|---|
| crib 2.6 × 1.3 units, sacks inside, 0.24 radius | sacks 8px | "no granary" | at the observatory camera 1 world unit ≈ 24px; a 0.24-radius prop is *8 pixels* |
| building-sized crib, sacks still inside | roof 18px | "no sacks" | anything **inside** a roofed structure is invisible from a top-down diorama camera — stock must sit on open ground |
| 0.6-radius gold spheres on an outside platform | 16px | "zero sacks" | gold beside a gold wheat field reads as *more wheat*; the reserve must differ in colour from the standing crop |
| 0.72-unit cream boxes with straps | 14px | "sheep or boulders" | small cream blobs on grass are livestock, not goods |
| **0..5 tapered stacks, ~2.2 units tall, cream with dark straps and a grain cap** | **42px** | — | a prop that must be *identified* at diorama zoom has to be **person-sized** |

The general rule this pass established: **measure props in screen pixels before
believing they are visible.** `godot/tools/probe_props.gd` and
`godot/tools/probe_store.gd` exist for exactly that. 8px, 14px and 16px props all
existed, rendered, and were invisible to a viewer.

Two probe gotchas worth knowing, both of which produced false "MISSING" reports:

- Godot renames duplicate sibling names to `@MeshInstance3D@NNN`, so a probe
  counting `Sack` found *one* when four existed. Asset builders now emit unique
  names (`Sack_0`, `Sack_1`, …).
- A `MeshInstance3D`-only filter misses props built as `Node3D` groups. The store
  probe now walks the whole subtree.

Two other cues serve the same "make it physical" purpose:

- houses emit **woodsmoke** from their chimneys — the clearest "someone lives
  here right now" signal available in a still frame (also scaled up after a probe
  measured the first version at 7px);
- the **most recently constructed building** gets an extra villager anchor, so
  the steward's last act has bodies at it and a viewer can find what changed by
  looking at the world rather than only reading the activity log.

### Honest limitation

The store now measures **42px** on screen and its stack count provably tracks
authoritative `food` (probe: `food=21 → 2 stacks`, matching `round(21/48 × 5)`).
But an independent viewer asked to find "grain stacks" still describes them as
"cream blocks with yellow caps" — i.e. it sees the geometry and reads it as
*small buildings*, not as stored grain.

That is a real limit of the diorama camera, not a bug: at 42px a prop can carry a
silhouette and a colour, but not enough surface detail to be *semantically*
identified without context. Making stored food unambiguous would need either a
closer camera (the FOLLOW mode already provides one) or a labelled HUD affordance
pointing at the store. Both are deliberate choices left open rather than a defect
to paper over.

---

## 12. Observatory HUD (`AgentConsole.gd`)

Presentation only. Every value comes from an authoritative source:

| Panel | Source |
|---|---|
| WORLD strip (day / season / pop / food / rate / days left / pressure) | `GameClient.astrix_state_received` — Core snapshot |
| STEWARD badge (lifecycle state, last action, consequence) | `/astrix/agent/status` |
| ACTIVITY feed | `lastEvents` from agent status + authoritative deltas |
| APPROVAL panel | the real `pendingApproval` |

Before the first snapshot every field renders `—`, never a plausible default.

Layout: panels are **content-sized** (`reset_size()`), the feed is anchored to the
bottom edge, and portrait stacks the world strip and steward badge. A fixed
height left a ~200px empty void hanging over the settlement, and in portrait it
covered the farm district the activity log was describing.

Consequence detection compares authoritative day-over-day values (buildings,
crops, population, food, season) — it never predicts or invents an event.

---

## 13. Approval UX

The panel only ever shows a **real pending proposal**. It carries the subject as
the largest text, then route, cost (with affordability against authoritative
`resources`), risk, irreversibility, what it unlocks, the steward's reason, and
the live `PROPOSED → APPROVED → EXECUTING → VERIFIED` chain.

Deliberate choices from review:

- A **scrim dims the world only** — it is moved to child index 0 so it draws
  beneath the Observatory panels. Added last, it covered the activity log that
  explains the proposal.
- **The safe action carries the visual weight.** REJECT is the filled button;
  APPROVE is outlined, and default keyboard focus lands on REJECT. Approving is
  the irreversible choice, so it does not get the inviting treatment.
- An **unaffordable proposal disables APPROVE** and says why, rather than letting
  the human click into a server-side rejection.
- The panel states **SIMULATION PAUSED**, because world time really is frozen
  while the gate is open.
- In landscape the card is offset left of centre so the channel between the
  islands — where a proposed bridge would actually go — stays visible.

`ApprovalGate.gd` remains the explicit seam in the scene tree (it receives the
authoritative request and routes the decision) but draws no UI, so the human
never sees two competing dialogs.

---

## 14. Reproducible visual evidence

`godot/tools/astrix_fixture.gd` + `godot/tools/screenshot_harness.gd`.

**GameClient polls the live Core server twice a second.** Any render that does
not stop polling first captures whatever the live world happens to be — which is
how an early render came out dark and empty (the live world was 3000+ days old
with population 0). `FIX.go_offline(root)` stops the poll timer and points the
API origin at a dead port before the fixture is applied.

The fixtures are **real Core-shaped snapshots** — same field names, same value
ranges, same growth-stage semantics as `src/astrix/state.ts` produces. They
replace the transport, not the authority model.

```
ASTRIX_SHOT_PATH=/tmp/x.png \
ASTRIX_SHOT_SCENARIO=autumn|winter|evening|approval \
ASTRIX_SHOT_CAMERA=observatory|archipelago|follow \
godot --path . --script tools/screenshot_harness.gd --resolution WxH
```

Three probes, all of which report **screen pixels**, not just existence:

| Probe | Answers |
|---|---|
| `tools/diag_snapshot.gd` | did the snapshot land, what got materialized, how tall is a villager on screen |
| `tools/probe_props.gd` | do the named storytelling props exist, are they on-screen, how many px |
| `tools/probe_store.gd` | full FoodStore subtree with world + screen coordinates |

This is how "built but illegible" was distinguished from "not built" instead of
guessing from a render. Every prop scale decision in this document came from one
of these probes.

---

## 15. Known limits

- Vegetation and settlement dressing are static, built at boot. When an
  authoritative building lands on a prop, `_clear_footprint()` hides the prop —
  the settlement clearing land for a new farm is the correct visual answer, but
  it is a visibility toggle, not a real terrain edit.
- `MAX_RENDERED_VILLAGERS = 14`. Above that the count stops tracking population
  exactly; the HUD figure remains authoritative.
- The Dusk island is deliberately outside the observatory frame. It is visible in
  `ARCHIPELAGO` mode only.

---

## 16. Reimagination pass — "The Bowl, the Bastion, and the Shatter"

The three-island *topology* is authoritative (Core's `BiomeId`, island list,
bridge pairs, connectivity) and was kept: merging landmasses would falsify what
a bridge claims. Everything the topology does not fix was re-authored so the
world has a memory hook: **a white needle with gold rings over gold terraces,
chained by gated bridges to a snowy crag and a haunted violet rock.**

| Change | Why | Truth note |
|---|---|---|
| Meridian Spire on the plaza knoll (dais + needle + 2 gold torus rings + violet tip + 4 banners) | the world had no landmark; 10-second memory test failed | ancient monument, environmental like the watchtower; claims no function |
| Meadow farm belt set into 2 dry-stone terrace steps + irrigation rill + spring basin | farms read as stamped plots; now agriculture relates to terrain | ornamental dressing like paths/well; no irrigation state claimed |
| Frost raised 4.2 → 5.4 + basalt-column palisade + winter cornice; watchtower → taller Beacon | Frost read as a second Meadow; now the high alpine Bastion | presentation heights only; all mapping/bridge/camera math derives from `ISLANDS` |
| Dusk deepened a full violet step + shard rim + broken arch ruin + crystal veins + 3 bobbing splinters | old Dusk read as unfinished snow | ruin/splinters are weather/mystery on wall-clock (cloud precedent); veins echo but never are the resource node |
| Bridge gates (pylons + lintel + lantern + cloths) at all 4 heads incl. unbridged meadow↔dusk | crossings were planks sprouting from grass | static geography at rim 0.80; stands with or without Core's bridge |
| Stone causeway lanterns along the Frost road | infrastructure should read as mattering after dark | kindle from authoritative `time`, like the plaza lamps |
| 5 harbour gulls over the channel | sky life; proves navigable water alongside the moored boats | wall-clock wildlife (cloud precedent); boats stay moored — Core has no transport |
| Drowned Giant reef behind Dusk | horizon-scale mystery | kept LOW after a tall version filled the frame top as a grey void-slab; visible mainly in portrait overview |

Two bugs this pass, both general lessons:

1. **Gate yaw.** The span runs along local X while paths/bridges run along local
   Z, so a gate needs the *same* yaw as a path (`atan2(dx,dz)`), not +90°.
   Reasoned wrong once; the render showed pylons fore-and-aft and the math was
   rechecked against `_path_between` and the bridge builder.
2. **Distant-mass scale discipline.** At ortho size ~56, a 24-wide mass 20 units
   past Dusk fills the frame top as a featureless slab. Background masses must
   stay low (reef, not continent) or far enough to be haze.
