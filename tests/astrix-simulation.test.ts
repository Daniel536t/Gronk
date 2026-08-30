// Simulation-layer tests (P2 simulation phase): seasons, crop lifecycle,
// harvest, farmland constraints, winter pressure, starvation, day boundaries.
import { describe, it, expect } from "vitest";
import { AstrixWorldState, DAY_SECONDS, FARM_CROP_CAPACITY, seasonForDay } from "../src/astrix/state";
import { AstrixGameCommandBus } from "../src/astrix/commandBus";
import { createAstrixService } from "../src/astrix/server";

function fresh() {
  const state = new AstrixWorldState();
  const bus = new AstrixGameCommandBus(state);
  return { state, bus };
}

/** Advance the world by a whole number of days. */
function advanceDays(state: AstrixWorldState, days: number): void {
  state.tick(DAY_SECONDS * days);
}

function placeFarm(bus: AstrixGameCommandBus, x: number, islandId: "meadow" | "frost" | "dusk" = "meadow") {
  return bus.execute({ command: "PLACE_BUILDING", buildingType: "farm", position: { x, y: 0, z: 10 }, islandId });
}

describe("ASTrix seasons", () => {
  it("follows a 30-day year: spring 1-8, summer 9-16, autumn 17-24, winter 25-30", () => {
    expect(seasonForDay(1)).toBe("spring");
    expect(seasonForDay(8)).toBe("spring");
    expect(seasonForDay(9)).toBe("summer");
    expect(seasonForDay(16)).toBe("summer");
    expect(seasonForDay(17)).toBe("autumn");
    expect(seasonForDay(24)).toBe("autumn");
    expect(seasonForDay(25)).toBe("winter");
    expect(seasonForDay(30)).toBe("winter");
    expect(seasonForDay(31)).toBe("spring"); // year wraps
    expect(seasonForDay(60)).toBe("winter");
  });

  it("reports season and days-until-winter in the snapshot", () => {
    const { state } = fresh();
    let snap = state.snapshot();
    expect(snap.season).toBe("spring");
    expect(snap.daysUntilWinter).toBe(24);
    advanceDays(state, 24); // day 25
    snap = state.snapshot();
    expect(snap.season).toBe("winter");
    expect(snap.daysUntilWinter).toBe(30); // next year's winter
  });

  it("emits SEASON_CHANGED on the agent event stream when the season flips", () => {
    const service = createAstrixService();
    service.tick(DAY_SECONDS * 8); // day 9 -> summer
    const types = service.events.all().map((e) => e.type);
    expect(types).toContain("SEASON_CHANGED");
    const change = service.events.all().find((e) => e.type === "SEASON_CHANGED");
    expect(change?.data?.season).toBe("summer");
    expect(change?.data?.day).toBe(9);
  });
});

