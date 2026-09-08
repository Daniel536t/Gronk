# ASTRIX_GODOT_SEAM_AUDIT.md

> **Question:** can Godot faithfully observe and represent the authoritative
> ASTrix world state?
>
> **Answer: yes for the state it consumes, but the seam is lossy.** Godot never
> mutates authoritative state and never invents it (one narrow exception, §3).
> However **9 of 23 snapshot fields are dropped at the client boundary**, and
> several fields that *are* consumed are shown only as console text rather than
> rendered in the 3D world. Detail per field below.
>
> Verified against source on `feat/mobile-first-gameplay`; every row cites
> `path:line`. Field list captured from a live `GET /astrix/state`.

---

## 1. How authoritative state reaches Godot

```
AstrixWorldState.snapshot()            src/astrix/state.ts:216   (deep copy)
   │
   │  GET /astrix/state                src/astrix/server.ts:86
   │  polled every 0.5 s               GameClient.gd:16,132-134
   │  GET /astrix/agent/status         GameClient.gd:90
   ▼
GameClient._apply_astrix_state()       GameClient.gd:136
   │  emits astrix_state_received
   ▼
World3D._on_astrix_state_received()    World3D.gd:1057
   │  1. snapshots `prev` (crops/bridges/buildings/season)
   │  2. WorldState.apply_snapshot(state)   WorldState.gd:41   ← mirror
   │  3. _materialize_sim(prev)             World3D.gd:1096    ← presentation
   ▼
rendered scene  (procedural GDScript geometry)
```

Parallel consumers of the same feed: `AgentConsole.gd` (world line + consequence
feed + gate buttons) and `ApprovalGate.gd` (modal). Both subscribe to
`GameClient` signals; neither holds authority.

**Transport notes.** Polling only — `GameClient` has no SSE parsing, so
`GET /astrix/events` (the typed `event: agent` stream) is **not consumed by
Godot**. Agent observability arrives via the 0.5 s `/astrix/agent/status` poll,
whose `lastEvents` is capped at 8 entries (`orchestrator.ts:279`). Origin
resolution: `window.location.origin` on web, else `http://127.0.0.1:8787`
(`GameClient.gd:30-36`).

---

## 2. Does Godot ever mutate authoritative state?

**No.** Confirmed three ways:

1. `GameCommandBus.gd:2-4` — *"Every world-changing request is validated here and
   forwarded to the authoritative server. No local mutation happens: visuals
   update only after a server response / snapshot."* `send_command()` (`:43`)
   validates shape then calls `GameClient.send_astrix_command()`, which POSTs to
   `/astrix/command`.
2. Approvals go to the real endpoint: `respond_to_astrix_approval()`
   (`GameClient.gd:118`) → `POST /astrix/approval/respond`, wired from both
   `ApprovalGate.gd:36-55` and `AgentConsole.gd`.
3. Repo grep: no Godot script writes to `WorldState` fields except
   `apply_snapshot()`. The local mutators `set_resource` / `add_resource` /
   `consume` (`WorldState.gd:89-103`) exist but **are never called from anywhere**
   — dead code inherited from the pre-server scaffold. They are a latent hazard,
   not an active second truth (see P1-4).

`MCPToolRegistry.gd` is **not** an MCP host: no JSON-RPC, no transport, no
listener. Its header (`:2`) says *"MCP-shaped local registry. Phase 2 will connect
external TrueForge calls."* It delegates to `GameCommandBus`. The MCP host is the
TypeScript server (`/astrix/mcp*`, `src/astrix/server.ts:156-183`).

---

## 3. Is any state duplicated or invented locally?

**Duplicated:** yes, by design — `WorldState` is a mirror, overwritten wholesale
on every poll (`apply_snapshot` clears and rebuilds `resource_nodes`, `buildings`,
`crops`, `bridges`). Stale-mirror risk is bounded to one 0.5 s poll interval.

**Invented — three cases, all presentation:**

| Case | Where | Assessment |
|---|---|---|
| `WorldState` field defaults before the first poll (`food = 12`, `biome_health = 1.0`, `resources.wood = 0`) | `WorldState.gd:7-19` | Wrong values (server starts food 40, meadow 0.8) shown for <0.5 s at boot. Cosmetic, but the defaults contradict Core. |
| `Player3D.inventory` + `add_resource()` | `Player3D.gd:69-73`, called `:89` | A **local player-only inventory** incremented on a successful server gather. Not authoritative state (Core has no per-player inventory) — but it is a locally-maintained number the server never confirms. |
| Decorative trees/rocks/props not backed by resource nodes | `World3D.gd:1051-1055` `_build_decor()` | Pure set dressing. Acceptable, but means "tree count" on screen ≠ authoritative node count. |

