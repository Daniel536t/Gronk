// Reliability milestone tests:
//   A. configurable steward decision timeout
//   B. timeout produces DECISION_COMPLETED failureKind=timeout and TURN_FAILED
//   C. decision latency observability (DECISION_STARTED -> DECISION_COMPLETED w/ duration)
//   D. strategic derived survival fields in the snapshot and WORLD_OBSERVED
//   E. farm-capacity reasoning inputs present in the steward prompt
//   F. connectivity/build consistency: building on Frost/Dusk requires a bridge
import { describe, it, expect } from "vitest";
import { AstrixWorldState, DAY_SECONDS } from "../src/astrix/state";
import { AstrixGameCommandBus } from "../src/astrix/commandBus";
import { createAstrixToolRegistry } from "../src/astrix/mcpTools";
import { AstrixEventLog } from "../src/astrix/events";
import { AstrixStewardLoop, type StewardDecision, type StewardDecisionProvider, type StewardRunContext } from "../src/astrix/orchestrator";
import { buildStewardPrompt } from "../src/server/trueforge";

class SlowProvider implements StewardDecisionProvider {
  readonly id = "slow";
  constructor(private readonly delayMs: number) {}
  async decide(_context: StewardRunContext): Promise<StewardDecision> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return { decision: "idle", toolCalls: [] };
  }
}

function fresh() {
  const state = new AstrixWorldState();
  const bus = new AstrixGameCommandBus(state);
  return { state, bus };
}