describe("ASTrix crop lifecycle", () => {
  it("grows to harvestable over 8 days in spring/summer", () => {
    const { state, bus } = fresh();
    const farm = placeFarm(bus, 10);
    const planted = bus.execute({ command: "PLANT_CROP", farmPlotId: String(farm.buildingId), cropType: "wheat" });
    expect(planted.success).toBe(true);
    const cropId = String(planted.cropId);

    expect(state.snapshot().crops[0].growthStage).toBe(0);
    expect(state.snapshot().crops[0].harvestable).toBe(false);
    expect(state.snapshot().crops[0].plantedAtDay).toBe(1);

    advanceDays(state, 4); // day 5
    const mid = state.snapshot().crops.find((c) => c.id === cropId)!;
    expect(mid.growthStage).toBeCloseTo(0.5);
    expect(mid.harvestable).toBe(false);

    advanceDays(state, 4); // day 9
    const ripe = state.snapshot().crops.find((c) => c.id === cropId)!;
    expect(ripe.growthStage).toBe(1);
    expect(ripe.harvestable).toBe(true);
  });

  it("stops growing in winter and resumes the next spring", () => {
    const { state, bus } = fresh();
    const farm = placeFarm(bus, 10);
    const planted = bus.execute({ command: "PLANT_CROP", farmPlotId: String(farm.buildingId), cropType: "wheat" });
    const cropId = String(planted.cropId);
    advanceDays(state, 23); // day 24 (autumn), growth 23/8 = 2.875 -> capped at 1
    // Planted on day 1, so it is already mature before winter — plant a fresh
    // crop right at the winter edge to observe the freeze.
    const frozen = bus.execute({ command: "PLANT_CROP", farmPlotId: String(farm.buildingId), cropType: "wheat" });
    const frozenId = String(frozen.cropId);
    advanceDays(state, 7); // days 25-31: 6 winter days + 1 spring day
    const afterWinter = state.snapshot().crops.find((c) => c.id === frozenId)!;
    // Winter contributed 0 growth; the single spring day contributed 1/8.
    expect(afterWinter.growthStage).toBeCloseTo(1 / 8);
    void cropId;
  });

  it("harvests a mature crop into food and removes it", () => {
    const { state, bus } = fresh();
    const farm = placeFarm(bus, 10);
    const planted = bus.execute({ command: "PLANT_CROP", farmPlotId: String(farm.buildingId), cropType: "wheat" });
    advanceDays(state, 8);

    const before = state.food;
    const result = bus.execute({ command: "HARVEST_CROP", cropId: String(planted.cropId) });
    expect(result.success).toBe(true);
    expect(result.foodGained).toBe(6);
    expect(state.food).toBe(before + 6);
    expect(state.resources.food).toBe(state.food);
    expect(state.crops).toHaveLength(0);
  });

  it("rejects harvesting an immature crop", () => {
    const { state, bus } = fresh();
    const farm = placeFarm(bus, 10);
    const planted = bus.execute({ command: "PLANT_CROP", farmPlotId: String(farm.buildingId), cropType: "wheat" });
    advanceDays(state, 3);
    const result = bus.execute({ command: "HARVEST_CROP", cropId: String(planted.cropId) });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not harvestable");
    expect(state.crops).toHaveLength(1);
  });

  it("rejects harvesting an unknown crop", () => {
    const { bus } = fresh();
    const result = bus.execute({ command: "HARVEST_CROP", cropId: "crop-999" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("crop not found");
  });

  it("limits each farm to 3 crops", () => {
    const { state, bus } = fresh();
    const farm = placeFarm(bus, 10);
    const farmId = String(farm.buildingId);
    for (let i = 0; i < FARM_CROP_CAPACITY; i++) {
      const planted = bus.execute({ command: "PLANT_CROP", farmPlotId: farmId, cropType: "wheat" });
      expect(planted.success).toBe(true);
    }
    const overflow = bus.execute({ command: "PLANT_CROP", farmPlotId: farmId, cropType: "wheat" });
    expect(overflow.success).toBe(false);
    expect(overflow.error).toContain("farm plot is full");
    expect(state.crops).toHaveLength(FARM_CROP_CAPACITY);
  });
});

describe("ASTrix farmland constraints", () => {
  it("allows only the starting meadow farmland (2 farms) and rejects a third", () => {
    const { state, bus } = fresh();
    expect(placeFarm(bus, 10).success).toBe(true);
    expect(placeFarm(bus, 14).success).toBe(true);
    const third = placeFarm(bus, 18);
    expect(third.success).toBe(false);
    expect(third.error).toContain("no available farmland on meadow");
    expect(state.buildings.filter((b) => b.type === "farm")).toHaveLength(2);
  });

  it("clearing terrain creates farmland on the cleared island after approval", () => {
    const { state, bus } = fresh();
    expect(placeFarm(bus, 10).success).toBe(true);
    expect(placeFarm(bus, 14).success).toBe(true);
    expect(placeFarm(bus, 18).success).toBe(false);

    const request = bus.execute({ command: "CLEAR_TERRAIN", position: { x: 12, y: 3.5, z: 24 }, radius: 2 });
    expect(request.success).toBe(false);
    expect(request.pendingApproval).toBeDefined();
    expect(state.farmlandCapacity.meadow).toBe(2); // no change before approval

    const approved = bus.resolveApproval(request.pendingApproval!.id, "approve");
    expect(approved.success).toBe(true);
    expect(approved.woodGained).toBe(1);
    expect(state.farmlandCapacity.meadow).toBe(3);
    expect(state.snapshot().farmland.find((f) => f.islandId === "meadow")!.available).toBe(1);

    expect(placeFarm(bus, 18).success).toBe(true);
  });

  it("clearing terrain permanently removes nodes and lowers biome health", () => {
    const { state, bus } = fresh();
    const healthBefore = state.biomeHealth.meadow;
    const request = bus.execute({ command: "CLEAR_TERRAIN", position: { x: 12, y: 3.5, z: 24 }, radius: 2 });
    const approved = bus.resolveApproval(request.pendingApproval!.id, "approve");
    expect(approved.success).toBe(true);
    expect(state.resourceNodes.find((n) => n.id === "tree-meadow-001")).toBeUndefined();
    expect(state.resourceNodes).toHaveLength(4);
    expect(state.biomeHealth.meadow).toBeLessThan(healthBefore);
    expect(approved.permanent).toBe(true);
  });
});

describe("ASTrix population survival pressure", () => {
  it("consumes 1 food per villager per day", () => {
    const { state } = fresh();
    expect(state.food).toBe(40);
    advanceDays(state, 1);
    expect(state.food).toBe(36);
  });

  it("applies winter consumption pressure (1.5x)", () => {
    const { state } = fresh();
    state.food = 200; // isolate consumption from starvation: ample reserves
    advanceDays(state, 24); // day 25 (end of autumn)
    const before = state.food;
    advanceDays(state, 1); // winter day 25 -> 26
    expect(before - state.food).toBe(6); // 4 villagers * 1.5
  });

  it("starves villagers when food runs out and can collapse the village", () => {
    const { state } = fresh();
    state.food = 3;
    advanceDays(state, 1);
    expect(state.population).toBe(3);
    expect(state.food).toBe(0);

    // With no food at all the remaining villagers starve quickly.
    state.food = 0;
    for (let i = 0; i < 4 && state.population > 0; i++) advanceDays(state, 1);
    expect(state.population).toBe(0);
  });

  it("handles multi-day tick jumps by applying every day boundary", () => {
    const { state } = fresh();
    const changed = state.tick(DAY_SECONDS * 3); // days 2, 3, 4
    expect(changed).toBe(true);
    expect(state.day).toBe(4);
    expect(state.food).toBe(40 - 3 * 4);
  });

  it("keeps resources.food in sync with food", () => {
    const { state, bus } = fresh();
    const farm = placeFarm(bus, 10);
    const planted = bus.execute({ command: "PLANT_CROP", farmPlotId: String(farm.buildingId), cropType: "wheat" });
    advanceDays(state, 8);
    bus.execute({ command: "HARVEST_CROP", cropId: String(planted.cropId) });
    advanceDays(state, 1);
    expect(state.resources.food).toBe(state.food);
  });
});
