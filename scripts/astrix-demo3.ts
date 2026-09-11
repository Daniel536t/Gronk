// ASTrix 3-minute submission demo — one deterministic executable slice.
//
// PROOF A (world doesn't belong to the AI): compressed absence drill against
//   REAL Core — steward online, stopped, world ticks alone, steward returns,
//   recovery scored mechanically.
// PROOF B (AI has no unrestricted authority): scripted HIGH proposals against
//   REAL Core — one rejected (zero mutation), one approved (executed once +
//   verified).
// PROOF C (MagicBlock substrate): pre-verified devnet evidence, read from the
//   artifact and re-verifiable live via stock RPC (no new transactions).
//
// Deterministic, no network calls, no LLM. Target runtime: well under 3 min.
// Usage: npm run astrix:demo3
import { readFileSync } from "node:fs";
import { AstrixWorldState, DAY_SECONDS } from "../src/astrix/state";
import { AstrixGameCommandBus } from "../src/astrix/commandBus";
import { createAstrixToolRegistry } from "../src/astrix/mcpTools";
import { AstrixEventLog } from "../src/astrix/events";
import {
  AstrixStewardLoop,
  type StewardDecisionProvider,
} from "../src/astrix/orchestrator";
import { runAbsenceDrill } from "../src/astrix/absenceDrill";

const t0 = Date.now();
const secs = (): string => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
function headline(text: string): void {
  console.log(`\n=== [${secs()}] ${text} ===`);
}
async function settle(loop: AstrixStewardLoop): Promise<void> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (["COMPLETED", "STOPPED", "FAILED", "AWAITING_APPROVAL"].includes(loop.state)) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("demo3: loop did not settle");
}
function scripted(decisions: Array<{ decision: string; toolCalls: Array<{ tool: string; args: Record<string, unknown> }> }>): StewardDecisionProvider {
  return {
    id: "demo3-scripted",
    async decide() {
      return decisions.shift() ?? { decision: "idle", toolCalls: [] };
    },
  };
}

console.log("ASTrix 3-minute demo — deterministic, real Core, no LLM, no network.");

// ---- PROOF A ---------------------------------------------------------------
headline("PROOF A — the world does not belong to the AI");
const drill = await runAbsenceDrill({ onlineDays: 1, absenceDays: 3, recoveryDays: 4 });
console.log(`  steward online (day ${drill.stateAtDisconnect.day}): pop ${drill.stateAtDisconnect.population}, food ${drill.stateAtDisconnect.food}`);
console.log(`  steward STOPPED for ${drill.config.absenceDays} days: decisions ${drill.summary.decisionsDuringAbsence}, actions ${drill.summary.actionsDuringAbsence}`);
console.log(`  reconnect (day ${drill.stateAtReconnect.day}): pop ${drill.stateAtReconnect.population}, food ${drill.stateAtReconnect.food}`);
console.log(`  recovered (day ${drill.finalState.day}): pop ${drill.finalState.population}, food ${drill.finalState.food}`);
console.log(`  verdict: ${drill.score.pass ? "WORLD CONTINUED + RECOVERED" : "FAIL — " + drill.score.rule}`);
if (!drill.score.pass) process.exit(2);

