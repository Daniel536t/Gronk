# ASTrix Living World — submission status

> A persistent world with its own on-chain clock, governed by temporary AI
> stewards under revocable human authority. Proven slices below are real
> (devnet signatures cited); anything unproven is labeled as boundary, never
> shipped as functionality.

## Thesis

The world does not belong to the AI. Time, state, memory, and consequences
persist independently of any steward; governors are temporary, replaceable,
and revocable; humans hold the gate. Demonstrations, not dashboards.

## Slice 1 — World clock on Solana (PROVEN, devnet)

Program `qWpJE9ePjD8YnzW2AA6UdpFodF7LS7w5Y5CUmHArWK3`
(`solana/astrix-world/`, native Rust, no framework): one PDA world account
(`GBFT6mQew5g1BBpWjHSYfe9tNN1a3KykjuDun862S29P`) holding `{version,
authority, day}`. Instructions: Initialize / AdvanceDay (authority-signed) /
DelegateWorld (CPI to the Delegation Program). Zero simulation rules on-chain
— the clock determines WHEN, Core determines WHAT. Deployed, upgraded,
initialized, advanced to day 4 with real signatures.

## Slice 2 — Core catches up with real consequences (PROVEN)

`scripts/astrix-chain-catchup.ts`: reads the on-chain day, ticks a real Core
to match. Measured: day 1→4, food 40→28, crops 0→0.38, **zero steward
actions** (`artifacts/astrix-chain-catchup.snapshot.json`). Starvation,
growth, and consumption are Core's own `tick()` — the chain proposed time,
Core disposed meaning.

## Slice 3 — Observatory renders chain-driven time (PROVEN)

The catch-up snapshot renders through the production Godot path
(`screenshot_harness` + `ASTRIX_SHOT_SNAPSHOT`): day-4 world, honest IDLE
steward badge, empty feed (`awaiting steward…`), villagers present. No
staged narrative.

## Absence, succession, revocation (PROVEN locally)

- `astrix:absence-drill` → PASS: 0 decisions/actions while STOPPED, granary
  12→0, recovery harvests, mechanical score (+4-frame real-state storyboard).
- `astrix:revocation-drill` → PASS: `stop("authority-revoked")` mid-gate-park,
  zero post-revoke steward mutations, approval survives, human approves
  exactly once. Succession = stop + start (restart clears the reason: a
  restart is a fresh authorization).
- Settlement: canonical receipt hashes pinned in tests; null-adapter journal
  tested; devnet memo-tx round-trip confirmed
  (`4KoCCoW…mhJL`, slot 496596741, recovered byte-identical).

## Boundary: ER delegation (PROVEN — was blocked, root-caused, fixed)

Program-owned PDA delegation works **through the official
`ephemeral-rollups-sdk::cpi::delegate_account` lifecycle** (buffer create +
data copy + zeroing + system-path reassignment + delegation CPI), called from
our program so the world PDA signs through its seeds. Two wrong theories died
with evidence: a hand-built delegate CPI skips preparation
(`InvalidAccountOwner`); a direct owner `assign` trips the runtime guard
(`ModifiedProgramId`). Measured on devnet: delegate → owner `DELeGGvX…`;
advance on ER/EU in ~960 ms; explicit commit → base day synced. The account
stays delegated (undelegate needs the exact-discriminator callback —
deferred, documented in-program).

## Authority (frozen)

One semantic authority: ASTrix Core (rules, validation, gate, verification).
Chain: WHEN (day counter) + durable witness (receipts). Godot: observation
only. No duplicated simulation anywhere. Core-wins on every disagreement.

## Evidence index

- Tests: 262/262 (drills 6, settlement 9, R3 source pins, attack probes 18).
- Artifacts: canonical run, demo A–D, absence drill + storyboard, revocation
  drill, settlement spike (tx sig + slot), chain-catchup snapshot.
- Live chain: program, world PDA (day 4+), init/advance/upgrade signatures —
  all on Solana devnet, recoverable via stock RPC + explorer.
