# ASTRIX_MAGICBLOCK_ARCHITECTURE.md

> **Status:** DESIGN ONLY, against baseline `797f4b3`
> (`chore(astrix): harden trust boundaries before magicblock`).
> No code modified, nothing installed, no adapter created, no SDK added.
> Every claim about MagicBlock cites current official documentation
> (docs.magicblock.gg, fee schedule checked against source 2026-08-20).
> Every claim about ASTrix was re-traced in source for this document.
>
> > Freeze amendment: §40 re-examined the settlement *venue* (MagicBlock ER
> > vs ordinary Solana) and concluded the receipt role stands but ordinary
> > Solana is the correct implementation — see §41 for the frozen decision.
> > §§26–34 (real-time game research) are classified FUTURE RESEARCH.

---

## 1. Executive conclusion

MagicBlock is justified for exactly one narrow role: **external settlement of
governance receipts for human-authorized irreversible actions** (today:
`BUILD_BRIDGE`, `CLEAR_TERRAIN`), committed asynchronously after Core
verification, readable by any third party through stock Solana RPC without
trusting our server. A real-time simulation role was investigated seriously
(§§26–34) and rejected: ASTrix's liveness bottleneck is deliberate
authoritative pacing, not execution throughput, so an execution substrate
would add dependence without benefit.

It is NOT justified as execution boundary, world authority, notary-without-
execution, randomness source, privacy layer, or anything touching the
simulation loop. The recommended design adds one small ASTrix Solana program
(receipt registry), one infrastructure adapter outside Core, and zero Core
imports — and the demo's sharpest honest hook is structural, not anecdotal:
all evidence ASTrix serves lives inside the operator's trust domain, while a
base-layer commitment lives outside it. (Our 500-entry event ring truncating
a 928-event run is supporting evidence for why external permanence is useful —
it is not itself the fundamental reason.)

**Final decision: MAGICBLOCK IS JUSTIFIED** — for receipt settlement only
(see §39 for the exact property, responsibilities, and minimal scope).

---

## 2. Current ASTrix architecture (re-traced at 797f4b3)

Authoritative state: `AstrixWorldState` (`src/astrix/state.ts:177`); sole
mutation boundary: `AstrixGameCommandBus.execute()` with six commands, two of
them HIGH-risk and approval-gated in the bus itself (`CLEAR_TERRAIN`,
`BUILD_BRIDGE`; `commandBus.ts:103-114`). Steward proposes JSON only, approval
ids stripped from its args (`orchestrator.ts:128,732`). Verification
(`checkVerification`, `:669`) is evidence-based per tool against before/after
snapshots. Events: 22-type ring buffer (`events.ts`). TrueForge is an optional
`StewardDecisionProvider` adapter; Core imports only intra-Core/`node:`/`zod`
and runs fully without it. Godot renders snapshots, commits nothing locally.

Traced example — approved `BUILD_BRIDGE(meadow→dusk)` (verified against
`orchestrator.ts:567-635`, `commandBus.ts:261-276`, `events.ts`):

```
decide() → ACTION_PROPOSED → ACTION_EXECUTING
  → bus raises gate, zero mutation → APPROVAL_REQUIRED {approval{ id,
     command, impact{ islandA, islandB, cost, bridgePosition,
     resultingTopology, unlocks } } }
  → human approves exact impact → APPROVAL_GRANTED
  → bus replays stored command (approvalMatchesCommand) → bridgeId minted,
     cost deducted, topology mutated → ACTION_SUCCEEDED
  → VERIFICATION_STARTED → bridgeId exists in bridges[]
  → VERIFICATION_SUCCEEDED → TURN_COMPLETED
```

Rejection ends the chain at `APPROVAL_REJECTED` with a byte-identical world;
the rejected site is never re-proposed blindly (adaptation is structural).
Receipt inputs available after `VERIFICATION_SUCCEEDED`: the stored approval
(`commandBus.ts`), the action record (id, turn, agent, tool, sanitized args,
states), the bus result (`bridgeId`, derived `position`, `costDeducted`), and
before/after snapshots.

---

## 3. Current MagicBlock capabilities (official docs)

Primary authority: docs.magicblock.gg (fee page values checked against source
2026-08-20). All URLs below are that domain.

- **What an ER is.** An auxiliary SVM runtime: programs live on base-layer
  Solana; state accounts are delegated to it via the Delegation Program
  (`DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`, Halborn-audited —
  `/pages/overview/additional-information/security-and-audits.md`). Lifecycle:
  delegate (base tx) → execute on ER (~10 ms slots, 0 fee in the current
  release) → commit (periodic/on-demand) → undelegate (commits, returns
  ownership, base-layer callback CPI). (`/pages/ephemeral-rollups-ers/
  introduction/ephemeral-rollup.md`, `/pages/get-started/introduction/
  ephemeral-rollup.md`)
- **What "commit" guarantees.** The operator commits account state to base;
  finalization uses a fraud-proof mechanism through a decentralized Security
  Committee (whitepaper arxiv.org/abs/2311.02650, via docs). Commits can cover
  multiple accounts **atomically** (`MagicIntentBundleBuilder`). Base-layer
  readers use stock Solana RPC (`getAccountInfo`, `getTransaction`,
  `getSignatureStatuses`) — verifying committed state requires no MagicBlock
  trust.
- **What it costs** (`/pages/ephemeral-rollups-ers/introduction/
  fees-and-commit-economics.md`): one delegation session 300,000 lamports
  (0.0003 SOL); commits after the first 100,000 lamports (0.0001 SOL) each,
  settled from the deposit at undelegate; ≤10 commits per session without a
  delegated fee payer. ASTrix HIGH actions are rare (canonical: 5 per 31-day
  run) — settlement costs are negligible and need no fee-payer path in v1.
- **Limits** (`.../introduction/runtime-limits.md`): same SVM rules as base
  (10 MiB accounts — a ~400-byte receipt fits trivially); ER transactions up
  to 64 KB.
- **Available now:** free devnet routers/validators (US/EU/Asia), Anchor +
  native-Rust SDKs, Magic Router, Magic Actions (post-commit base hooks),
  Cranks, session keys, VRF, Private ERs (Intel TDX).
- **Evaluated and rejected for ASTrix:** VRF (Core has no RNG and needs none);
  Private ERs (approvals are public by design — secrecy would *weaken*
  observability); Cranks (the world clock is Core-owned by policy);
  Ephemeral SPL tokens / payments / swaps (no economy exists); session keys
  (no player wallets exist).

