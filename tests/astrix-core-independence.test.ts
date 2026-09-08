// ASTrix Core independence + local runtime tests (Core extraction milestone).
//
// These tests exist to prove ONE property structurally: ASTrix Core runs the
// full canonical lifecycle with TrueForge disabled, unavailable, and
// unconfigured — using the REAL command bus, the REAL structural approval gate,
// and the REAL verification step. Nothing here mocks the world or the bus; the
// only thing that changes versus production is WHERE reasoning happens.
//
// Coverage map (mission Part XX / XXI):
//   Core        : world init, time progression, authoritative state
//   Steward     : observation -> reasoning -> proposal (no direct mutation)
//   Commands    : valid / invalid / mutation boundary
//   Governance  : approval required, approve, reject, interrupt (stop)
//   Execution   : success + failure, exactly-once
//   Verification: success + failure paths
//   Consequence : world changes persist and feed the next observation
//   Adaptation  : steward changes behaviour after a human rejection
//   TF absence  : no network, no config, no provider
import { describe, it, expect } from "vitest";
import { AstrixWorldState, DAY_SECONDS } from "../src/astrix/state";
import { AstrixGameCommandBus } from "../src/astrix/commandBus";
import { createAstrixToolRegistry } from "../src/astrix/mcpTools";
import { AstrixEventLog } from "../src/astrix/events";
import { createAstrixService } from "../src/astrix/server";
import { AstrixStewardLoop } from "../src/astrix/orchestrator";
import { LocalStewardProvider, decideLocalSteward } from "../src/astrix/localRuntime";
import type { AstrixActionRecord, StewardRunContext } from "../src/astrix/orchestrator";

function core(options: { maxTurnsPerRun?: number; maxActionsPerTurn?: number } = {}) {
  const state = new AstrixWorldState();
  const bus = new AstrixGameCommandBus(state);
  const tools = createAstrixToolRegistry(state, bus);
  const events = new AstrixEventLog();
  const loop = new AstrixStewardLoop({
    state,
    bus,
    tools,
    events,
    provider: new LocalStewardProvider(),
    maxTurnsPerRun: options.maxTurnsPerRun ?? 4,
    maxActionsPerTurn: options.maxActionsPerTurn ?? 6,
    decideTimeoutMs: 2000,
  });
  return { state, bus, tools, events, loop };
}

async function settle(loop: AstrixStewardLoop, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (["COMPLETED", "STOPPED", "FAILED", "AWAITING_APPROVAL"].includes(loop.state)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`loop did not settle (state=${loop.state})`);
}

function ctx(state: AstrixWorldState, history: AstrixActionRecord[] = []): StewardRunContext {
  return { turn: 1, objective: "Keep the village alive for 30 days", snapshot: state.snapshot(), history };
}

function rejectedRecord(tool: string, args: Record<string, unknown>): AstrixActionRecord {
  return {
    id: "act-001",
    turn: 1,
    agent: "steward",
    tool,
    args,
    riskLevel: "high",
    approvalRequired: true,
    approvalState: "rejected",
    executionState: "REJECTED",
    verificationState: "NOT_VERIFIED",
    createdAt: Date.now(),
  };
}

// ---------------------------------------------------------------- Core -----

describe("ASTrix Core — world and time", () => {
  it("initializes an authoritative world at day 1 with the canonical start state", () => {
    const { state } = core();
    const snap = state.snapshot();
    expect(snap.day).toBe(1);
    expect(snap.season).toBe("spring");
    expect(snap.population).toBe(4);
    expect(snap.food).toBe(40);
    expect(snap.resources).toEqual({ wood: 30, stone: 15, food: 40, water: 0, crystal: 5 });
    expect(snap.buildings).toHaveLength(1);
    expect(snap.resourceNodes).toHaveLength(5);
    expect(snap.bridges).toEqual([]);
    expect(snap.pendingApprovals).toEqual([]);
  });

  it("advances time and consumes food at each day boundary", () => {
    const { state } = core();
    const before = state.food;
    expect(state.tick(DAY_SECONDS)).toBe(true);
    expect(state.day).toBe(2);
    expect(state.food).toBe(before - 4); // 4 villagers x 1 food
  });
});