// ---- PROOF B ---------------------------------------------------------------
headline("PROOF B — the AI has no unrestricted authority");
{
  const mk = (decisions: Parameters<typeof scripted>[0]) => {
    const state = new AstrixWorldState();
    const bus = new AstrixGameCommandBus(state);
    const tools = createAstrixToolRegistry(state, bus);
    const events = new AstrixEventLog(500);
    const loop = new AstrixStewardLoop({ state, bus, tools, events, provider: scripted(decisions), maxTurnsPerRun: 2, maxActionsPerTurn: 2, decideTimeoutMs: 2000 });
    return { state, bus, loop };
  };
  // Reject path.
  const r = mk([{ decision: "bridge", toolCalls: [{ tool: "build_bridge", args: { island_a: "meadow", island_b: "frost" } }] }]);
  r.loop.start("demo3 reject");
  await settle(r.loop);
  if (r.loop.state !== "AWAITING_APPROVAL") throw new Error("demo3: reject path did not park");
  const pid = r.state.pendingApprovals[0].id;
  r.loop.resolveApproval(pid, "reject");
  await settle(r.loop);
  console.log(`  REJECTED: bridges=${r.state.snapshot().bridges.length} (expected 0), state=${r.loop.state}`);
  if (r.state.snapshot().bridges.length !== 0) process.exit(2);
  // Approve path.
  const g = mk([{ decision: "bridge", toolCalls: [{ tool: "build_bridge", args: { island_a: "meadow", island_b: "frost" } }] }]);
  g.loop.start("demo3 approve");
  await settle(g.loop);
  const pid2 = g.state.pendingApprovals[0].id;
  g.loop.resolveApproval(pid2, "approve");
  await settle(g.loop);
  const act = g.loop.actions.find((a) => a.tool === "build_bridge")!;
  console.log(`  APPROVED → ${act.executionState} → ${act.verificationState}: bridges=${g.state.snapshot().bridges.length} (expected 1)`);
  if (act.executionState !== "SUCCEEDED" || act.verificationState !== "VERIFIED") process.exit(2);
}

// ---- PROOF C ---------------------------------------------------------------
headline("PROOF C — world time executes through MagicBlock, commits to Solana");
{
  const ev = JSON.parse(readFileSync("artifacts/astrix-magicblock-smoke.json", "utf8"));
  console.log(`  base day ${ev.before.day} (slot ${ev.before.slot}, owner ${String(ev.before.owner).slice(0, 8)}…)`);
  console.log(`  ER advance: day → ${ev.erAdvance.erDayAfter} in ${ev.erAdvance.ms}ms [${String(ev.erAdvance.sig).slice(0, 12)}…]`);
  console.log(`  commit: [${String(ev.commit.sig).slice(0, 12)}…]`);
  console.log(`  base after: day ${ev.after.day} (slot ${ev.after.slot}) — MATCH=${ev.match}`);
  console.log(`  program: ${ev.programId} | world: ${ev.worldPDA} | validator: EU ${String(ev.erValidator).slice(0, 8)}…`);
  console.log(`  re-verify live: getTransaction(<sig>) + getAccountInfo(<worldPDA>) on ${ev.rpcBase}`);
  if (ev.match !== true) process.exit(2);
}

// ---- PROOF D — heartbeat ----------------------------------------------------
headline("PROOF D — the pulse: five autonomous heartbeats, no steward");
{
  const lines = readFileSync("artifacts/astrix-heartbeat.jsonl", "utf8").trim().split("\n");
  console.log(`  ${lines.length} heartbeats recorded (steward, observer, Godot all OFF)`);
  let prev = -1;
  for (const line of lines) {
    const b = JSON.parse(line);
    const okDay = Number(b.baseDay) === Number(b.baseDayBefore) + 1;
    console.log(`  #${b.heartbeat}: ER ${b.erMs}ms [${String(b.advanceSig).slice(0, 8)}…] → commit [${String(b.commitSig).slice(0, 8)}…] → base day ${b.baseDayBefore}→${b.baseDay}${okDay ? "" : "  DAY MISMATCH!"}`);
    if (!okDay) process.exit(2);
    prev = Number(b.baseDay);
  }
  void prev;
  console.log("  every heartbeat advanced exactly one day; every commit landed on base.");
}

// ---- clock honesty footnote -------------------------------------------------
headline("NOTE — what the demo does not claim");
console.log("  Core ticks (days/food/growth) run locally in this demo, exactly as");
console.log("  the managed clock does in production. The devnet proof above shows");
console.log("  the same day-counter advancing through the ER instead — the clock");
console.log("  determines WHEN, Core determines WHAT, in both configurations.");
console.log(`\nDEMO COMPLETE in ${secs()} — all proofs deterministic and re-runnable.`);
void DAY_SECONDS;
