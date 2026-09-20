// PHASE H causal demonstration scenarios (ASTrix central thesis, end to end):
//   A. low-risk success   (propose -> execute -> verify, no approval)
//   B. high-risk rejection (propose -> gate -> human rejects -> no mutation)
//   C. high-risk approval  (propose -> gate -> human approves -> executes once)
//   D. steward failure     (decision timeout -> TURN_FAILED, no blind retry)
//
// Every scenario drives the REAL machinery (AstrixWorldState ->
// AstrixGameCommandBus -> tool registry -> AstrixStewardLoop -> events).
// Nothing is fabricated: no fake events, no fake decisions, no direct state
// mutation, no invented commands. The scripted providers stand in for the
// TrueForge model with FIXED decisions, so each run is deterministic.
import { describe, it, expect } from "vitest";
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

/** Deterministic stand-in for the model: replays one fixed decision per turn. */
class ScriptedProvider implements StewardDecisionProvider {
  readonly id = "demo-scripted";
  constructor(private readonly queue: StewardDecision[]) {}
  async decide(_context: StewardRunContext): Promise<StewardDecision> {
    const next = this.queue.shift();
    if (next) return next;
    return { decision: "idle", toolCalls: [] };
  }
}

/** Never resolves: forces the loop's decide-timeout path deterministically. */
class HangingProvider implements StewardDecisionProvider {
  readonly id = "demo-hanging";
  async decide(): Promise<StewardDecision> {
    return new Promise(() => {});
  }
}

function setup(decisions?: StewardDecision[], loopOverrides: Record<string, unknown> = {}) {
  const state = new AstrixWorldState();
  const bus = new AstrixGameCommandBus(state);
  const tools = createAstrixToolRegistry(state, bus);
  const events = new AstrixEventLog();
  const loop = new AstrixStewardLoop({
    state,
    bus,
    tools,
    events,
    provider: decisions ? new ScriptedProvider(decisions) : undefined,
    ...loopOverrides,
  } as never);
  return { state, bus, tools, events, loop };
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("waitFor timed out");
}

function types(events: AstrixEventLog): string[] {
  return events.all().map((e) => e.type);
}

/** Assert an ordered subsequence appears in the event stream. */
function expectChain(events: AstrixEventLog, chain: string[]): void {
  const stream = types(events);
  let cursor = 0;
  for (const want of chain) {
    const found = stream.indexOf(want, cursor);
    expect(found, `expected ${want} after position ${cursor} in ${stream.join(",")}`).toBeGreaterThanOrEqual(0);
    cursor = found + 1;
  }
}

describe("PHASE H case A — low-risk success needs no human", () => {
  it("gather executes, verifies, and the world actually changes", async () => {
    const woodBefore = 30;
    const { state, events, loop } = setup([
      { decision: "gather wood", toolCalls: [{ tool: "gather", args: { resource_id: "tree-meadow-001" } }] },
    ]);
    expect(state.resources.wood).toBe(woodBefore);

    expect(loop.start().ok).toBe(true);
    await loop.whenSettled();

    expect(loop.state).toBe("COMPLETED");
    expectChain(events, [
      "WORLD_OBSERVED",
      "DECISION_COMPLETED",
      "ACTION_PROPOSED",
      "ACTION_EXECUTING",
      "ACTION_SUCCEEDED",
      "VERIFICATION_STARTED",
      "VERIFICATION_SUCCEEDED",
      "TURN_COMPLETED",
    ]);
    // No approval was ever required or created.
    expect(types(events)).not.toContain("APPROVAL_REQUIRED");
    expect(state.pendingApprovals.length).toBe(0);
    // The authoritative world actually changed and verification confirmed it.
    expect(state.resources.wood).toBe(woodBefore + 1);
    expect(state.resourceNodes.find((n) => n.id === "tree-meadow-001")!.quantity).toBe(4);
    const action = loop.actions[0];
    expect(action.executionState).toBe("SUCCEEDED");
    expect(action.verificationState).toBe("VERIFIED");
  });
});