`ResourceNode3D.gathered` (`ResourceNode3D.gd:7`) is set **only** after
`astrix_command_succeeded` matching its `server_node_id` (`:29-33`) — server-driven,
correct.

---

## 4. Field-by-field seam table

`GET /astrix/state` sends **23 fields**. `WorldState.apply_snapshot` reads **11**.

Legend — **V** verified rendered from real state · **T** text-only (console, not
world) · **D** dropped at the client boundary · **X** consumed but not represented.

| # | Authoritative source | Transport | Godot consumer | Rendered representation | Status |
|---|---|---|---|---|---|
| 1 | `state.day` (`state.ts:165`) | `day` | `WorldState.gd:42`; `AgentConsole.gd:124` | `"day N / 30"` text; `DAY N BEGINS` feed line | **T** — no in-world clock/HUD |
| 2 | `state.time` (`:173`) | `time` | — | — | **D** |
| 3 | `elapsedSeconds` | `elapsedSeconds` | — | — | **D** |
| 4 | `state.population` (`:125`) | `population` | `WorldState.gd:43`; `AgentConsole.gd:126` | `"population N"` text; `FOOD SHORTAGE — n starved` | **T** — **no villager bodies in the 3D world** (grep for `villager` in `World3D.gd` = 0 hits) |
| 5 | `state.food` (`:126`) | `food` | `WorldState.gd:44,51` | `"food N"` text; `HARVEST COMPLETE` line | **T** |
| 6 | `foodSecurity` (`:180`) | `foodSecurity` | recomputed locally `WorldState.gd:105` | — | **D** (server value ignored; local recompute matches formula) |
| 7 | `state.season` (`:169`) | `season` | `WorldState.gd:76`; `AgentConsole.gd:125` | season text + `WINTER HAS ARRIVED` line | **X** — mirrored but **World3D never reads `WorldState.season`**; the 90 s day↔dusk lerp (`World3D.gd:103,165-182`) is wall-clock, unrelated to authoritative season |
| 8 | `daysUntilWinter` (`:102`) | `daysUntilWinter` | — | — | **D** |
| 9 | `foodPerDay` | `foodPerDay` | `AgentConsole.gd:129` | `"@ N/day"` | **T** |
| 10 | `daysOfFoodRemaining` | `daysOfFoodRemaining` | `AgentConsole.gd:128` | `"N days left"` | **T** |
| 11 | `harvestableFood` | `harvestableFood` | — | — | **D** |
| 12 | `growingFood` | `growingFood` | — | — | **D** |
| 13 | `projectedFoodAtWinter` | `projectedFoodAtWinter` | — | — | **D** |
| 14 | `foodPressureLevel` | `foodPressureLevel` | `AgentConsole.gd:127` | colour-coded `pressure: CRITICAL/HIGH/OK` | **T** |
| 15 | `state.resources` | `resources` | `WorldState.gd:48-51` | — | **X** — mirrored, never rendered (no resource HUD in 3D) |
| 16 | `state.biomeHealth` | `biomeHealth` | `WorldState.gd:45-47` | — | **X** — mirrored, never rendered (no terrain tint response) |
| 17 | `state.crops` | `crops` | `WorldState.gd:64-69` → `World3D.gd:1180-1200` | **crop plots per farm, height scaled by `growthStage`; ≥0.8 gets a golden mature tip; empty plot = furrow** | **V** |
| 18 | `farmland` | `farmland` | `AgentConsole.gd:131-136` (console) | `"meadow 2/3"` text | **T** + **D in World3D** (`World3D.gd` never reads farmland) |
| 19 | `state.bridges` | `bridges` | `WorldState.gd:70-75` → `World3D.gd:1119-1134` | **planks/rails per authoritative pair; removed when absent** | **V** (only 2 spans mapped — see P1-2) |
| 20 | `state.buildings` | `buildings` | `WorldState.gd:58-63` → `World3D.gd:1106-1117` | **farm groups materialized per `type=="farm"`; removed when no longer authoritative** | **V for farms**; **X for `house`/`storage`** — the hut is hand-placed decor (`World3D.gd:459+`), not driven by `buildings[]`; a steward-built house renders nothing |
| 21 | `state.resourceNodes` | `resourceNodes` | `WorldState.gd:52-57` → `World3D.gd:1138-1147` | **`ResourceNode3D` glow markers hidden when the server id disappears (clear_terrain permanence)** | **V** (markers hide; the decorative *tree mesh* does not disappear — see P0-2) |
| 22 | `islands` (+ connectivity) | `islands` | — | — | **D** |
| 23 | `pendingApprovals` | `pendingApprovals` | `WorldState.gd:77-85`; `GameClient.gd:138-145` → `ApprovalGate.gd` | **modal with action / reason / impact + APPROVE / REJECT wired to the real endpoint** | **V** |

