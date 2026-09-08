// P0 execution-loop lifecycle tests (ASTRIX_GAME_AND_AGENT_ARCHITECTURE.md §P0):
//   A. safe action executes -> verifies -> turn continues
//   B. high-risk action pauses at the structural approval gate (no mutation)
//   C. approval -> command executes -> verification succeeds
//   D. rejection -> mutation does not occur
//   E. failed action -> failure recorded, no false success
//   F. verification failure -> marked verification_failed
//   G. malformed agent response -> safely rejected, no mutation
//   H. bounded execution (turns + actions per turn)
//   I. non-idempotent safety (no blind retry of failed mutations)
import { describe, it, expect } from "vitest";
import { AstrixWorldState } from "../src/astrix/state";
import { AstrixGameCommandBus } from "../src/astrix/commandBus";
import { createAstrixToolRegistry } from "../src/astrix/mcpTools";
import { AstrixEventLog } from "../src/astrix/events";
import {
  AstrixStewardLoop,
  type AstrixActionRecord,
  type AstrixStewardLoopOptions,
  type StewardDecision,
  type StewardDecisionProvider,
  type StewardRunContext,
} from "../src/astrix/orchestrator";

/** Provider that replays queued decisions; once exhausted it returns an idle
 *  decision (toolCalls: []) so the loop ends naturally. */
class FakeProvider implements StewardDecisionProvider {
  readonly id = "fake";
  readonly contexts: StewardRunContext[] = [];

  constructor(private readonly queue: StewardDecision[]) {}

  async decide(context: StewardRunContext): Promise<StewardDecision> {
    this.contexts.push(context);
    const next = this.queue.shift();
    if (next) return next;
    return { decision: "idle", toolCalls: [] };
  }
}

class ThrowingProvider implements StewardDecisionProvider {
  readonly id = "throwing";
  constructor(private readonly error: Error) {}
  async decide(): Promise<StewardDecision> {
    throw this.error;
  }
}

interface SetupOptions {
  decisions?: StewardDecision[];
  loopOverrides?: Partial<Omit<AstrixStewardLoopOptions, "state" | "bus" | "tools" | "events">>;
  LoopClass?: typeof AstrixStewardLoop;
}

function setup(options: SetupOptions = {}) {
  const state = new AstrixWorldState();
  const bus = new AstrixGameCommandBus(state);
  const tools = createAstrixToolRegistry(state, bus);
  const events = new AstrixEventLog();
  const provider = options.decisions ? new FakeProvider(options.decisions) : undefined;
  const LoopClass = options.LoopClass ?? AstrixStewardLoop;
  const loop = new LoopClass({
    state,
    bus,
    tools,
    events,
    provider,
    ...options.loopOverrides,
  });
  return { state, bus, tools, events, loop, provider };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("waitFor timed out");
}

async function waitTerminal(loop: AstrixStewardLoop, timeoutMs = 2000): Promise<void> {
  await waitFor(
    () => ["COMPLETED", "STOPPED", "FAILED"].includes(loop.state),
    timeoutMs,
  );
}

function eventTypes(events: AstrixEventLog): string[] {
  return events.all().map((e) => e.type);
}

describe("ASTrix tool registry arg aliases", () => {
  it("accepts camelCase arg names as aliases for the snake_case contract", async () => {
    const { state, bus, tools } = setup();
    const result = await tools.callTool("build", {
      buildingType: "farm",
      position: { x: 5, y: 0, z: 5 },
      islandId: "meadow",
    });
    expect((result as any).success).toBe(true);
    expect(state.buildings.some((b) => b.type === "farm")).toBe(true);
    expect(state.resources.wood).toBe(28); // farm cost wood 2
    void bus;
  });
});

