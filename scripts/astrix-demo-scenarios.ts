// Runnable PHASE H demonstration: executes the four causal scenarios against
// the REAL authoritative machinery (in-process, isolated from production) and
// writes the actual event trace to artifacts/astrix-demo-scenarios.json so a
// judge can answer "show me exactly what happened" from events, not pictures.
//
// Usage: npm run astrix:demo-scenarios
// Production safety: this script never touches the network, PM2, or the live
// server. All state lives in memory and is discarded on exit.
import { writeFileSync, mkdirSync } from "node:fs";
import { AstrixWorldState } from "../src/astrix/state";
import { AstrixGameCommandBus } from "../src/astrix/commandBus";
import { createAstrixToolRegistry } from "../src/astrix/mcpTools";
import { AstrixEventLog } from "../src/astrix/events";
import {
  AstrixStewardLoop,
  type StewardDecision,
  type StewardDecisionProvider,
  type StewardRunContext,
} from "../src/astrix/orchestrator";

class ScriptedProvider implements StewardDecisionProvider {
  readonly id = "demo-scripted";
  constructor(private readonly queue: StewardDecision[]) {}
  async decide(_context: StewardRunContext): Promise<StewardDecision> {
    return this.queue.shift() ?? { decision: "idle", toolCalls: [] };
  }
}

class HangingProvider implements StewardDecisionProvider {
  readonly id = "demo-hanging";
  async decide(): Promise<StewardDecision> {
    return new Promise(() => {});
  }
}

interface CaseTrace {
  case: string;
  claim: string;
  before: Record<string, unknown>;
  events: { type: string; turn: number; at: number }[];
  after: Record<string, unknown>;
  outcome: Record<string, unknown>;
}

function essentials(state: AstrixWorldState): Record<string, unknown> {
  const snap = state.snapshot();
  return {
    day: snap.day,
    season: snap.season,
    population: snap.population,
    food: snap.food,
    wood: snap.resources.wood,
    stone: snap.resources.stone,
    farms: snap.farmland,
    crops: snap.crops.length,
    bridges: snap.bridges,
    connectivity: snap.islands.map((i) => ({ id: i.id, connectivity: i.connectivity })),
    pendingApprovals: snap.pendingApprovals.length,
    pressure: snap.foodPressureLevel,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("demo waitFor timed out");
}

function rig(decisions?: StewardDecision[], overrides: Record<string, unknown> = {}) {
  const state = new AstrixWorldState();
  const bus = new AstrixGameCommandBus(state);
  const tools = createAstrixToolRegistry(state, bus);
  const events = new AstrixEventLog();
  const loop = new AstrixStewardLoop({
    state, bus, tools, events,
    provider: decisions ? new ScriptedProvider(decisions) : undefined,
    ...overrides,
  } as never);
  return { state, bus, events, loop };
}

function trace(events: AstrixEventLog) {
  return events.all().map((e) => ({ type: e.type, turn: e.turn, at: e.at }));
}

async function caseA(): Promise<CaseTrace> {
  const { state, events, loop } = rig([
    { decision: "gather wood", toolCalls: [{ tool: "gather", args: { resource_id: "tree-meadow-001" } }] },
  ]);
  const before = essentials(state);
  loop.start();
  await loop.whenSettled();
  return {
    case: "A-low-risk-success",
    claim: "A safe steward action executes and verifies with no human involved.",
    before,
    events: trace(events),
    after: essentials(state),
    outcome: { loopState: loop.state, woodDelta: (essentials(state).wood as number) - (before.wood as number) },
  };
}

async function caseB(): Promise<CaseTrace> {
  const { state, events, loop } = rig([
    { decision: "bridge to frost", toolCalls: [{ tool: "build_bridge", args: { island_a: "meadow", island_b: "frost" } }] },
  ]);
  const before = essentials(state);
  loop.start();
  await waitFor(() => loop.state === "AWAITING_APPROVAL");
  const heldAtGate = loop.state === "AWAITING_APPROVAL" && state.pendingApprovals.length === 1;
  const rejected = loop.resolveApproval(state.pendingApprovals[0].id, "reject");
  await loop.whenSettled();
  return {
    case: "B-high-risk-rejection",
    claim: "A proposal is not an authorization: rejection mutates nothing.",
    before,
    events: trace(events),
    after: essentials(state),
    outcome: { heldAtGate, rejectResponse: rejected, bridgesAfter: state.bridges.length },
  };
}

async function caseC(): Promise<CaseTrace> {
  const { state, events, loop } = rig([
    { decision: "bridge to frost", toolCalls: [{ tool: "build_bridge", args: { island_a: "meadow", island_b: "frost" } }] },
  ]);
  const before = essentials(state);
  loop.start();
  await waitFor(() => loop.state === "AWAITING_APPROVAL");
  const id = state.pendingApprovals[0].id;
  const granted = loop.resolveApproval(id, "approve");
  await loop.whenSettled();
  // Idempotency: the consumed approval cannot execute twice.
  const replay = loop.resolveApproval(id, "approve");
  return {
    case: "C-high-risk-approval",
    claim: "Human approval permits exactly one governed execution, then verifies.",
    before,
    events: trace(events),
    after: essentials(state),
    outcome: {
      grantResponse: granted,
      replayResponse: replay,
      bridgesAfter: state.bridges.length,
      woodAfter: state.resources.wood,
      stoneAfter: state.resources.stone,
    },
  };
}

async function caseD(): Promise<CaseTrace> {
  const rigged = rig(undefined, { provider: new HangingProvider(), decideTimeoutMs: 60 });
  const { state, events, loop } = rigged;
  const before = essentials(state);
  loop.start();
  await loop.whenSettled();
  return {
    case: "D-failure",
    claim: "Decision timeout fails the turn observably: no retry, no mutation.",
    before,
    events: trace(events),
    after: essentials(state),
    outcome: { loopState: loop.state, actionsAttempted: loop.actions.length },
  };
}

async function main(): Promise<void> {
  const cases = [await caseA(), await caseB(), await caseC(), await caseD()];
  mkdirSync("artifacts", { recursive: true });
  const out = "artifacts/astrix-demo-scenarios.json";
  writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), cases }, null, 2));
  for (const c of cases) {
    console.log(`--- ${c.case}: ${c.claim}`);
    console.log(`    events: ${c.events.map((e) => e.type).join(" -> ")}`);
    console.log(`    outcome: ${JSON.stringify(c.outcome)}`);
  }
  console.log(`trace artifact: ${out}`);
}

await main();