async function waitTerminal(loop: AstrixStewardLoop, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (["COMPLETED", "STOPPED", "FAILED"].includes(loop.state)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("waitTerminal timed out");
}

describe("decision reliability", () => {
  it("A: a configurable decision timeout fails the turn observably without mutation", async () => {
    const { state } = fresh();
    const bus = new AstrixGameCommandBus(state);
    const tools = createAstrixToolRegistry(state, bus);
    const events = new AstrixEventLog();
    const loop = new AstrixStewardLoop({
      state,
      bus,
      tools,
      events,
      provider: new SlowProvider(300),
      decideTimeoutMs: 30,
    });
    loop.start();
    await waitTerminal(loop);

    expect(loop.state).toBe("FAILED");
    expect(loop.error).toContain("timed out");
    expect(state.resources.wood).toBe(30); // no mutation
    expect(events.all().some((e) => e.type === "TURN_FAILED")).toBe(true);
  });

  it("B: a timeout is recorded as DECISION_COMPLETED failureKind=timeout", async () => {
    const { state } = fresh();
    const bus = new AstrixGameCommandBus(state);
    const tools = createAstrixToolRegistry(state, bus);
    const events = new AstrixEventLog();
    const loop = new AstrixStewardLoop({
      state,
      bus,
      tools,
      events,
      provider: new SlowProvider(300),
      decideTimeoutMs: 30,
    });
    loop.start();
    await waitTerminal(loop);

    const completed = events.all().find((e) => e.type === "DECISION_COMPLETED");
    expect(completed).toBeDefined();
    expect(completed!.data?.ok).toBe(false);
    expect(completed!.data?.failureKind).toBe("timeout");
    expect(typeof completed!.data?.durationMs).toBe("number");
    const failed = events.all().find((e) => e.type === "TURN_FAILED");
    expect(failed?.data?.decisionFailureKind).toBe("timeout");
  });

  it("C: DECISION_STARTED precedes DECISION_COMPLETED with measured duration", async () => {
    const { state } = fresh();
    const bus = new AstrixGameCommandBus(state);
    const tools = createAstrixToolRegistry(state, bus);
    const events = new AstrixEventLog();
    const loop = new AstrixStewardLoop({
      state,
      bus,
      tools,
      events,
      provider: new SlowProvider(20),
      decideTimeoutMs: 1000,
    });
    loop.start();
    await waitTerminal(loop);

    const types = events.all().map((e) => e.type);
    expect(types.indexOf("DECISION_STARTED")).toBeGreaterThan(types.indexOf("WORLD_OBSERVED"));
    expect(types.indexOf("DECISION_COMPLETED")).toBeGreaterThan(types.indexOf("DECISION_STARTED"));
    expect(types.indexOf("PLAN_CREATED")).toBeGreaterThan(types.indexOf("DECISION_COMPLETED"));
    const completed = events.all().find((e) => e.type === "DECISION_COMPLETED")!;
    expect(completed.data?.ok).toBe(true);
    expect((completed.data?.durationMs as number) ?? 0).toBeGreaterThanOrEqual(20);
  });
});

describe("strategic observation fields", () => {
  it("D1: the snapshot exposes deterministic survival projections", () => {
    const { state } = fresh();
    let snap = state.snapshot();
    expect(snap.foodPerDay).toBe(4);
    expect(snap.daysOfFoodRemaining).toBe(10);
    expect(snap.harvestableFood).toBe(0);
    expect(snap.growingFood).toBe(0);
    expect(snap.projectedFoodAtWinter).toBe(40 - 24 * 4); // 24 days until winter at 4/day
    expect(snap.foodPressureLevel).toBe("ok");

    // A planted + matured crop becomes harvestable food.
    const bus = new AstrixGameCommandBus(state);
    bus.execute({ command: "PLACE_BUILDING", buildingType: "farm", position: { x: 10, y: 0, z: 10 }, islandId: "meadow" });
    bus.execute({ command: "PLANT_CROP", farmPlotId: "farm-001", cropType: "wheat" });
    state.tick(DAY_SECONDS * 8);
    snap = state.snapshot();
    expect(snap.harvestableFood).toBe(6);
    expect(snap.growingFood).toBe(6);

    // Food scarcity raises the pressure level (daysOfFoodRemaining <7 -> high, <3 -> critical).
    state.food = 16;
    expect(state.snapshot().foodPressureLevel).toBe("high");
    state.food = 4;
    expect(state.snapshot().foodPressureLevel).toBe("critical");

    // Winter raises daily consumption (world is at day 9 after the crop growth above).
    state.food = 200;
    state.tick(DAY_SECONDS * 16); // day 25
    snap = state.snapshot();
    expect(snap.season).toBe("winter");
    expect(snap.foodPerDay).toBe(6); // 4 villagers * 1.5
  });

  it("D2: WORLD_OBSERVED carries the derived survival facts", async () => {
    const { state } = fresh();
    const bus = new AstrixGameCommandBus(state);
    const tools = createAstrixToolRegistry(state, bus);
    const events = new AstrixEventLog();
    const loop = new AstrixStewardLoop({
      state,
      bus,
      tools,
      events,
      provider: new SlowProvider(1),
      decideTimeoutMs: 1000,
    });
    loop.start();
    await waitTerminal(loop);

    const observed = events.all().find((e) => e.type === "WORLD_OBSERVED");
    expect(observed).toBeDefined();
    const data = observed!.data ?? {};
    expect(data.daysOfFoodRemaining).toBe(10);
    expect(data.foodPerDay).toBe(4);
    expect(data.harvestableFood).toBe(0);
    expect(data.projectedFoodAtWinter).toBeDefined();
    expect(data.foodPressureLevel).toBe("ok");
  });

  it("E: the steward prompt carries the economics and derived-fact guidance", () => {
    const prompt = buildStewardPrompt({ foodPerDay: 4 });
    expect(prompt).toMatch(/foodPerDay/);
    expect(prompt).toMatch(/projectedFoodAtWinter/);
    expect(prompt).toMatch(/daysOfFoodRemaining/);
    expect(prompt).toMatch(/empty farm plots are wasted production/i);
  });
});

describe("bounded parse-failure retry", () => {
  it("G: a parse failure is retried exactly once and the turn completes on the retry", async () => {
    const { state } = fresh();
    const bus = new AstrixGameCommandBus(state);
    const tools = createAstrixToolRegistry(state, bus);
    const events = new AstrixEventLog();
    let calls = 0;
    let sawRetryHint = false;
    const provider: StewardDecisionProvider = {
      id: "parse-once",
      async decide(context: StewardRunContext) {
        calls += 1;
        if (context.retryHint) sawRetryHint = true;
        if (calls === 1) throw new Error("steward turn done: no parseable decision in output");
        return { decision: "idle", toolCalls: [] };
      },
    };
    const loop = new AstrixStewardLoop({
      state,
      bus,
      tools,
      events,
      provider,
      decideTimeoutMs: 1000,
    });
    loop.start();
    await waitTerminal(loop);

    expect(calls).toBe(2); // exactly one retry, no more
    expect(sawRetryHint).toBe(true);
    expect(loop.state).toBe("COMPLETED"); // idle turn completes the loop
    const retry = events.all().find((e) => e.type === "DECISION_RETRY");
    expect(retry).toBeDefined();
    expect(retry!.data?.attempt).toBe(2);
    expect(retry!.data?.firstFailureKind).toBe("parse");
    const completed = events.all().filter((e) => e.type === "DECISION_COMPLETED");
    expect(completed).toHaveLength(2);
    expect(completed[1].data?.ok).toBe(true);
    expect(completed[1].data?.retriedAfter).toBe("parse");
    expect(events.all().some((e) => e.type === "TURN_FAILED")).toBe(false);
  });

  it("H: a second consecutive parse failure fails the turn (no infinite retry)", async () => {
    const { state } = fresh();
    const bus = new AstrixGameCommandBus(state);
    const tools = createAstrixToolRegistry(state, bus);
    const events = new AstrixEventLog();
    let calls = 0;
    const provider: StewardDecisionProvider = {
      id: "parse-always",
      async decide() {
        calls += 1;
        throw new Error("steward turn done: no parseable decision in output");
      },
    };
    const loop = new AstrixStewardLoop({
      state,
      bus,
      tools,
      events,
      provider,
      decideTimeoutMs: 1000,
    });
    loop.start();
    await waitTerminal(loop);

    expect(calls).toBe(2); // original + exactly one retry, then stop
    expect(loop.state).toBe("FAILED");
    const retries = events.all().filter((e) => e.type === "DECISION_RETRY");
    expect(retries).toHaveLength(1);
    const failed = events.all().filter((e) => e.type === "TURN_FAILED");
    expect(failed).toHaveLength(1);
    expect(failed[0].data?.decisionFailureKind).toBe("parse");
    expect(state.resources.wood).toBe(30); // no mutation ever
  });
});

describe("connectivity / build consistency", () => {
  it("F: building on Frost/Dusk without a bridge is rejected; a bridge unlocks it", () => {
    const { state, bus } = fresh();
    const denied = bus.execute({
      command: "PLACE_BUILDING",
      buildingType: "farm",
      position: { x: 44, y: 0, z: 10 },
      islandId: "frost",
    });
    expect(denied.success).toBe(false);
    expect(denied.error).toContain("no bridge to frost");
    expect(state.buildings.filter((b) => b.islandId === "frost")).toHaveLength(0);

    // A bridge is approval-gated (structural gate unchanged).
    const request = bus.execute({ command: "BUILD_BRIDGE", islandA: "meadow", islandB: "frost" });
    expect(request.pendingApproval).toBeDefined();
    expect(state.resources.wood).toBe(30); // untouched before approval
    const approved = bus.resolveApproval(request.pendingApproval!.id, "approve");
    expect(approved.success).toBe(true);
    expect(state.resources.wood).toBe(27); // bridge cost wood 3

    // Now the same build succeeds.
    const ok = bus.execute({
      command: "PLACE_BUILDING",
      buildingType: "farm",
      position: { x: 44, y: 0, z: 10 },
      islandId: "frost",
    });
    expect(ok.success).toBe(true);
    expect(state.buildings.filter((b) => b.islandId === "frost")).toHaveLength(1);
    // Dusk still unreachable (only meadow<->frost bridged).
    const dusk = bus.execute({
      command: "PLACE_BUILDING",
      buildingType: "farm",
      position: { x: 72, y: 0, z: 30 },
      islandId: "dusk",
    });
    expect(dusk.success).toBe(false);
    expect(dusk.error).toContain("no bridge to dusk");
  });
});