describe("ASTrix steward execution loop", () => {
  it("A: executes a safe action, verifies it, and continues the turn", async () => {
    const { state, events, loop } = setup({
      decisions: [{ decision: "gather wood", toolCalls: [{ tool: "gather", args: { resource_id: "tree-meadow-001" } }] }],
    });
    const start = loop.start();
    expect(start.ok).toBe(true);
    await loop.whenSettled();

    expect(loop.state).toBe("COMPLETED");
    expect(state.resources.wood).toBe(31);
    const node = state.resourceNodes.find((n) => n.id === "tree-meadow-001")!;
    expect(node.quantity).toBe(4);

    const action = loop.actions.find((a) => a.tool === "gather")!;
    expect(action.executionState).toBe("SUCCEEDED");
    expect(action.verificationState).toBe("VERIFIED");

    const types = eventTypes(events);
    expect(types[0]).toBe("TURN_STARTED");
    expect(types[1]).toBe("WORLD_OBSERVED");
    expect(types[2]).toBe("DECISION_STARTED");
    expect(types[3]).toBe("DECISION_COMPLETED");
    expect(types[4]).toBe("PLAN_CREATED");
    // Strict ordering: propose -> executing -> succeeded -> verification.
    expect(
      ["ACTION_PROPOSED", "ACTION_EXECUTING", "ACTION_SUCCEEDED", "VERIFICATION_STARTED", "VERIFICATION_SUCCEEDED"].every((t) =>
        types.includes(t),
      ),
    ).toBe(true);
    expect(types.indexOf("ACTION_PROPOSED")).toBeLessThan(types.indexOf("ACTION_EXECUTING"));
    expect(types.indexOf("ACTION_EXECUTING")).toBeLessThan(types.indexOf("ACTION_SUCCEEDED"));
    expect(types.indexOf("ACTION_SUCCEEDED")).toBeLessThan(types.indexOf("VERIFICATION_STARTED"));
    expect(types.indexOf("VERIFICATION_STARTED")).toBeLessThan(types.indexOf("VERIFICATION_SUCCEEDED"));
    expect(types[types.length - 1]).toBe("TURN_COMPLETED");
  });

  it("B: a high-risk action pauses at the structural approval gate with no mutation", async () => {
    // Sneak an approval_id in the args: the loop must strip it so the command
    // bus creates its OWN approval — the agent can never self-approve.
    const { state, events, loop } = setup({
      decisions: [
        {
          decision: "clear for farmland",
          toolCalls: [
            {
              tool: "clear_terrain",
              args: { position: { x: 12, y: 3.5, z: 24 }, radius: 2, approval_id: "bogus" },
            },
          ],
        },
      ],
    });
    loop.start();
    await waitFor(() => loop.state === "AWAITING_APPROVAL");

    // No mutation before approval.
    expect(state.resourceNodes).toHaveLength(5);
    expect(state.resources.wood).toBe(30);
    expect(state.pendingApprovals).toHaveLength(1);

    const approval = state.pendingApprovals[0];
    expect(approval.id).not.toBe("bogus"); // agent-provided id was stripped
    const action = loop.actions[0];
    expect(action.tool).toBe("clear_terrain");
    expect(action.riskLevel).toBe("high");
    expect(action.approvalRequired).toBe(true);
    expect(action.approvalState).toBe("pending");
    expect(action.executionState).toBe("AWAITING_APPROVAL");
    expect(eventTypes(events)).toContain("APPROVAL_REQUIRED");
  });

  it("C: approving the pending action executes it and verifies", async () => {
    const { state, events, loop } = setup({
      decisions: [
        {
          decision: "clear for farmland",
          toolCalls: [{ tool: "clear_terrain", args: { position: { x: 12, y: 3.5, z: 24 }, radius: 2 } }],
        },
      ],
    });
    loop.start();
    await waitFor(() => loop.state === "AWAITING_APPROVAL");

    const approvalId = state.pendingApprovals[0].id;
    const result = loop.resolveApproval(approvalId, "approve");
    expect(result.success).toBe(true);

    await waitTerminal(loop);
    expect(loop.state).toBe("COMPLETED");
    // The node at (12,3.5,24) was cleared — meadow node tree-meadow-001 is gone.
    expect(state.resourceNodes).toHaveLength(4);
    expect(state.resourceNodes.find((n) => n.id === "tree-meadow-001")).toBeUndefined();
    expect(state.pendingApprovals).toHaveLength(0);

    const action = loop.actions[0];
    expect(action.approvalState).toBe("granted");
    expect(action.executionState).toBe("SUCCEEDED");
    expect(action.verificationState).toBe("VERIFIED");
    const types = eventTypes(events);
    expect(types).toContain("APPROVAL_GRANTED");
    expect(types).toContain("VERIFICATION_SUCCEEDED");
  });

  it("D: rejecting the pending action performs no mutation", async () => {
    const { state, events, loop } = setup({
      decisions: [
        {
          decision: "clear for farmland",
          toolCalls: [{ tool: "clear_terrain", args: { position: { x: 12, y: 3.5, z: 24 }, radius: 2 } }],
        },
      ],
    });
    loop.start();
    await waitFor(() => loop.state === "AWAITING_APPROVAL");

    const approvalId = state.pendingApprovals[0].id;
    const result = loop.resolveApproval(approvalId, "reject");
    expect(result.success).toBe(false);
    expect(result.error).toBe("approval rejected");

    await waitTerminal(loop);
    expect(loop.state).toBe("COMPLETED");
    expect(state.resourceNodes).toHaveLength(5); // nothing cleared
    expect(state.resources.wood).toBe(30);
    expect(state.pendingApprovals).toHaveLength(0);

    const action = loop.actions[0];
    expect(action.approvalState).toBe("rejected");
    expect(action.executionState).toBe("REJECTED");
    expect(eventTypes(events)).toContain("APPROVAL_REJECTED");
  });

  it("E: a failed action is recorded as failed with no false success", async () => {
    const { state, events, loop } = setup({
      decisions: [{ decision: "gather missing", toolCalls: [{ tool: "gather", args: { resource_id: "tree-does-not-exist" } }] }],
    });
    loop.start();
    await loop.whenSettled();

    expect(loop.state).toBe("COMPLETED"); // turn continued
    const action = loop.actions.find((a) => a.tool === "gather")!;
    expect(action.executionState).toBe("FAILED");
    expect(action.verificationState).toBe("NOT_VERIFIED");
    expect(action.error).toContain("resource node not found");
    expect(state.resources.wood).toBe(30); // untouched
    const types = eventTypes(events);
    expect(types).toContain("ACTION_FAILED");
    expect(types).not.toContain("VERIFICATION_SUCCEEDED");
  });

  it("F: a command that 'succeeds' but fails verification is marked verification_failed", async () => {
    class FailingVerifierLoop extends AstrixStewardLoop {
      protected checkVerification(record: AstrixActionRecord, before: ReturnType<AstrixWorldState["snapshot"]>): boolean {
        if (record.tool === "gather" && record.args.resource_id === "tree-meadow-001") return false;
        return super.checkVerification(record, before);
      }
    }
    const { state, events, loop } = setup({
      decisions: [{ decision: "gather wood", toolCalls: [{ tool: "gather", args: { resource_id: "tree-meadow-001" } }] }],
      LoopClass: FailingVerifierLoop,
    });
    loop.start();
    await loop.whenSettled();

    const action = loop.actions[0];
    // The mutation DID happen (bus success) but the world did not match the
    // expectation — that is a verification failure, never a false success.
    expect(action.executionState).toBe("SUCCEEDED");
    expect(action.verificationState).toBe("VERIFICATION_FAILED");
    expect(state.resources.wood).toBe(31);
    const types = eventTypes(events);
    expect(types).toContain("VERIFICATION_FAILED");
    expect(types).not.toContain("VERIFICATION_SUCCEEDED");
  });

  it("G: unknown tools and malformed calls are safely rejected without mutation", async () => {
    const { state, loop } = setup({
      decisions: [
        {
          decision: "do everything",
          toolCalls: [
            { tool: "teleport", args: { x: 1 } },
            { tool: 123 as unknown as string, args: null as unknown as Record<string, unknown> },
          ],
        },
      ],
    });
    loop.start();
    await loop.whenSettled();

    expect(loop.state).toBe("COMPLETED");
    expect(loop.actions).toHaveLength(2);
    for (const action of loop.actions) {
      expect(action.executionState).toBe("SKIPPED");
      expect(action.error).toContain("unknown tool");
    }
    expect(state.resources.wood).toBe(30);
    expect(state.buildings).toHaveLength(1);
  });

  it("G2: a provider failure fails the turn observably and never mutates", async () => {
    const state = new AstrixWorldState();
    const bus = new AstrixGameCommandBus(state);
    const tools = createAstrixToolRegistry(state, bus);
    const events = new AstrixEventLog();
    const loop = new AstrixStewardLoop({
      state,
      bus,
      tools,
      events,
      provider: new ThrowingProvider(new Error("harness exploded")),
    });
    loop.start();
    await waitTerminal(loop);

    expect(loop.state).toBe("FAILED");
    expect(loop.error).toContain("harness exploded");
    expect(eventTypes(events)).toContain("TURN_FAILED");
    expect(state.resources.wood).toBe(30);
  });

  it("H: execution is bounded per turn and per run", async () => {
    const fifty = Array.from({ length: 50 }, () => ({ tool: "inspect_world" as const, args: {} }));
    const { loop } = setup({
      decisions: [{ decision: "observe a lot", toolCalls: fifty }],
      loopOverrides: { maxActionsPerTurn: 5, maxTurnsPerRun: 2 },
    });
    loop.start();
    await loop.whenSettled();

    expect(loop.state).toBe("COMPLETED");
    expect(loop.turn).toBe(2);
    // Turn 1 executed exactly 5 actions (the cap); turn 2 was idle and ended the run.
    expect(loop.actions).toHaveLength(5);
  });

  it("I: failed mutations are never blindly retried", async () => {
    const { state, loop } = setup({
      decisions: [
        { decision: "gather missing", toolCalls: [{ tool: "gather", args: { resource_id: "tree-does-not-exist" } }] },
        { decision: "gather missing again", toolCalls: [{ tool: "gather", args: { resource_id: "tree-does-not-exist" } }] },
      ],
    });
    loop.start();
    await loop.whenSettled();

    // Exactly one execution per proposal — no automatic re-attempts.
    expect(loop.actions).toHaveLength(2);
    for (const action of loop.actions) {
      expect(action.executionState).toBe("FAILED");
      expect(action.executedAt).toBeDefined();
    }
    expect(state.resources.wood).toBe(30);
  });

  it("stop() cancels a paused run without resolving the approval", async () => {
    const { state, loop } = setup({
      decisions: [
        { decision: "clear", toolCalls: [{ tool: "clear_terrain", args: { position: { x: 12, y: 3.5, z: 24 }, radius: 2 } }] },
      ],
    });
    loop.start();
    await waitFor(() => loop.state === "AWAITING_APPROVAL");

    const stop = loop.stop();
    expect(stop.ok).toBe(true);
    await waitTerminal(loop);
    expect(loop.state).toBe("STOPPED");
    // The approval remains pending in the world; the mutation never ran.
    expect(state.pendingApprovals).toHaveLength(1);
    expect(state.resourceNodes).toHaveLength(5);
    // A later explicit approval still works through the bus (world-correct),
    // but does not resume the stopped loop.
    const result = loop.resolveApproval(state.pendingApprovals[0].id, "reject");
    expect(result.error).toBe("approval rejected");
    expect(loop.state).toBe("STOPPED");
  });
});

