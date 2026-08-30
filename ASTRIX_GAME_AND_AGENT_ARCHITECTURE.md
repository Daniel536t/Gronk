# ASTRIX — Game Design + Agent Systems Architecture

> The definitive design specification for ASTrix. This document is the source of
> truth for future implementation prompts. It is grounded in the **current
> codebase** (verified against `src/astrix/*`, `src/server/*`, `godot/scripts/*`,
> and `scripts/provision-astrix-agents.ts` on branch `feat/mobile-first-gameplay`
> at commit `b8f72fa`), and it describes the **target** architecture.
>
> **Design phase only.** Nothing in this document has been implemented beyond
> what already exists; see §"Current state" under each section and the
> "Existing architecture mapping" (§23).

---

## 1. Vision

ASTrix answers one question:

> **Can an AI agent manage a complex, changing environment while remaining
> observable, verifiable, interruptible, and under meaningful human control?**

ASTrix is a **controlled laboratory** for that question, disguised as a charming
2.5D/isometric miniature adventure world. The agent (the **World Steward**)
operates a living simulated settlement through **real tools** — not prose. The
human (the **Overseer**) explores the world, gives the Steward high-level
objectives, and holds the **approval gate** for actions that cross a defined
risk boundary.

The product is not an AI chatbot in a game. It is an **observable autonomous
operator** whose every thought, tool call, consequence, and failure is visible
and human-checkable. The world is the interface; the simulation is the core.

---

## 2. Design Pillars

| Pillar | Meaning | Non-negotiable consequence |
|---|---|---|
| **The world is real** | One authoritative simulation (`AstrixWorldState` in `src/astrix/state.ts`). Clients and agents read it or mutate it through a single validated channel (`AstrixGameCommandBus`). | No agent logic inside Godot. No client-authoritative rules. No "demo scripting" of outcomes. |
| **The agent acts, never narrates** | Every Steward decision is a set of tool calls executed against the world, or an approval request. | `runAstrixStewardTurn`-style text decisions are a planning artifact, not the product. Tool calls must actually execute. |
| **Observability is a feature** | Everything the agent does is recorded and replayable: observations, plans, delegations, tool calls, approvals, outcomes, failures. | An event log exists and is shown in the AgentConsole; nothing happens silently. |
| **Human control is real** | Irreversible or high-risk actions halt at the approval gate until a human decides. | The gate is in the authoritative command bus (`src/astrix/commandBus.ts`), not the UI. An agent cannot bypass it. |
| **Failure is legitimate** | The agent can be wrong, plans can fail, the world can punish it. Recovery is the demonstration. | Success *and* failure are valid demo outcomes. |
| **Charm is the interface** | Pastel diorama, chunky silhouettes, warm light, readable depth. | The visual identity already established in Visual Passes 1–2 is preserved; gameplay additions must not break it. |

---

## 3. Player Fantasy

You are the **Overseer** of a tiny world. You walk a handcrafted miniature
island (three biomes: Meadow, Frost, Dusk) with your companion. You can do
small things yourself — gather wood, stone, crystal, water — but the settlement
is run by the **World Steward**, an autonomous agent you can see thinking.

Your fantasy: **"I gave an AI a job to do, I watched it think and act, I stopped
it when it was about to do something risky, and the world lived or died by that
partnership."** You are the responsible adult in the room with a powerful,
slightly over-eager helper — the mayor who can delegate but never abdicate.

---

## 4. Game Identity

- **Genre:** 2.5D/isometric miniature simulation with exploration.
- **Camera:** orthographic gameplay camera (already tuned — low-pitch isometric,
  player-anchored, portrait-aware) from Visual Pass 2.
- **Look:** handcrafted pastel diorama; low-poly/voxel-inspired; warm sunlight;
  soft shadows; readable depth planes; violet water.
- **Tone:** peaceful surface, sophisticated simulation underneath. Cozy, not
  tense; curious, not competitive.
- **Explicitly NOT:** Warcraft, traditional RPG, Minecraft clone, dashboard-with-
  a-3D-background, LLM-NPC game, AI quest generator.

The player-facing loop is *observe → instruct → watch → intervene*. There is no
combat, no XP, no inventory RPG progression. The "score" is the objective the
Overseer set (e.g. "keep the village alive for 30 days") and the event log of
how the partnership achieved or failed it.

---

## 5. The Simulated World

### Current state (exists today, `src/astrix/state.ts`)

- 3 islands: `meadow`, `frost`, `dusk`, each with `biomeHealth` (0.8 / 0.6 / 0.4).
- Day clock: `DAY_SECONDS = 120` real seconds per in-game day, starting 08:00.
- Population: fixed **4** villagers.
- Food: **12** units; consumption **1/villager/day** at the day boundary
  (`FOOD_PER_VILLAGER_PER_DAY`); `foodSecurity = food / population`.
- Resources: wood 30, stone 15, food 12, water 0, crystal 5.
- Buildings: 1 house (health 1).
- Resource nodes: 5 seeded nodes (2 wood, 1 stone, 1 crystal, 1 infinite water).
- Bridges: **none in the live array** (the starting "Meadow↔Frost bridge" is a
  Godot visual, not yet authoritative state).
- Tick: 1 Hz server loop (`setInterval(() => astrix.tick(1), 1000)` in
  `src/server/index.ts`); food is consumed at day rollover.

### MVP simulation systems (target — this pass only designs them)

| System | MVP scope | Simplified how | Deferred |
|---|---|---|---|
| **Food** | Crops (plant → grow → harvest → storage), food storage building, consumption, spoilage at low priority | No animals; no recipe/cooking | Animal husbandry, fishing, trade |
| **Energy/fuel** | Wood as fuel; a simple "cold" mechanic in winter (fuel shortage ⇒ happiness/productivity hit) | No coal/solar/renewables | Coal, power grid |
| **Environment** | Biome health reacts to clearing/gathering/building; weather = single "drought" and single "early winter" scripted-but-conditional events | No full weather model | Seasons beyond summer→autumn→winter |
| **People** | Population grows/shrinks by housing + food; hunger ⇒ productivity; happiness as a secondary readout | 4–10 villagers, no individual jobs | Individual villager AI, names, movement |
| **Infrastructure** | house, farm, storage, bridge, (road) | Roads are cosmetic costs | Workshops, processing buildings |
| **Economy** | wood, stone, food, crystal, water; one-way flows with costs in `COSTS` (`src/astrix/commandBus.ts`) | No currency/market | Trade, tools |

