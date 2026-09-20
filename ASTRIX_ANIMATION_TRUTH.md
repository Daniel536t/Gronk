# ASTrix Observatory — Animation Truth Table (Phase 8)

Godot is presentation-only. Every moving thing on screen falls into exactly one of
two classes, and the class is stated for each row:

- **DERIVED** — the motion, or its parameters, comes from a field ASTrix Core
  actually reports. Removing the field removes the animation.
- **ENVIRONMENTAL** — wind, water, light. It carries no state claim at all: a
  viewer cannot read any simulation fact out of it. Permitted to keep running
  while the authoritative clock is held, because it asserts nothing about the
  world's progress.

Nothing on this page is class **IMPLIED** — an animation that would let a viewer
infer a state Core does not contain. That class is what the audit removed.

---

## DERIVED

| Object | Authoritative source | Visual representation | Animation trigger |
|---|---|---|---|
| Villager (existence, count) | `population` | one figure per head of population | figure spawned/freed on snapshot |
| Villager (station) | `buildings[]`, `resourceNodes[]`, `islands[]` — via `_rebuild_anchors` per-island buckets | walks a round of the anchors **on its own island only** | route rebuilt when the anchor signature changes |
| Villager (role/livery) | the type of structure it is stationed at (`farm_plot`→farmer, `storage`→carrier, resource node→builder) | tunic colour + tool | respawn only when the derived role changes |
| Villager (working animation) | anchor tagged `work` — `"crop"` only when `crops[]` has a crop on that farm, `"gather"` only on a non-water `resourceNodes[]` entry | stooped tending vs. upright swing | on arrival at an anchor that has authoritative work |
| Villager (walking gait) | its own route | leg/arm swing, direction-aware facing, accel/decel | speed ramps toward `WALK_SPEED`; gait amplitude scales with speed |
| Villager (all motion) | loop `state` (`/astrix/agent/status`) | freezes in place | `set_world_live(false)` for every state in `HELD_LOOP_STATES`, incl. `AWAITING_APPROVAL` |
| Crop (size tier) | `crops[<id>].stage` | 5 discrete heights via `AstrixAssets.crop_tier_height` | rebuilt on snapshot; the **tier itself is never tweened past its authoritative value** |
| Crop (growth transition) | previous vs. new authoritative stage | 0.7 s ease from the old tier up to the new tier | only on a snapshot whose stage increased — forward only, never speculative |
| Crop (harvest) | crop leaving `crops[]` | row freed, plot returns to furrows | snapshot |
| Building | `buildings[]` (`type`, `position`, `islandId`) | one authored structure per record | materialize on snapshot |
| Bridge | `bridges[]` topology + `bridgeAnchorFor` → `_rim_point(a,b)`/`_rim_point(b,a)` | a deck spanning the two named islands' rims | materialize on snapshot; `bridge_segment` is skipped by the building pass so it exists exactly once |
| Food store stacks | `food` | 0–5 sacks on the granary platform | rebuilt when the stack count changes |
| Season palette / ground / foliage | `season` | Meadow/Frost/Dusk repainted; winter reads cold | `_apply_season` on snapshot |
| Window lights, watchtower brazier | `time` (time of day) | windows and the Frost brazier kindle at dusk | `_windows_lit` flips on the authoritative evening factor |
| Sun angle, sky, ambient, shadow length | `time` | solar altitude drives the whole frame's light | eased toward the authoritative phase each frame |
| Camera — ISLAND | `islands[]` (filtered to islands this renderer has geography for) | frames one island centre; the pill names it | pill tap; cycles **only** islands Core reports |
| Camera — STEWARD | agent status: `pendingApproval` → `currentAction` → newest resolvable `actions[]` entry, resolved through the same `_bridge_endpoints`/`_map_core_pos` mapping the world is built from | glides to the object under discussion; the pill names it | new authoritative focus, or pill tap |
| Camera — STEWARD with no target | absence of any resolvable action | holds the **world** frame; pill reads `NO TARGET` | `_has_steward_focus == false` |
| HUD `CLOCK HELD` | loop `state` | amber banner; `— AWAITING YOUR DECISION` when a gate is open | state enters a member of `UNMANAGED_STATES` |

## ENVIRONMENTAL

| Object | Motion | Why it claims nothing |
|---|---|---|
| Water surface | in-shader ripple, foam at every waterline | a sea moves whether or not anything happens |
| Boats | heave, roll, pitch, ±0.045 rad mooring yaw, sail luff | all of it is a **stationary** hull in wind; no boat travels, none carries a wake |
| Grass / trees | sway | wind |
| Crop wind sway | ±0.004–0.038 rad, amplitude scaled by the authoritative tier | the sway is wind; only its *amplitude* is derived (taller crop, wider sway), and it can never change a stage |
| Chimney smoke | rise + scale-in/out puffs | a hearth in a house Core reports; the puff cycle carries no rate information |

---

## What the Observatory deliberately does **not** animate

Each of these was wanted, and each is missing an authoritative field. Core is the
source of truth, so the animation stays out rather than the field being invented:

| Wanted animation | Missing authoritative state |
|---|---|
| A specific villager assigned to a specific job | no per-villager record at all — `population` is a scalar |
| Villagers crossing a bridge | no villager position, no movement, no path state |
| Boats sailing between islands | no vessels, no routes, no transport, no in-transit cargo |
| Resources visibly carried from node to store | no resource-movement state; `resources` is a per-island total |
| A building under construction | no construction-in-progress state; a building exists or does not |
| A garrison or patrol at the watchtower | no garrison, no watch, no patrol state |

The one honest consequence of that last group: villagers work **only** where Core
puts work, boats stay **moored**, and the watchtower's only life is the brazier
the authoritative clock lights at dusk.
