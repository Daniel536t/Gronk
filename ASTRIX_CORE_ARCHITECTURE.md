# ASTRIX_CORE_ARCHITECTURE.md

> **Status:** describes the architecture **as implemented**, verified against the
> source on branch `feat/mobile-first-gameplay` after the Core-extraction and
> canonical-run milestones. Every claim below is traceable to a `path:line`
> reference or a named test. Where something is aspirational it is labelled
> **NOT IMPLEMENTED**.
>
> Verified state at the time of writing: 185/185 tests pass, both typechecks
> clean, `npm run build` clean, `npm run astrix:canonical` produces
> `artifacts/astrix-canonical-run.json` + `.md`.

---

## 0. The two principles

### DECISION ≠ AUTHORITY

A steward may *decide* `build_bridge`. That decision mutates nothing. Deciding is
a pure function that returns JSON (`StewardDecision`); it holds no reference to
the world, the bus, or the tool registry. Every proposal must survive this path
before the world changes:

```
proposal (StewardDecision.toolCalls)
  → risk classification        orchestrator.ts:130 riskOf()
  → approval gate if HIGH      commandBus.ts:103-114 (structural)
  → tool registry              mcpTools.ts:41 callTool()
  → command bus                commandBus.ts:93 execute()
  → authoritative state        state.ts:122 AstrixWorldState
  → verification               orchestrator.ts:669 checkVerification()
  → event record               events.ts:52 record()
```

Enforced structurally, not by convention:

- `LocalStewardProvider.decide()` receives only `context.snapshot` — a deep-copied
  plain object from `state.snapshot()` (`state.ts:216`). It has no handle on
  `AstrixWorldState` or `AstrixGameCommandBus`.
- Agent-supplied approval ids are **stripped** before execution:
  `FORBIDDEN_ARG_KEYS = {approval_id, approvalId}` (`orchestrator.ts:128`),
  applied in `sanitizeArgs` (`orchestrator.ts:732`) at both call sites
  (`runSafe` `:534`, `runApprovalGated` `:568`).
- Test: *"cannot mutate authoritative state by deciding (proposal is inert)"* —
  two `decide()` calls, snapshot byte-identical
  (`tests/astrix-core-independence.test.ts`).

### VISUALIZATION ≠ AUTHORITY

Godot renders truth; it never owns it. See §13 and the companion
`ASTRIX_GODOT_SEAM_AUDIT.md`.

---

## 1. Canonical architecture (as implemented)

```
                    ┌───────────────────────────────┐
                    │      Steward Provider         │
                    │  (StewardDecisionProvider)    │
                    │                               │
                    │  LocalStewardProvider  ← default
                    │  TrueForgeStewardProvider ← optional adapter
                    │  <future provider>     ← extension point
                    └──────────────┬────────────────┘
                                   │  StewardDecision (JSON only)
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                            ASTRIX CORE  (src/astrix/)                │
│                                                                      │
│  AstrixWorldState ──snapshot()──► WORLD_OBSERVED ──► provider.decide()│
│        ▲                                                      │      │
│        │                                              toolCalls[]     │
│        │                                                      ▼      │
│        │                                        propose() + riskOf()  │
│        │                                                      │      │
│        │                            ┌── high ──► APPROVAL GATE       │
│        │                            │            (command bus)       │
│        │                            │              │ human           │
│        │                            │       approve │ reject         │
│        │                            │              ▼                │
│        │                            └── low/med ─► Tool Registry     │
│        │                                              │              │
│        │                                              ▼              │
│        │                                        AstrixGameCommandBus │
│        │                                     (SOLE mutation boundary)│
│        │                                              │              │
│        └──────────────────────────────────────────────┘              │
│                                                       │              │
│                                        Verification ◄─┘              │
│                                              │                       │
│                                              ▼                       │
│                                    AstrixEventLog (ring, 500)        │
│                                     + per-turn memory summary        │
│                                              │                       │
│                                              └──► next Observe       │
└──────────────────────────────────────────────────────────────────────┘
        │                        │                         │
        │ GET /astrix/state      │ SSE /astrix/events      │ GET /astrix/log
        │ GET /astrix/agent/status                         │
        ▼                        ▼                         ▼
┌────────────────┐      ┌────────────────┐       ┌──────────────────┐
│  Godot client  │      │  Observatory   │       │  evidence/CI     │
│ (read + submit │      │ (pure          │       │ artifacts/*.json │
│  permitted acts)│     │  projection)   │       └──────────────────┘
└────────────────┘      └────────────────┘
```