### What creates *emergent* problems (MVP)

1. Food is consumed daily; farms take time to grow; winter halves yield ⇒
   **planning horizons matter**.
2. Expanding farmland needs wood/stone ⇒ **resource competition** with housing.
3. Clearing forest for farms yields wood now but **lowers meadow biome health**
   and removes future wood nodes ⇒ **short-term vs long-term tension**.
4. Building on an island without a bridge strands production ⇒ **connectivity
   matters** (bridges are already approval-gated as irreversible).
5. Crystal is rare and only on Dusk (health 0.4) ⇒ **exploration of risky
   biomes** is rewarded.
6. Approval rejections cost the agent a day ⇒ **re-planning is observable**.

---

## 6. System Interdependencies (≥10 causal chains)

1. **Population → food → farmland → land → forest → wood.**
   More villagers eat more → food reserves fall → more farms needed → farms
   need cleared land → forest clearing reduces future wood (resource nodes) and
   meadow biome health.
2. **Winter → crop yield ↓ → food deficit → hunger → productivity ↓ → slower
   building/harvest → deficit worsens.** (The canonical death spiral.)
3. **Bridge → connectivity → island production usable → food/resource flow →
   survival.** Frost has stone and food potential but no bridge in the live
   state; without one its nodes are unreachable for the settlement.
4. **Housing → population cap → labor supply → output.** Building houses
   unlocks growth; growth without matching food production is a trap.
5. **Storage → spoilage/capacity → food security.** Without storage, harvests
   that exceed immediate need are wasted (MVP: spoilage cap).
6. **Gathering → node depletion → resource scarcity → expansion cost ↑.**
   Nodes have finite quantity; over-gathering (allowed, low-risk today) starves
   future construction.
7. **Biome health → yield → food.** Meadow health falling below a threshold
   reduces farm yield; Dusk health affects crystal output; Frost health affects
   nothing yet (design: affects wood/stone yields).
8. **Clear terrain (irreversible) → biome health ↓ + wood ↑ + arable land ↑ →
   approval gate → time cost.** The approval itself costs a day of planning.
9. **Crystal → (MVP: beacon/special building bonus) → efficiency.** Deferred
   payoff keeps Dusk exploration meaningful.
10. **Food security → objective success/failure.** Survival is a compound
    result of 1–9; no single command fixes it.
11. **Weather event (drought) → farm yield = 0 for N days → harvest deficit →
    agent must pivot (ration? build storage? clear more land?) → risky options
    surface.** 
12. **Early winter (event) → the pre-computed winter requirement is wrong →
    agent must re-plan under time pressure → visible adaptation or collapse.**

These chains mean the agent cannot win with isolated commands; it must sequence
actions against a changing state — the thesis.

---

## 7. Time & Seasons

- **Clock:** 120 s/day (existing). 1 in-game hour ≈ 5 s. Day boundary consumes
  food (existing behavior).
- **Day/night:** presentation already cycles (90 s day↔dusk lerp in
  `World3D.gd`). No gameplay effect in MVP beyond a night "sleep/rest" flavor.
- **Seasons (new):** a 30-day run = summer (days 1–10), autumn (11–20), winter
  (21–30).
  - Farm yield multiplier: summer 1.0, autumn 0.8, winter 0.3.
  - Food consumption: 1/villager/day, winter 1.25/villager/day (cold).
  - Wood needed as fuel in winter: if wood < population, happiness/productivity
    drop (simplified as a yield penalty on gathering/building).
- **Weather events (new, conditional):** `drought` (0–2 days, farms yield 0),
  `early_winter` (winter starts up to 5 days early). Both are triggered by a
  seeded RNG so demos can be reproduced.
- **Production cycles:** crop growth = 3 days (planted → mature → harvestable).
  Building construction = instant today; MVP: 1-day build time for house/storage
  so construction has an opportunity cost.
- **Minimum tick:** 1 s server tick is sufficient (already in place). Day-
  granularity economics + event granularity = enough temporal pressure.

---

## 8. Resource, Population & Environment Systems (MVP tables)

### Resources

| Resource | Source | Sinks | Note |
|---|---|---|---|
| wood | gather wood nodes; clear_terrain | building costs, winter fuel | finite nodes (existing) |
| stone | gather stone nodes | building costs, bridge | finite (existing) |
| food | starting stock; farm harvests | daily consumption, winter ×1.25 | the survival axis |
| crystal | gather crystal nodes (Dusk) | beacon/bonus (MVP: optional) | rare, high biome risk |
| water | infinite node (existing) | none yet (MVP: farm requirement flavor) | cheap storytelling resource |

### Population

- Fixed 4 at start. MVP target 5–10 via growth rule: a new villager arrives
  every 4 days **if** housing capacity > population **and** food security ≥ 3.
- Hunger ⇒ productivity: when `foodSecurity < 2`, gathering/building/harvest
  yields ×0.7. At 0, starvation reduces population by 1/day (min 1).
- No individual villager simulation in MVP.

### Environment

- `biomeHealth` per island (existing field). New rules:
  - Clear terrain: −0.05/radius-unit on the affected island.
  - Build farm/house on an island: −0.01.
  - Planting crops: +0.005 (regeneration feel).
  - Natural drift: +0.002/day toward 0.7 baseline.
- Biome health thresholds (MVP): health < 0.35 ⇒ that island's yields ×0.6;
  health < 0.2 ⇒ event "island blighted" (visible to Godot as color shift).

---

## 9. Buildings & Infrastructure (MVP)

| Building | Cost (existing `COSTS`) | Effect (target) |
|---|---|---|
| house | wood 4, stone 2 | +1 housing cap; 1-day build |
| farm | wood 2, stone 1 | +1 farm plot; crops grow; 1-day build |
| storage | wood 3, stone 2 | +food storage cap, −spoilage; 1-day build |
| bridge_segment | wood 3, stone 1 | island connectivity (existing authoritative effect) |
| road (new, cheap) | wood 1 | cosmetic + flavor (+0 transport math is deferred) |