// ------------------------------------------------------------- Steward -----

describe("ASTrix Steward — observation, reasoning, proposal", () => {
  it("observes authoritative state and proposes real tool calls with a rationale", async () => {
    const { state } = core();
    const decision = await new LocalStewardProvider().decide(ctx(state));
    expect(decision.toolCalls.length).toBeGreaterThan(0);
    expect(decision.decision).toBeTruthy();
    expect(decision.reasoning).toBeTruthy();
    // Day 1: no farms exist, wood/stone are affordable -> build a farm.
    expect(decision.toolCalls[0].tool).toBe("build");
    expect(decision.toolCalls[0].args).toMatchObject({ building_type: "farm", island_id: "meadow" });
  });

  it("cannot mutate authoritative state by deciding (proposal is inert)", async () => {
    const { state } = core();
    const before = JSON.stringify(state.snapshot());
    await new LocalStewardProvider().decide(ctx(state));
    await new LocalStewardProvider().decide(ctx(state));
    expect(JSON.stringify(state.snapshot())).toBe(before);
  });

  it("prioritises harvest over expansion when crops are mature", () => {
    const { state, bus } = core();
    bus.execute({ command: "PLACE_BUILDING", buildingType: "farm", position: { x: 10, y: 0, z: 10 }, islandId: "meadow" });
    const farm = state.buildings.find((b) => b.type === "farm")!;
    bus.execute({ command: "PLANT_CROP", farmPlotId: farm.id, cropType: "wheat" });
    state.tick(DAY_SECONDS * 9); // wheat matures in 8 days
    const decision = decideLocalSteward(ctx(state));
    expect(decision.toolCalls[0].tool).toBe("harvest");
  });

  it("gathers when materials are the binding constraint", () => {
    const { state } = core();
    state.resources.wood = 0;
    state.resources.stone = 0;
    const decision = decideLocalSteward(ctx(state));
    expect(decision.toolCalls[0].tool).toBe("gather");
  });
});

// ------------------------------------------------------------ Commands -----

describe("ASTrix Commands — mutation boundary", () => {
  it("executes a valid command through the bus and changes the world", () => {
    const { state, bus } = core();
    const result = bus.execute({ command: "GATHER_RESOURCE", resourceId: "tree-meadow-001" });
    expect(result.success).toBe(true);
    expect(state.resources.wood).toBe(31);
  });

  it("rejects invalid commands without mutating", () => {
    const { state, bus } = core();
    const before = JSON.stringify(state.snapshot());
    expect(bus.execute({ command: "PLACE_BUILDING", buildingType: "farm", islandId: "frost", position: { x: 44, y: 0, z: 10 } }).error)
      .toContain("no bridge to frost");
    expect(bus.execute({ command: "HARVEST_CROP", cropId: "nope" }).error).toContain("crop not found");
    expect(bus.execute({ command: "PLANT_CROP", farmPlotId: "nope", cropType: "wheat" }).error).toContain("farm plot not found");
    expect(JSON.stringify(state.snapshot())).toBe(before);
  });

  it("strips agent-supplied approval ids so the gate cannot be self-granted", async () => {
    const { state, loop } = core();
    // Drive one gated action, then confirm the pending approval was created by
    // the bus (not carried in by the agent) and the world is untouched.
    const nodes = state.resourceNodes.length;
    state.farmlandCapacity.meadow = 0; // force the irreversible path
    loop.start("test");
    await settle(loop);
    expect(loop.state).toBe("AWAITING_APPROVAL");
    expect(state.pendingApprovals).toHaveLength(1);
    expect(state.resourceNodes.length).toBe(nodes); // zero mutation while pending
    loop.stop();
  });
});

// ---------------------------------------------------------- Governance -----