The single most design-relevant fact: **MagicBlock does not notarize arbitrary
JSON.** Anything independently readable on base layer must be written there by
*our own Solana program* into *our own PDAs*. Attestation therefore always
passes through program execution — there is no notary-without-execution.

---

## 4. Why MagicBlock is or is not necessary

Central question: *what does MagicBlock prove that ASTrix Core alone cannot
prove?*

Core alone proves, to anyone who trusts our server: proposals, approvals,
executions, verifications, order, adaptation (canonical + demo artifacts,
18/18 attack probes). What it cannot provide is **operator-independent
permanence and readability**. The fundamental property is the trust domain:
every byte of evidence ASTrix serves is served by the party being evaluated —
our snapshots live in our process memory. A normal database fixes nothing —
it is another server we operate, in the same trust domain. (Supporting
evidence: our event ring truncates at 500 while the canonical run emits 928 —
the first ~430 are *gone* by default. That anecdote illustrates the need; the
trust domain *is* the need.)

What base-layer Solana adds, precisely: public reads that do not depend on us
(stock RPC), tamper-evident append-only history (hash-chained ledger +
validator signatures), operator-independent ordering/timestamps (slots), and
fraud-proof-backed commits. The trust delta is exactly: **an authorization
trail nobody, including us, can truncate or unsay — with each receipt
independently checkable against artifacts, so reliance on our word shrinks to
the one link no ledger can witness: that a human finger clicked.** (The chain
preserves and exposes what ASTrix *claims* resulted from a human approval; it
does not prove the click. §11, §16.)

Anything vaguer than that ("on-chain game", "blockchain village") is rejected
below.

---

## 5. Comparison of the four MagicBlock roles

| Dimension | A. Notary | B. Execution boundary | C. Settlement (receipts) | D. World authority |
|---|---|---|---|---|
| Trust added | none beyond C, and impossible as specified — base layer only stores what a program writes, so "pure attestation" collapses into C with extra steps | negative: sim now trusts external liveness per action | operator-independent permanent governance trail | full external verifiability of sim |
| Authority | unchanged | **shared — violates audit law** | Core untouched | **inverted — Core demoted** |
| Verifiability | same as C, less honestly framed | execution provable, at the cost below | receipts + history independently readable | total, at the cost below |
| Latency | async possible | gates every HIGH action on ER/base round-trips | fully async, zero sim impact | every tick/decision coupled to chain |
| Complexity | program + adapter anyway | program + gating + rollback design | program + adapter + journal | rewrite of state/bus/clock/Godot mapping |
| Failure handling | n/a | chain stall **freezes governance** (cf. §18: we already watched a stall kill a village) | queue + retry; sim never waits | chain outage = world outage |
| Replay/idempotency | n/a | must design execution idempotency externally | approvalId-keyed PDAs reject duplicates at the account layer | full distributed-systems redesign |
| Demo clarity | "we wrote JSON to chain" — weak | "watch it wait for blocks" — anti-demo | "the approval you just clicked is now permanently, independently readable" — strong | incomprehensible in demo time |
| Judge comprehension | low (why?) | low (why slower?) | high (one new fact, shown) | ~zero |
| Fit with ASTrix thesis | neutral | contradicts interruptibility | strengthens the human-gate story | replaces the experiment with infrastructure |
| Chain dependence | permanent for reads | permanent for function | **none for function** (reads enhanced) | total |
| Preserves Core | yes | no (gate moves outward) | **yes, zero Core imports** | no |

**Recommendation: C, with A's honesty folded in** — call it what it is
(externally settled governance receipts), never "notarized truth." B is
rejected as a gate (permitted only as a non-blocking witness, which adds
nothing over C — so not built). D is rejected: it trades a proven authority
model for dependence, contradicts the live-failure lesson (§18), and buys no
governance property receipts don't already provide.

---

## 6. Recommended role

**External settlement of governance receipts for human-authorized irreversible
actions, committed asynchronously after Core verification, verified by third
parties through stock Solana RPC.** One small ASTrix Solana program (receipt
registry), one infrastructure adapter outside Core (`src/server/` or
`src/adapters/`, never `src/astrix/`), one receipt PDA per HIGH action,
devnet-first. Everything else stays exactly where it is.

---

## 7. Authority model

```
HUMAN ......... decides: approve / reject a presented impact (and only that)
               authorizes: NOTHING except through the bus-bound approval it resolves
               observes: Observatory, receipts (post-hoc, independently)
               proves: authorship of the decision (server auth story — unchanged)
               CANNOT override: Core validation, verification outcomes, committed history

AI ............ decides: which toolCalls to propose (JSON only)
               authorizes: NOTHING (ids stripped; advisory flags ignored)
               executes: NOTHING
               observes: snapshot copies + own history
               proves: NOTHING about the world
               CANNOT override: risk class, gate, validation, history

ASTRIX CORE ... decides: risk class, validity, verification outcomes
               authorizes: NOTHING without the human (HIGH tools)
               executes: ALL simulation transitions (sole writer)
               observes: its own state
               proves: event chains + snapshots + artifacts (to those who trust the server)
               CANNOT override: a human rejection; committed chain history

COMMANDBUS .... the narrow waist: validates, gates, mutates, emits. No policy beyond its code.

VERIFICATION . decides: VERIFIED / VERIFICATION_FAILED from before/after reality
               (production checkVerification; extended by Fix-4 style reality tests)

MAGICBLOCK .... decides: NOTHING about ASTrix (accepts well-formed receipt writes per its own fees/validity)
               authorizes: NOTHING in ASTrix
               executes: only its own receipt program (records bytes into PDAs)
               observes: submitted receipts
               proves: independent permanence/order/readability of whatever Core committed
               CANNOT override: Core state, approvals, verification, or history-as-simulated

GODOT ......... decides/owns: NOTHING (mirror + forward-only; R3-pinned)
               proves: NOTHING (visualization ≠ authority, unchanged)
```

Laws preserved: AI ≠ authority, proposal ≠ execution, human ≠ AI approval,
execution ≠ verification, visualization ≠ authority. MagicBlock sits
**downstream of verification, upstream of nobody** — it is witnessed *by*,
never waited *on*.

---

## 8. Receipt schema (minimum sufficient)

One receipt per HIGH action that reaches `VERIFICATION_SUCCEEDED`. PDA seeds:
`[b"astrix-receipt", approvalId]` — duplicates fail at the account layer.

