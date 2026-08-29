# PRD — Gronk's Hoard

> The product requirements document. This is the "what and why" — the game's
> concept, audience, mechanics, milestones, and acceptance criteria. For the
> "how" see `architecture.md`; for the visual system see `DESIGN.md`; for
> current state see `handoff.md`.

## 1. One-line concept

A real-time multiplayer hide-and-seek heist where the TrueForge agent harness
**IS** the game engine: Gronk the troll and the bot wizards are TrueForge
agents, game actions are MCP tools, the treasure location is a server-side
secret, and winning requires human approval.

**No blockchain, no crypto, no Solana.** Pure TypeScript agents + MCP tools + a
canvas game.

## 2. Why this exists (context)

Built for the **TrueForge Agent Harness Hackathon**. The evaluation criteria:

- Potential Impact
- Creativity & Originality
- Technical Excellence
- Use of Sponsor Tools
- Control & Safety
- Presentation

The broader vision: prove an agent harness can orchestrate a real interactive
system — game agents, adversarial behavior, hidden information, tool use,
sandboxed execution, human approval, live commentary, post-match analysis.
The game exists so that orchestration is *visible and fun* in a demo, not just
a backend abstraction.

## 3. Audience

- **Primary:** hackathon judges watching a live demo (~2 minutes to understand).
- **Secondary:** players who enjoy party/party-game hide-and-seek (Among Us
  crowd) on desktop and mobile.
- The game must be instantly readable by a bystander: who each player is, who
  Gronk is, who is hiding, who is carrying treasure, what just happened.

## 4. Product goals

1. **Playable immediately.** One click from the title screen to a live match
   (Single Player = you + 3 bots).
2. **Secret boundary is real.** The treasure furniture id never leaves the
   server — clients and agents only see riddles + their own search results.
3. **Agents are the game.** TrueForge agents decide every action; the scripted
   FSM is a permanent fallback so the game always works, LLM or not.
4. **Human-in-the-loop.** Banking the treasure requires a human Approve click.
5. **Polished enough to demo.** Dark-fantasy visual identity, readable at a
   glance, mobile + desktop, restrained effects.

## 5. Game concept & rules (player-facing)

- **Setting:** two wizard teams in one single-screen room (top-down 2D, ~100×60
  units, four themed zones: Cafeteria, Library, Reactor, Storage).
- **No roles:** everyone can hide as furniture and everyone can search.
- **Hide (TRANSFORM):** stand next to furniture and transform into it —
  position locks; moving breaks the disguise.
- **Search (ACTION):** near furniture = SEARCH →
  1. treasure there → pick it up (you become the carrier),
  2. enemy hiding there → revealed + stunned 3s,
  3. otherwise → "Empty!".
  **Every search makes noise that attracts Gronk.**
- **Carry:** carrier glows gold, moves 30% slower, can't hide; a stunned carrier
  drops the treasure; carrier at own pedestal + ACTION = bank request.
- **Gronk:** wanders; sniffs every 15s, hunting noise > stunned > visible;
  touch → 25s closet then respawn; enrages (2× speed) in the final 60s.
- **Sudden death:** no bank by 5:00 → treasure pings every 10s, enrage stays on.
- **Win:** bank with human approval, or the whole enemy team in the closet at once.

## 6. Riddles (the treasure hint system)

Three hardcoded sets, three escalating lines each, revealed at 0s / 90s / 180s.
Each set pairs with a furniture spot (Kitchen→fridge, Living room→bookshelf,
Lounge→couch). The riddle text never names the furniture id — it hints
poetically ("Open the fridge. Behind the milk.").

## 7. The secret boundary (core safety property)

`treasureFurnitureId` lives only on the `GameEngine` instance. It is never
inside `GameState`, so `getPublicState()` (used by `/state`, MCP `get_state`,
and every agent prompt) structurally cannot leak it. This is verified by
`verify:mode-a` and the unit tests (payload scanning for the string).

## 8. Multiplayer model

- Lobby system with 4-letter room codes (`WAND-42`). Up to 4 humans (2v2);
  empty seats are filled with agents at start.
- Host (first joiner) starts the match.
- Browser session persisted in localStorage (`gh-session`) → refresh-resume
  into an in-progress match; reconnect overlay if the server restarted.
- Server is authoritative at 10Hz; the client predicts the local avatar at
  60fps and reconciles (see `architecture.md` — this had a notorious bug).

## 9. Milestones (all shipped)

| # | Scope | Status |
|---|-------|--------|
| M1 | Pure TS engine: rules, Gronk FSM, unit tests | ✅ |
| M2 | MCP server + lobby + `/state` + scripted bots | ✅ |
| M3 | Canvas frontend, 1 human vs 3 bots playable | ✅ |
| M4 | TrueForge live agents + skill pack + game-master | ✅ |
| M5 | Approval gate on bank + session resume + reconnect | ✅ |
| M6 | Single-player finalization + playtest | ✅ |
| M7 | Submission package (README, Qodo evidence, demo clips) | ✅ |
| M8+ | Post-hackathon polish: Phase 6B UI/HUD, visual transformation pass | 🔄 |

## 10. Acceptance criteria (current build)

- `npm run prod` serves the entire game on one port (8787).
- `npm test` → 64/64 passing.
- `npm run typecheck` clean (server + client tsconfigs).
- `npm run build` clean.
- `npm run qa:visual` → all rendering/UI checks pass (long-running gameplay
  fixtures are probabilistic vs Gronk interference — see `handoff.md`).
- `npm run verify:mode-a` → full TrueForge-agent match finishes with a winner,
  ≥1 real agent decision, zero treasure leaks.
- `BOTS=scripted` (default) works with no LLM; `BOTS=trueforge` uses real agents.

## 11. Non-goals / explicit exclusions

- No 3D, no external game engine, no external DB, no blockchain.
- No dynamic/LLM-generated riddles (riddles are hardcoded).
- No custom bot sandboxing, no analyst/commentator agents yet (future).
- No `cmdSeq` server-side command ordering (documented, deferred).
- No asset pipeline / sprite sheets (procedural Canvas only).

## 12. Risks & mitigations

- **Agent latency** (real LLM ~10–28s on NIM): 60s decision timeout + scripted
  fallback per seat; match never crashes.
- **Mobile performance:** bounded particles (350), no per-frame allocations,
  pointer-type responsive model.
- **Visual quality without an artist:** procedural Canvas with a pose-based
  character rig + a coherent DESIGN.md token system.
- **Judge demo flakiness:** `verify:mode-a` (mock or real harness) proves the
  pipeline anywhere; demo clips capture the approval gate + session resume.