All builds route through the existing `PLACE_BUILDING` / `BUILD_BRIDGE` commands
in `AstrixGameCommandBus` — no new mutation path.

---

## 10. The AI Governor (World Steward)

### Lifecycle (target)

```
OBSERVE      -> inspect_world / inspect_island / inspect_resources / inspect_buildings / inspect_population / inspect_storage / inspect_weather
UNDERSTAND   -> forecast_food / calculate_winter_requirements / calculate_resource_requirements  (read-only computations)
PLAN         -> simulate_plan (read-only; returns projected state + per-command validation)
DELEGATE     -> specialist agents return plans/recommendations (agriculture / construction / ecology)
REQUEST      -> if any planned action is HIGH-risk: approval gate (server-side, blocking)
ACT          -> execute tool calls through /mcp (gronks-hoard-mcp) or /astrix/mcp/tools/call
OBSERVE      -> re-inspect; the world may have changed or the action may have failed
VERIFY       -> verify_action / verify_objective against authoritative state
ADAPT        -> revise plan; loop
```

### What the agent receives at each stage

- **Observe:** the full `AstrixStateSnapshot` (already serialized into steward
  turn prompts today) — but the target is real MCP tool calls, not a prompt
  dump. Each tool returns JSON.
- **Plan:** `simulate_plan` output (`{ success, readOnly: true, projected,
  results[] }`) — already implemented.
- **Delegate:** specialist agents (provisioned as `astrix-agriculture`,
  `astrix-construction`, `astrix-ecology`) return JSON plans; the Steward
  synthesizes and remains accountable.
- **Act:** tool calls execute against the command bus. The Steward never
  proposes prose — it proposes `toolCalls: [{tool, args}]` and a controller
  executes them.
- **Verify:** post-action inspection diff (resource deltas, building id, node
  quantity) — this is the "did it actually work" step.

### Missing today (honest gap)

`runAstrixStewardTurn` is **one-shot**: it prompts the agent with a snapshot and
parses a JSON decision containing `toolCalls`, but **nothing executes those
tool calls and no loop continues**. There is no objective system, no scheduler,
no subagent delegation driver, and no verification step. The architecture
below is the target; §23 maps what exists vs. what must be built.

---

## 11. Tool System

Ten tools exist today (`src/astrix/mcpTools.ts`, registered in
`src/server/mcp.ts` under the `gronks-hoard-mcp` connector AND exposed at
`/astrix/mcp/tools/call`): `inspect_world`, `inspect_island`,
`inspect_resources`, `inspect_buildings`, `gather`, `build`, `plant`,
`clear_terrain`, `build_bridge`, `simulate_plan`.

Target tool catalog (existing + proposed). All mutations route through
`AstrixGameCommandBus` (non-negotiable).

| Tool | Purpose | Inputs | Outputs | Changes state? | Reversible? | Risks | Approval? |
|---|---|---|---|---|---|---|---|
| inspect_world | full snapshot | — | `AstrixStateSnapshot` | No | — | none | No |
| inspect_island | one biome | `island_id` | health, nodes, buildings, connectivity | No | — | none | No |
| inspect_resources | resource nodes | — | node list | No | — | none | No |
| inspect_buildings | buildings | — | building list | No | — | none | No |
| inspect_population *(new)* | people stats | — | pop, housing cap, hunger/productivity | No | — | none | No |
| inspect_storage *(new)* | food/resource stores | — | storage caps, spoilage | No | — | none | No |
| inspect_weather *(new)* | season, events, forecast | — | season, active events, forecast | No | — | none | No |
| inspect_terrain *(new)* | biome/terrain state | `island_id` | health, trees, cleared area | No | — | none | No |
| forecast_food *(new)* | projected food over N days | `days` | deficit/surplus per day | No | — | none | No |
| calculate_winter_requirements *(new)* | winter food+fuel need | — | required food/wood | No | — | none | No |
| calculate_resource_requirements *(new)* | build plan cost check | `plan` | per-resource cost, feasibility | No | — | none | No |
| simulate_plan | validate plan read-only | `plan` JSON | per-command validation + projected | No | — | none | No |
| gather | collect a node | `resource_id` or `resource_type` | gathered, inventory after | **Yes** | No (node depletes) | node depletion | No (low) |
| plant | start a crop | `farm_plot_id`, `crop_type` | crop id, stage 0 | **Yes** | Yes (crop can be left) | wasted seed (deferred) | No (low) |
| harvest_crop *(new)* | collect mature crop | `farm_plot_id` | food gained | **Yes** | No | spoilage if no storage | No (low) |
| build | construct building | `building_type`, `position`, `island_id` | building id, cost deducted | **Yes** | No (permanent) | resource cost, biome −0.01 | No (medium — cost only) |
| assign_worker *(new)* | rebalance labor (MVP: yield multipliers) | `role`, `count` | productivity | **Yes** | Yes | misallocation | No (medium) |
| move_resource *(new)* | transfer stock between islands/storage | `from`, `to`, `resource`, `amount` | new balances | **Yes** | Yes | stranded goods, no bridge = fail | No (medium) |
| construct_road *(new)* | build cosmetic road | `position`, `island_id` | road id | **Yes** | No | trivial cost | No (low) |
| construct_bridge | existing build_bridge | `island_a`, `island_b` | bridge id, connectivity | **Yes** | **No** | permanent connectivity change | **Yes (high)** |
| clear_forest / clear_terrain | remove trees/land | `position`, `radius` | trees cleared, wood gained | **Yes** | **No** | biome health ↓, nodes lost | **Yes (high)** |
| demolish *(new)* | destroy building | `building_id` | removed, partial refund | **Yes** | **No** | permanent loss | **Yes (high)** |
| store_food *(new)* | move food into storage | `amount` | stored, spoilage reduced | **Yes** | Yes | — | No (low) |
| verify_action *(new)* | re-inspect after an action | `action_ref` | success/failure, deltas | No | — | none | No |
| verify_objective *(new)* | objective progress check | — | % complete, projected outcome | No | — | none | No |

**Rule:** every state-changing tool has exactly one authoritative backing
(an `AstrixCommand` in the bus). Tools with no backing are not added.

---

## 12. Subagents

