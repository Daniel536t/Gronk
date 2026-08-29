# Architecture — Gronk's Hoard

> How the system actually fits together, grounded in the current source. This
> is the "how": files, data flow, the secret boundary, the agent pipeline, and
> the client render model. For "what/why" see `prd.md`; for the visual system
> see `DESIGN.md`.

## 0. The core design stance

Three hard boundaries that everything else respects:

1. **The engine is the only truth.** Clients and agents never mutate state —
   they call command methods (`move` / `transform` / `action`) or read a public
   snapshot.
2. **The secret never crosses the public boundary.** `treasureFurnitureId`
   lives only on the `GameEngine` instance; `GameState` has no field for it, so
   `getPublicState()` / `/state` / MCP `get_state` / agent prompts cannot leak it.
3. **Agents reason about state, never frames.** The engine ticks at 10Hz; the
   client renders that state at 60fps. No agent code touches rendering.

## 1. Layered file map

```
┌─────────────────────────── CLIENT (vanilla TS + Canvas 2D) ───────────┐
│ index.html           5 screens + approval modal + reconnect overlay    │
│ src/client/main.ts   screens, 10Hz poll, HUD, transform-suppression   │
│ src/client/render.ts camera, world drawing, hide anims, Gronk, VFX    │
│ src/client/character.ts pose rig (computePose → drawPose)             │
│ src/client/objects.ts VisualObject system + furniture renderers       │
│ src/client/input.ts  WASD/Space/E + virtual joystick (touch)          │
│ src/client/api.ts    fetch wrappers + localStorage session            │
│ src/client/audio.ts  Web Audio manager (semantic, failure-safe)       │
│ src/client/particles.ts pooled particle system + spawn helpers        │
│ src/client/effects.ts camera impulse / shake / flash (bounded)        │
│ src/client/style.css design-token CSS (DESIGN.md tokens)              │
└────────────────────────────────────────────────────────────────────────┘
┌─────────────────────────── SERVER (Node, tsx) ─────────────────────────┐
│ src/server/index.ts      entrypoint: LobbyManager + MCP + HTTP         │
│ src/server/lobby.ts      Lobby/LobbyManager: rooms, seats, tick loop   │
│ src/server/http.ts       /state + /api/* + /mcp + static dist/         │
│ src/server/mcp.ts        11 MCP tools over stdio                      │
│ src/server/mcpHttp.ts    MCP over Streamable HTTP (POST /mcp)          │
│ src/server/orchestrator.ts AgentRuntime: cadence + timeout + fallback  │
│ src/server/agent.ts      AgentBackend/AgentDecision/AgentView seam     │
│ src/server/bots.ts       scripted FSM (permanent fallback)             │
│ src/server/intents.ts    IntentExecutor: intents → engine API calls    │
│ src/server/trueforge.ts  TrueForge HTTP backend + prompts + provision  │
│ src/server/trueforgeFactory.ts seats → TrueForge agents                │
│ src/server/gamemaster.ts riddle-reveal driver (skill-owning agent)     │
│ src/server/config.ts     loads config/*.json                           │
└────────────────────────────────────────────────────────────────────────┘
┌─────────────────────────── ENGINE (pure TS, zero deps) ────────────────┐
│ src/engine/engine.ts      GameEngine: tick, commands, Gronk FSM, wins  │
│ src/engine/types.ts       GameState + Player + JSON schema (comment)   │
│ src/engine/constants.ts   all timings/ranges/speeds                    │
│ src/engine/riddles.ts     3 riddle sets                                │
│ src/engine/index.ts       barrel export                                │
└────────────────────────────────────────────────────────────────────────┘
scripts/   provision · verify-mode-a · tf-smoke · live-demo · playtest ·
           mock-trueforge · visual-qa
tests/     engine rules, lobby, MCP, HTTP, M4 secrecy, M5 approval, playtest
config/    gronk-model.json · bots-model.json · trueforge.json
skills/    gronks-hoard/SKILL.md  (rules + riddles + schedule, for the GM agent)
```

## 2. Engine (authoritative, 10Hz)

`GameEngine` (engine.ts) owns:

- **State:** `GameState` — fixed-size arrays (4 players, 10 furniture), plain
  serializable object. `getPublicState()` deep-clones via `structuredClone`.