**One correction to the diagram in the brief:** `src/astrix/server.ts` (the
HTTP/service layer) lives *inside* `src/astrix/`, so Core includes its own
transport adapter. It imports `node:http` and `node:crypto` only — no network
*client*, no third-party HTTP library. Core therefore *serves* state but never
*fetches* anything. See §18.

---

## 2. Authoritative state ownership

`AstrixWorldState` (`state.ts:122`) is the only authority. Owned fields:

| Field | Type | Notes |
|---|---|---|
| `elapsed` (private) | number | the clock; `day = floor(elapsed/120)+1` (`:166`) |
| `population` | number | mutable; only ever *decremented* by starvation (`:262`) |
| `food` | number | mirrored into `resources.food` (`:265`) |
| `resources` | `Record<ResourceType, number>` | wood, stone, food, water, crystal |
| `biomeHealth` | `Record<BiomeId, number>` | lowered by clearing (`commandBus.ts:232`) |
| `crops` | `AstrixCrop[]` | `growthStage` 0→1, frozen in winter (`:110`) |
| `bridges` | `{id, islandA, islandB}[]` | derives connectivity (`:272`) |
| `farmlandCapacity` | `Record<BiomeId, number>` | meadow 2 / frost 2 / dusk 1 |
| `buildings` | `AstrixBuilding[]` | house/farm/storage/bridge_segment |
| `resourceNodes` | `AstrixResourceNode[]` | finite; removed permanently by clearing |
| `pendingApprovals` | `AstrixApproval[]` | the gate's queue |

Constants: `DAY_SECONDS=120`, `FOOD_PER_VILLAGER_PER_DAY=1`,
`WINTER_FOOD_MULTIPLIER=1.5`, `YEAR_DAYS=30`,
`CROP_TYPES={wheat:{daysToMature:8,yield:6}}`, `FARM_CROP_CAPACITY=3`
(`state.ts:79-92`).

`snapshot()` (`:216`) returns a **deep copy** with derived read-only facts
(`survivalProjection()` `:193`): `foodPerDay`, `daysOfFoodRemaining`,
`harvestableFood`, `growingFood`, `projectedFoodAtWinter`, `foodPressureLevel`.
These are *facts, never recommendations* — the comment at `state.ts:190` states
this explicitly, and it is why the steward can reason without being scripted.

`tick(deltaSeconds)` (`:155`) applies `advanceDay()` once **per crossed day
boundary**, so a multi-day jump consumes food for every day rather than one.

---

## 3. CommandBus — the mutation boundary

`AstrixGameCommandBus` (`commandBus.ts:46`) is the only writer of authoritative
state. Six commands: `PLACE_BUILDING`, `GATHER_RESOURCE`, `PLANT_CROP`,
`HARVEST_CROP`, `CLEAR_TERRAIN`, `BUILD_BRIDGE` (`:4-10`).

Shape: `execute()` → `validate()` → gate check → mutate → `emitState()`.
`validate()` (`:143`) enforces world bounds, costs (`COSTS` `:39`), farmland
capacity (`:158`), crop capacity (`:167`), crop maturity (`:210`), and
connectivity via `islandReachableFromMeadow()` (`:252`) for both `build` and
`gather`.

**Audited claim — the bus is the sole mutation path.** A repo-wide grep for
assignments/pushes/splices against `state.<field>` outside `commandBus.ts` and
`state.ts` returns nothing, and `bus.execute(` is called from exactly two places:
`mcpTools.ts:48-53` (the tool registry) and `server.ts:109` (`POST /astrix/command`).
No UI path, no Godot path, no test-only path writes state.

---

## 4. Tool registry

`createAstrixToolRegistry(state, bus)` (`mcpTools.ts:38`) exposes 11 tools
(`ASTRIX_TOOL_NAMES` `:5`):