Three specialist agents are already provisioned
(`scripts/provision-astrix-agents.ts`):
`astrix-agriculture`, `astrix-construction`, `astrix-ecology`.

### When delegation actually helps (and when it doesn't)

- **Helps:** divergent analysis from one shared snapshot — three specialists
  each return a *scoped* recommendation (food plan / build plan / veto-or-
  approve ecological impact). The Steward cannot cheaply hold all three
  perspectives in one context; delegation is a real decomposition.
- **Doesn't help:** trivial decisions (gather a node), anything requiring the
  same global state the Steward already holds, or "delegation theater" with no
  distinct scope. We never spin a subagent for a single tool call.

### Flow

```
Steward (accountable for final decision)
   ├─ astrix-agriculture  -> {plant/harvest/farm plan, food projection}
   ├─ astrix-construction -> {build list, material costs, placement}
   └─ astrix-ecology      -> {impact report; may VETO high-eco-cost actions}
Synthesis -> simulate_plan -> approve-or-request -> execute -> verify
```

- Specialists are **read-only advisors**: they return JSON plans. Only the
  Steward's synthesized `toolCalls` execute against the bus.
- Ecology's veto is advisory-to-the-Steward; the *human* is the final veto
  (approval gate) — the veto cannot bypass the gate.
- MVP: 3 specialists; a 4th (`logistics`) is deferred until `move_resource`
  exists.

### Missing today

Subagents are provisioned but **nothing drives them** — no delegation prompt
pipeline, no result capture, no synthesis step. The Steward session exists but
does not orchestrate subagent turns. This is core Phase-A work (§29).

---

## 13. TrueForge Integration (the sponsor-tools core)

TrueForge must be load-bearing, not decorative. It is already the harness
running on `:8790` (auth-disabled standalone), with agents provisioned via
`POST /api/v1/agents` and turns driven via
`POST /api/v1/sessions/{id}/turns` (see `src/server/trueforge.ts`).

### Where TrueForge provides value (and nothing else does)

| Capability | ASTrix usage | Why TrueForge specifically |
|---|---|---|
| **Agent lifecycle** | Steward + 3 specialists are TrueForge agents with manifests (model, instructions, MCP refs, skills, sandbox config) | Session/turn API already proven in this repo |
| **Tool execution** | Steward calls ASTrix tools through the `gronks-hoard-mcp` connector (`POST /mcp`, streamable HTTP, already registered) | TrueForge discovers `@all` tools from the MCP connector |
| **Subagent orchestration** | Delegation turns are TrueForge sessions with scoped prompts | Same harness, auditable turns |
| **Execution tracing** | Every turn's `tool_calls` and outputs are retained per session | Judge-facing "watch the agent think" evidence |
| **Sandbox** | Steward's numeric planning (winter requirements, food projections) runs in the TrueForge sandbox with generated code | Sponsor's sandbox = code-generation-to-result demo (§25) |
| **Persistent context/memory** | Sessions persist; the Steward can reference its own rejected proposals across turns | Demonstrates memory: "you rejected this before — I won't propose it again" |

### The integration contract (from the audited code — do not guess)

- **Provision:** `POST {base}/api/v1/agents` with
  `{ name, manifest: { model: {name}, instructions, mcp_servers: [{name, enable_tools:["@all"]}], skills, config: {sandbox:{enabled}} } }`.
  409 ⇒ update via `PUT /api/v1/agents/{internalId}`.
- **Turn:** `POST /api/v1/sessions` `{ agent: { name } }` → session id;
  `POST /api/v1/sessions/{id}/turns` `{ input:[{type:"user.message", content}], previous_turn_id:"auto", stream:false }` → turn id; poll
  `GET /api/v1/sessions/{id}/turns/{turnId}` until `state.status === "done"`.
- **MCP:** connector `gronks-hoard-mcp` → `http://localhost:8787/mcp`
  (POST /mcp is deliberately open to TrueForge — same-host network boundary;
  the public `/astrix/*` mutation surface stays keyed by `ASTRIX_API_KEY`).
- **Models:** NVIDIA NIM via `registerNvidiaProvider`; names in
  `config/gronk-model.json` / `config/bots-model.json`.

### Missing today

The steward turn prompt explicitly says **"Do not mutate anything"** — the
current `runAstrixStewardTurn` returns a JSON decision; tool execution,
approval wiring from the decision, subagent turns, and sandbox code execution
are not yet connected. The architecture below is the target.

---

## 14. Human Approval System

### Risk classification (formal)

| Class | Actions | Gate |
|---|---|---|
| **LOW** | inspect_*, simulate_plan, gather, plant, harvest, store_food, construct_road | none (auto-execute) |
| **MEDIUM** | build (house/farm/storage), assign_worker, move_resource, clear small radius | none (cost-based feedback is the check); Steward logs rationale |
| **HIGH** | clear_terrain (any), build_bridge, demolish, divert water (future) | **approval gate — blocking** |

The gate already exists in the command bus: `CLEAR_TERRAIN` and `BUILD_BRIDGE`
without `approvalId` create a `pendingApproval` and return
`{ success:false, error:"human approval required", pendingApproval }`
(`src/astrix/commandBus.ts`). Humans resolve via
`POST /astrix/approval/respond` `{approval_id, decision}`; Godot's
`ApprovalGate.gd` already renders the modal from `pendingApprovals` in the
snapshot.

### Approval payload (target, matches existing shape + richer fields)

```json
{
  "id": "approval-001",
  "command": "CLEAR_TERRAIN",
  "reason": "Emergency farmland expansion is required to prevent projected winter food shortage.",
  "expectedBenefit": "+42 food/day",
  "cost": { "wood": -18, "stone": 0 },
  "environmentalImpact": { "treesRemoved": 23, "meadowHealth": -0.15, "permanent": true },
  "alternativesConsidered": ["ration food", "import food", "expand southern farm", "clear northern forest"],
  "agentRecommendation": "clear northern forest",
  "risk": "high",
  "createdAt": 1725000000000
}
```

- **Reject** ⇒ approval removed, command not executed, event logged. The
  Steward sees the rejection in the next observation and must re-plan.
- **Approve** ⇒ `resolveApproval` validates the stored impact against the
  command (existing `approvalMatchesCommand` logic) and executes.
