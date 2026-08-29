# Project Plan — Gronk's Hoard

> The roadmap: what the project is trying to do, where it's been, where it is
> now, and where it's going next. The **single best file to read first** after
> the README — it tells you what state the project is in and what's next.

## North star

A real-time multiplayer hide-and-seek heist where the TrueForge agent harness
**IS** the game engine — for the TrueForge Agent Harness Hackathon. The game
must be visually compelling enough that the orchestration (agents deciding,
Gronk hunting, treasure secrecy, human approval) is instantly understandable
and interesting in a demo.

## How work has shipped (the rhythm)

Every substantive change ships as a **Qodo-reviewed PR**: branch → push → open
PR → `/agentic_review` → fix/dismiss findings → re-review → merge. The README
"Qodo Code Review Evidence" section is the audit trail. Process rule learned
the hard way: **count every numbered finding in the review body before merging**
— do not trust the header count (see the PR #9 "Ignored" chip episode).

## Phase history (all merged to `main`)

| Phase | What | PR(s) | Status |
|---|---|---|---|
| M1–M7 | Engine, MCP, lobby, frontend, TrueForge agents, approval gate, playtest, submission package | — | ✅ |
| Phase 2 | Recognizable environmental objects + visual object system | `33daf6d` | ✅ |
| Phase 3 | Hooded-adventurer characters + animation/state system | #1, `0212f6a` | ✅ (Qodo: 2 bugs fixed) |
| Phase 4 | Hiding, occlusion & environmental interaction | #3, `6913d82` | ✅ (Qodo: 6 bugs → 0) |
| Phase 5 | Game feel: audio, particles, camera feedback, ambient life | #5, `e999c55` | ✅ (Qodo: 12 findings → 0) |
| Phase 6A | Articulated character rig, Gronk upgrade, furniture reactions | #7, `eebd1cd` | ✅ (Qodo: 15 findings → 0) |
| Phase 6A.1 | Fix controller "RELEASE → REWIND" movement feel | #9, `8cc6a85` | ✅ (2/3 fixed in-PR) |
| 6A.1 follow-up | Release reconciliation hardening (progress detection, poll-evidence stall) | #11, `297ba5e` | ✅ (Qodo: Bugs (0)) |
| Phase 6B | UI/HUD redesign per DESIGN.md | #14, `83bcccf` | ✅ (Qodo: 4 findings → 0) |
| Visual transformation pass | Global warm light, character/Gronk/furniture form shading, contact shadows, room tint | *in flight* | 🔄 uncommitted |

## Current state (HEAD `83bcccf` + uncommitted visual pass)

- `main` is at **`83bcccf` (Phase 6B)**.
- Working tree has an **uncommitted visual transformation pass** on three
  files: `src/client/character.ts`, `src/client/objects.ts`,
  `src/client/render.ts` (+ untracked `VISUAL_TRANSFORMATION_PLAN.md`). See
  `handoff.md` — this is the immediate next thing to commit/PR/review.
- Live deployment: pm2 on the VPS serving `:8787` (game) + `:8790`
  (TrueForge harness). `DESIGN.md` is the visual source of truth.

## Roadmap / next steps

Ordered by what the repo actually needs next:

1. **Commit + PR the visual transformation pass** (in-flight now). Qodo-review
   it, then deploy to the VPS. Verify 64/64 tests, typecheck, build, visual QA.
2. **Human visual gate.** The pixel-audit proves the changes render; whether
   they *look* right (outline weight, Gronk's horns/tusks, rim intensity, room
   tint) needs a human playtest at real zoom. Tune from that feedback.
3. **Qodo dashboard hygiene** (if still relevant): PR #9's "Slow requests
   restore rewind" chip reads "Ignored" — the code is fixed (PR #11), the chip
   is per-PR bookkeeping; the GitHub thread + README document the chain.
4. **Future/optional (not scheduled):**
   - Analyst / commentator TrueForge agents + replay/heatmap layer.
   - Dynamic riddles.
   - Custom bot sandboxing.
   - `cmdSeq` server-side command ordering (documented deferral — needs an
     engine/API milestone, never a client timeout).

## Definition of done for any phase

- Typecheck clean (server + client).
- 64/64 unit tests green (never delete/weaken old tests to pass).
- `npm run build` clean.
- `npm run qa:visual` — rendering/UI checks green (acknowledge the pre-existing
  Gronk-interference flakes on long gameplay fixtures; verify against a clean
  baseline run when in doubt).
- Qodo review completed; genuine findings fixed or documented; `Bugs (0)` at
  the final commit.
- Engine/server/API/networking untouched unless the phase explicitly owns them.
- Honest reporting: automated verification ≠ human visual/audio judgment.

## Guardrails (hard constraints, every phase)

- Engine stays pure TS, zero deps; the secret never crosses the public boundary.
- No asset pipeline / sprite sheets (procedural Canvas, pose rig).
- No new authoritative game state without approval; no `cmdSeq`.
- No arbitrary timeouts as correctness mechanisms (poll-evidence, never
  `setTimeout` for correctness).
- DESIGN.md is the source of truth for presentation; update it first if the
  design system itself must change.
- BOTS=scripted must stay functional forever (it's the demo insurance).