describe("approval observability (P1): the human can see what they are authorizing", () => {
  it("status() exposes command, islands, cost, risk, permanence, topology, action and turn", async () => {
    const { state, loop } = setup({
      decisions: [
        {
          decision: "connect frost",
          toolCalls: [
            // The agent also tries to authorize itself -- the id must never reach
            // a human as if it were the server's approval.
            { tool: "build_bridge", args: { island_a: "meadow", island_b: "frost", approval_id: "self-granted" } },
          ],
        },
      ],
    });
    loop.start();
    await waitFor(() => loop.state === "AWAITING_APPROVAL");

    const status = loop.status();
    const pending = status.pendingApproval as Record<string, unknown>;
    expect(pending).toBeTruthy();

    // Every field the approval view must show, straight from the loop.
    expect(pending.approvalId).toBe(state.pendingApprovals[0].id);
    expect(pending.command).toBe("BUILD_BRIDGE");
    expect(pending.tool).toBe("build_bridge");
    expect(pending.sourceIsland).toBe("meadow");
    expect(pending.destinationIsland).toBe("frost");
    expect(pending.cost).toEqual({ wood: 3, stone: 1 });
    expect(pending.riskLevel).toBe("high");
    expect(pending.irreversible).toBe(true);
    expect(pending.permanent).toBe(true);
    expect(pending.resultingTopology).toBe("meadow <-> frost");
    expect(pending.position).toEqual({ x: 32.5, y: 4, z: 16 });
    expect(pending.actionId).toBe(loop.actions[0].id);
    expect(pending.turn).toBe(1);
    expect(pending.agent).toBe("steward");
    expect(String(pending.reason)).toContain("connectivity");

    // The gate is unchanged: the approval id is the SERVER's, not the agent's.
    expect(pending.approvalId).not.toBe("self-granted");
    expect(JSON.stringify(pending)).not.toContain("self-granted");
    for (const key of ["approval_id", "approvalId"]) {
      expect(Object.keys(pending.args as Record<string, unknown>)).not.toContain(key);
    }
    expect(pending.args).toEqual({ island_a: "meadow", island_b: "frost" });
  });

  it("action records carry their sanitized args, so an action is never just a bare tool name", async () => {
    const { loop } = setup({
      decisions: [
        { decision: "gather", toolCalls: [{ tool: "gather", args: { resource_type: "wood", approvalId: "nope" } }] },
      ],
    });
    loop.start();
    await waitTerminal(loop);

    const actions = loop.status().actions as Array<Record<string, unknown>>;
    const gather = actions.find((action) => action.tool === "gather")!;
    // The defect this fixes: status() reported `tool: gather` with no args at all,
    // so the poller printed "gather null" and no reader could tell what happened.
    expect(gather.args).toEqual({ resource_type: "wood" });
    expect(JSON.stringify(actions)).not.toContain("nope");
  });
});