- **Ambiguity rule:** a stored approval is bound to its exact recorded
  `{position, radius, islandA, islandB}`. It can never be repurposed for a
  different command (this is already enforced; keep it).

---

## 15. Safety / Risk Model

1. **Single mutation channel:** every state change goes through
   `AstrixGameCommandBus.execute()` (validates position bounds, costs, island
   existence, approvals). No direct state writes from agents, Godot, or tools.
2. **Two security surfaces:**
   - Public browser mutations (`/astrix/command`, `/astrix/approval/respond`,
     `/astrix/mcp/tools/call`) → `ASTRIX_API_KEY` bearer (already enforced).
   - TrueForge tool channel (`POST /mcp`) → open by design, same-host
     deployment (documented in `src/server/http.ts`).
3. **Irreversibility is structural:** high-risk commands cannot execute without
   an approval id; approval ids are bound to exact impacts.
4. **Read-only projections:** `simulate_plan` and all `calculate_*` /
   `forecast_*` tools never mutate.
5. **Verification loop:** post-execution `verify_action` diff; the Steward
   cannot claim success without evidence.
6. **Human last word:** the approval gate is in the authoritative bus — no
   client UI, prompt, or agent can bypass it.
7. **Auditability:** every command, approval, tool call, and turn is logged
   (§17).

---

## 16. Observability / Event Model

### The AgentConsole becomes a real feed

`godot/scripts/AgentConsole.gd` is currently a presentation-only scaffold
connected to the local `GameCommandBus`. Target: it consumes a server
agent-event stream so the *authoritative* narrative is displayed live.

### Server event stream (target, new — additive)

```
event: agent.observe        data: {tool:"inspect_world", at:day, time}
event: agent.forecast       data: {tool:"forecast_food", projection:{...}}
event: agent.plan           data: {plan:[...], simulated:{success, projected}}
event: agent.delegate       data: {subagent:"astrix-agriculture", request, result}
event: agent.synthesize     data: {decision, recommendation}
event: agent.approval       data: {approval:{...}}            # ALSO -> snapshot.pendingApprovals
event: agent.tool_call      data: {tool, args, result}
event: agent.verify         data: {action_ref, deltas, success}
event: agent.failure        data: {error, recovered:true|false}
event: agent.adapt          data: {old_plan, new_plan, reason}
event: objective            data: {objective, progress, projected_outcome}
```

- Transport: extend the existing SSE endpoint `/astrix/events` (already streams
  `event: state`) with typed event names; Godot `GameClient` parses
  `event: agent.*` lines and forwards to `AgentConsole`.
- Also persisted to a ring buffer on the server (last ~500 events) and exposed
  via `GET /astrix/log` for replays/judging.

### What must be visible at a glance

- current objective + progress bar
- agent status (observing / planning / awaiting approval / executing / failed)
- active plan (last N steps)
- latest tool call + result
- pending approval payload (full: benefit, cost, impact, alternatives)
- resource/population sparkline over days

---

## 17. Failure & Recovery Model

### Designed failure injection (all reproducible via seeded RNG)

| Event | Trigger | Visible consequence | Agent recovery path |
|---|---|---|---|
| drought | day 8–12, seeded | farms yield 0 for 2 days | re-plan food (ration, storage, clear land) |
| early winter | seeded, up to 5 days early | yield ×0.3 sooner, fuel need | recalc winter requirements, pivot |
| crop failure | 15% per harvest roll | that plot yields 0 | diversify plots, build storage |
| storage destroyed | 5% when a storm event fires | food in storage lost | rebuild storage, prioritize |
| bridge collapse | only if bridge built in a "storm" day | island disconnects | rebuild (approval), reroute |
| rejected approval | human choice | plan step skipped, a day lost | re-plan with alternatives |
| agent bad plan | model behavior | deficit deepens | verify detects gap, adapt |

### The recovery contract

1. **Detect:** `verify_action`/`verify_objective` shows a delta mismatch or
   projected failure.
2. **Explain:** the AgentConsole logs the failure event with the agent's
   stated cause (its own words are captured in the turn).
3. **Re-plan:** the Steward produces a new plan (visible `event: agent.adapt`).
4. **Ask for help:** if no valid plan exists (e.g. food hits 0), the Steward
   escalates a *consultation* request to the human (a non-blocking
   "please advise" notification, distinct from the approval gate).
5. **Accept collapse:** running out of food is a legitimate FAILURE state —
   the objective fails, the run ends, the log remains as the story.

---

## 18. Canonical 30-Day Scenario (the demo backbone)

**Objective (human-given): "Keep the village alive for 30 days."**

- **Day 1:** Steward `inspect_world` → sees food 12, pop 4, 3 days of food.
- **Day 2:** inventories resources + population; notices only 1 house, 0 farms.
- **Day 3:** `forecast_food` → projects shortage by ~day 8 without farms.
- **Day 4:** identifies winter risk via `calculate_winter_requirements`.
- **Day 5:** delegates agriculture (food plan), construction (farm/house
  plan), ecology (impact report) — all in parallel TrueForge sessions.
- **Day 6:** plans return; Steward synthesizes; `simulate_plan` validates.
- **Day 7:** executes low-risk actions: `plant` ×2, `gather` wood, `build` farm.
- **Day 10+:** seeded drought fires; yields collapse; Steward observes its plan
  becoming insufficient (`verify_objective` red).
- **Day 15+:** food shortage is likely. Options: ration (productivity hit),
  build storage, **clear the northern forest** (approval required — high risk,
  biome health ↓, permanent). TrueForge pauses; approval payload with full
  cost/benefit/impact and alternatives appears in Godot's ApprovalGate.
- **Human approves or rejects.** If rejected, the Steward visibly re-plans
  (rations + storage instead). If approved, meadow health drops and wood
  surges — visible world change.
- **Days 16–30:** winter arrives; the agent must have stored food and wood.
- **Outcome:** SUCCESS (village survives 30 days) or FAILURE (food 0, collapse).
  Both are legitimate; the event log tells the whole story either way.

**Why this scenario:** it touches every pillar — autonomous operation (days
1–7), delegation (day 5), real tool execution (day 7+), emergent problem
(drought/winter), irreversible-risk approval (day 15+), observable adaptation
(rejection path), and a binary success/failure verdict.