| Field | Why | Computed by | Verified by | Forged? | Replay? | Necessary? |
|---|---|---|---|---|---|---|
| `receiptVersion` (u8 = 1) | schema evolution | Core | adapter/program | n/a | n/a | yes |
| `approvalId` (string) | binds the exact gate instance; doubles as PDA seed → on-chain dedup | bus (minted) | program (seed match) | only by compromised server (see §16 limits) | rejected: PDA exists | yes |
| `command` (enum u8) | which of the 2 HIGH commands | bus | anyone vs Core code | — | — | yes |
| `commandHash` (32B) | binds exact canonical params (§7) | Core (node:crypto, already a Core dep) | anyone recomputing §7 | no (collision-resistant) | covered by approvalId | yes |
| `params` (canonical bytes, ≤256B) | makes the hash checkable without our code | Core | anyone | — | — | yes |
| `decision` (u8) | approve (only approved actions settle; rejections settle nothing — absence of receipt IS the rejection record, cross-checked against the ring) | loop outcome | — | — | — | yes |
| `resultEntityId` (string) | binds outcome (bridge-016) | bus result | anyone vs snapshots/artifacts | — | — | yes |
| `prevReceiptHash` (32B, zero for first) | continuity among committed receipts: a verifier walking the chain detects a *break* (missing or corrupted link). A break proves discontinuity — it does NOT prove every event occurred, and it cannot enumerate what an uncommitted event might have been (§26.12C) | Core (journal) | anyone walking the chain | no | reordering/discontinuity detectable; completeness unprovable | yes |
| `runId` + `turn` + `actionId` | scopes approval to one run/turn/action (kills cross-run reuse claims) | loop | — | — | scoped out | yes |
| `chainId` + `programId` | scopes receipt to one ledger/program (no cross-chain ambiguity) | adapter config | — | — | scoped out | yes |
| `decidedAt` (logical: day+turn) | causal position in sim time | Core | — | — | — | yes |
| `txSig` | recorded post-hoc by adapter journal (NOT in the PDA) | adapter | anyone via RPC | — | — | journal-only |

Deliberately EXCLUDED: full `stateHashBefore/After` (§9), wall-clock timestamps
(non-deterministic, prove nothing), steward reasoning text (not evidence),
fee/payer internals (operator detail).

---

## 9. Command canonicalization (proposed spec)

`commandHash = SHA-256(canonical_bytes)` where canonical bytes are:

1. Fixed field order: `command | islandA | islandB | position | radius |
   buildingType | islandId | farmPlotId | cropType | cropId | resourceId |
   resourceType`. Absent fields encode as empty (length-prefixed), never omitted.
2. Strings: UTF-8, exact case as Core enums (`"BUILD_BRIDGE"`, `"meadow"`).
   No alias resolution at hash time (aliases resolve to canonical form first).
3. Numbers: positions quantized to 3 decimals, ASCII decimal, no exponents;
   `radius` likewise.
4. No timestamps, no approval ids, no costs (costs are *derived* from command
   by Core code — hashing them would couple the receipt to balance tuning).
5. Versioned: `commandHash` covers `receiptVersion` domain separation
   (`"astrix-receipt-v1" || canonical_bytes`).

Same logical command ⇒ same hash on any machine (pure function of the
command). Different commands ⇒ different commitments (distinct fields hashed;
SHA-256). Approval ids excluded because the *binding* approvalId→commandHash
is the receipt's own job (§10), and excluding it keeps the hash a pure
function of intent.

---

## 10. State hashing

**Full-world `stateHashBefore/After` are REJECTED for v1** — they prove less
than they appear to: reproducibility requires our exact canonicalizer plus
full-snapshot access (which lives in our memory), so no independent observer
can recompute them; they would invite "the chain verified the world" claims
the design cannot defend. What the receipt *does* bind instead: the exact
command (§9), the gate instance, the outcome entity, and the chain position —
each independently checkable against artifacts any observer already holds
(canonical JSON, demo traces, live snapshots). Revisit only with a published
canonical snapshot spec and two independent implementations.

---

## 11. Human approval binding

Chain of custody (all links exist in current source): agent args are
sanitized → bus mints the approval bound to the exact impact
(`approvalMatchesCommand`, `commandBus.ts:297`) → human sees the same record
the bus will replay (`summarizePendingApproval` renders the stored approval)
→ approve consumes the id (second use: `approval not found`; wrong command:
mismatch, approval stays) → receipt binds `{approvalId, commandHash,
resultEntityId}` → PDA keyed by `approvalId` (on-chain dedup) → hash-chained
to the previous receipt.

Attack cases: forged id (fails: bus mints ids; unknown ids reject — proven
18/18); reused id (consumed on use; PDA re-creation fails); different
command/parameters (exact-impact match fails); duplicate approval (same);
replayed receipt (PDA exists; journal dedups by actionId); stale/cross-run
approval (ids are single-run memory + `runId`/`turn` in receipt; restart wipes
all pending — nothing persists to be replayed); agent-supplied metadata
(stripped pre-execution and pre-display); receipt for a never-existent
approval (possible ONLY from a compromised server — stated limit, §16: the
chain attests what Core *said*, it does not witness the human finger; finger
authenticity remains the server auth story, unchanged and unweakened).

---

## 12. Event-log integration (from actual implementation)

Trigger: `VERIFICATION_SUCCEEDED` **for HIGH-risk tools only** (the event
carries `{actionId, tool}`; the adapter resolves the full record from
`loop.status()`/snapshot — same read path the Observatory uses). Settlement
is AFTER verification, never before: nothing settles for REJECTED, FAILED, or
`VERIFICATION_FAILED` actions, and their *absence* from the receipt chain is
itself checkable against the ring. Flow:

```
VERIFICATION_SUCCEEDED (high) → adapter builds receipt → journal PENDING
  → submit record_receipt → tx confirmed → journal SETTLED {txSig}
  → Observatory resolves txSig → explorer/RPC link
```

No new Core event type in v1: the adapter keeps its own journal (JSONL keyed
by actionId) and serves it from the server layer (`src/server/`, not
`src/astrix/`), so Core stays untouched. A `RECEIPT_SETTLED` Core event is
deferred until the journal proves insufficient.

---

## 13. Async vs synchronous settlement