| Tool | Mutates | Backing command |
|---|---|---|
| `inspect_world` / `inspect_island` / `inspect_resources` / `inspect_buildings` | no | `state.snapshot()` |
| `simulate_plan` | no | `bus.simulate()` (`:136`, read-only) |
| `gather` | yes | `GATHER_RESOURCE` |
| `build` | yes | `PLACE_BUILDING` |
| `plant` | yes | `PLANT_CROP` |
| `harvest` | yes | `HARVEST_CROP` |
| `clear_terrain` | yes | `CLEAR_TERRAIN` (**gated**) |
| `build_bridge` | yes | `BUILD_BRIDGE` (**gated**) |

snake_case is the contract; `ARG_ALIASES` (`:18`) accepts camelCase so a model
naming slip never fails a call. Every mutating tool has exactly one backing
command — no tool bypasses the bus.

**Known gap:** `listAstrixTools()` (`:11`) returns `inputSchema: {}` for every
tool, so `/astrix/mcp/tools/list` is schema-less. Real schemas live in
`src/server/mcp.ts:264-274` and in the prompt text. `astrixToolSchemas` (`:96`)
defines zod schemas for only 4 tools and is imported nowhere.

---

## 5. StewardLoop lifecycle

`AstrixStewardLoop` (`orchestrator.ts:136`). States: `IDLE`, `RUNNING`,
`AWAITING_APPROVAL`, `COMPLETED`, `STOPPED`, `FAILED` (`:27`).

Per turn (`run()` `:288`):

```
TURN_STARTED → WORLD_OBSERVED → DECISION_STARTED
  → provider.decide() raced against decideTimeoutMs
  → DECISION_COMPLETED (durationMs, ok, failureKind)
  → PLAN_CREATED
  → for each toolCall (≤ maxActionsPerTurn):
        propose() → ACTION_PROPOSED
        high risk ? runApprovalGated() : runSafe()
        → ACTION_EXECUTING → ACTION_SUCCEEDED|ACTION_FAILED
        → VERIFICATION_STARTED → VERIFICATION_SUCCEEDED|VERIFICATION_FAILED
  → TURN_COMPLETED   (or TURN_FAILED)
```

Bounds: `DEFAULT_MAX_TURNS=5`, `DEFAULT_MAX_ACTIONS_PER_TURN=10`,
`DEFAULT_DECIDE_TIMEOUT_MS=60_000` (`:119-121`). An idle turn (zero actions) ends
the run (`:462`). Risk: `HIGH_RISK_TOOLS={clear_terrain,build_bridge}` (`:126`),
read-only tools are low, everything else medium (`riskOf` `:130`).

Per-action lifecycle is tracked in `AstrixActionRecord` (`:48`) with separate
`executionState` and `verificationState` — see §9.

---

## 6. StewardDecisionProvider interface

```ts
interface StewardDecisionProvider {          // orchestrator.ts:96
  readonly id: string;
  decide(context: StewardRunContext): Promise<StewardDecision>;
}

interface StewardRunContext {                // :83
  turn: number;
  objective?: string;
  snapshot: AstrixStateSnapshot;             // deep copy — read-only in practice
  history: readonly AstrixActionRecord[];    // this run's actions (agent memory)
  lastOutcome?: string;                      // previous turn summary
  retryHint?: string;                        // set only on a parse retry
}

interface StewardDecision {                  // :73
  decision: string;
  recommendation?: string;
  reasoning?: string;
  approvalRequired?: boolean;                // INFORMATIONAL ONLY — the bus decides
  toolCalls: { tool: string; args: Record<string, unknown> }[];
}
```

This interface **is** the extension point (§20). Note `approvalRequired` is
advisory: an agent claiming `false` changes nothing, because the gate lives in
the bus.

---

## 7. LocalStewardProvider — the default runtime

`src/astrix/localRuntime.ts`. In-process, deterministic, zero network. Priority
policy, re-evaluated every turn from the fresh snapshot:

1. `harvest` mature crops — realise standing production
2. `plant` into free farm capacity — "the day you plant is not the day you eat"
3. `build` a farm on reachable free farmland
4. `gather` the binding material (wood or stone) when a build is unaffordable
5. `clear_terrain` (**gated**) when no reachable farmland remains
6. `build_bridge` (**gated**) to unlock another island's farmland
7. idle — with the reason stated