---

## 19. Gameplay Loop

```
OBSERVE the world (walk, gather, watch villagers/crops)
    │
    ▼
SET an objective ("keep the village alive for 30 days")
    │
    ▼
STEWARD plans -> delegates -> simulates -> executes (visible in AgentConsole)
    │
    ▼
WORLD changes (crops grow, buildings appear, resources move)
    │
    ▼
PLAYER observes consequences (food bar, biome colors, event feed)
    │
    ▼
UNEXPECTED event (drought, early winter, rejected approval)
    │
    ▼
STEWARD adapts (or escalates to you)
    │
    ▼
HIGH-RISK action -> APPROVAL GATE -> your decision
    │
    ▼
EXECUTION -> VERIFICATION -> progress toward objective
    │
    └────────────── loop ──────────────┘
```

A 15–30 minute session: the player spends the first minutes exploring and
gathering, sets the objective, then alternates between watching the feed,
walking to inspect physical changes, and making 1–3 meaningful approval calls.
The drama is watching the agent *actually operate* — not clicking through menus.

---

## 20. MVP Scope

### In scope (smallest simulation that proves the thesis)

- 1 settlement (Meadow), Frost + Dusk as connected-but-thin biomes (Frost:
  stone node; Dusk: crystal node).
- Population 4 → up to 8 (housing + food-driven growth rule).
- Resources: wood, stone, food, crystal, water (existing five).
- Buildings: house, farm, storage, bridge (existing four) + road (cosmetic).
- Crops: plant → 3-day growth → harvest (needs new `HARVEST_CROP` command).
- Food: daily consumption, winter multiplier, storage spoilage cap.
- Seasons: summer/autumn/winter within a 30-day objective run.
- Weather: drought + early winter events (seeded, reproducible).
- Biome health effects on yields (existing field, new rules).
- **AI:** Steward + 3 specialists with real delegation turns; tool execution
  loop; verification; objective system; event log.
- **Approval gate:** existing HIGH-risk gate + richer payload + Godot modal.
- **Observability:** AgentConsole live feed + `GET /astrix/log` replay.

### Out of scope for the hackathon (do NOT build)

- Animals, fishing, trade, currency, workshops, tech trees.
- Individual villager AI, names, jobs, movement.
- Full weather model, seasons beyond the 30-day cycle, day-length simulation
  beyond 120 s.
- Multiplayer presentation, combat, quests, NPCs, dialogue.
- Real GLB-authored character/asset pipeline beyond the documented wrappers.
- Persistence across server restarts (in-memory is fine for a demo).

---

## 21. Future Scope (post-hackathon)

- `move_resource` + logistics specialist + road transport math.
- Workers with job assignment (`assign_worker`) and productivity curves.
- More building types (workshop, granary, well) and a processing chain.
- Emergent population dynamics (births, aging, happiness mechanics).
- Full authored asset pipeline (GLB characters, environmental kitbash).
- Persistence, save/load, multi-run history.
- Difficulty/crisis packs (each pack = a new failure injection profile).

---

## 22. Existing Architecture Mapping

| System | Authoritative engine | Server/API | Godot presentation | TrueForge agent | Tools | Human approval |
|---|---|---|---|---|---|---|
| World state + clock | `src/astrix/state.ts` | `/astrix/state`, tick in `src/server/index.ts` | `WorldState.gd` mirror | read via tools | inspect_world | — |
| Mutations | `src/astrix/commandBus.ts` | `/astrix/command`, `/astrix/mcp/*`, `POST /mcp` | `GameCommandBus.gd` → `GameClient` | via MCP connector | build/gather/plant/clear/bridge | HIGH-risk only |
| Crops/growth | new command `HARVEST_CROP` + tick logic in `state.ts` | same command surface | crop visuals | plant/harvest | plant, harvest_crop | No |
| Seasons/weather | new season/event state in `state.ts` | snapshot fields + events | day/dusk lerp, event feed | inspect_weather | inspect_weather, forecast | No |
| Approval gate | `commandBus.ts` (structural) | `/astrix/approval/respond`, `pendingApprovals` in snapshot | `ApprovalGate.gd` modal | requests via tool result | clear_terrain/build_bridge | **Yes — blocking** |
| Objective | new `ObjectiveState` (server) | `/astrix/objective` GET/POST, snapshot | HUD progress | verify_objective | verify_objective | objective set = human act |
| Event log | new `EventLog` (server ring buffer) | `/astrix/events` (SSE), `/astrix/log` | `AgentConsole.gd` | turns recorded by TrueForge | — | — |
| Steward loop | controller in `src/server` (new) | same command surface | console feed | `astrix-steward` session | all | via gate |
| Specialists | — | delegation driver (new) | console feed | 3 provisioned agents | read-only advisors | — |
| Sandbox calc | — | — | result display | TrueForge sandbox | calculate_* | No |

**Rule:** Godot never owns a rule. `WorldState.gd` is a mirror; `MCPToolRegistry.gd`
delegates to the local bus which POSTs to the server; the server bus is the only
mutation path.

---

## 23. Current State vs. Target (honest inventory)

| Capability | Exists today | Gap to target |
|---|---|---|
| World state + 1 Hz tick + day rollover food | ✅ `src/astrix/state.ts` | seasons, weather events, growth, biome-yield rules |
| Command bus + validation + costs | ✅ `commandBus.ts` | `HARVEST_CROP`, `DEMOLISH`, medium-risk actions |
| Irreversible approval gate | ✅ structural | richer payload, rejection re-plan signal |
| 10 MCP tools on `/mcp` + `/astrix/mcp/*` | ✅ | forecast/calculate/verify/population/storage/weather tools |
| Steward + 3 specialists provisioned | ✅ `scripts/provision-astrix-agents.ts` | delegation driver, synthesis, sandbox code execution |
| One-shot steward turn (prompt + parse) | ✅ `runAstrixStewardTurn` | **autonomous loop that executes `toolCalls`** |
| Godot: poll `/astrix/state`, commands, approvals | ✅ `GameClient.gd` | agent-event stream parsing, objective HUD |
| Godot ApprovalGate modal | ✅ | richer payload rendering |
| Godot AgentConsole | ⚠️ scaffold, local bus only | server agent-event feed |
| Event log / replay | ❌ | `EventLog` + `/astrix/log` |
| Objective system | ❌ | objective state, progress, success/failure verdict |
| Failure injection | ❌ | seeded events + recovery contract |
| Population dynamics | ❌ (fixed 4) | growth rule, starvation |