Agent-status feed (separate endpoint, `GET /astrix/agent/status`):

| Source | Godot consumer | Rendered | Status |
|---|---|---|---|
| `loop.state`, `turn`, `objective` | `AgentConsole.gd:79-84` | `WORLD STEWARD // STATE // turn N` + objective | **T** |
| `currentAction{tool,executionState}` | `:85-90` | `activity: <tool> (<state>)` | **T** |
| `pendingApproval{approvalId,action.tool}` | `:91-101` | `⚠ HUMAN APPROVAL REQUIRED` + `WORLD TIME: PAUSED` + buttons | **V** |
| `lastEvents[]` (8 max) | `:108-120` | rolling 12-line feed `TYPE detail time` | **T** |
| `provider`, `error`, `actions[]` | — | — | **D** |

---

## 5. Answers to the 14 audit questions

| # | Question | Answer |
|---|---|---|
| 1 | How does authoritative state reach Godot? | 0.5 s polling of `/astrix/state` + `/astrix/agent/status`; no SSE. §1 |
| 2 | Does Godot ever mutate authoritative state? | **No.** All writes go server-side via `/astrix/command` and `/astrix/approval/respond`. §2 |
| 3 | Any state duplicated or invented locally? | Mirror by design; three presentation-only inventions (boot defaults, player inventory, decor). §3 |
| 4 | Farms rendered from real state? | **Yes** — one group per authoritative `type=="farm"` building, removed when gone. |
| 5 | Crops rendered from real state? | **Yes** — bound by `farmPlotId`, height scales with `growthStage`, mature tip at ≥0.8. |
| 6 | Bridges rendered from real state? | **Yes**, but only the 2 pairs in `SIM_BRIDGE_SPANS`; a `frost↔dusk` bridge would be invisible. |
| 7 | Cleared trees disappear because of real state? | **Partially.** The `ResourceNode3D` glow marker hides, but the decorative tree mesh at that position stays. **P0-2.** |
| 8 | Population changes visible? | **Text only.** No villagers exist in the 3D world; starvation is a console line. **P0-1.** |
| 9 | Food changes visible? | Text only (console line + harvest delta). |
| 10 | Day/time changes visible? | Day is text only. `time` is dropped. The visual day/dusk cycle is wall-clock, **not** authoritative time. |
| 11 | Agent proposals visible? | Yes, as console text (`activity: <tool>`) and the 8-event feed. Not visualised in-world. |
| 12 | Approval/rejection visible? | **Yes — the strongest part of the seam.** Modal + `WORLD TIME: PAUSED` + real endpoint. |
| 13 | Consequences visible? | Mixed: farms/crops/bridges/node-removal **are** visible in 3D; starvation, food, season, biome health are text-only. |
| 14 | Errors/failures visible? | Weakly. `command_failed` → one console line (`AgentConsole.gd:178`); `TURN_FAILED`/`VERIFICATION_FAILED` appear only if inside the last 8 events. No persistent error surface. **P1-3.** |

---

## 6. Verdict

**Seam integrity: PASS.** Godot is a faithful read-only client. It does not own
truth, does not simulate, and its one mutation path is a server round-trip. The
approval gate is genuinely represented.

**Seam completeness: PARTIAL.** The simulation's *survival* dimension —
population, food, season, biome health, food pressure — reaches Godot but stops
at a text console. What renders in 3D is the *construction* dimension (farms,
crops, bridges, node removal). A viewer watching the 3D world alone cannot see
the village starving; they must read the console panel.

That gap is the highest-value visual work, and it is an *observability* gap, not a
decorative one.
