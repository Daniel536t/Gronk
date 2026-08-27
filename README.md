# Gronk's Hoard

A real-time multiplayer hide-and-seek heist where the TrueForge agent harness IS the game engine. The monster and bot players are TrueForge agents, game actions are MCP tools, the treasure location is protected behind the tool boundary, and winning requires human approval.

**No blockchain. No crypto. No Solana. No MagicBlock.** Just agents, MCP tools, and a troll.

## Quick Start

```bash
npm install
npm run prod  # serves everything on http://localhost:8787
```

Open http://localhost:8787, hit **Single Player** — one click to a live match (you + 3 scripted bots). For development (hot-reload frontend):

```bash
npm run dev:all  # game server :8787 + Vite frontend :5173
```

Open http://localhost:5173.

## Running it forever (VPS / pm2 / nohup)

The game is a real-time, in-memory server — it must keep running. On your own box
(you already have one hosting the previous build):

**With pm2** (recommended; auto-restarts + survives crashes):

```bash
npm i -g pm2
npm run build && pm2 start ecosystem.config.cjs && pm2 save
pm2 startup   # optional: copy the printed command so it survives server reboots
pm2 logs
```

**Without pm2 (nohup):**

```bash
./start-server.sh          # build-if-needed + start under nohup on :8787
./start-server.sh status
./start-server.sh stop
```

Both serve the whole game on **one port: 8787** (`http://<ip>:8787`). Open the security
group / firewall for 8787. This is the **recommended** deployment: one URL, no CORS,
and the in-memory lobbies that power refresh-resume.

## Deploying the frontend separately (Vercel optional)

