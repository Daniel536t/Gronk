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
import { createAstrixService } from "../src/astrix/server";
import { AstrixStewardLoop, type StewardDecision, type StewardDecisionProvider, type StewardRunContext } from "../src/astrix/orchestrator";
import { buildStewardPrompt } from "../src/server/trueforge";

class SlowProvider implements StewardDecisionProvider {
  readonly id = "slow";
  constructor(private readonly delayMs: number) {}
  async decide(_context: StewardRunContext): Promise<StewardDecision> {
    // Sleep until the delay has elapsed ON THE CLOCK THE ORCHESTRATOR MEASURES
    // WITH. `setTimeout(n)` schedules against libuv's cached loop time, while
    // DECISION_COMPLETED.durationMs is `Date.now() - decidedAt`; the two are
    // truncated in different domains, so a single setTimeout(20) is observed as a
    // 19ms Date.now() delta on this machine in ~1.7% of samples (3000 samples:
    // 19ms x50, 20ms x1907, 21ms x846, 22ms x141, ...; never below 19, the
    // one-millisecond signature of the clock split rather than of a slow host).
    // Test C therefore failed about one run in sixty with "expected 19 to be
    // greater than or equal to 20". Re-arming until Date.now() agrees makes this
    // provider honour its stated latency in the units the assertion is written
    // in: the >= 20 bound is untouched and now genuinely guaranteed instead of
    // being a coin flip on timer rounding.
    const started = Date.now();
    while (Date.now() - started < this.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs - (Date.now() - started)));
    }
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
    // CHANGED (was "ok"): genesis has 10 days of food, ZERO farms, ZERO crops and
    // 24 days until Winter -- projectedFoodAtWinter is -56. "ok" was the label of
    // a bug: foodPressureLevel looked only at daysOfFoodRemaining and ignored the
    // very projection printed on the line above, so the steward was told the food
    // supply was fine while the state said the village cannot reach Winter.
    // "high" (cannot reach Winter) is the truthful label; the runway is still long
    // enough to plant, so it is not yet "critical".
    expect(snap.foodPressureLevel).toBe("high");
    // Nothing is planted, so the soonest food is a crop sown TODAY: 8 days.
    expect(snap.daysUntilNextHarvest).toBe(8);

    // A planted + matured crop becomes harvestable food.
    const bus = new AstrixGameCommandBus(state);
    bus.execute({ command: "PLACE_BUILDING", buildingType: "farm", position: { x: 10, y: 0, z: 10 }, islandId: "meadow" });
    bus.execute({ command: "PLANT_CROP", farmPlotId: "farm-001", cropType: "wheat" });
    state.tick(DAY_SECONDS * 8);
    snap = state.snapshot();
    expect(snap.harvestableFood).toBe(6);
    expect(snap.growingFood).toBe(6); // the SAME crop, counted once -- not 12
    expect(snap.daysUntilNextHarvest).toBe(0); // it is harvestable right now
    // food 40 - 8 days * 4 = 8 left, plus the 6 standing in the field.
    expect(snap.projectedFoodAtWinter).toBe(8 + 6 - (25 - 9) * 4);

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

  it("D1b: a food-deficit state is reported as such (the granary empties before the harvest)", () => {
    const { state, bus } = fresh();
    // Reconstructs live turn 3: two farms planted, crops one day old, 24 food.
    bus.execute({ command: "PLACE_BUILDING", buildingType: "farm", position: { x: 12, y: 0, z: 12 }, islandId: "meadow" });
    bus.execute({ command: "PLACE_BUILDING", buildingType: "farm", position: { x: 20, y: 0, z: 12 }, islandId: "meadow" });
    bus.execute({ command: "PLANT_CROP", farmPlotId: "farm-001", cropType: "wheat" });
    bus.execute({ command: "PLANT_CROP", farmPlotId: "farm-002", cropType: "wheat" });
    state.tick(DAY_SECONDS); // one day of growth: 12.5% of the 8-day maturity
    state.food = 24;

    const snap = state.snapshot();
    expect(snap.crops.every((crop) => crop.growthStage === 0.125)).toBe(true);
    expect(snap.harvestableFood).toBe(0);
    expect(snap.growingFood).toBe(12); // two wheat crops at 6 each, counted once
    expect(snap.daysOfFoodRemaining).toBe(6); // 24 food / 4 per day
    expect(snap.daysUntilNextHarvest).toBe(7); // 7 more growth days needed

    // THE REGRESSION: 6 days of food and no food for 7 days is starvation, and
    // the old rule (daysOfFoodRemaining alone, threshold 7) called this "high"
    // -- and called the strictly worse genesis state "ok". The level must follow
    // the numbers it is derived from.
    expect(snap.foodPressureLevel).toBe("critical");

    // The projection is internally consistent: mature crops are NOT counted twice.
    expect(snap.projectedFoodAtWinter).toBe(24 + 12 - (25 - 2) * 4);

    // Harvesting the crops later removes the gap, and the label follows. (Stock
    // the granary before ticking so the 7 days pass without starvation skewing
    // population -- this test is about the label, not about famine mechanics.)
    state.food = 400;
    state.tick(DAY_SECONDS * 7);
    state.food = 24;
    const ready = state.snapshot();
    expect(ready.daysUntilNextHarvest).toBe(0);
    expect(ready.harvestableFood).toBe(12);
    expect(ready.growingFood).toBe(12); // same crops -- never summed with harvestable
    expect(ready.foodPressureLevel).toBe("high"); // 6 days of food, but relief is in the field

    // Plenty of food AND standing crops: no hazard, so "ok" still means ok.
    state.food = 400;
    expect(state.snapshot().foodPressureLevel).toBe("ok");
  });

  it("D1c: in Winter nothing can mature, so no harvest date is promised", () => {
    const { state } = fresh();
    state.food = 4000; // survive the 25 days without starvation (see D1b)
    state.tick(DAY_SECONDS * 25); // day 26: winter
    expect(state.population).toBe(4);
    state.food = 36;

    const snap = state.snapshot();
    expect(snap.season).toBe("winter");
    expect(snap.foodPerDay).toBe(6); // 4 villagers * 1.5
    // Nothing planted and nothing CAN grow: null, not a number that would read
    // as "food arrives in 8 days" -- a promise Winter cannot keep.
    expect(snap.daysUntilNextHarvest).toBeNull();
    expect(snap.foodPressureLevel).toBe("high"); // 6 days of food, and no production at all

    // A null harvest date must not make everything critical: with a full granary
    // and no deficit projection there is no hazard to report.
    state.food = 1000;
    expect(state.snapshot().daysUntilNextHarvest).toBeNull();
    expect(state.snapshot().foodPressureLevel).toBe("ok");

    state.food = 6; // one day of winter rations left
    expect(state.snapshot().daysOfFoodRemaining).toBe(1);
    expect(state.snapshot().foodPressureLevel).toBe("critical");
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
    // CHANGED (was "ok"): same genesis state as D1 -- see the justification there.
    // WORLD_OBSERVED must carry the same truthful level the snapshot computes,
    // because this event is what the steward actually reasons from.
    expect(data.foodPressureLevel).toBe("high");
    expect(data.daysUntilNextHarvest).toBe(8);
  });

  it("E: the steward prompt carries the economics, meta-tool rejection, and time-to-production guidance", () => {
    const prompt = buildStewardPrompt({ foodPerDay: 4 });
    expect(prompt).toMatch(/foodPerDay/);
    expect(prompt).toMatch(/projectedFoodAtWinter/);
    expect(prompt).toMatch(/daysOfFoodRemaining/);
    expect(prompt).toMatch(/empty farm plots are wasted production/i);
    expect(prompt).toMatch(/TIME-TO-PRODUCTION/);
    expect(prompt).toMatch(/the day you PLANT is not the day you EAT/i);
    expect(prompt).toMatch(/create_sub_agent/);
    expect(prompt).toMatch(/never invent IDs|NEVER invent IDs/i);
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

describe("approval pauses world time", () => {
  it("P1: day does not advance while AWAITING_APPROVAL; time resumes and mutation executes after approval", async () => {
    let calls = 0;
    const provider: StewardDecisionProvider = {
      id: "propose-clear",
      async decide() {
        calls += 1;
        if (calls === 1) {
          return {
            decision: "clear meadow",
            toolCalls: [{ tool: "clear_terrain", args: { position: { x: 12, y: 3.5, z: 24 }, radius: 1 } }],
          };
        }
        return { decision: "idle", toolCalls: [] };
      },
    };
    const service = createAstrixService({ stewardProvider: provider, maxTurnsPerRun: 2, maxActionsPerTurn: 2 });
    const { state, loop, bus } = service;
    const dayAtStart = state.day;
    loop.start("Keep the village alive for 30 days");

    // Advance world time and wait for the loop to reach the approval gate.
    service.tick(DAY_SECONDS * 10); // would push past many days if not paused
    const deadline = Date.now() + 3000;
    while (loop.state !== "AWAITING_APPROVAL" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      service.tick(DAY_SECONDS / 2); // keep feeding the world clock
    }
    expect(loop.state).toBe("AWAITING_APPROVAL");
    expect(loop.pendingApproval).toBeTruthy();

    // Being at the gate now MUST freeze time: many ticks must not advance the day.
    // (Time advanced while the loop was RUNNING/deciding — that is correct; the
    // pause begins the moment the gate is reached.)
    const dayAtGate = state.day;
    for (let i = 0; i < 6; i++) service.tick(DAY_SECONDS * 5);
    expect(state.day).toBe(dayAtGate);

    // Approve -> mutation executes -> time resumes.
    const approvalId = loop.pendingApproval!.approvalId;
    const before = state.resourceNodes.length;
    const res = loop.resolveApproval(approvalId, "approve");
    expect(res.success).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Time resumes after approval.
    const dayAfter = state.day;
    service.tick(DAY_SECONDS * 5);
    expect(state.day).toBeGreaterThan(dayAfter);
  });

  it("P2: rejection keeps time paused until the decision, then resumes without mutation", async () => {
    let calls = 0;
    const provider: StewardDecisionProvider = {
      id: "propose-clear-reject",
      async decide() {
        calls += 1;
        if (calls === 1) {
          return {
            decision: "clear meadow",
            toolCalls: [{ tool: "clear_terrain", args: { position: { x: 12, y: 3.5, z: 24 }, radius: 1 } }],
          };
        }
        return { decision: "idle", toolCalls: [] };
      },
    };
    const service = createAstrixService({ stewardProvider: provider, maxTurnsPerRun: 2, maxActionsPerTurn: 2 });
    const { state, loop } = service;
    loop.start("Keep the village alive for 30 days");
    service.tick(DAY_SECONDS * 10);
    const deadline = Date.now() + 3000;
    while (loop.state !== "AWAITING_APPROVAL" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      service.tick(DAY_SECONDS / 2);
    }
    expect(loop.state).toBe("AWAITING_APPROVAL");
    const dayAtGate = state.day;
    const nodesBefore = state.resourceNodes.length;
    for (let i = 0; i < 6; i++) service.tick(DAY_SECONDS * 5);
    expect(state.day).toBe(dayAtGate);

    const res = loop.resolveApproval(loop.pendingApproval!.approvalId, "reject");
    expect(res.success).toBe(false); // rejection carries the rejected outcome
    await new Promise((resolve) => setTimeout(resolve, 50));
    // No mutation was applied (no tree removed).
    expect(state.resourceNodes.length).toBe(nodesBefore);
    // Time resumes after the decision.
    const dayAfter = state.day;
    service.tick(DAY_SECONDS * 5);
    expect(state.day).toBeGreaterThan(dayAfter);
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