**Asynchronous — unanimously.** Sync would gate the world clock and the
steward loop on ER/base round-trips, retries, and fee funding: chain latency
inside ordinary simulation with no architectural payoff (receipts are
post-hoc evidence, needed by nobody in real time). Async gives: clock
unaffected; failures retried idempotically off the hot path; full
observability via journal states (`PENDING → SUBMITTED → SETTLED` /
`FAILED_RETRYABLE`); demo reliability (a stalled chain degrades to "receipt
pending," never to a frozen world — cf. §18). Rule: **blockchain latency
never enters the simulation.**

---

## 14. Failure model (Core-wins, stated absolutely)

**Can MagicBlock failure mutate or corrupt simulation state? NO — structurally
impossible:** the adapter holds no state handle (as the steward holds none),
imports nothing from Core, and is never awaited by the loop. Enumerated:
Core-ok/chain-down → journal queues, retries with backoff, sim continues;
chain rejects → journal marks, alert surfaces, sim continues; accepted-then-
crash → boot reconciler replays journal against `getSignaturesForAddress`
(completed ones marked, rest resubmitted — PDA seeds make resubmission safe);
double submit → second fails (PDA exists) or no-ops; local-vs-committed
mismatch → journal flags `MISMATCH`, Core NOT rewritten; approval-exists-
different-claim → impossible without compromised server (then the *server* is
the incident, flagged by any observer comparing receipt to artifact).
**"Core wins" is the policy for every disagreement**, because Core is the
simulated world and the chain is its witness: a witness that overrules its
subject is a second authority, which §5 forbids.

---

## 15. Idempotency / replay model

Three independent layers, any one sufficient: (1) Core consumes approval ids
on use; (2) adapter journal dedups by actionId across restarts; (3) receipt
PDAs keyed by approvalId make on-chain duplicates fail at the account layer.
Receipt resubmission is therefore always safe; chain replays resolve to the
same bytes at the same address. Hash-chaining (`prevReceiptHash`) additionally
establishes *continuity* among committed receipts: a verifier walking the
chain detects a break (a missing or corrupted link). A break proves
discontinuity — it does not prove completeness, and no hash chain can prove
that an uncommitted event never existed.

---

## 16. Threat model (honest limits included)

| Threat | ASTrix prevents | MagicBlock prevents | Outside guarantees |
|---|---|---|---|
| Malicious/careless AI proposing harm | gate + validation + human (proven 18/18) | — | model quality itself |
| Forged/reused/mismatched approval | bus binding + consumption (proven) | on-chain dedup (defense in depth) | — |
| Compromised server fabricating approvals | server auth (R1) — same as today | **nothing: it attests the lie faithfully.** Committed lies are, however, permanent, ordered, and comparable against artifacts — fabrication becomes *detectable*, not *impossible* | finger-to-click authenticity |
| History rewrite / log truncation | — (ring truncates by design) | **yes: committed receipts cannot be un-published or reordered** | — |
| Equivocation across observers | — | **yes: one base state for all readers** | — |
| Repudiation ("we never approved that") | artifacts (server-served) | **yes: independently readable record** | — |
| Godot-side fabrication | R3 (no values to fabricate) | — | — |
| Restart / crash / chain outage | memory-safety (nothing half-authorized persists) | journal + reconciler | live in-flight deliberation |
| Provider timeout (cf. §18) | loop FAILED, clock held, world truthful | — (dead stewards settle nothing — correct) | model latency |

---

## 17. Local settlement adapter boundary

```ts
// Illustrative shape ONLY — not implemented. Lives OUTSIDE src/astrix/.
interface SettlementAdapter {
  readonly id: string;                       // "null" | "magicblock-devnet"
  submit(receipt: GovernanceReceipt): Promise<{ txSig: string }>;
  status(actionId: string): Promise<"PENDING" | "SUBMITTED" | "SETTLED" | "FAILED_RETRYABLE" | "MISMATCH">;
  reconcile(): Promise<ReconcileReport>;     // journal-vs-chain, boot + periodic
}
```

Boundary rules (same shape as the proven TrueForge rule): Core never imports
it; it consumes the event log + status reads; the null implementation
(journal-only, deterministic) keeps tests, canonical runs, and offline dev
identical with and without chain access; the MagicBlock implementation is an
infrastructure adapter holding no state handle and awaited by nothing. Core
files that must remain untouched: `state.ts`, `commandBus.ts`,
`orchestrator.ts`, `events.ts`, `mcpTools.ts` (plus `localRuntime.ts`).

---

## 18. MagicBlock adapter boundary

Adapter owns: receipt canonicalization (§9), submission/funding/retries,
journal persistence + reconciliation, status reads for the Observatory.
Adapter never: validates commands, computes costs, judges approvals, touches
Core state, or blocks the loop. Funding/ops (payer wallet, devnet-vs-mainnet,
program upgrade authority) are deployment concerns, open (§24). Needs one new
thing that exists nowhere today: the ASTrix receipt program (Anchor,
`record_receipt` writing the §8 PDA, Halborn-audited Delegation Program CPI
for delegate/commit/undelegate around it).

---

## 19. On-chain / off-chain boundary

KEEP LOCAL: reasoning, ticks, crop growth, consumption, rendering, atmosphere,
all low-risk commands, full snapshots, steward memory, deliberation text.
EXTERNALIZE: only the §8 receipt bytes for VERIFIED HIGH actions (canonical
rate: ~5 per 31-day run; fee-trivial per §3). Smallest meaningful subset =
approved-then-verified `BUILD_BRIDGE` + `CLEAR_TERRAIN` receipts. Nothing else
goes on-chain: no world state, no crops, no villagers, no ticks, no
low-risk traffic.

---

## 20. Minimal vertical slice

On devnet, one HIGH action end-to-end: steward proposes `BUILD_BRIDGE`
→ human approves the exact impact → Core executes (bridgeId minted) →
production verification passes → adapter builds the §8 receipt → null-adapter
shadows it in tests while the MagicBlock adapter submits `record_receipt` →
commit → adapter journals `{txSig}` → Observatory shows, for that bridge:
`PROPOSED → APPROVED → EXECUTED → VERIFIED → SETTLED {base64 tx link}` with
the receipt independently readable via stock `getAccountInfo`. Success
criterion: a judge, given only the tx signature, recovers approvalId,
commandHash, params, and entity id — and matches them to the local artifact
without our help.

---

## 21. Observatory information architecture (no redesign)

Append one terminal stage to the existing causal chain, using Solana's own
vocabulary so words mean what the chain means: `PROPOSED → APPROVED →
EXECUTED → VERIFIED → SUBMITTED (tx seen) → CONFIRMED → FINALIZED`. Display
rules: never show "settled" before base confirmation; never show "verified"
for the chain step (the chain attests, Core verifies — different verbs on
purpose); pending/failed-settlement states render as their own honest pills
(`receipt pending`, `settlement failed — retrying`), never as world states.

---

## 22. Judge-facing explanation (skeptical-judge script)

- *What does MagicBlock add?* A permanent, operator-independent record of
  exactly which irreversible actions ASTrix claims a human authorized — served
  from outside the operator's trust domain. (Supporting scale: our own log
  truncates at 500 entries; the canonical run alone emits 928.)