---

## 24. Hackathon Criteria Mapping (honest)

| Criterion | What we demonstrate | How | Why it matters (and honest weakness) |
|---|---|---|---|
| **Potential Impact** | An agent that operates a *system* under time pressure — not a chatbot | Live 30-day survival run with a real food/winter crisis | High impact **if** the demo shows the loop end-to-end. Weakness: impact depends entirely on the live run going well — a flaky model turn hurts more than any static feature. |
| **Creativity & Originality** | The world *is* the harness demo: a diorama whose crisis is the sponsor's approval gate | Gameplay and agent safety are the same artifact | Genuinely novel framing. Weakness: visual charm currently outpaces the agent loop; the game part must not overshadow the agent part. |
| **Technical Excellence** | Authoritative simulation + typed command bus + MCP tool surface + fail-open backend + real tool execution | The existing clean boundaries (engine/bus/MCP/approval) plus the new loop | Strong. Weakness: the one-shot steward turn today does not execute tools — that must land and be demonstrably solid. |
| **Use of Sponsor Tools** | TrueForge is the *entire* agent layer: agents, MCP tools, subagents, sandbox, persistent sessions, approval pause | Steward/specialists are TrueForge agents calling ASTrix MCP; planning math runs in the TrueForge sandbox; rejected-proposal memory across sessions | This is the centerpiece. Weakness: today TrueForge only parses a decision JSON — the real tool-call path is the gap. |
| **Control & Safety** | Human holds the gate; everything is observable; failure is legitimate | Structural approval gate in the authoritative bus; typed agent-event feed; verify loop | Arguably our strongest honest story — it's already partly real (gate is structural). |
| **Presentation** | The 3–5 min demo (§25) is a single continuous story with visible consequences | AgentConsole feed + world changes + ApprovalGate modal on screen simultaneously | Weakness: live demos of LLM agents can stall; we need a scripted-but-real fallback (see risks §26). |

---

## 25. 3–5 Minute Demo Script

**0:00–0:30 — The world.** Open `https://astrixx.duckdns.org` on a tablet.
Walk the meadow: pastel diorama, the hut, the bridge, the glowing beacon.
Say: *"This is ASTrix — a living miniature world run by an AI steward."*

**0:30–0:45 — The objective.** Player taps "New Objective: Keep the village
alive for 30 days." The AgentConsole comes alive.

**0:45–1:15 — Observe + plan.** Console streams: `inspect_world` →
`forecast_food` → `calculate_winter_requirements` → *"projected shortage by
day 8"* → delegate to Agriculture / Construction / Ecology (three parallel
turns visible as separate console lines).

**1:15–1:45 — Real tool execution.** The Steward's plan executes: `plant`,
`gather`, `build farm`. The world *visibly changes* — crops appear, wood
counts drop, a farm rises on the meadow. Console shows each `agent.tool_call`
with results.

**1:45–2:30 — The crisis.** Drought fires. Crop yield collapses.
`verify_objective` turns red. The Steward states the problem in its own words
(from the turn). Then: *"I can clear the northern forest for emergency
farmland."*

**2:30–3:15 — The gate.** TrueForge pauses. The ApprovalGate modal appears with
benefit (+42 food/day), cost (−18 wood), environmental impact (23 trees,
meadow −0.15, permanent), and alternatives considered. **Live choice.** The
judge decides. (Recommend REJECT here — the Steward visibly re-plans to
ration + storage, which is the better "control & safety" moment. Or APPROVE to
show the world degrading and the agent adapting to the consequence.)

**3:15–3:45 — Verify + adapt.** Post-decision, `verify_action` shows deltas;
winter arrives; stored food + wood carry the village. Objective progress bar
approaches 30 days.

**3:45–4:00 — Replay.** Show `GET /astrix/log` — the entire event timeline
(observe → plan → delegate → execute → approval → verify → adapt) as an
auditable record.

**Fallback if a turn stalls:** the scripted-FSM-style fallback path (already
the pattern in the legacy `AgentRuntime`) produces the same visible narrative —
the demo never hangs on an LLM.

---

## 26. Technical Risks

1. **Tool-execution loop is unbuilt.** The one-shot turn returns `toolCalls`
   but nothing executes them. Mitigate: build the controller (execute → verify
   → re-observe) first; it is the heart of the demo.
2. **Steward prompt-drift / unparseable output.** Mitigate: strict
   `toolCalls` JSON schema + validation; any parse failure logs a visible
   `agent.failure` and retries with a narrower prompt (never silent).