- **Tick:** `tick(1)` → updateRiddles → updateGronk → updatePlayers →
  updateSuddenDeath → checkClosetWin. One tick = 1/10s.
- **Commands:** `move` (breaks disguise if transformed), `transform` (position
  locks, snaps to furniture center), `action` (the one verb: search / reveal /
  pickup / bank — context-resolved). `approveBank` / `rejectBank` (M5 gate +
  10s cooldown).
- **Gronk FSM:** wander → sniff every 15s (noise > stunned > visible) → chase;
  touch → closet 25s; enrage at 4:00 (2× speed); external `forceSniff()` +
  `steerGronk()` when a TrueForge Gronk agent owns the cadence
  (`externalSniff` option).
- **Events:** `onEvent(cb)` emits `EngineEvent`s (riddle_reveal, noise, pickup,
  reveal, stun, drop, closet, bank_*, win, ...) — the client uses them for
  presentation feedback.
- **Secret:** `treasureFurnitureId` + `treasureInFurniture` are private fields,
  never in state.

## 3. Server layers

**LobbyManager** (lobby.ts): in-memory `Map<roomCode, Lobby>`; create/join/
start; fills empty seats with agents; `tickOnce` per 10Hz interval:
`runtime.step(lobby)` (agent decisions) → `intentExec.step(engine)` (apply
intents) → `engine.tick(1)` → stop when finished. `approvalRequired: true`
always for production lobbies.

**HTTP** (http.ts): `GET /state` (10Hz poll), `GET /api/lobby`,
`POST /api/create|join|start|move|transform|action|approve-bank|reject-bank`,
`POST|GET /mcp` (Streamable HTTP MCP), static `dist/` serving, CORS `*`.

**MCP** (mcp.ts): 11 tools — create_lobby, join_lobby, start_match, get_state,
move, transform, action, approve_bank, reject_bank, reveal_riddle,
agent_intent. Each session remembers its room after create/join. Tools return
JSON text. Over stdio (agents via MCP client) and over HTTP (TrueForge).

**Agent pipeline:**

```
engine.state ──toAgentView()──▶ AgentView (public-only, same as get_state)
      └───────────────▶ AgentRuntime.step (cadence: wizards 2.5s, Gronk 15s)
                            ├─ scripted backend: decideSync inline (0ms)
                            └─ TrueForge backend: decide() async, raced
                               against decisionTimeoutMs (60s default)
                               → on timeout/throw: scripted FSM answers
      ◀── AgentDecision { intent, targetId?, targetX?, targetY? } ──┘
        │  wizard → IntentExecutor.setIntent (persistent intent)
        │  gronk  → steerGronk(point) + forceSniff()
        ▼
   IntentExecutor.step → engine.move/transform/action (public API only)
```

- `AgentView` is deliberately the same restricted data `get_state` returns —
  no secret, no hidden extras (agent.ts).
- `AgentDecision` intents: SEARCH_FURNITURE / HIDE_AS / FLEE / GRAB /
  GO_TO_PEDESTAL / HUNT_NEAREST (intents.ts).
- TrueForge backend (trueforge.ts): plain `fetch` against
  `POST /api/v1/sessions/{id}/turns`; full public state injected into the turn
  prompt; parses `agent_intent` tool call or JSON-in-text back out
  (`parseDecision`); fail-open — never throws recoverable errors.

## 4. Client

**Loop (main.ts):** poll `GET /state` every 100ms → update HUD/buttons/toasts/
modal; 10Hz move sender pushes the input vector (0,0 when idle); `requestAnimationFrame`
60fps render with `setLocalPrediction` for the local avatar.