- *Why not a database?* A database is another server we run. Solana reads
  don't need us: different trust domain, tamper-evident, permanent.
- *What becomes independently verifiable?* The binding of approval, exact
  command, and outcome for every HIGH action — checkable against artifacts by
  anyone with an RPC endpoint. (What it does *not* verify: that a human
  finger clicked. The receipt preserves and exposes our claim; our approval
  mechanism establishes it.)
- *Why is this for AI agents?* The whole experiment is whether an agent can
  be given power without being given authority. The receipt is the physical
  artifact of that distinction: proposals are the agent's, approvals are the
  human's, and now the difference is carved outside our box.
- *Can the AI bypass the human / rewrite history?* No: gate is structural
  (proven 18/18); committed history is append-only and hash-chained.
- *Can the server fabricate success?* It can commit a lie but cannot make it
  consistent with artifacts — and can never unsay it. (Stated limit, §16.)
- *Does it work if MagicBlock disappears?* Fully: settlement is async and
  awaited by nothing; the null adapter keeps every test green offline.
- *Does the demo make sense without blockchain?* Yes — that is required.
- *The one moment it becomes necessary:* the human clicks APPROVE on the
  bridge, and seconds later the authorization exists somewhere no restart,
  no truncation, and no operator can erase.

---

## 23. Implementation phases (AFTER approval — not started)

- **Phase 1:** receipt schema + canonicalization spec frozen; null adapter +
  journal; `GET /astrix/receipts` (server layer).
- **Phase 2:** receipt generation on `VERIFICATION_SUCCEEDED` (HIGH only);
  Observability of journal states.
- **Phase 3:** ASTrix receipt program (Anchor) + devnet deploy; adapter
  submission/reconcile paths.
- **Phase 4:** failure-injection tests (chain down/reject/crash-mid-flight/
  double-submit/mismatch); R4 source tests (no chain imports in Core).
- **Phase 5:** Observatory settled-link display (info architecture §21).
- **Phase 6:** judge walkthrough on devnet; fee accounting note.
- **Untouched throughout:** `state.ts`, `commandBus.ts`, `orchestrator.ts`,
  `events.ts`, `mcpTools.ts`, `localRuntime.ts`, Godot world.

---

## 24. Open questions

1. Devnet vs mainnet for the demo (devnet free + resettable; mainnet permanent + needs funded payer).
2. Payer wallet ownership/funding and per-session spending caps.
3. Receipt program upgrade authority (multisig? immutable after audit?).
4. `runId` scheme across restarts (UUID per boot + monotonic turn/action counters — sufficient?).
5. Whether rejections should settle *absence proofs* (recommended no: absence is checkable against the ring + journal; settling every rejection doubles cost for negative evidence).
6. Commit cadence: per-receipt session (simplest, ~0.0004 SOL each) vs long-lived log PDA (fee-payer path after 10 commits).
7. Exact Observatory query path for journal + chain status.

---

## 25. Explicit non-goals

No world state on-chain. No ER execution of simulation. No VRF, PER/TEE,
Cranks, tokens, wallets, payments, or player accounts. No steward reasoning on
chain. No `stateHash` world commitments in v1. No sync settlement. No Core
imports of any chain SDK. No Godot wallet flows. No mainnet anything before
the devnet slice is judged.

---

## FINAL DECISION (superseded — see §39)

**MAGICBLOCK IS JUSTIFIED** — Sections §§1–25 above stand except where §§26–38
correct them (approval-proof language in §§1/4/22, hash-chain completeness in
§§8/15). The re-examination below re-derives the verdict from the execution
side instead of assuming it.

- **Exact property added:** operator-independent permanence, ordering, and
  readability of the human-authorization trail for irreversible actions —
  surviving restarts, log truncation, and distrust of our server.
- **Responsibility MagicBlock owns:** durable, tamper-evident, publicly
  readable storage of governance receipts written by our program; nothing else.
- **Responsibility Core retains:** everything that decides, authorizes,
  executes, or verifies — simulation authority never leaves the process.
- **Smallest viable integration:** receipt program + async adapter + journal +
  one settled bridge on devnet, with the null adapter keeping all 247 tests
  green offline.
- **Why it strengthens rather than distracts:** it carves the experiment's
  central distinction — agent proposals vs human authority — into a ledger
  neither party controls, without moving, slowing, gating, or risking any of
  it. ASTrix remains an AI-governance laboratory that *uses* a blockchain the
  way a laboratory uses a notary's seal: to make one critical fact
  independently checkable, and nothing more.

---

## 26. Re-examination: could MagicBlock execute the simulation?

This section re-derives the verdict from the execution side, taking the
official game architecture as primary source (docs.magicblock.gg:
`/pages/get-started/use-cases/games.md` incl. the Generals reference game,
github.com/magicblock-labs/solana-generals; Cranks
`/pages/tools/crank/introduction.md`; Magic Router; FAQ; fee/runtime pages
cited in §3).

How Generals actually works: game account created **on Solana first**, then
**delegated**; all game transactions go to the **ER RPC**; the frontend
**listens to ER state** (`gameListen.ts`) and re-renders on every change;
moves submit **directly to the ER** (`gameSystemCommand.ts`); base layer holds
programs, discovery (game list), and final/partial settlement. FAQ constraints
that bind any design: delegated accounts must pre-exist on Solana (cloned to
ER on first use); **programs are never delegated** (cloned + subscribed);
every Solana account is readable on ER; **slot times are NOT guaranteed timing**
(10 ms ER / 400 ms Solana as of 2026-08-05) — logic must never depend on slot
duration. Cranks are scheduled instruction execution via CPI to MagicBlock's
scheduling program, running inside ER consensus; documented uses include
"refresh game state" and "automated game progression."

Roles re-evaluated (B = fast execution env, C = receipts [§§1–25], D = world
authority, E = B+C hybrid):
- **B alone:** coherent to build, valueless here (§27 proves it). If ordinary
  Solana sufficed for anything proposed, that would win on simplicity — but
  nothing proposed needs even ordinary Solana *execution*: Core executes for
  free already.