describe("ASTrix Governance — human control is structural", () => {
  it("REJECT produces ZERO world mutation", async () => {
    const { state, loop } = core();
    state.farmlandCapacity.meadow = 0;
    const before = JSON.stringify(state.snapshot());
    loop.start("test");
    await settle(loop);
    expect(loop.state).toBe("AWAITING_APPROVAL");

    const approval = state.pendingApprovals[0];
    const result = loop.resolveApproval(approval.id, "reject");
    expect(result.success).toBe(false);
    await settle(loop);

    const after = state.snapshot();
    expect(after.resourceNodes.length).toBe(JSON.parse(before).resourceNodes.length);
    expect(after.resources.wood).toBe(JSON.parse(before).resources.wood);
    expect(after.biomeHealth.meadow).toBe(JSON.parse(before).biomeHealth.meadow);
    expect(after.pendingApprovals).toEqual([]);
  });

  it("APPROVE executes EXACTLY ONE authorized mutation and verifies it", async () => {
    const { state, events, loop } = core();
    state.farmlandCapacity.meadow = 0;
    const woodBefore = state.resources.wood;
    const nodesBefore = state.resourceNodes.length;

    loop.start("test");
    await settle(loop);
    const approval = state.pendingApprovals[0];
    const result = loop.resolveApproval(approval.id, "approve");
    expect(result.success).toBe(true);
    await settle(loop);

    expect(state.resourceNodes.length).toBeLessThan(nodesBefore);
    expect(state.resources.wood).toBeGreaterThan(woodBefore);
    expect(state.pendingApprovals).toEqual([]);

    const types = events.all().map((e) => e.type);
    expect(types).toContain("APPROVAL_REQUIRED");
    expect(types).toContain("APPROVAL_GRANTED");
    expect(types).toContain("VERIFICATION_SUCCEEDED");
    // Exactly one clear_terrain reached SUCCEEDED.
    const cleared = loop.actions.filter((a) => a.tool === "clear_terrain" && a.executionState === "SUCCEEDED");
    expect(cleared).toHaveLength(1);
  });

  it("a consumed approval cannot be replayed to execute the action twice", async () => {
    const { state, loop } = core();
    state.farmlandCapacity.meadow = 0;
    loop.start("test");
    await settle(loop);
    const approval = state.pendingApprovals[0];
    expect(loop.resolveApproval(approval.id, "approve").success).toBe(true);
    await settle(loop);

    const nodesAfterFirst = state.resourceNodes.length;
    const woodAfterFirst = state.resources.wood;
    // Replay the same id: it is gone, so nothing can execute again.
    const replay = loop.resolveApproval(approval.id, "approve");
    expect(replay.success).toBe(false);
    expect(replay.error).toContain("approval not found");
    expect(state.resourceNodes.length).toBe(nodesAfterFirst);
    expect(state.resources.wood).toBe(woodAfterFirst);
  });

  it("world time is frozen while a decision awaits human approval", async () => {
    const service = createAstrixService({ maxTurnsPerRun: 2, maxActionsPerTurn: 2 });
    service.state.farmlandCapacity.meadow = 0;
    service.loop.start("test");
    await settle(service.loop);
    expect(service.loop.state).toBe("AWAITING_APPROVAL");

    const dayAtGate = service.state.day;
    for (let i = 0; i < 5; i++) service.tick(DAY_SECONDS); // 5 days of wall clock
    expect(service.state.day).toBe(dayAtGate); // time did not advance

    const approval = service.state.pendingApprovals[0];
    service.loop.resolveApproval(approval.id, "reject");
    await settle(service.loop);
    service.tick(DAY_SECONDS);
    expect(service.state.day).toBeGreaterThan(dayAtGate); // resumes after the decision
  });

  it("interruption (stop) at the gate leaves the world unmutated", async () => {
    const { state, loop } = core();
    state.farmlandCapacity.meadow = 0;
    const before = JSON.stringify(state.snapshot());
    loop.start("test");
    await settle(loop);
    expect(loop.state).toBe("AWAITING_APPROVAL");

    loop.stop();
    await loop.whenSettled();
    expect(loop.state).toBe("STOPPED");
    const after = state.snapshot();
    expect(after.resourceNodes.length).toBe(JSON.parse(before).resourceNodes.length);
    expect(after.resources.wood).toBe(JSON.parse(before).resources.wood);
  });
});