**Local prediction / reconciliation (render.ts `setLocalPrediction` + `step`):**
the server is authoritative at 10Hz but the client predicts at 60fps. Released
input **freezes** at the predicted position instead of snapping back (the
"RELEASE → REWIND" bug, Phase 6A.1). Handoff to authoritative smoothing happens
on convergence, judged by **completed-poll evidence** (never frame time), with
an 8s fetch timeout in `api.getState`. See README's Qodo evidence for the full
bug chain (PRs #9, #11).

**Transform suppression guard (main.ts):** while a transform POST is pending,
move sending is suppressed so a racing `move(0,0)` can't instantly untransform.
Released only on: rejection, a poll observing the requested state, or a poll
completed after the last request settled (poll-generation barrier + cycle
token). Never a fixed timeout.

**Rendering (render.ts):** world-space draw at ~36 world units vertical zoom,
camera follows local player exponentially, clamps to world. Draw order:

```
clear → floor base → room floors → global light → dust → interior walls →
outer walls → decor → room props → treasure pings → ground treasure →
objects (back pass) → pedestals → players (smoothed) → object fronts (cover) →
interaction affordance → Gronk → particles → screen-space lighting (vignette…)
```

- **Hide/occlusion (Phase 4):** cover objects render their full body in the
  back pass, then re-paint front geometry over the player with a cover alpha
  (`lastCoverMap`); enter/exit runs a 300ms slide + fade (`hideAnims`),
  plus furniture settle reactions (`reactT` map).
- **Characters (character.ts):** `drawCharacter(ctx, opts)` → `computePose` →
  `drawPose`. Pose-driven: speed-scaled stride, directional silhouettes
  (back/front/profile), stun droop, carry hunch, cloak secondary motion,
  reduced-motion gate.
- **Objects (objects.ts):** `VisualObject { id, kind, x, y, w, h, layer, cover }`
  — a pure rendering abstraction over engine furniture; per-kind chunky
  renderers (fridge, barrel, chest, throne, bookshelf, couch, tapestry, brazier,
  statue, cauldron) + `faceShade` light-face/shadow pass + contact shadows.
- **Particles (particles.ts):** fixed pool (max 350), ring-buffer reuse, spawn
  helpers (dust, motes, sparkles, stars, embers, vapor, rage).
- **Audio (audio.ts):** Web Audio manager, semantic methods, per-sound
  cooldowns, room ambience beds, gesture-gated init, total failure safety.
- **Effects (effects.ts):** camera impulse / shake / flash, bounded, gated by
  `prefers-reduced-motion`.

## 5. The secret boundary — verified paths

1. `treasureFurnitureId` only on the engine instance.
2. `GameState` type has no treasure field → `getPublicState()` cannot include it.
3. `AgentView` is built from the public state only.
4. `verify:mode-a` scans every agent payload + state response for the string.
5. Unit tests assert the same across tick loops.

## 6. Config & deployment

- **config/trueforge.json:** baseUrl (localhost:8790), 60s decision timeout,
  mcpServerUrl. Overridable via `TRUEFORGE_URL` / `TRUEFORGE_API_KEY`.
- **config/gronk-model.json / bots-model.json:** model FQNs, swappable.
- **BOTS env:** `scripted` (default) | `trueforge`.
- **pm2** (ecosystem.config.cjs): two apps — `gronks-hoard` (:8787) and
  `trueforge-harness` (`npx @truefoundry/trueforge --port 8790`).
- **One port:** `npm run prod` builds + serves `dist/` + API + MCP all on 8787.
- Optional split (Vercel static + game server) via `VITE_API_URL`; Fly.io via
  Dockerfile + fly.toml. README verdict: single pm2 box for the demo.

## 7. Tests & verification

- `npm test` — 64 tests: setup/movement/transform/riddles/secrecy (16),
  action rules (15), Gronk FSM (12), lobby + full match + M5 approval (4),
  HTTP API full match (2), MCP stdio round trip (1), M4 steer/secrecy/fallback
  (9), playtest (5).
- `npm run typecheck` — server + client.
- `npm run verify:mode-a` — full agent-driven match (mock or real harness).
- `npm run qa:visual` — Playwright headless: static/character/movement/furniture/
  transform/hide/game-feel/pose/input/joystick/accessibility/HUD/menu probes at
  desktop/tablet/mobile + screenshots to `qa/screenshots/`.
- QA hooks: `__ghCam`, `__ghChars`, `__ghCover`, `__ghEffects`, `__ghHide`,
  `__ghInteract`, `__ghReact`, `__ghSteps`, `__ghParticles`, `__ghAudio`,
  `__ghUI` — read-only introspection on `window`.

## 8. Known deferred / documented issues

- **cmdSeq / move-transform ordering race:** a move POST in flight the same tick
  as a transform POST can race server-side. Deliberately deferred; requires
  engine/API command ordering (a separate milestone). Never "fix" with client
  timeouts.
- **Visual QA probabilistic flakes:** long-running desktop gameplay fixtures
  can be interrupted by Gronk/bots (caught → respawn → position assertions
  fail). Verified pre-existing on clean main; rendering checks are stable.