describe("PHASE H case B — high-risk rejection mutates nothing", () => {
  it("bridge proposal parks at the gate; rejection leaves the world identical", async () => {
    const { state, events, loop } = setup([
      { decision: "bridge to frost", toolCalls: [{ tool: "build_bridge", args: { island_a: "meadow", island_b: "frost" } }] },
    ]);
    const before = state.snapshot();

    expect(loop.start().ok).toBe(true);
    await waitFor(() => loop.state === "AWAITING_APPROVAL");

    // The gate is raised with full consequence info; nothing has executed.
    expect(state.bridges.length).toBe(0);
    expect(state.pendingApprovals.length).toBe(1);
    const approval = state.pendingApprovals[0];
    expect(approval.command).toBe("BUILD_BRIDGE");
    expect(types(events)).toContain("APPROVAL_REQUIRED");
    // The clock-freeze precondition holds: the loop parks instead of spinning.
    expect(loop.pendingApproval?.approvalId).toBe(approval.id);

    const result = loop.resolveApproval(approval.id, "reject");
    expect(result.success).toBe(false); // rejections report success:false with reason
    await loop.whenSettled();

    // Assertions: no execution, no deduction, no topology, resolved as rejected.
    expect(types(events)).toContain("APPROVAL_REJECTED");
    expect(types(events)).not.toContain("ACTION_SUCCEEDED");
    expect(state.bridges.length).toBe(0);
    expect(state.resources.wood).toBe(before.resources.wood);
    expect(state.resources.stone).toBe(before.resources.stone);
    expect(state.pendingApprovals.length).toBe(0);
    expect(loop.actions[0].approvalState).toBe("rejected");
    expect(loop.actions[0].executionState).not.toBe("SUCCEEDED");
  });
});

describe("PHASE H case C — high-risk approval executes exactly once", () => {
  it("approval grants one execution; replay is refused; observation sees the bridge", async () => {
    const { state, events, loop } = setup([
      { decision: "bridge to frost", toolCalls: [{ tool: "build_bridge", args: { island_a: "meadow", island_b: "frost" } }] },
    ]);

    expect(loop.start().ok).toBe(true);
    await waitFor(() => loop.state === "AWAITING_APPROVAL");
    const approval = state.pendingApprovals[0];
    expect(approval).toBeDefined();

    const granted = loop.resolveApproval(approval.id, "approve");
    expect(granted.success).toBe(true);
    await loop.whenSettled();

    expectChain(events, [
      "APPROVAL_REQUIRED",
      "APPROVAL_GRANTED",
      "ACTION_SUCCEEDED",
      "VERIFICATION_STARTED",
      "VERIFICATION_SUCCEEDED",
      "TURN_COMPLETED",
    ]);
    // Exactly one bridge, exactly one cost deduction, verified.
    expect(state.bridges.length).toBe(1);
    expect(state.bridges[0].islandA).toBe("meadow");
    expect(state.bridges[0].islandB).toBe("frost");
    expect(state.resources.wood).toBe(27); // 30 - bridge cost 3
    expect(state.resources.stone).toBe(14); // 15 - bridge cost 1
    expect(loop.actions[0].verificationState).toBe("VERIFIED");
    // Proposal markers disappear: no pending approval remains.
    expect(state.pendingApprovals.length).toBe(0);

    // IDEMPOTENCY (§14): approving again cannot execute twice.
    const replay = loop.resolveApproval(approval.id, "approve");
    expect(replay.success).toBe(false);
    expect(replay.error).toContain("approval not found");
    expect(state.bridges.length).toBe(1);
    expect(state.resources.wood).toBe(27);
    expect(state.resources.stone).toBe(14);
    expect(types(events).filter((t) => t === "ACTION_SUCCEEDED").length).toBe(1);

    // Next observation sees the changed world.
    const after = state.snapshot();
    expect(after.bridges.length).toBe(1);
    expect(after.islands.find((i) => i.id === "meadow")!.connectivity).toContain("frost");
  });
});

describe("PHASE H case D — failure is observable and safe", () => {
  it("decision timeout fails the turn with no blind retry and no mutation", async () => {
    const state = new AstrixWorldState();
    const bus = new AstrixGameCommandBus(state);
    const tools = createAstrixToolRegistry(state, bus);
    const events = new AstrixEventLog();
    const loop = new AstrixStewardLoop({
      state,
      bus,
      tools,
      events,
      provider: new HangingProvider(),
      decideTimeoutMs: 60,
    } as never);

    expect(loop.start().ok).toBe(true);
    await loop.whenSettled();

    expect(loop.state).toBe("FAILED");
    expectChain(events, ["DECISION_STARTED", "DECISION_COMPLETED", "TURN_FAILED"]);
    // No false success, no blind retry, no mutation of any kind.
    expect(types(events)).not.toContain("ACTION_SUCCEEDED");
    expect(types(events)).not.toContain("DECISION_RETRY");
    expect(loop.actions.length).toBe(0);
    expect(state.bridges.length).toBe(0);
    expect(state.resources.wood).toBe(30);
    expect(state.pendingApprovals.length).toBe(0);
  });
});