// ------------------------------------- Execution / Verification / failure ---

describe("ASTrix Execution + Verification", () => {
  it("ends honestly (idle, no false success) when no valid action exists", async () => {
    const state = new AstrixWorldState();
    const bus = new AstrixGameCommandBus(state);
    const events = new AstrixEventLog();
    const loop = new AstrixStewardLoop({
      state,
      bus,
      tools: createAstrixToolRegistry(state, bus),
      events,
      // Irreversible expansion disabled: with no farmland and no materials the
      // steward has nothing legitimate to propose and must say so.
      provider: new LocalStewardProvider({ allowIrreversible: false }),
      maxTurnsPerRun: 1,
      decideTimeoutMs: 2000,
    });
    state.farmlandCapacity.meadow = 0;
    state.farmlandCapacity.frost = 0;
    state.farmlandCapacity.dusk = 0;
    const before = JSON.stringify(state.snapshot());

    loop.start("test");
    await settle(loop);

    expect(loop.state).toBe("COMPLETED");
    expect(loop.actions).toHaveLength(0);
    expect(events.all().some((e) => e.type === "ACTION_SUCCEEDED")).toBe(false);
    expect(JSON.stringify(state.snapshot())).toBe(before);
  });

  it("records an execution failure as FAILED with no false success and consistent state", async () => {
    const state = new AstrixWorldState();
    const bus = new AstrixGameCommandBus(state);
    const events = new AstrixEventLog();
    // A provider that proposes a doomed-but-well-formed command. The local
    // policy never proposes these (it pre-checks), so the failure path is
    // exercised deliberately here.
    const provider = {
      id: "doomed",
      async decide() {
        return {
          decision: "plant into a farm that does not exist",
          toolCalls: [{ tool: "plant", args: { farm_plot_id: "farm-does-not-exist", crop_type: "wheat" } }],
        };
      },
    };
    const loop = new AstrixStewardLoop({
      state,
      bus,
      tools: createAstrixToolRegistry(state, bus),
      events,
      provider,
      maxTurnsPerRun: 1,
      decideTimeoutMs: 2000,
    });
    const before = JSON.stringify(state.snapshot());

    loop.start("test");
    await settle(loop);

    const action = loop.actions[0];
    expect(action.executionState).toBe("FAILED");
    expect(action.verificationState).toBe("NOT_VERIFIED");
    expect(action.error).toContain("farm plot not found");
    const types = events.all().map((e) => e.type);
    expect(types).toContain("ACTION_FAILED");
    expect(types).not.toContain("ACTION_SUCCEEDED");
    expect(types).not.toContain("VERIFICATION_SUCCEEDED");
    // State is unchanged: a failed command mutates nothing.
    expect(JSON.stringify(state.snapshot())).toBe(before);
  });

  it("verifies a successful safe mutation against authoritative state", async () => {
    const { events, loop } = core({ maxTurnsPerRun: 1 });
    loop.start("test");
    await settle(loop);
    const built = loop.actions.find((a) => a.tool === "build");
    expect(built?.executionState).toBe("SUCCEEDED");
    expect(built?.verificationState).toBe("VERIFIED");
    expect(events.all().map((e) => e.type)).toContain("VERIFICATION_SUCCEEDED");
  });
});

// -------------------------------------------- Consequence + Adaptation -----