The game logic **must** run on an always-on host (Vercel's serverless functions are
stateless and scale-to-zero, so they can't hold a live match). Two options:

1. **Frontend on Vercel + game server on your VPS or Fly.io.** Build the static frontend
   with the game server's origin baked in:

   ```bash
   VITE_API_URL="https://game.example.com" npm run build
   vercel --prod            # statically serves dist/
   ```

   The game server already sends `Access-Control-Allow-Origin: *`, so the cross-origin
   polling works as-is. `vercel.json` is ready.

2. **Fly.io for the whole game** (one always-on host, still single origin):

   ```bash
   fly launch --no-deploy
   fly secrets set BOTS=scripted
   fly deploy               # uses Dockerfile + fly.toml
   ```

**Verdict:** for a hackathon demo, skip the split and run everything with pm2 on one
box — simplest and most reliable. Use option 1 or 2 only if you specifically want the
Vercel URL.

## TrueForge Mode (M4)

On the VPS, the whole thing stays up under pm2. One-time setup:

```bash
# 1. Start both apps (game + TrueForge harness on :8790, bound to 0.0.0.0).
#    Open http://<your-ip>:8790 in a browser for the TrueForge UI (keep the
#    security-group rule limited to your IP — standalone runs auth-disabled).
pm2 start ecosystem.config.cjs

# 2. Register the NVIDIA NIM model provider + MCP connector + skill, and
#    create/update the 5 agents (gronk, botwizard-a/b/c, gamemaster).
#    The key is passed via env — it is never committed.
NVIDIA_API_KEY=nvapi-... npm run provision

# 3. Run the game with TrueForge agents (BOTS is read live from env)
BOTS=trueforge pm2 restart gronks-hoard
pm2 save
```

**Skill pack (GameMaster):** the `gronks-hoard` skill (rules + riddles + reveal
schedule) is registered from `Daniel536t/Gronk` (ref `main`, path
`skills/gronks-hoard`) and loads into the local sandbox — the harness needs its
host deps installed once: `sudo apt-get install -y socat ripgrep python3-venv`.
No agent carries an MCP connector (the public state is in every turn prompt, and
the TrueForge<->game streamable-HTTP transport is flaky); the connector stays
registered as the harness's tool surface.

**Models (NVIDIA NIM, verified live):** both tiers run `nemotron-3-nano-30b-a3b`
(~1-20s/decision). `openai/gpt-oss-20b` is registered too and reasons better but
~10-25s/decision — it trips the scripted fallback often, so it's a swap option in
`config/bots-model.json`. The playing agents carry **no MCP connector**: the full
public state is injected into every turn prompt, so they answer directly with an
`agent_intent` JSON (the secret boundary still holds — they only ever see public
state). The GameMaster keeps the connector + skill pack.

Verify Mode A plays a full match headless — either against the real harness on the
VPS, or (no harness needed) against an in-process mock that implements the same HTTP
contract, so the whole pipeline is provable anywhere:

```bash
npm run verify:mode-a                          # mock harness — works anywhere
TRUEFORGE_URL=http://localhost:8790 npm run verify:mode-a   # real agents on the VPS
npm run tf:smoke                               # one real gronk + one real bot decision
```

The verifier plays a complete match through the MCP surface (1 human proxy + 3 TrueForge
wizards + TrueForge Gronk), measures per-decision latency, and fails unless the match ends
with a winner, at least one decision came from a real agent (mock: all of them), and the
treasure furniture id never appeared in any payload (the "agents can't cheat" proof).
Real-LLM decisions run ~10-28s on NIM; the 60s timeout + scripted fallback is the designed
safety net — a slow or dead agent is replaced per-seat and the match never crashes.

`BOTS=scripted` (the default) runs the permanent scripted-FSM fallback — same game, zero LLM
needed. `npx @truefoundry/trueforge --port 8790` also works for a foreground harness during
dev.

## How it works

- **Engine (pure TS, zero deps):** authoritative `GameState`, 10 ticks/sec. Secret boundary: `treasureFurnitureId` lives on the engine instance only and can never cross `getPublicState()` — clients and agents see riddles and their own search results, nothing more.
- **MCP server (the game's tool surface):** `create_lobby`, `join_lobby`, `start_match`, `get_state`, `move`, `transform`, `action`, `agent_intent`, `approve_bank`, `reject_bank`, `reveal_riddle` — over stdio and over HTTP (`POST /mcp`, streamable HTTP, where TrueForge connects).
- **HTTP API (for the browser):** `POST /api/create|join|start|move|transform|action|approve-bank|reject-bank` + `GET /state` (10Hz polling) + `GET /api/lobby`.
- **Agent harness:** Gronk (cheap/fast model) decides every 15s sniff tick; bot wizards (standard model) every 2.5s. Intents are executed continuously by the engine's intent executor.
- **Approval gate (M5):** banking only ends the match after a human clicks **Approve**. Every human player gets the modal: "TEAM X IS BANKING THE TREASURE!" Rejecting gives that team a 10s bank cooldown.

## Screens

Title → Single Player (one click) or Multiplayer (create/join) → Lobby (team seats, host-only start) → Game (canvas + riddle banner + timer + toasts + approval modal) → Result (winner + confetti).

Visuals are a flat "Among Us"-style cartoon drawn as shapes on our 2D plane: bean-shaped
astronaut **crewmate** wizards (rounded body + dome visor + backpack + stubby legs that waddle
as they move), a hulking troll Gronk, and a tiled spaceship interior. No assets, no sprites —
everything is Canvas 2D primitives. The own avatar moves at 60fps via client-side prediction
(lerped/snapped from the 10Hz server stream) for a smooth Among-Us feel.

Controls: WASD + Space (action) + E (transform) on desktop; a floating joystick + a single
big circular ACTION button (label flips to SEARCH / BANK / HIDING) + a smaller TRANSFORM button
above it on touch. Ops screens auto-hide and show a control hint on desktop.

## Tests

```bash
npm test           # 64 tests: engine rules, lobby, MCP wire, HTTP API, M4 fallback/secrecy, M5 approval, M6 playtest
npm run typecheck
npm run verify:mode-a   # full match driven by TrueForge agents (mock harness)
npx tsx scripts/playtest.ts   # headless 3-match single-player playtest
```

## Project structure

```
├── package.json                  # scripts: test, typecheck, server, prod, dev:all
├── tsconfig.json / tsconfig.client.json
├── index.html                    # 5 screens + approval modal + reconnect overlay
├── vite.config.ts                # dev server (:5173), proxies /state + /api -> :8787
├── ecosystem.config.cjs          # pm2 process config (VPS)
├── start-server.sh               # nohup alternative: start/status/stop
├── vercel.json                   # static-frontend deploy (optional split)
├── Dockerfile + fly.toml         # always-on host deploy (optional)
├── .env.example                  # VITE_API_URL for a split frontend (optional)
├── config/
│   ├── gronk-model.json          # Gronk's cheap/fast model (swappable)
│   ├── bots-model.json           # bot wizards' standard model (swappable)
│   └── trueforge.json            # TrueForge baseUrl + 5s decision timeout
├── skills/gronks-hoard/SKILL.md  # skill pack: rules + riddles + schedule
├── scripts/
│   ├── provision.ts              # creates the TrueForge agents
│   ├── verify-mode-a.ts          # full match driven by TrueForge agents (mock or real harness)
│   ├── mock-trueforge.ts         # mock TrueForge harness (same HTTP contract)
│   └── playtest.ts               # headless single-player playtest
├── demo-clips/                   # demo video captures (see README there)
├── src/
│   ├── engine/                   # pure TS, zero deps, unit-testable
│   │   ├── constants.ts          # room, speeds, all timings (+ bank cooldown)
│   │   ├── types.ts              # GameState + JSON schema (in comment)
│   │   ├── riddles.ts            # 3 riddle sets (fridge/bookshelf/couch)
│   │   ├── engine.ts             # GameEngine: tick loop, commands, Gronk FSM, approval gate
│   │   └── index.ts              # barrel export
│   ├── server/                   # MCP + HTTP layer (wraps the engine)
│   │   ├── intents.ts            # agent_intent executor (engine public API only)
│   │   ├── agent.ts              # AgentView/AgentDecision seam
│   │   ├── bots.ts               # scripted FSM fallback bots + toAgentView
│   │   ├── orchestrator.ts       # decision cadence + >5s timeout fallback + payload log
│   │   ├── trueforge.ts          # TrueForge HTTP backend + exact agent prompts
│   │   ├── trueforgeFactory.ts   # seats -> TrueForge agents
│   │   ├── gamemaster.ts         # game-master driver (riddle reveal schedule)
│   │   ├── config.ts             # loads config/*.json
│   │   ├── lobby.ts              # room codes, teams, host rules, tick loop
│   │   ├── mcp.ts                # MCP server: 11 tools over stdio
│   │   ├── mcpHttp.ts            # MCP over HTTP (POST /mcp)
│   │   ├── http.ts               # /state + /api/* + /mcp + static dist/
│   │   └── index.ts              # entrypoint
│   └── client/                   # vanilla TS + Canvas 2D
│       ├── main.ts               # screens, 10Hz poll, HUD, modal, confetti, reconnect
│       ├── render.ts             # shapes + lerp + juice (sniff flare, stun, gold, enrage, pings)
│       ├── input.ts              # WASD/Space/E + touch joystick
│       ├── api.ts                # fetch wrappers + localStorage session
│       └── style.css
└── tests/
    ├── helpers.ts                # seeded RNG, engine factory, neutralizer
    ├── setup-movement.test.ts    # setup, movement, transform, riddles, secrecy
    ├── action.test.ts            # search / stun / pickup / bank / cooldown
    ├── gronk.test.ts             # Gronk FSM, enrage, closet, sudden death, wins
    ├── integration.test.ts       # lobby rules + headless full match + M5 approval
    ├── http-api.test.ts          # browser data path over HTTP (full match)
    ├── mcp-smoke.test.ts         # MCP wire round trip (11 tools over stdio)
    ├── m4.test.ts                # steer/forceSniff, MCP-over-HTTP, fallback, secrecy
    └── playtest.test.ts          # M6: three full solo matches + milestone transitions
```

## Game rules (engine)

- 2 wizard teams, one room (~100x60), no roles — everyone hides, everyone searches.
- ~10 furniture spots; stand next to one and TRANSFORM to hide (position locks; moving breaks the disguise).
- ACTION near furniture = SEARCH: treasure → pick it up; hidden enemy → reveal + 3s stun; else empty. Every search makes noise that attracts Gronk.
- Carrier glows gold, 30% slower, can't hide. Stunned carrier drops the treasure.
- Gronk wanders, sniffs every 15s (noise > stunned > visible), catches → 25s closet, enrages at 4:00 (2x speed).
- No bank by 5:00 → sudden death: treasure pings every 10s, enrage stays on.
- Win: bank with human approval, or whole enemy team in the closet at once.

## Milestones

| # | Scope | Status |
|---|-------|--------|
| M1 | Pure TS engine: rules, Gronk FSM, unit tests | ✅ |
| M2 | MCP server + lobby + `/state` + scripted bots | ✅ |
| M3 | Canvas frontend, 1 human vs 3 bots playable | ✅ |
| M4 | TrueForge live agents + skill pack + game-master | ✅ |
| M5 | Approval gate on bank + session resume + reconnect | ✅ |
| M6 | Single-player finalization + playtest | ✅ |
| M7 | Submission package (this README, Qodo evidence, demo clips) | ✅ |

## Qodo Code Review Evidence

Every substantive change ships via a Qodo-reviewed PR. Qodo's GitHub App is installed
on this repo; each PR runs an agentic review and findings are resolved or explicitly
rationalized before merge.

### Representative reviewed PR
- **Repo:** https://github.com/Daniel536t/Gronk
- **PR: [Phase 3 — original hooded-adventurer characters + animation/state system](https://github.com/Daniel536t/Gronk/pull/1)** (#1, merged)

### What Qodo found and what we changed
Qodo's agentic review of PR #1 (deep mode) flagged two bugs:
1. **High — Rejected transform froze movement.** A rejected/errored `transform` POST left move
   suppression permanently set, disabling input. Fixed: suppression now releases immediately on
   a rejected/failed request and is reset when a session changes.
2. **High — Slow-transform move race.** A hard 500ms suppression cap could expire before a slow
   transform applied, letting a racing move break the disguise. Fixed: removed the time cap; input
   is held only until a poll observes the applied state (and released instantly on rejection).

Follow-up: Qodo raised a deeper ordering sub-case (a move POST in flight the same tick as the
creature transform). This is **intentionally deferred** as out of scope for a visual phase (it needs
engine/API ordering tokens, which this repo's Phase 3 brief reserves for a later milestone) and is
documented in the PR thread with that rationale.

### Phase 4 — hiding & occlusion (also Qodo-reviewed)
- **PR: [Phase 4 — hiding, occlusion & environmental interaction](https://github.com/Daniel536t/Gronk/pull/3)** (#3, merged)

Phase 4 (hide enter/exit animation, furniture front-cover occlusion, interaction
affordance, and a fix for a rapid-toggle input lock) went through a full Qodo
agentic review that closed **6 bugs over two follow-up rounds to 0**:
1. Overlapping transform posts needed a per-request counter (not a single boolean).
2. A shared hiding spot could lose occlusion when another player animated. 
3. Floor markers (pip/shadow/aura) ignored the hide fade.
4. QA must fail (not silently pass) when a probe throws or a fixture is unreachable.
5. A stale in-flight poll could release movement before the toggle state was observed
   (fixed with a poll-generation barrier).
6. A pre-reset transform callback could settle a new suppression cycle
   (fixed with a suppression-cycle token).

Public thread: https://github.com/Daniel536t/Gronk/pull/3 — Qodo Code Review comment
with each finding marked `✓ Resolved` at the final commit (`Bugs (0)`).

### Phase 5 — game feel (also Qodo-reviewed)
- **PR: [Phase 5 — game feel: audio, particles, camera feedback, ambient life](https://github.com/Daniel536t/Gronk/pull/5)** (#5, merged)

Phase 5 (Web Audio manager with semantic procedural sounds + room ambience, pooled
particle system, camera impulse/shake/flash, event feedback from authoritative state,
footsteps tied to the walk cycle, and ambient brazier/cauldron/Gronk life) went through
a full Qodo agentic review that closed **12 findings over three review rounds to 0**,
including:
1. Screen shake was dead code (applied in an uncalled `setProjection`) — moved into the
   frame projection; the camera impulse is now a presentation offset, never integrated
   into the follow-camera.
2. The audio cooldown gate discarded a sound's first play; the cafeteria ambient bed
   stayed silent (room default short-circuited the initial profile).
3. `playReveal` was never invoked; resume replayed the game-start cue; the first
   snapshot (and each new match's first snapshot) now seeds event trackers without
   emitting false hide/stun/pickup/alert feedback.
4. Shake is folded into the effective camera center before the world-bounds clamp, so a
   shaken frame at a map edge never exposes the background.
5. QA probes no longer silently skip on failed walks/transforms; the spawn-room check
   asserts the actual zone.

Also found while verifying: a latent unhandled-promise-rejection in the transform input
guard (parallel `.then`/`.catch` — now chained).

Public thread: https://github.com/Daniel536t/Gronk/pull/5 — Qodo Code Review comment
with each finding marked `✓ Resolved` at the final commit (`Bugs (0)`).

### Phase 6A — character animation & motion (also Qodo-reviewed)
- **PR: [Phase 6A — articulated character rig, Gronk upgrade, furniture reactions](https://github.com/Daniel536t/Gronk/pull/7)** (#7, merged)

Phase 6A (pose-based character rig: speed-scaled stride, directional back/front/profile
silhouettes, cloak secondary motion, stun droop, carry hunch, reduced-motion gate; a
Gronk rig with feet/arms/head/nostrils/catch-lunge; furniture settle reactions on
hide/emerge) went through a full Qodo agentic review that closed **15 findings over
two follow-up rounds to 0**, including:
1. An unbalanced canvas save in `drawGronk` leaked the rig transform into particle
   rendering and grew the stack every frame.
2. Front/back hoods collapsed to a zero-area path (all X coordinates multiplied by the
   zero horizontal facing component).
3. The furniture reaction scaled around the world origin, drifting distant objects;
   now it scales about the object center in both back and front passes.
4. Reduced motion scaled whole avatars down 45% (only motion amplitudes should damp),
   and left lean full-strength on down/horizontal facings.
5. Stun stars/diamond/ghost motes rendered at the world origin after the character
   transform was restored — now drawn inside the local frame.
6. The advertised stun slouch and cloak trailing stream were computed but never drawn
   — both are now consumed by the renderer.
7. The furniture-reaction envelope treated remaining countdown as elapsed time
   (suppressed for most of the window) and the hood lean sign doubled for left/up.
8. QA honesty: the reaction probe now reads a live `__ghReact` hook instead of the
   transform state, the idle probe asserts zero stride in both samples, and the
   hide-exit probe verifies the player actually emerged before the screenshot.

Public thread: https://github.com/Daniel536t/Gronk/pull/7 — Qodo Code Review comment
with each finding marked `✓ Resolved` at the final commit (`Bugs (0)`).

### Review history (public)
The Qodo review and follow-up re-reviews on the updated commits are public on PR #1:
https://github.com/Daniel536t/Gronk/pull/1 (Qodo Code Review comment + review markers at each commit), on PR #3 (Phase 4, `Bugs (0)` at the final commit), on PR #5 (Phase 5, `Bugs (0)` at the final commit), and on PR #7 (Phase 6A, `Bugs (0)` at the final commit).

### Workflow
branch → push → open PR → `\`/agentic_review\`` → fix/dismiss findings → re-review → merge.

## Demo clips

`demo-clips/` contains capture instructions for the two required clips (approval gate +
session resume). Run the commands in `demo-clips/README.md` on a machine with a browser;
headless environments can't record video.

## Hackathon constraints honored

- TypeScript everywhere, Node 20+, no game engine, no 3D, no external DB, no blockchain.
- GameState: plain serializable object, fixed-size arrays for 4 players, JSON schema in a comment.
- Engine stays pure and dependency-free; the server layer talks to it only through its public API.
- One command to run everything: `npm run prod`.