- **D:** rejected (§5 stands, deepened in §29).
- **E (hybrid: ER fast mirror + receipts):** the only combination worth a
  hearing. Verdict: **rejected for now, preserved as a sketched option.**
  An ER mirror of simulation state cannot outrun Core's authoritative clock
  without forking truth; if Core wins every divergence (and it must, §14),
  the mirror is a lagging copy with extra steps — dependence + cost +
  boundary-erosion risk in exchange for milliseconds off a 120-second day.
  It becomes worth revisiting only if ALL three hold: (1) product direction
  demands sub-minute world pacing, (2) third parties must read/compose that
  fast state operator-independently, (3) the crank-safety rule (§31) governs
  every automated transition. None hold today.
- **F (something else — evaluated):** VRF/PER/session-keys/tokens (no RNG,
  secrecy, wallets, or economy exist); Magic Actions as settlement hooks
  (valid Phase-7 extension, not v1); Cranks as proposers (see §31 — lawful
  but pointless while Core ticks for free).

---

## 27. The crop-growth question

Could a delegated account make crops progress "really fast," event-driven,
instead of Core counting days? Technically yes: a crop PDA + crank-scheduled
`advance_growth` instruction would tick growth at ER speed, and a subscribed
frontend would observe every transition. What that actually buys is then
measured against what limits liveness today:

- Core's tick costs nothing; a 120 s day is **policy** (managed clock), not a
  performance ceiling. Ten-second days are a config change, not an integration.
- Godot polls snapshots at 2 Hz and renders at 60 fps with eased growth
  transitions. ER-side speed shaves milliseconds off a 120,000 ms day —
  human-imperceptible by construction.
- The binding constraint is governance, not throughput: growth halts in
  winter, consumption starves villagers, harvest needs maturity — all
  authority rules. Moving the counter while Core owns the rules forks truth;
  moving the rules erodes the boundary the audit proved.

Crop growth therefore belongs **local-only** (§30). The hybrid that "makes
sense" (ER mirror + Core authority) is exactly the architecture that cannot
outperform a config flag while adding liveness dependence — rejected without
prejudice to a future product direction that changes the pacing requirement.

---

## 28. WHAT MAGICBLOCK ACTUALLY MAKES FASTER

Mandatory separation. MagicBlock improves **1–5** and does **not** improve
**6–9**:

1. **Transaction execution** — yes: ~10 ms ER slots vs ~400 ms base slots.
2. **State transitions** — yes, inside delegated accounts, at ER speed.
3. **Network/state latency** — yes, via Magic Router single-endpoint routing
   and ER websocket subscriptions (the Generals `gameListen` pattern).
4. **State propagation** — yes: push-on-change instead of poll.
5. **Frontend responsiveness to state** — yes: UI updates arrive in
   milliseconds rather than on the next poll.
6. **GPU rendering** — NO. Nothing in the docs touches rasterization.
7. **Mesh generation** — NO.
8. **Animation** — NO.
9. **Godot frame rate** — NO.

Why 1–5 could still make a world *feel* dramatically more alive — in a game
whose pacing needs it: Generals-style play (moves, counters, prices) lives or
dies on 1–5 because its state changes at human-interaction speed. ASTrix's
state changes at *policy* speed (days are two minutes by design; crops mature
over a quarter hour). Responsiveness faster than the pacing is unobservable.
ER speed matters the day ASTrix's authoritative clock runs at interaction
speed; until then it is a faster engine bolted to a deliberately slow clock.

---

## 29. Authority models if MagicBlock executed simulation state

- **Model A (Core authority, ER accelerated replica):** smallest change,
  preserves every trust guarantee — and collapses under its own premise. A
  replica must not diverge; therefore it must not advance without Core; therefore
  it adds Core's latency floor plus its own. On divergence Core wins, the ER
  copy is discarded work. Failure table: ER unavailable → mirror stale, sim
  fine (why pay for it?); failed tx → retry or drop, sim fine; commit fails →
  mirror resyncs from Core; restart → mirror re-clones; replay → ER-side
  idempotency required (new design burden); stale frontend → possible *only*
  through the mirror (a new staleness vector Core polling does not have).
- **Model B (ER authoritative runtime, Solana settlement):** the Generals
  model applied to ASTrix. Requires migrating growth/consumption/season rules
  into program instructions, crank-scheduling them, and re-verifying from the
  outside. Fails the live-incident test: chain stall would freeze *truth*,
  not just evidence; every guarantee in §§7/14 inverts. Rejected.
- **Model C (anything else):** no third model preserves the audit laws with
  less machinery than A while delivering more than A — which delivers nothing.
  None adopted.

---

## 30. State classification: what lives where

| Category | Examples | Authority | Update freq | Latency-sensitive? | Persistence | Adds value on ER/Solana? | Home |
|---|---|---|---|---|---|---|---|
| World governance | population, food totals, approvals, verification outcomes, event history | Core | per action/day | no (policy-paced) | ring (truncated by design) | receipts only (§§8–19) | LOCAL + receipts |
| Simulation | crop growthStage, day/season clock, consumption, biome health | Core | per tick/action | no (120 s days) | snapshot memory + artifacts | no (§27) | LOCAL ONLY |
| Presentation | villager animation, smoke, water, banners, growth easing | nobody (weather) | per frame | yes — served locally at 60 fps | none | no | GODOT ONLY |
| Persistent proof | governance receipts, approval binding | Core mints; chain stores | per HIGH action (~5/31 d) | no (post-hoc) | permanent, operator-independent | **yes — the one justified use** | SOLANA (+ journal) |
| Identity/session | runId, payer, program config | operator/adapter | per session | no | deployment-scoped | n/a (ops, not sim) | OPERATOR |

Rule of thumb for every future proposal: *ER execution is justified only for
state that is simultaneously high-frequency, latency-sensitive, and required
readable outside the operator's domain.* No ASTrix simulation state meets all
three today.

---

## 31. Cranks: the exact safety rule