3. **TrueForge MCP auth collision.** POST /mcp is open (same-host). If the
   deployment changes (TrueForge elsewhere), revisit — documented in
   `src/server/http.ts`; do not silently gate it or steward turns hang (learned
   on PR #15).
4. **SSE agent-event framing.** Existing `/astrix/events` sends `event: state`
   lines; adding `agent.*` event names must not break Godot's parser
   (parse per `event:` name, ignore unknown).
5. **Deterministic demos vs. live LLM.** Use seeded RNG for events and the
   fallback path for agent text; the *world* is deterministic, the *agent* is
   live — this is the right split.
6. **80/80 test suite + Godot headless regression** must keep passing; the new
   loop ships with unit tests for: command execution, approval binding,
   event log ordering, objective success/failure verdicts.

---

## 27. Design Risks

1. **"AI gimmick" drift:** if the player can trivially win by gathering
   (the current action button gathers infinitely-cheap nodes), the agent feels
   decorative. Mitigate: MVP nodes deplete (already do) and the 30-day
   objective cannot be won by manual gathering alone.
2. **Dashboard feel:** if the console feed dominates, it's a dashboard with a
   3D background. Mitigate: the player must physically see consequences —
   buildings appear, biome colors shift, crops grow, bridge spans islands.
3. **Over-simulation:** 5+ interlocking systems with no tuned numbers = chaos.
   Mitigate: MVP numbers are few and visible (food, wood, stone, health,
   population); tune one demo run end-to-end before adding knobs.
4. **Approval fatigue:** too many gates → the human stops reading. Mitigate:
   only HIGH-risk actions gate; LOW/MEDIUM auto-execute with logged rationale.
5. **Failure-feels-bad:** a failed run must still read as a great demo.
   Mitigate: the event log + AgentConsole narrative makes collapse a story,
   and the demo script offers both approve/reject paths.

---

## 28. Open Questions

1. **Objective syntax:** free-text ("keep the village alive") vs. structured
   presets (survive / expand / self-sufficiency)? MVP: 2–3 presets + free text
   parsed into a goal + horizon + priority.
2. **Who owns the loop:** a new `src/server/astrixOrchestrator.ts` (recommended;
   mirrors the legacy `AgentRuntime` pattern) vs. a TrueForge-native workflow?
   Recommendation: server-side controller, TrueForge as the brain.
3. **Simulation pacing:** 120 s/day ⇒ 30-day run = 60 min. Demo needs
   compression (e.g. a `SIM_SPEED` multiplier or a "skip to day 15" dev hook).
   Decide before tuning the canonical scenario.
4. **Verification depth:** full per-action delta diff vs. sampled checks?
   MVP: diff on the fields each action claims to change.
5. **Specialist execution:** do specialists ever execute tools, or are they
   strictly advisory (recommended: advisory; the Steward is the only executor)?
6. **Bridge start state:** the live `bridges` array is empty while Godot draws
   a Meadow↔Frost bridge. Should the starting bridge be authoritative (yes —
   otherwise `inspect_world` lies to the agent about connectivity)?

---

## 29. Recommended Implementation Order

Each step is a separate Qodo-reviewed PR; no direct pushes to main.

1. **P0 — Steward execution loop (unblocks everything):** server controller
   that takes a Steward decision, executes `toolCalls` through the bus,
   verifies, and continues; `verify_action`/`verify_objective` tools; agent
   event log + typed SSE events; Godot `AgentConsole` reads the server feed.
   *(Dependency: none. Risk: the demo's heart.)*
2. **P1 — Simulation depth:** seasons + winter multipliers; crop growth +
   `HARVEST_CROP`; storage + spoilage; population growth/starvation rule;
   seeded drought/early-winter events; biome-health yield rules. *(Depends on
   P0 for observability of the new systems.)*
3. **P2 — Delegation + sandbox:** subagent delegation driver (3 specialists →
   JSON plans → synthesis); Steward numeric planning in the TrueForge sandbox;
   persistent-session memory ("you rejected this before"). *(Depends on P0
   turn plumbing.)*
4. **P3 — Objective system + verdict:** `/astrix/objective` GET/POST,
   progress computation, SUCCESS/FAILURE end-of-run; Godot HUD progress.
5. **P4 — Approval payload + re-plan path:** rich approval payload,
   rejection → visible re-plan event; `GET /astrix/log` replay page.
6. **P5 — Demo polish:** SIM_SPEED/skip hook, scripted-fallback narrative
   path, tune the canonical 30-day scenario, record the demo video.

---

## Consistency Review (per the design-phase final rule)

Checked every system in this document against the failure modes:

- **Systems depending on undefined systems:** seasons/weather depend only on
  `AstrixWorldState` fields + tick (defined). Population growth depends on
  housing cap + food (both defined). Storage depends on a `storage` building +
  spoilage number (defined). No orphan dependencies.
- **Agent actions without tools:** every lifecycle action maps to a tool in
  §11 (observe→inspect_*, plan→simulate_plan, act→execute tools, verify→
  verify_*). Delegation is not a "tool" — it's a TrueForge turn, explicitly
  scoped as advisory; synthesis is the Steward's own turn output.
- **Tools without authoritative backing:** every state-changing tool in §11
  maps to an `AstrixCommand` in the bus. Read-only tools map to
  `state.snapshot()` or pure functions. No new mutation bypasses the bus.
- **Impossible resource flows:** food comes only from start stock + harvests,
  consumed daily/winter; wood from nodes + clearing, spent on builds + winter
  fuel; crystal from Dusk node only; water infinite. No negative balances
  (bus `validate` rejects insufficient resources). Bridge requires distinct
  islands; connectivity derives from `bridges` only (open question #6 aligns
  the visual with truth).
- **Ambiguous approval rules:** HIGH-risk = exactly {clear_terrain,
  build_bridge, demolish}. LOW/MEDIUM auto-execute. Approvals bind to exact
  recorded impact; cannot be repurposed; rejections are logged and visible to
  the agent. No ambiguity.
- **Unnecessary complexity:** no currency, no individual villagers, no tech
  tree, no combat in MVP. The three specialists are justified by scope
  separation (§12). Roads are cosmetic. Nothing exists "because it renders
  easily".
- **Thesis dilution ("a game with an AI gimmick"):** the mitigation is
  structural — manual gathering cannot win the 30-day objective; the agent's
  tool calls are the only scalable lever; the approval gate is in the
  authoritative bus. The world is the *evidence surface* for the agent, not a
  minigame beside it.
- **TrueForge meaningful value:** TrueForge supplies agents, MCP tool
  execution, subagent turns, sandbox computation, persistent memory, and the
  pause-for-approval model. Removing TrueForge would require replacing all six
  — it is load-bearing (§13), and the current gap (toolCalls not executed) is
  the single highest-priority item in §29.

### The final question

> **Can we demonstrate, through ASTrix, that an AI agent can autonomously
> operate a changing world while its actions remain observable, verifiable,
> interruptible, and under meaningful human control?**

**Not yet — but the missing pieces are precisely identified and ordered.**

- **Already real:** authoritative world + command bus, structural irreversible-
  action approval gate, 10 MCP tools, provisioned steward + specialists,
  one-shot steward turns, Godot polling/command/approval wiring, SSE state
  stream, presentation-ready console + gate scaffolds.
- **Missing (all in §29, P0–P4):** the autonomous loop that *executes* the
  Steward's `toolCalls` and continues; typed agent-event observability;
  verification; delegation; failure injection; the objective/verdict system;
  rich approval payloads. Once P0–P4 land, every element of the question —
  autonomy, observability, verifiability, interruptibility, human control —
  has a concrete, demonstrable answer in the code.
