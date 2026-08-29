# Memory — Gronk's Hoard

> Persistent lessons, decisions, and gotchas accumulated across the project.
> The "things you only learn by being here" file. Read this before touching
> anything subtle. Ordered roughly by how often they bite.

## Top rules that keep biting

1. **`npm run typecheck` runs TWO tsconfigs** (`tsc --noEmit` + client). A
   change that typechecks in one can fail the other. Always run the full
   script, not `tsc` alone.
2. **The visual QA suite has pre-existing probabilistic flakes.** Long-running
   desktop gameplay fixtures (move/emerge/camera/transform probes) can be
   interrupted when Gronk/bots catch the player mid-probe (respawn → position
   jumps → assertions fail). Different checks fail each run. Verified pre-existing
   on clean `main` (stash → baseline run → same failures). **Rendering/UI
   checks are stable** — trust those; re-run for the flaky ones. Never weaken a
   probe to make the suite pass.
3. **Never use a fixed timeout as a correctness mechanism.** The client's
   transform-suppression and release-reconciliation are correctness-critical
   and both use *evidence* (poll observations, completed-poll counts, state
   confirmation), never `setTimeout`. Qodo has repeatedly flagged timeout-based
   logic as bugs. If you're tempted to add `setTimeout(…, 200)`, stop and find
   the real signal.
4. **Qodo review status is per-PR and the header count lies.** On PR #9 the
   review header said `Bugs (1)` while two findings showed `✓ Resolved`, and
   there was a third finding we missed entirely — merged with it open (chip =
   "Ignored"). **Before merging, dump and count every numbered finding in the
   review body**, including newly added ones. Resolution comments must name
   every finding.
5. **The `(pointer: fine)` vs `(pointer: coarse)` responsive model is
   deliberate** — not width breakpoints. Don't "fix" mobile by adding 768px
   media queries.
6. **Design tokens live in `style.css` `:root` and DESIGN.md is the source of
   truth.** One semantic meaning = one token. No new hexes for existing roles.
   Gold = magic/treasure/CTA only. Update DESIGN.md first if the system must
   change.

## Architecture gotchas (learned the hard way)

- **Local prediction vs 10Hz authority:** the client predicts at 60fps; the
  server is authoritative at 10Hz. Releasing input must NOT snap back to the
  lagging server position (the Phase 6A.1 "RELEASE → REWIND" bug). Freeze +
  hand off on convergence, judged by completed-poll evidence. The renderer's
  stall clock must count **distinct completed polls** (success or failure),
  never frame dt — a single slow poll at 60fps would exhaust a frame-based
  bound.
- **Transform input race:** the engine's `move()` breaks a disguise, so an
  idle `move(0,0)` sender can race a transform POST and instantly
  untransform. The suppression guard is subtle (poll generations + cycle
  tokens + per-request counters) — read `main.ts` before touching it.
- **The `drawCharacter` contract and QA hooks are load-bearing.** Extend,
  never replace. `__gh*` hooks are read-only introspection that the visual QA
  suite depends on.
- **Canvas path persistence is a feature:** after `ctx.fill()`, the path stays
  current — the character shading re-fills the same cloak/hood path with a
  horizontal light/shadow gradient instead of re-drawing it. That's how the
  form-shading pass stays cheap.
- **Front/back occlusion (Phase 4):** cover objects paint their full body in
  the back pass, then re-paint front geometry over the player with a cover
  alpha. Shared hiding spots must keep steady cover so one player's enter/exit
  animation never exposes another (Qodo #2 in Phase 4).
- **`approvalRequired: true` is the production default** for banking (M5) —
  unit tests that want instant banking pass `approvalRequired: false`.
- **Agent decisions are applied through the engine public API only** — the
  IntentExecutor translates persistent intents into `move/transform/action`
  per tick. The engine has no notion of intents.
- **In trueforge mode, Gronk's sniff cadence is owned by the agent**
  (`externalSniff: true` + `forceSniff()`), and the engine's own timer is
  disabled.

## Secrets & safety

- `treasureFurnitureId` lives only on the `GameEngine` instance — never in
  `GameState`, so `getPublicState()` structurally can't leak it. `AgentView`
  is built from public state only. `verify:mode-a` scans every payload +
  state response for the string. If you add any new public state, re-run the
  secrecy checks.
- NVIDIA NIM API keys are env-only, never committed. Model configs are in
  `config/*.json` and swappable from the TrueForge UI.

## QA / testing habits

- Deterministic RNG: `seededRng(42)` from `tests/helpers.ts`; `neutralize()`
  hides all-but-one player and disables Gronk sniffs for focused engine tests.
- New visual work gets **deterministic probes** (pixel sampling, pose-param
  hooks) + **screenshots** to `qa/screenshots/`. A pixel probe proves the code
  renders — it does NOT prove it looks good. Say so honestly.
- Before/after screenshot comparisons: keep `qa/screenshots-before/` and
  `qa/screenshots-after/` copies when reporting a visual change; the harness
  overwrites by filename each run, and best-effort shots (group, stunned) can
  silently stay stale.

## Deployment facts

- Game on `:8787` (single port: static + API + MCP), TrueForge harness on
  `:8790` (auth-disabled standalone — keep the security group limited to your
  IP).
- pm2: `gronks-hoard` + `trueforge-harness` (ecosystem.config.cjs). Restart
  with `BOTS=trueforge pm2 restart gronks-hoard` after provisioning.
- Provision once: `NVIDIA_API_KEY=… npm run provision` (registers provider,
  MCP connector, skill pack, 5 agents). Sandbox needs `socat`, `ripgrep`,
  `python3-venv` installed for the GameMaster skill pack.
- The game server **must stay running** (in-memory lobbies power
  refresh-resume). Vercel serverless can't hold a live match.

## Workflow / process

- Every change ships via a Qodo-reviewed PR. Docs changes also go through PRs
  and get reviewed (and Qodo has caught doc inaccuracies — e.g. overstating
  the ~1.5s reconciliation claim).
- "Continue from where you stopped" sessions: check git status + the last
  progress note first — partial work is often uncommitted (this happened with
  the Phase 6B reduced-motion fixes and the visual pass).
- GitHub token must be in the push URL (or use the classic token provided);
  the redacted-token push failure happened more than once — verify the exact
  token before pushing.
- `DESIGN.md` and the new context docs (`prd.md`, `architecture.md`,
  `project-plan.md`, `handoff.md`, `memory.md`) are the "explain this repo to
  the next model" set — keep them updated as the project moves.
