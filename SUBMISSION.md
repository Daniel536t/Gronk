# ASTrix — Submission

## 1. What ASTrix is

ASTrix is an **AI-control / governance laboratory**, not a game. A deterministic
village simulation (food, crops, population, farms, bridges) is managed by an
AI steward that can propose but never authorize, under a human approval gate,
with evidence-based verification and a fully observable event log. The village
is the experimental environment; the control system is the product.

## 2. The core problem

AI agents can make decisions, but decision-making alone does not establish safe
authority. ASTrix separates the causal chain into independently verifiable
stages:

```
DECISION → PROPOSAL → APPROVAL → EXECUTION → VERIFICATION → CONSEQUENCE
   (AI)      (AI)       (HUMAN)     (BUS)       (EVIDENCE)      (WORLD)
```

The thesis: *can an AI govern a complex, changing environment while remaining
observable, verifiable, interruptible, and under meaningful human control?*

## 3. Why MagicBlock matters (concrete, not marketing)

- The persistent world clock lives in a Solana program (`solana/astrix-world`,
  devnet `qWpJE9ePjD8YnzW2AA6UdpFodF7LS7w5Y5CUmHArWK3`): day advances were
  executed through MagicBlock's Ephemeral Rollup and committed back to base
  (measured: ER advance ~960 ms; base reflects committed day — see
  `artifacts/astrix-magicblock-smoke.json` with transaction signatures).
- Governance receipts use canonical command hashes (pinned in tests) with a
  null-adapter journal today; devnet memo round-trip proven.
- MagicBlock does NOT render, decide, or govern. It provides shared fast
  execution + durable witness. Pacing, rules, and authority stay local.

## 4. Human control

HIGH-risk actions (`CLEAR_TERRAIN`, `BUILD_BRIDGE`) cannot execute without a
human resolving a bus-bound approval (exact-impact matching, single-use ids —
18/18 attack probes). Revocation (`loop.stop("authority-revoked")`) parks the
steward mid-gate with zero post-revoke steward mutations while the pending
approval survives for the human (`npm run astrix:revocation-drill` → PASS).

## 5. World autonomy

`npm run astrix:absence-drill` → PASS: steward STOPPED for 3 days with
**0 decisions and 0 actions** (microtask-quiesced measurement), granary
12→0, fields maturing unharvested; on return the steward harvests and
recovers (food 4, population held). A 9-day variant starves the village and
scores FAIL honestly — extinction is defeat, not a technical pass.

## 6. Evidence

| Claim | Proof |
|---|---|
| Long-horizon governance | `artifacts/astrix-canonical-run.json` (31 d, 111 proposals, 110/110 verified) |
| Gate branches | demo scenarios A–D (`artifacts/astrix-demo-scenarios.json`) |
| Absence + recovery | `artifacts/astrix-absence-drill.json` + 4-frame real-state storyboard |
| Revocation | `artifacts/astrix-revocation-drill.json` |
| Authority attacks | 18/18 adversarial probes |
| Chain execution | `artifacts/astrix-magicblock-smoke.json` (sigs, slots, MATCH=true) |
| Chain-driven render | real-snapshot Godot captures |
| Regression | 262/262 tests, clean typecheck |

Run everything: `npm run astrix:demo3` (2 s, deterministic: absence-mini +
reject/approve + chain evidence). Judge recovery from a tx signature alone:
`getTransaction` + `getAccountInfo` on devnet — no trust in our server needed.

## 7. Honest limitations

Undelegate callback deferred (account stays delegated — committable and
base-readable); VRF/environmental randomness deferred; on-chain succession
and session allowlists deferred; payer/funding ops manual (devnet throwaway
keypair). These are scoped-out next steps, not hidden gaps — the submission
proves what it claims and labels the rest.
