import { describe, it, expect } from "vitest";
import { AstrixWorldState, bridgeAnchorFor, ISLAND_ANCHORS } from "../src/astrix/state";
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

  it("rejects irreversible approval when the stored params are invalid", () => {
    const { state, bus } = fresh();
    // Force a malformed stored approval directly (simulating a legacy/bad stored entry).
    bus.execute({
      command: "BUILD_BRIDGE",
      position: { x: 40, y: 0, z: 20 },
      islandA: "meadow",
      islandB: "frost",
    });
    const stored = state.pendingApprovals[0];
    // Corrupt a field that validation genuinely requires (a bridge needs two
    // distinct islands), so the stored approval can no longer execute.
    (stored.impact as Record<string, unknown>).islandA = undefined;
    const result = bus.resolveApproval(stored.id, "approve");
    expect(result.success).toBe(false);
    expect(result.error).toContain("approval invalid");
    // The stuck approval is cleared rather than left pending forever.
    expect(state.pendingApprovals).toHaveLength(0);
    expect(state.buildings).toHaveLength(1);
    expect(state.resources.wood).toBe(30);
  });

  it("resolves a positionless bridge approval", () => {
    const { state, bus } = fresh();
    // Position is optional for bridges; a positionless approval must be
    // consumable instead of staying pending forever.
    const request = bus.execute({ command: "BUILD_BRIDGE", islandA: "meadow", islandB: "frost" });
    expect(request.success).toBe(false);
    expect(request.pendingApproval).toBeDefined();
    const approved = bus.resolveApproval(request.pendingApproval!.id, "approve");
    expect(approved.success).toBe(true);
    expect(state.bridges).toHaveLength(1);
    expect(state.pendingApprovals).toHaveLength(0);
    expect(state.resources.wood).toBe(27);
  });

  it("simulate rejects unsupported commands explicitly", () => {
    const { bus } = fresh();
    const result = bus.simulate({ command: "__UNSUPPORTED__" as never });
    expect(result.success).toBe(false);
    expect(result.error).toBe("unsupported command for simulation");
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

describe("gather invariant: no success without a state transition", () => {
  it("a gather on a depleted node fails instead of reporting gathered: 0", () => {
    const { state, bus } = fresh();
    const node = state.resourceNodes.find((n) => n.id === "tree-meadow-001")!;
    node.quantity = 0;
    const before = state.snapshot();
    const result = bus.execute({ command: "GATHER_RESOURCE", resourceId: "tree-meadow-001" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("resource depleted");
    expect(result).not.toHaveProperty("gathered");
    // Valid request, impossible transition: the world is byte-identical.
    expect(state.snapshot()).toEqual(before);
  });

  it("a type-matched gather skips depleted nodes and still gathers", () => {
    const { state, bus } = fresh();
    for (const n of state.resourceNodes) if (n.type === "wood") n.quantity = 0;
    const result = bus.execute({ command: "GATHER_RESOURCE", resourceType: "wood" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("resource node not found");
  });

  it("a legitimate gather moves exactly one unit and reports it", () => {
    const { state, bus } = fresh();
    const result = bus.execute({ command: "GATHER_RESOURCE", resourceId: "tree-meadow-001" });
    expect(result.success).toBe(true);
    expect(result.gathered).toBe(1);
    expect(state.resources.wood).toBe(31);
  });
});

describe("entity identity: generated ids never collide with seeded ids", () => {
  it("the first built house does not reuse the seeded house-001", () => {
    const { state, bus } = fresh();
    const result = bus.execute({
      command: "PLACE_BUILDING",
      buildingType: "house",
      position: { x: 5, y: 0, z: 5 },
      islandId: "meadow",
    });
    expect(result.success).toBe(true);
    const ids = state.buildings.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("house-001"); // the seed
    expect(result.buildingId).not.toBe("house-001");
  });

  it("ids stay unique across many builds, approvals, and crops", () => {
    const { state, bus } = fresh();
    state.resources.wood = 500;
    state.resources.stone = 500;
    const farm = bus.execute({ command: "PLACE_BUILDING", buildingType: "farm", position: { x: 5, y: 0, z: 5 }, islandId: "meadow" });
    expect(farm.success).toBe(true);
    for (let i = 0; i < 3; i++) {
      const plant = bus.execute({ command: "PLANT_CROP", farmPlotId: (farm as { buildingId?: string }).buildingId!, cropType: "wheat" });
      expect(plant.success).toBe(true);
    }
    const gate = bus.execute({ command: "BUILD_BRIDGE", islandA: "meadow", islandB: "frost" });
    expect(gate.pendingApproval).toBeDefined();
    const all = [
      ...state.buildings.map((b) => b.id),
      ...state.crops.map((c) => c.id),
      ...state.bridges.map((b) => b.id),
      ...state.pendingApprovals.map((a) => a.id),
    ];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("bridge topology and derived position (P0)", () => {
  it("derives the meadow<->frost deck position from the authoritative island pair", () => {
    // The midpoint of the two island anchors -- no invented coordinates, and no
    // dependence on what an LLM happens to put in `position`.
    expect(bridgeAnchorFor("meadow", "frost")).toEqual({ x: 32.5, y: 4, z: 16 });
    // Order must not matter: a bridge is an undirected edge.
    expect(bridgeAnchorFor("frost", "meadow")).toEqual(bridgeAnchorFor("meadow", "frost"));
    // Between the two islands it joins, on every axis.
    const anchor = bridgeAnchorFor("meadow", "frost");
    expect(anchor.x).toBeGreaterThan(ISLAND_ANCHORS.meadow.x);
    expect(anchor.x).toBeLessThan(ISLAND_ANCHORS.frost.x);
    expect(anchor.z).toBeLessThan(ISLAND_ANCHORS.meadow.z);
    expect(anchor.z).toBeGreaterThan(ISLAND_ANCHORS.frost.z);
  });

  it("builds the bridge at the derived position when the agent supplies none", () => {
    const { state, bus } = fresh();
    // No `position` -- exactly what a model that cannot know world coordinates sends.
    const request = bus.execute({ command: "BUILD_BRIDGE", islandA: "meadow", islandB: "frost" });
    expect(request.pendingApproval).toBeDefined();
    const approved = bus.resolveApproval(request.pendingApproval!.id, "approve");
    expect(approved.success).toBe(true);
    expect(approved.position).toEqual(bridgeAnchorFor("meadow", "frost"));

    const segment = state.buildings.find((building) => building.type === "bridge_segment")!;
    expect(segment.position).toEqual({ x: 32.5, y: 4, z: 16 });
    // Never the origin: an unpositioned bridge used to land at (0,0,0).
    expect(segment.position).not.toEqual({ x: 0, y: 0, z: 0 });
  });

  it("keeps bridges[] authoritative and consistent with the rendered building", () => {
    const { state, bus } = fresh();
    const request = bus.execute({ command: "BUILD_BRIDGE", islandA: "meadow", islandB: "frost" });
    bus.resolveApproval(request.pendingApproval!.id, "approve");

    expect(state.bridges).toHaveLength(1);
    const bridge = state.bridges[0];
    expect(bridge).toMatchObject({ islandA: "meadow", islandB: "frost" });
    // The topology edge and the physical segment are the SAME entity id, so a
    // renderer cannot draw one without the other.
    const segment = state.buildings.find((building) => building.type === "bridge_segment")!;
    expect(bridge.id).toBe(segment.id);

    // What the Observatory actually reads: snapshot topology + segment position.
    const snap = state.snapshot();
    expect(snap.bridges).toEqual([{ id: bridge.id, islandA: "meadow", islandB: "frost" }]);
    expect(snap.buildings.find((b) => b.id === bridge.id)!.position).toEqual(bridgeAnchorFor("meadow", "frost"));
    expect(snap.islands.find((i) => i.id === "meadow")!.connectivity).toEqual(["frost"]);
    expect(snap.islands.find((i) => i.id === "frost")!.connectivity).toEqual(["meadow"]);
  });

  it("is deterministic: a rebuilt world derives the identical position", () => {
    const build = (): unknown => {
      const state = new AstrixWorldState();
      const bus = new AstrixGameCommandBus(state);
      const request = bus.execute({ command: "BUILD_BRIDGE", islandA: "meadow", islandB: "frost" });
      bus.resolveApproval(request.pendingApproval!.id, "approve");
      return state.snapshot().buildings.find((b) => b.type === "bridge_segment")!.position;
    };
    // Restart-safe: nothing about the position depends on run order, time or ids.
    expect(build()).toEqual(build());
  });

  it("still honours an explicit position, and the approval reports the derived one", () => {
    const { bus } = fresh();
    const explicit = { x: 40, y: 0, z: 20 };
    const request = bus.execute({ command: "BUILD_BRIDGE", position: explicit, islandA: "meadow", islandB: "frost" });
    const approval = request.pendingApproval!;
    // Match-critical keys stay byte-identical to the command (approval matching).
    expect(approval.impact.position).toEqual(explicit);
    expect(approval.impact.bridgePosition).toEqual(explicit);
    const result = bus.resolveApproval(approval.id, "approve");
    expect(result.position).toEqual(explicit);
  });

  it("exposes the human-facing impact a BUILD_BRIDGE approval must carry", () => {
    const { bus } = fresh();
    const request = bus.execute({ command: "BUILD_BRIDGE", islandA: "meadow", islandB: "frost" });
    const approval = request.pendingApproval!;
    expect(approval.command).toBe("BUILD_BRIDGE");
    expect(approval.impact).toMatchObject({
      islandA: "meadow",
      islandB: "frost",
      cost: { wood: 3, stone: 1 },
      irreversible: true,
      permanent: true,
      resultingTopology: "meadow <-> frost",
      bridgePosition: { x: 32.5, y: 4, z: 16 },
    });
    expect(String(approval.impact.unlocks)).toContain("frost");
    expect(approval.reason).toContain("connectivity");
    // The agent never supplies an approval id, and none is echoed back to a human.
    expect(Object.keys(approval.impact)).not.toContain("approvalId");
    expect(Object.keys(approval.impact)).not.toContain("approval_id");
  });
});