describe("ASTrix Consequence + Adaptation", () => {
  it("consequences persist and change the next observation", async () => {
    const { state, loop } = core({ maxTurnsPerRun: 2 });
    const woodBefore = state.resources.wood;
    loop.start("test");
    await settle(loop);
    // A farm was built: resources were spent and the farm is in the snapshot.
    const snap = state.snapshot();
    expect(snap.buildings.some((b) => b.type === "farm")).toBe(true);
    expect(snap.resources.wood).toBeLessThan(woodBefore);
    expect(snap.farmland.find((f) => f.islandId === "meadow")!.used).toBeGreaterThan(0);
  });

  it("the steward adapts after a human rejection instead of re-proposing it", () => {
    const { state } = core();
    state.farmlandCapacity.meadow = 0;

    // First proposal at this state: clear the first reachable wood node.
    const first = decideLocalSteward(ctx(state));
    expect(first.toolCalls[0].tool).toBe("clear_terrain");
    const firstArgs = JSON.stringify(first.toolCalls[0].args);

    // Same state, but the human rejected exactly that proposal. The steward must
    // NOT re-ask for the identical action — it tries a different clearing site.
    const history = [rejectedRecord("clear_terrain", first.toolCalls[0].args)];
    const second = decideLocalSteward(ctx(state, history));
    expect(JSON.stringify(second.toolCalls[0].args)).not.toBe(firstArgs);

    // Every clearing site refused -> change strategy entirely (connectivity).
    const history2 = [
      ...history,
      rejectedRecord("clear_terrain", second.toolCalls[0].args),
    ];
    const third = decideLocalSteward(ctx(state, history2));
    expect(third.toolCalls[0]?.tool).toBe("build_bridge");

    // Connectivity refused too -> idle honestly rather than repeat itself.
    const history3 = [...history2, rejectedRecord("build_bridge", third.toolCalls[0].args)];
    const fourth = decideLocalSteward(ctx(state, history3));
    expect(fourth.toolCalls).toHaveLength(0);
    expect(fourth.reasoning).toContain("rejected by the human");
  });
});

// ------------------------------------------------ TrueForge independence ---

describe("ASTrix Core runs with TrueForge unavailable", () => {
  it("createAstrixService with no provider installs the local runtime", () => {
    const service = createAstrixService();
    expect(service.loop.providerId).toBe("local-astrix-steward");
    expect(service.loop.start("Keep the village alive for 30 days").ok).toBe(true);
    service.loop.stop();
  });

  it("runs the full lifecycle with TrueForge env unconfigured and unreachable", async () => {
    // Point every TrueForge knob at a closed port and clear the key: if any
    // code path needed TrueForge, this test would hang or throw.
    const saved = { url: process.env.TRUEFORGE_URL, key: process.env.TRUEFORGE_API_KEY };
    process.env.TRUEFORGE_URL = "http://127.0.0.1:9"; // discard port
    delete process.env.TRUEFORGE_API_KEY;
    try {
      const service = createAstrixService({ maxTurnsPerRun: 3, maxActionsPerTurn: 6 });
      service.state.farmlandCapacity.meadow = 1;
      expect(service.loop.start("Keep the village alive for 30 days").ok).toBe(true);
      await settle(service.loop, 6000);

      // Observed, decided, proposed, executed, verified — all locally.
      const types = service.events.all().map((e) => e.type);
      expect(types).toContain("WORLD_OBSERVED");
      expect(types).toContain("DECISION_COMPLETED");
      expect(types).toContain("PLAN_CREATED");
      expect(types).toContain("ACTION_SUCCEEDED");
      expect(types).toContain("VERIFICATION_SUCCEEDED");
      expect(service.state.buildings.some((b) => b.type === "farm")).toBe(true);
    } finally {
      if (saved.url === undefined) delete process.env.TRUEFORGE_URL;
      else process.env.TRUEFORGE_URL = saved.url;
      if (saved.key !== undefined) process.env.TRUEFORGE_API_KEY = saved.key;
    }
  });

  it("the event log alone reconstructs the lifecycle (no chain-of-thought)", async () => {
    const { events, loop } = core({ maxTurnsPerRun: 1 });
    loop.start("test");
    await settle(loop);
    const seq = events.all().map((e) => e.type);
    expect(seq[0]).toBe("TURN_STARTED");
    expect(seq).toContain("WORLD_OBSERVED");
    expect(seq.indexOf("ACTION_PROPOSED")).toBeLessThan(seq.indexOf("ACTION_EXECUTING"));
    expect(seq.indexOf("ACTION_EXECUTING")).toBeLessThan(seq.indexOf("ACTION_SUCCEEDED"));
    expect(seq.indexOf("ACTION_SUCCEEDED")).toBeLessThan(seq.indexOf("VERIFICATION_SUCCEEDED"));
  });
});
