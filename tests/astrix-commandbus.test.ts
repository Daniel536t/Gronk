import { describe, it, expect } from "vitest";
import { AstrixWorldState } from "../src/astrix/state";
import { AstrixGameCommandBus } from "../src/astrix/commandBus";

function fresh() {
  const state = new AstrixWorldState();
  const bus = new AstrixGameCommandBus(state);
  return { state, bus };
}

describe("ASTrix command bus", () => {
  it("creates a pending approval for an irreversible bridge command", () => {
    const { state, bus } = fresh();
    const result = bus.execute({
      command: "BUILD_BRIDGE",
      position: { x: 40, y: 0, z: 20 },
      islandA: "meadow",
      islandB: "frost",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("human approval required");
    expect(result.pendingApproval).toBeDefined();
    expect(state.pendingApprovals).toHaveLength(1);
    // Resources are untouched until approved.
    expect(state.resources.wood).toBe(30);
  });

  it("executes an approved irreversible command and consumes the approval", () => {
    const { state, bus } = fresh();
    const request = bus.execute({
      command: "BUILD_BRIDGE",
      position: { x: 40, y: 0, z: 20 },
      islandA: "meadow",
      islandB: "frost",
    });
    const approvalId = request.pendingApproval!.id;
    const approved = bus.resolveApproval(approvalId, "approve");
    expect(approved.success).toBe(true);
    expect(approved.bridgeId).toBeDefined();
    // Bridge cost wood 3 / stone 1 deducted.
    expect(state.resources.wood).toBe(27);
    expect(state.resources.stone).toBe(14);
    expect(state.buildings).toHaveLength(2);
    expect(state.pendingApprovals).toHaveLength(0);
    // Connectivity reflects the new bridge.
    const islands = state.snapshot().islands;
    expect(islands.find((i) => i.id === "meadow")!.connectivity).toContain("frost");
  });

  it("rejects an approval whose command does not match", () => {
    const { state, bus } = fresh();
    const request = bus.execute({
      command: "BUILD_BRIDGE",
      position: { x: 40, y: 0, z: 20 },
      islandA: "meadow",
      islandB: "frost",
    });
    const approvalId = request.pendingApproval!.id;
    // Attempt to consume the approval for a different bridge.
    const result = bus.execute({
      command: "BUILD_BRIDGE",
      position: { x: 41, y: 0, z: 21 },
      islandA: "frost",
      islandB: "dusk",
      approvalId,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("approval does not match command");
    // Approval stays pending and world is unchanged.
    expect(state.pendingApprovals).toHaveLength(1);
    expect(state.buildings).toHaveLength(1);
  });

  it("rejects unknown commands instead of crashing", () => {
    const { bus } = fresh();
    const result = bus.execute({ command: "__INVALID__" as never });
    expect(result.success).toBe(false);
    expect(result.error).toBe("unknown command");
  });

  it("rejects positionless clear_terrain", () => {
    const { state, bus } = fresh();
    const result = bus.execute({ command: "CLEAR_TERRAIN", radius: 1 });
    expect(result.success).toBe(false);
    expect(result.error).toContain("position and radius");
    expect(state.resourceNodes).toHaveLength(5);
  });

  it("rejects planting on a phantom farm plot", () => {
    const { state, bus } = fresh();
    const result = bus.execute({ command: "PLANT_CROP", farmPlotId: "farm-999", cropType: "wheat" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("farm plot not found");
    expect(state.crops).toHaveLength(0);
  });

  it("creates a crop only against an existing farm building", () => {
    const { state, bus } = fresh();
    // Place a farm first.
    const placed = bus.execute({ command: "PLACE_BUILDING", buildingType: "farm", position: { x: 10, y: 0, z: 10 }, islandId: "meadow" });
    expect(placed.success).toBe(true);
    const farmId = String(placed.buildingId);
    const result = bus.execute({ command: "PLANT_CROP", farmPlotId: farmId, cropType: "wheat" });
    expect(result.success).toBe(true);
    expect(state.crops).toHaveLength(1);
    expect(state.crops[0].farmPlotId).toBe(farmId);
  });

  it("simulate_plan validates the submitted plan without mutation", () => {
    const { state, bus } = fresh();
    const snapshot = state.snapshot();
    const result = bus.simulate({
      command: "PLACE_BUILDING",
      buildingType: "farm",
      position: { x: 5, y: 0, z: 5 },
      islandId: "meadow",
    });
    expect(result.success).toBe(true);
    // No mutation happened.
    expect(state.snapshot()).toEqual(snapshot);
  });
});