Cranks (CPI-scheduled, ER-consensus execution; documented for "automated game
progression") *could* lawfully automate ASTrix recurrences — crop growth,
consumption, day transitions — **if and only if** all of the following hold,
which is why they remain deferred, not forbidden:

1. The transition is **already authorized** by standing simulation rules
   (growth-given-season is authorized the way gravity is authorized — no
   proposal, no gate, no decision).
2. Nothing gated ever moves by crank: no HIGH tool, no approval, no spend,
   no topology change can be crank-reachable. Crank instruction surface must
   exclude them by construction, not by convention.
3. Crank output is **re-verified by Core before acceptance** (crank as
   proposer with a fast hand, never decider) — same `checkVerification`
   discipline, extended domain.
4. Slot time is never the clock (docs forbid depending on slot duration):
   crank intervals reference Core's logical day/turn, reconciled on commit.
5. A stalled/dead crank degrades to "growth paused," logged and visible —
   never to fabricated progress.

Today this buys nothing (Core ticks for free), so no crank is proposed. The
rule exists so a future fast-pacing direction cannot smuggle automation past
the gate.

---

## 32. Godot subscription mapping (read-only, realistic)

Generals proves the pattern: frontend subscribes to ER state over the
SVM-compliant websocket RPC and re-renders on notification. Mapped onto
ASTrix *if* a fast mirror ever exists: ER `accountSubscribe` → a new
Observatory adapter (sibling of `GameClient`, same forward-only law) →
`WorldState.apply_snapshot`-shaped updates → existing materialization. Godot
stays non-authoritative by the same mechanism as today (no local commit path;
R3-pinned), with one new rule the adapter would enforce: **ER-sourced values
are display hints until confirmed against a Core snapshot** — the mirror can
lag or fork, and the Observatory must render the fork as stale, never as
truth. No change proposed now; the 2 Hz poll already outruns the 120 s clock
by 240×.

---

## 33. Worked example: a crop under the adopted architecture

Plant (`low-risk`, local): steward proposes → Core validates plot capacity →
executes → verifies (`cropId` exists) → event. Growth (local ticks, policy
paced): each day Core advances `growthStage`, winter halts it — no chain
contact at any point. Godot polls, eases the row taller, turns it gold at
1.0. Harvest (low-risk, local): maturity checked, food credited, verified by
before/after delta. The ER appears nowhere in this trace and nothing is lost:
every transition is authority-cheap, policy-paced, and fully evidenced
locally. *Under the rejected hybrid*, the same trace would add: delegate crop
PDA → crank ticks → commit → Corners: winter rule duplicated on-chain, fee
payer funded, stale-mirror handling in Godot — six new failure modes to make
seedlings grow at a speed nobody asked for.

---

## 34. Receipts + substrate: how the two relate

Adopted: receipts only (§§8–19). Deferred-but-sketched: an ER fast mirror
governed by §§29–31. Relation if both ever exist: the ER is *mutable fast
scratch* (sessions open/close; state ultimately re-anchored to Core truth),
Solana receipts are *immutable slow proof* (governance trail only), Core is
the *only decider*. The two never reference each other: receipts bind Core
events, never ER state; the mirror never settles governance. Trust boundaries
stay clean precisely because the fast thing proves nothing and the proving
thing moves slowly.

---

## 35. Glossary (MagicBlock ≠ Solana)

- **ASTrix** — this system: Node/TS simulation + steward loop + Godot
  Observatory. Owns all authority.
- **Solana program (ours)** — the future receipt-registry program WE write
  and deploy. The only new authority-adjacent code, and it holds no
  simulation authority.
- **MagicBlock ER** — the auxiliary validator runtime executing delegated
  accounts at ~10 ms slots. A venue, not a verdict.
- **Solana base layer** — L1 ledger: programs live here, commits land here,
  judges read here with stock RPC. This (not "MagicBlock" vaguely) is what
  provides permanence.
- **Godot** — read-only visualization of Core snapshots (today) and, only in
  the deferred sketch, of ER hints explicitly marked stale-until-confirmed.

---

## 36. Revised architecture (receipts adopted; simulation sketch rejected)

```
                     HUMAN (approves exact impacts, nothing else)
                       │
                       ▼
                ASTrix GOVERNANCE (risk class, proposals, adaptation)
                       │
                       ▼
                 COMMAND BUS (validates → gates → mutates → emits)
                       │
          ┌────────────┴────────────┐
          │                         │
          ▼                         ▼
   CORE SIMULATION            HIGH-RISK ACTION
   (ticks, growth,             │
    consumption —               ▼
    LOCAL ONLY)           APPROVAL GATE (human)
                               │
                               ▼
                      EXECUTE (Core, sole writer)
                               │
                               ▼
                      VERIFICATION (before/after reality)
                               │
                    ┌──────────┴──────────┐
                    │                     │
                    ▼                     ▼
              GODOT (renders        RECEIPT → journal →
              snapshots)            async submit → Solana
                                    base (independently readable)

   DEFERRED SKETCH (not adopted): ER fast mirror + crank-scheduled
   already-authorized transitions, Core-wins on divergence, §31 rules.
```

---

## 37. Decision criteria — explicit answers

1. *Capability ordinary Solana lacks?* For receipts: MagicBlock adds ER-speed
   submission plumbing, but the permanence comes from Solana base. Used
   honestly: MagicBlock SDKs for delegate/commit flows on devnet; verified via
   stock Solana RPC (no MagicBlock trust needed to read).
2. *Meaningful value for real-time simulation?* No — proven in §27/§28.
3. *Selected state legitimately in ER?* Technically yes, valuably no.
4. *Crop growth benefit?* No (§27).
5. *Cranks without compromising control?* Yes, under the §31 rule — deferred
   as valueless today, not forbidden.
6. *Godot consumes without authority?* Yes (§32), unchanged law.
7. *Responsiveness over rendering?* Yes in general (§28), unneeded at our pace.
8. *Complexity justified?* For receipts: yes (one program + adapter + journal).
   For simulation: no.
9. *Receipts / simulation / both / neither?* **Receipts only** (with the
   simulation sketch preserved in §§29–31 for a future pacing direction).
10. *Smallest meaningful integration proving real value?* One settled bridge
    receipt on devnet, recovered by a judge from the tx signature alone (§20).

---

## 38. End deliverables

1. **Final diagram:** §36. 2. **State ownership:** §30. 3. **MagicBlock
   responsibility:** ER venue + delegation/commit plumbing; proves nothing
   about ASTrix by itself. 4. **Solana responsibility:** permanent,
   independently readable receipt storage. 5. **Core responsibility:**
   everything that decides/authorizes/executes/verifies. 6. **Godot
   responsibility:** render snapshots (and, deferred, ER hints marked stale).
7. **Minimal slice:** §20. 8. **Proven:** approval→command→outcome binding,
   permanently, operator-independently, per HIGH action. 9. **NOT proven:**
   the human finger (§16 limit), completeness of history beyond committed
   continuity, anything about simulation correctness beyond what Core already
   proves. 10. **Decision:** §39.

---

## 39. FINAL DECISION (superseded — see §41)

> The verdict below was the receipt-settlement conclusion under the assumption
> that MagicBlock's ER stack was the natural settlement venue. §40 re-asked
> "why MagicBlock *specifically*" against ordinary Solana and changed the
> venue while keeping the role. Preserved verbatim as the decision record.

The re-examination changed the *reasoning* (execution investigated seriously
and rejected on evidence, not assumed away) and corrected four weak claims
(approval-proof language, ring-buffer-as-fundamental-reason, hash-chain
completeness, MagicBlock/Solana conflation) — but the verdict stands,
narrower and harder to dispute. Proceed to receipt-schema freeze and null
adapter (Phase 1) on explicit approval. Nothing else is authorized.

---

## 40. FREEZE INVESTIGATION: why MagicBlock specifically?

Question: if the mechanism is ASTrix → Solana transaction → our program →
PDA receipt, what does MagicBlock add? Answer, after re-checking current
official docs (ER lifecycle, delegation/commit/undelegate, Magic Router,
Ephemeral Accounts, fee schedule, FAQ): **for the receipt architecture,
nothing load-bearing.** The honest three-way comparison:

| Question | A. Ordinary Solana | B. MagicBlock ER + commit | C. Appropriate mechanism |
|---|---|---|---|
| What does it prove? | receipt bytes exist at a program address, ordered in slots | same bytes, plus an ER execution trail nobody needs | A proves everything the receipt claims |
| What does it persist? | PDA data permanently on L1 | same PDA data (ER state is transient by design) | A, with fewer moving parts |
| Trust assumptions | L1 validators only | L1 validators **plus** ER operator, delegation program, Security-Committee finality | A is strictly leaner |
| Latency to finality | base confirmation (~seconds) | commit cadence + fraud-proof finalization on top — longer | A is faster to *final* |
| Cost per receipt (~400 B, ~5/31 d) | ~5,000 lamports base fee + one-time rent | session 300,000 + 100,000/commit after first — ~80× more per receipt; breakeven vs base never occurs at this rate | A, by two orders of magnitude |
| Complexity | @solana/web3.js submit to our program | + delegation lifecycle, validator selection, fee vaults, commit scheduling, undelegate callbacks | A |
| If external infra disappears | Solana outage (whole ecosystem down — receipts queue like any outage) | ER operator outage stalls commits while base works fine — strictly more fragile | A |
| Judge recovery from tx/receipt alone | full receipt via stock `getAccountInfo`/`getTransaction` | identical bytes, harder path | A |
| Uniquely provided by MagicBlock? | — | 10 ms slots, gasless ER txs, 64 KB txs, subscriptions, cranks — **none of which a ~400-byte async quarterly receipt can use** | none for receipts |

Rejected alternatives, seriously considered: **Ephemeral Accounts** (ER-only,
never commit — anti-fit for permanent receipts); **delegation-as-locking**
(our program's instruction logic already restricts writes; delegation adds a
trusted operator, not integrity); **Covenant-style attested metering**
(stake + slashing + TEE provenance roots — solves accountability-via-
economics, a different problem; ASTrix has no stake, no slashing, no TEE
need); **Magic Actions / Cranks for settlement** (nothing is scheduled: HIGH
actions are rare, human-paced events); **Magic Router as justification**
(convenient transport, not a capability — using it changes no trust property).

The precise sentence (§4 mandate): *MagicBlock's ER stack offers ASTrix's
receipt architecture no capability ordinary Solana lacks — at ~5 async
receipts per month, direct base-layer writes are cheaper, faster to finality,
simpler, and leaner in trust assumptions; ER speed, subscriptions, and cranks
apply to high-frequency interactive state, which receipts are not.* There is
therefore no sufficiently strong answer — and per the mandate, none is
forced. **The venue changes to ordinary Solana; the role (receipt settlement)
is unchanged.** MagicBlock remains the designated answer for the deferred
fast-simulation direction (§§26–34, classified FUTURE RESEARCH — including
the standing distinction that fast state execution ≠ fast GPU rendering, and
that pacing, not throughput, is ASTrix's liveness bottleneck).

Corrections applied by this freeze (no other sections change meaning):
- "Verify the human gate without trusting our box" is withdrawn as a slogan;
  the frozen claim is §7's: the commitment preserves and exposes what ASTrix
  claims resulted from human authorization. The chain never witnessed the click.
- The 500-entry ring remains supporting evidence only; the fundamental reason
  is the operator trust domain (§8, unchanged).
- Hash-chain wording (§§8/15) stands: continuity with break-detection, never
  completeness.
- Vocabulary: *Solana program* (ours), *Solana base layer* (permanence),
  *MagicBlock ER* (deferred fast venue), *ASTrix* (all authority), *Godot*
  (observation only). "MagicBlock" never used where "Solana" is meant.

Authority (§10), failure semantics (§11: Core-wins; settlement down →
queue/retry, sim continues; disagreement → flag, never rewrite Core),
minimal slice (§12), and judge test (§13) all stand with "Solana base layer"
as the settlement venue. The §14 diagram is superseded by §41's.

---

## 41. FINAL DECISION: **MAGICBLOCK IS NOT NECESSARY FOR THE CURRENT RECEIPT ARCHITECTURE**

1. **Why:** the receipt is a rare (~400 B, async, post-verification) durable
   write with public reads. Ordinary Solana provides every required property
   — permanence, independent readability, ordering, tamper-evidence — more
   cheaply (~5k vs ~400k lamports), faster to finality, more simply, and with
   strictly fewer trust assumptions than routing through an ER session.
   Nothing in the ER stack (speed, subscriptions, cranks, gasless txs,
   64 KB transactions) is usable by this workload. Adopting it would be
   MagicBlock theater.
2. **What MagicBlock uniquely contributes:** nothing to the current receipt
   architecture. It remains the designated venue for the deferred
   fast-simulation direction only.
3. **What Solana contributes:** durable, tamper-evident, publicly readable
   receipt storage + ordering + the program-execution layer for the receipt
   registry.
4. **What ASTrix contributes:** everything that decides, authorizes,
   executes, and verifies — unchanged, plus receipt canonicalization (§9).
5. **What Godot contributes:** observation and rendering only — unchanged.
6. **What is proven:** per-HIGH-action binding of approval, exact command,
   and outcome, permanently and operator-independently readable; continuity
   among committed receipts with detectable breaks.
7. **What is not proven:** the human finger (§16 limit); completeness beyond
   committed continuity; anything about simulation correctness beyond Core's
   own evidence.
8. **First implementation slice will demonstrate:** one settled bridge
   receipt via direct base-layer `record_receipt`, recovered by a judge from
   the tx signature alone and matched to the local artifact — with MagicBlock
   SDKs absent from the dependency tree as a checkable fact.
9. **What remains future work:** devnet/mainnet choice, payer funding,
   program upgrade authority (§24); the entire ER fast-simulation sketch
   (§§26–34) pending a product direction that needs sub-minute pacing with
   third-party observers.