**Adaptation is real, not scripted.** `rejectedSignatures()` reads
`context.history` for `approvalState === "rejected"` and builds stable
per-proposal signatures (`signatureOf()`). `clearableNode()` skips refused
targets, so a rejected clearing produces a *different* site; when every site is
refused it changes strategy to connectivity; when that is refused too it idles
honestly and says so. Tested end-to-end in
`tests/astrix-core-independence.test.ts` ("the steward adapts after a human
rejection instead of re-proposing it") and observed in the canonical artifact
(`adaptations[0].changed === true`).

Options: `{ maxFarms?, allowIrreversible?, respectSeason? }`. `allowIrreversible:
false` yields a provider that can never reach the gate — used to test honest idle.

---

## 8. TrueForgeStewardProvider — optional adapter

**Fully intact. Nothing was deleted.** `src/server/trueforge.ts:452` implements
the same `StewardDecisionProvider` interface, driving
`runAstrixStewardTurn()` (`:252`): `POST /api/v1/sessions` →
`POST /api/v1/sessions/{id}/turns` → poll to `state.status === "done"` →
`parseAstrixStewardDecision()`. Prompt construction in `buildStewardPrompt()`
(`:331`) plus `ASTRIX_TOOL_GUIDE` (`:315`); provisioning helpers at `:498-651`.

**Exactly where it remains optional** — one function,
`selectStewardProvider()` (`src/server/index.ts:82`):

| `ASTRIX_RUNTIME` | Provider |
|---|---|
| unset / `local` | **default** — returns `undefined`, Core installs `LocalStewardProvider` |
| `trueforge` | `TrueForgeStewardProvider(loadConfig().trueforge)` |
| `auto` | TrueForge **iff** `TRUEFORGE_URL` is set, else local |

Core never calls this function. `createAstrixService()` (`astrix/server.ts:37`)
falls back to `new LocalStewardProvider()` when no provider is passed, so
independence is structural rather than a config flag.

Proven absent from the Core path: `tests/astrix-core-independence.test.ts` runs
the full lifecycle with `TRUEFORGE_URL=http://127.0.0.1:9` (discard port) and the
API key deleted — if any path needed TrueForge the test would hang or throw.

---

## 9. Approval gate

**Structural, in the bus, not the UI.** `commandBus.ts:103-114`: an irreversible
command arriving with `approvalId === undefined` creates an `AstrixApproval`
(bound to the exact `{position, radius, islandA, islandB}` impact), pushes it to
`state.pendingApprovals`, and returns
`{success:false, error:"human approval required", pendingApproval}` **without
mutating anything**.

The loop deliberately calls high-risk tools *without* an approval id
(`runApprovalGated` `:562`) so the bus itself raises the gate, then parks in
`AWAITING_APPROVAL` on an unresolved promise (`awaitApproval` `:629`).
`orchestrator.ts:16` states the rule: *"A timeout is NEVER interpreted as
approval."*

Only `resolveApproval(id, decision)` (`:241`) resumes it. On approve it delegates
to `bus.resolveApproval` (`commandBus.ts:56`), which re-`validate()`s and
re-`execute()`s the **stored** command — the agent cannot substitute a different
one, because `approvalMatchesCommand()` (`:271`) compares the recorded impact
exactly.

**World time freezes at the gate.** `AstrixService.tick` (`astrix/server.ts:73`)
returns early while `loop.state === "AWAITING_APPROVAL"`, so human deliberation
never silently consumes game days. Tested: 5 days of wall-clock ticks at the gate
leave `state.day` unchanged; it advances again after approve/reject.

---

## 10. Verification

Distinct from execution. Every action carries both `executionState` (PROPOSED →
EXECUTING → SUCCEEDED/FAILED/REJECTED/SKIPPED) and `verificationState` (PENDING →
VERIFIED/VERIFICATION_FAILED/NOT_VERIFIED).

`checkVerification()` (`orchestrator.ts:669`) is evidence-based per tool, using a
`before` snapshot captured prior to execution:

| Tool | Evidence required |
|---|---|
| `build` | returned `buildingId` exists in `snap.buildings` |
| `build_bridge` | returned `bridgeId` exists in `snap.bridges` |
| `plant` | returned `cropId` exists in `snap.crops` |
| `harvest` | crop existed before **and** is gone now **and** `foodDelta === foodGained` |
| `gather` | node quantity decreased by exactly `gathered` (or node fully depleted) |
| `clear_terrain` | `permanent === true` **and** no nodes remain within the radius |

Read-only tools are marked `NOT_VERIFIED` rather than falsely verified
(`:647`). Tested: no action is ever `VERIFIED` without `SUCCEEDED`, and no
`FAILED` action is `VERIFIED` (canonical-run integration test).

---

## 11. Event log

`AstrixEventLog` (`events.ts:46`) — a ring buffer with listeners. 22 event types
(`:6-34`). Each event: `{type, at, turn, actionId?, data}`.

**It is an audit/observability log, not event sourcing.** State cannot be rebuilt
from events; the buffer truncates at `capacity` (default 500, `:50`). Recorded
data is *observable facts and concise rationale only* — `decision`,
`recommendation`, tool names, deltas, durations, failure kinds. No private
chain-of-thought is stored.

Consumers: SSE `event: agent` (`astrix/server.ts:61`), `GET /astrix/log` (`:152`),
`loop.status().lastEvents` (`orchestrator.ts:279`).

> **Capacity caveat:** the canonical run emits ~928 events, so the default 500
> would drop the earliest ~430. `canonicalRun.ts` constructs its log with
> `new AstrixEventLog(5000)` for exactly this reason. The historical
> `/tmp/astrix-final-eval/final-log.json` lost its first 165 events to this.

---

## 12. Canonical run

`src/astrix/canonicalRun.ts` — a library (so the test and the generator share one
code path), driven by `scripts/astrix-canonical-run.ts` (`npm run astrix:canonical`).

It assembles Core exactly as `createAstrixService` does and adds **only** two
things for determinism: an explicit clock (`state.tick(DAY_SECONDS)` between
steward runs instead of a wall-clock interval) and a deterministic
`HumanApprovalPolicy` (default `rejectFirstThenApprove` — refuse the first
irreversible request, approve the rest). *Which* action reaches the gate and on
*which* day remains the steward's doing.

Latest artifact (`artifacts/astrix-canonical-run.md`): survived to day 31,
population 4→4, food 40→142, 7 farms, 2 bridges, 39 crops harvested, 111
proposals (5 high-risk), 4 approvals granted / 1 rejected, 110 executed / 110
verified, 0 failures, 1 adaptation, 928 events, TrueForge **NO**.

Reproducibility is asserted, not assumed: the integration test runs the same seed
twice and compares frames, decisions, and the full event-type sequence.

---

## 13. Godot seam (summary — detail in `ASTRIX_GODOT_SEAM_AUDIT.md`)

```
AstrixWorldState.snapshot()
  → GET /astrix/state (2 Hz)        GameClient.gd:80
  → WorldState.apply_snapshot()     WorldState.gd:41   (mirror, no authority)
  → World3D._materialize_sim()      World3D.gd:1096    (presentation only)
  → rendered scene
```

Godot **submits** actions (`POST /astrix/command`, `GameCommandBus.gd`) and
**responds** to approvals (`POST /astrix/approval/respond`, `ApprovalGate.gd`),
but never commits a mutation locally — `GameCommandBus.gd:2-4`: *"Every
world-changing request is validated here and forwarded to the authoritative
server. No local mutation happens."*

`MCPToolRegistry.gd` is **not** an MCP host — no JSON-RPC, no transport. Its own
header says *"MCP-shaped local registry. Phase 2 will connect external TrueForge
calls."* The MCP host is the TypeScript server.

---

## 14. Failure semantics

- **Unknown tool** → recorded `SKIPPED` + `ACTION_FAILED`, never executed
  (`orchestrator.ts:510`).
- **Invalid args / insufficient resources / capacity** → bus returns
  `{success:false,error}` → `FAILED` + `NOT_VERIFIED` + `ACTION_FAILED`. No state
  change (validation precedes mutation).
- **Provider throw / timeout** → `DECISION_COMPLETED{ok:false,failureKind}` →
  `TURN_FAILED` → loop `FAILED`. `failureKind` distinguishes
  `timeout | parse | provider` (`:347`).
- **Parse failure only** is retried **exactly once** with `retryHint`
  (`:352-403`); timeouts and provider errors are never retried — *"no blind retry
  of potentially non-idempotent work"* (`:18`).
- **Verification failure** → `VERIFICATION_FAILED`; execution success is not
  downgraded, the two facts are recorded separately.
- **No false success:** nothing reaches `VERIFIED` without `SUCCEEDED`; tested.

---

## 15. Interruption semantics

`stop()` (`:227`) sets `_stopped` and, when parked at the gate, wakes the waiter
with `"stopped"` → loop `STOPPED`, world unmutated (tested). The loop also checks
`_stopped` at every turn and tool-call boundary (`:290`, `:444`).

Authority summary:

| Actor | Can | Cannot |
|---|---|---|
| **Agent** | observe, reason, propose, request | mutate state, grant its own approval, bypass the gate, escalate risk class |
| **Human** | set objective, start/stop, approve, reject | — (holds the final word on every HIGH action) |
| **System (Core)** | classify risk, validate, execute, verify, record | invent an approval, execute an unapproved irreversible command |

The agent cannot escalate its own authority: risk class is computed from the tool
name by Core (`riskOf`), not supplied by the agent, and approval ids are stripped
from its args.

---

## 16. Stale / duplicate approval protection

1. Approvals bind to their exact recorded impact; `approvalMatchesCommand()`
   (`commandBus.ts:271`) rejects any mismatch, so an approval can never be
   repurposed for a different command.
2. A successful irreversible execution **removes** the approval
   (`commandBus.ts:127-130`), so the id cannot be replayed. Tested: a second
   `approve` on a consumed id returns `approval not found` and the world is
   byte-identical.
3. An approval whose stored params no longer validate is **dropped** rather than
   left pending forever (`:74-89`).
4. Rejection removes the approval and returns `approval rejected` with zero
   mutation (`:60-64`).

---

## 17. Deterministic test / canonical-run strategy

- Core has no RNG. Given the same start state and the same provider, the
  trajectory is identical — which is why `runCanonicalScenario` is reproducible
  without a seed mechanism. `seed` is recorded as a run *identifier*.
- Time is injected, never ambient: `state.tick(deltaSeconds)` is called by the
  caller. Production uses `setInterval(() => astrix.tick(1), 1000)`
  (`src/server/index.ts:65`); tests and the canonical run advance days explicitly.
- Providers are injectable, so tests use real Core with a scripted or doomed
  provider rather than mocking the world.
- Assertions are invariant-based. The one ordering treated as a contract
  (propose → execute → verify) is asserted **per action id**, not against the
  global event sequence.
- Non-determinism that remains (and is excluded from comparisons): `event.at`
  wall-clock timestamps and `durationMs`.

---

## 18. Dependency direction

**Audited — every import in `src/astrix/*.ts`:**

```
canonicalRun.ts  → ./commandBus ./events ./localRuntime ./mcpTools ./orchestrator ./state
commandBus.ts    → ./state
localRuntime.ts  → ./state ./orchestrator
mcpTools.ts      → zod, ./commandBus ./state
orchestrator.ts  → ./commandBus ./events ./mcpTools ./state
server.ts        → node:http node:crypto, ./commandBus ./events ./localRuntime ./mcpTools ./orchestrator ./state
```

Core's entire external surface is **`zod`**, **`node:http`**, **`node:crypto`**.

Token scan across `src/astrix/` — confirmed **zero** occurrences of:
`src/server`, `../server`, `fetch`, `axios`, `magicblock`/`MagicBlock`,
`solana`/`Solana`, `creditcoin`/`Creditcoin`, `attestcoin`/`Attestcoin`,
`godot`/`Godot`. The only `TrueForge` matches are **string literals and comments
in `canonicalRun.ts`** asserting non-use (`trueforge: {used: false}`), plus the
markdown label `TrueForge used | NO` — no import, no call.

### Core MUST NOT import

- ❌ `src/server/*` — the direction is `server → astrix`, never the reverse
- ❌ TrueForge (`trueforge.ts`, `trueforgeFactory.ts`, `config.ts`)
- ❌ any network **client** (`fetch`, `axios`, `undici`, MCP SDK client)
- ❌ provider-specific infrastructure (NVIDIA NIM, model configs)
- ❌ Godot / rendering / presentation
- ❌ MagicBlock, Solana, Creditcoin, Attestcoin, or any chain SDK
- ❌ the legacy game engine (`src/engine/*`) or lobby

Allowed: `zod` (validation), `node:http` + `node:crypto` (its own transport
adapter in `server.ts`). If Core ever needs a *client*, that belongs in an
adapter under `src/server/` or a new `src/adapters/`, never in `src/astrix/`.

---

## 19. Security boundaries

Two surfaces, and the posture **changed** with the local runtime:

| Surface | Auth | Note |
|---|---|---|
| `POST /astrix/command`, `/astrix/approval/respond`, `/astrix/agent/start`, `/astrix/agent/stop`, `POST /astrix/mcp`, `POST /astrix/mcp/tools/call` | `ASTRIX_API_KEY` bearer (`astrix/server.ts:200`) | **fails open when the env var is unset** (`:201`) |
| `GET /astrix/state`, `/astrix/events`, `/astrix/agent/status`, `/astrix/log`, `GET /astrix/mcp*` | none | read-only |
| `POST /mcp` (legacy MCP channel) | **none by design** (`src/server/http.ts:20-26`) | reasoning was "same-host network isolation" |

The `POST /mcp` justification **no longer holds**: the app is published via Caddy,
and because Core now reasons locally it needs **no inbound TrueForge access at
all**. Full analysis, exposure, and remediation in
`ASTRIX_SECURITY_FINDINGS.md`. Not fixed in this milestone by instruction.

Structural safety that does *not* depend on auth: the approval gate is in the
bus, so even an unauthenticated caller that reaches a mutating tool cannot
execute `clear_terrain`/`build_bridge` without a human resolving an approval.

---

## 20. Extension points for future execution providers

The seam is `StewardDecisionProvider` (§6). A new provider needs only
`{id, decide(context)}` and is selected in `selectStewardProvider()`
(`src/server/index.ts:82`). Nothing in Core changes.

```
                    ASTrix Core  (authoritative, provider-agnostic)
                          │
        ┌─────────────────┼─────────────────┬──────────────────┐
        │                 │                 │                  │
  Local Runtime    TrueForge Adapter   MagicBlock Adapter   Creditcoin /
   (default)         (optional)        (NOT IMPLEMENTED)    Attestcoin
                                                            (NOT IMPLEMENTED)
```

**Not implemented, deliberately:** MagicBlock, Creditcoin, Attestcoin. No
blockchain dependency exists in the repo (verified by the token scan in §18).

A second extension axis exists but is **NOT IMPLEMENTED**: settlement/attestation
adapters would consume the *event log* rather than replace the provider — i.e.
they observe `APPROVAL_GRANTED` / `VERIFICATION_SUCCEEDED` and anchor them
externally. That keeps Core authoritative and the adapter downstream. Provisioned
but unused subagents (`astrix-agriculture`, `astrix-construction`,
`astrix-ecology`) and the `SUBAGENT_REQUESTED`/`SUBAGENT_RESULT` event types are
likewise **NOT IMPLEMENTED** — declared, never driven.

---

## Appendix — file map

| Path | Role |
|---|---|
| `src/astrix/state.ts` | authoritative world + clock + derived facts |
| `src/astrix/commandBus.ts` | sole mutation boundary + approval gate |
| `src/astrix/mcpTools.ts` | tool registry (11 tools) |
| `src/astrix/orchestrator.ts` | steward loop, risk, verification, events |
| `src/astrix/localRuntime.ts` | **default** in-process reasoning layer |
| `src/astrix/events.ts` | ring-buffer event log |
| `src/astrix/server.ts` | Core's own HTTP/SSE adapter + service assembly |
| `src/astrix/canonicalRun.ts` | deterministic canonical run (library) |
| `scripts/astrix-canonical-run.ts` | evidence generator (`npm run astrix:canonical`) |
| `src/server/index.ts` | wiring + `ASTRIX_RUNTIME` provider selection |
| `src/server/trueforge.ts` | **optional** TrueForge adapter (intact) |
| `tests/astrix-core-independence.test.ts` | Core/governance/TF-absence (22 tests) |
| `tests/astrix-canonical-run.test.ts` | canonical lifecycle (6 tests) |
| `artifacts/astrix-canonical-run.{json,md}` | canonical evidence |
