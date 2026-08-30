// Canonical 30-day scenario (ASTRIX_GAME_AND_AGENT_ARCHITECTURE.md §19/§16):
//   "Keep the village alive for 30 days."
//
// Proves the simulation math is coherent end-to-end with the REAL loop, REAL
// command bus, and REAL structural approval gate (nothing is faked):
//   - A governor limited to Meadow's starting farmland (2 farms) cannot feed
//     the village through Winter -> starvation (the tradeoff is real).
//   - A governor that expands farmland via clear_terrain (1 approval) survives
//     with the full population.
//
// The governor is a scripted heuristic (deterministic), but every action it
// proposes goes through the actual AstrixStewardLoop -> tool registry -> command
// bus, and the irreversible clear_terrain genuinely pauses at AWAITING_APPROVAL
// until the test (standing in for the human) approves through resolveApproval.
import { describe, it, expect } from "vitest";
import { AstrixWorldState, DAY_SECONDS } from "../src/astrix/state";
import { AstrixGameCommandBus } from "../src/astrix/commandBus";
import { createAstrixToolRegistry } from "../src/astrix/mcpTools";
import { AstrixEventLog } from "../src/astrix/events";
import { AstrixStewardLoop, type StewardDecision, type StewardDecisionProvider, type StewardRunContext } from "../src/astrix/orchestrator";

/**
 * A deterministic governor: harvest mature crops, build farms while farmland
 * is available (up to maxFarms), plant wheat, and clear terrain ONLY when
 * farmland has run out and the farm cap has not been reached. With maxFarms=3
 * the expansion requires one clear_terrain -> one human approval.
 */
class ScriptedGovernor implements StewardDecisionProvider {
  readonly id = "governor";
  constructor(private readonly maxFarms: number) {}

  async decide(context: StewardRunContext): Promise<StewardDecision> {
    const snap = context.snapshot;

    const harvestable = snap.crops.filter((c) => c.harvestable);
    if (harvestable.length > 0) {
      return {
        decision: "harvest mature crops",
        toolCalls: harvestable.slice(0, 10).map((c) => ({ tool: "harvest", args: { crop_id: c.id } })),
      };
    }

    const farms = snap.buildings.filter((b) => b.type === "farm");
    const meadow = snap.farmland.find((f) => f.islandId === "meadow")!;

    if (meadow.available > 0 && farms.length < this.maxFarms) {
      const x = 10 + farms.length * 4;
      return {
        decision: "build farm",
        toolCalls: [{ tool: "build", args: { building_type: "farm", position: { x, y: 0, z: 10 }, island_id: "meadow" } }],
      };
    }

    for (const farm of farms) {
      const planted = snap.crops.filter((c) => c.farmPlotId === farm.id).length;
      if (planted < 3) {
        return {
          decision: "plant wheat",
          toolCalls: Array.from({ length: 3 - planted }, () => ({ tool: "plant", args: { farm_plot_id: farm.id, crop_type: "wheat" } })),
        };
      }
    }

    if (meadow.available === 0 && farms.length < this.maxFarms) {
      return {
        decision: "clear for farmland",
        toolCalls: [{ tool: "clear_terrain", args: { position: { x: 12, y: 3.5, z: 24 }, radius: 2 } }],
      };
    }

    return { decision: "idle", toolCalls: [] };
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("waitFor timed out");
}

interface ScenarioResult {
  state: AstrixWorldState;
  approvals: number;
  eventTypes: string[];
}

/**
 * Drive the governor for 30 simulated days: each day runs the steward loop to
 * completion (approving any real approval the gate raises), then advances one
 * day boundary. Mirrors how scripts/astrix-demo.ts keeps the governor alive
 * across loop runs on the live system.
 */
async function runScenario(maxFarms: number): Promise<ScenarioResult> {
  const state = new AstrixWorldState();
  const bus = new AstrixGameCommandBus(state);
  const tools = createAstrixToolRegistry(state, bus);
  const events = new AstrixEventLog();
  const loop = new AstrixStewardLoop({
    state,
    bus,
    tools,
    events,
    provider: new ScriptedGovernor(maxFarms),
    maxTurnsPerRun: 6,
    maxActionsPerTurn: 10,
  });

  let approvals = 0;
  for (let day = 1; day <= 30 && state.population > 0; day++) {
    if (["IDLE", "COMPLETED", "STOPPED"].includes(loop.state)) {
      loop.start("Keep the village alive for 30 days");
    }
    await waitFor(() => ["COMPLETED", "FAILED", "STOPPED", "AWAITING_APPROVAL"].includes(loop.state));
    if (loop.state === "AWAITING_APPROVAL") {
      const approval = state.pendingApprovals[0];
      expect(approval).toBeDefined();
      approvals += 1;
      const result = loop.resolveApproval(approval.id, "approve");
      expect(result.success).toBe(true);
      await waitFor(() => ["COMPLETED", "FAILED", "STOPPED"].includes(loop.state));
    }
    state.tick(DAY_SECONDS);
  }

  return { state, approvals, eventTypes: events.all().map((e) => e.type) };
}

describe("canonical 30-day scenario", () => {
  it("survives 30 days only when farmland is expanded via the approval-gated clear", async () => {
    const { state, approvals, eventTypes } = await runScenario(3);

    // Full population survives the full 30 days.
    expect(state.day).toBeGreaterThanOrEqual(30);
    expect(state.population).toBe(4);
    // One irreversible action was genuinely required and approved.
    expect(approvals).toBe(1);
    expect(eventTypes).toContain("APPROVAL_REQUIRED");
    expect(eventTypes).toContain("APPROVAL_GRANTED");
    expect(eventTypes).toContain("VERIFICATION_SUCCEEDED");
    // Farmland was expanded exactly once (meadow 2 -> 3).
    expect(state.farmlandCapacity.meadow).toBe(3);
  });

  it("the village starves when limited to the starting farmland (the tradeoff is real)", async () => {
    const { state, approvals } = await runScenario(2);

    // Two meadow farms cannot feed 4 villagers through Winter.
    expect(state.population).toBeLessThan(4);
    // No irreversible action was taken (no farmland expansion attempted).
    expect(approvals).toBe(0);
    expect(state.farmlandCapacity.meadow).toBe(2);
  });
});
