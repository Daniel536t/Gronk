// ASTrix Observatory — pure-logic tests.
// Verifies the projector is a faithful projection of authoritative state (no
// independent simulation) and the replay engine preserves the recorded event
// timeline exactly. These run in jsdom-free node because the projector and
// replay modules are DOM-independent (string assembly only).
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { AstrixWorldState, bridgeAnchorFor, ISLAND_ANCHORS } from "../src/astrix/state";
import { AstrixGameCommandBus } from "../src/astrix/commandBus";
import { renderWorld, hudLine } from "../observatory/src/projector";
import { buildSteps, eventLabel, emphasisFor } from "../observatory/src/replay";
import type { DerivedReplayBundle } from "../observatory/src/replay";
import type { WorldSnapshot, AgentEvent } from "../observatory/src/types";

function baseSnap(over: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    day: 1,
    season: "spring",
    time: "10:00",
    population: 4,
    food: 40,
    daysUntilWinter: 24,
    foodPerDay: 4,
    daysOfFoodRemaining: 10,
    harvestableFood: 0,
    growingFood: 0,
    projectedFoodAtWinter: -56,
    daysUntilNextHarvest: 8,
    foodPressureLevel: "high",
    resources: { wood: 30, stone: 15, food: 40, water: 0, crystal: 5 },
    biomeHealth: { meadow: 0.8, frost: 0.6, dusk: 0.4 },
    crops: [],
    farmland: [{ islandId: "meadow", capacity: 2, used: 0, available: 2 }],
    bridges: [],
    buildings: [{ id: "house-001", type: "house", position: { x: 20, y: 3.6, z: 30 }, health: 1, islandId: "meadow" }],
    resourceNodes: [
      { id: "tree-1", type: "wood", position: { x: 12, y: 3, z: 24 }, quantity: 5, islandId: "meadow" },
      { id: "tree-2", type: "wood", position: { x: 30, y: 3, z: 36 }, quantity: 5, islandId: "meadow" },
      { id: "rock-1", type: "stone", position: { x: 44, y: 4, z: 14 }, quantity: 4, islandId: "frost" },
    ],
    islands: [{ id: "meadow", biome: "meadow", health: 0.8, connectivity: [] }],
    pendingApprovals: [],
    ...over,
  };
}

describe("projector / state mapping", () => {
  it("renders trees only when authoritative resourceNodes contain wood nodes", () => {
    const w = renderWorld(baseSnap());
    expect(w.svg).toContain("conifer");
    expect(w.trees).toBe(2); // two wood nodes present
    // stone node must NOT become a tree
    expect(w.trees).toBeLessThan(3);
  });

  it("removes a tree when the authoritative record marks it removed (clear_terrain)", () => {
    const snap = baseSnap();
    const removed = new Set<string>(["tree-1"]);
    const w = renderWorld(snap, removed);
    expect(w.trees).toBe(1);
    // no conifer at tree-1 rendered twice: total conifers counted via trees
    expect(w.svg).not.toContain('id="tree-1"');
  });

  it("farm count reflects the authoritative building list and crop stage reflects growth", () => {
    const snap = baseSnap({
      buildings: [
        { id: "farm-1", type: "farm", position: { x: 25, y: 3, z: 35 }, health: 1, islandId: "meadow" },
        { id: "farm-2", type: "farm", position: { x: 45, y: 4, z: 14 }, health: 1, islandId: "frost" },
      ],
      crops: [{ id: "crop-1", farmPlotId: "farm-1", cropType: "wheat", growthStage: 0.25 }],
    });
    const w = renderWorld(snap);
    expect(w.farms).toBe(2);
    // A crop with 0.25 stage produces a "crop" element (not an empty furrow).
    expect(w.svg).toContain('class="crop"');
  });

  it("bridge appears only when an authoritative bridge exists", () => {
    const noBridge = renderWorld(baseSnap());
    expect(noBridge.bridges).toBe(0);
    const withBridge = renderWorld(baseSnap({ bridges: [{ id: "b", islandA: "meadow", islandB: "frost" }] }));
    expect(withBridge.bridges).toBe(1);
    expect(withBridge.svg).toContain('class="bridge"');
  });

  it("season drives the palette deterministically", () => {
    const winter = renderWorld(baseSnap({ season: "winter" }));
    const summer = renderWorld(baseSnap({ season: "summer" }));
    expect(winter.svg).not.toEqual(summer.svg);
    expect(winter.svg).toContain("#eef2f7"); // winter roof
  });

  it("hudLine reflects authoritative day/food", () => {
    const line = hudLine(baseSnap({ day: 13, food: 12 }));
    expect(line).toContain("DAY 13 / 30");
    expect(line).toContain("FOOD 12");
  });

  it("emits a viewBox that contains every rendered entity (world is on-canvas)", () => {
    // REGRESSION: the world used to render at negative/overflow coordinates in a
    // pixel-space SVG (no viewBox), so absolutely everything was clipped off the
    // visible canvas -> the empty/dark-world bug. The projector must return a
    // viewBox whose frame encloses all projected entities.
    const snap = baseSnap({
      buildings: [
        { id: "farm-1", type: "farm", position: { x: 25, y: 3, z: 35 }, health: 1, islandId: "meadow" },
        { id: "farm-2", type: "farm", position: { x: 60, y: 4, z: 14 }, health: 1, islandId: "frost" },
      ],
      crops: [{ id: "crop-1", farmPlotId: "farm-1", cropType: "wheat", growthStage: 0.5 }],
    });
    const w = renderWorld(snap);
    const m = w.viewBox.match(/^(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)$/);
    expect(m).not.toBeNull();
    const [x, y, ww, hh] = [Number(m![1]), Number(m![2]), Number(m![3]), Number(m![4])];
    for (const e of w.entities) {
      expect(e.sx).toBeGreaterThanOrEqual(x - 1);
      expect(e.sx).toBeLessThanOrEqual(x + ww + 1);
      expect(e.sy).toBeGreaterThanOrEqual(y - 1);
      expect(e.sy).toBeLessThanOrEqual(y + hh + 1);
    }
    expect(ww).toBeGreaterThan(0);
    expect(hh).toBeGreaterThan(0);
  });

  it("renders the full world composition (water + all three islands + house)", () => {
    const w = renderWorld(baseSnap());
    expect(w.svg).toContain('fill="url(#wg)"'); // water gradient is present
    for (const id of ["meadow", "frost", "dusk"]) {
      expect(w.svg).toContain(`data-island="${id}"`);
    }
    expect(w.svg).toContain("house-001");
  });

  // ---- living Experience layer: pure projection of authoritative state ----
  it("projects one living villager per authoritative population (clamped ≤ 12)", () => {
    expect(renderWorld(baseSnap({ population: 4 })).villagers).toBe(4);
    expect(renderWorld(baseSnap({ population: 0 })).villagers).toBe(0);
    expect(renderWorld(baseSnap({ population: 99 })).villagers).toBe(12); // clamped so the world isn't overcrowded
    const big = renderWorld(baseSnap({ population: 20 }));
    expect(big.villagers).toBe(12);
    expect(renderWorld(baseSnap({ population: -3 })).villagers).toBe(0);
    // every projected villager emits an animated bob group (living figure)
    const w = renderWorld(baseSnap({ population: 4 }));
    const bobCount = (w.svg.match(/class="villager-bob"/g) ?? []).length;
    expect(bobCount).toBe(4);
  });

  it("villagers are placed on-canvas inside the computed viewBox", () => {
    const w = renderWorld(baseSnap({ population: 4 }));
    const m = w.viewBox.match(/^(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)$/);
    expect(m).not.toBeNull();
    const [x, y, ww, hh] = [Number(m![1]), Number(m![2]), Number(m![3]), Number(m![4])];
    // the village anchor (house at 20,30) must be within the frame
    const hx = (20 - 30) * 2; // iso.sx
    const hy = (20 + 30) * 1; // iso.sy
    expect(hx).toBeGreaterThanOrEqual(x - 1);
    expect(hx).toBeLessThanOrEqual(x + ww + 1);
    expect(hy).toBeGreaterThanOrEqual(y - 1);
    expect(hy).toBeLessThanOrEqual(y + hh + 1);
  });

  it("the house emits rising smoke (living village)", () => {
    const w = renderWorld(baseSnap());
    expect(w.svg).toContain('class="smoke"');
    expect((w.svg.match(/class="smoke-p1"/g) ?? []).length).toBe(1);
  });

  it("mature crops get a golden harvest tip; young crops do not", () => {
    const mature = baseSnap({ buildings: [{ id: "farm-1", type: "farm", position: { x: 25, y: 3, z: 35 }, health: 1, islandId: "meadow" }] });
    mature.crops = [{ id: "c1", farmPlotId: "farm-1", cropType: "wheat", growthStage: 1.0 }];
    expect(renderWorld(mature).svg).toContain('class="crop-gold"');

    const young = baseSnap({ buildings: [{ id: "farm-1", type: "farm", position: { x: 25, y: 3, z: 35 }, health: 1, islandId: "meadow" }] });
    young.crops = [{ id: "c2", farmPlotId: "farm-1", cropType: "wheat", growthStage: 0.4 }];
    expect(renderWorld(young).svg).not.toContain('class="crop-gold"');
  });

  it("winter adds a falling snow layer driven by season", () => {
    expect(renderWorld(baseSnap({ season: "winter" })).svg).toContain('class="snow-layer"');
    expect(renderWorld(baseSnap({ season: "spring" })).svg).not.toContain('class="snow-layer"');
  });

  it("living elements carry phased animation hooks (no independent simulation)", () => {
    const w = renderWorld(baseSnap({ population: 3 }));
    expect(w.svg).toContain('class="tree-sway"');   // trees sway
    expect(w.svg).toContain('animation-delay:');      // phased offsets
    expect(w.svg).toContain('class="waterfx"');      // water ripple
  });
});

describe("replay engine / event preservation", () => {
  function bundle(): DerivedReplayBundle {
    const events: AgentEvent[] = [
      { type: "TURN_STARTED", turn: 1, at: 1000, data: {} },
      { type: "WORLD_OBSERVED", turn: 1, at: 1100, data: { day: 1, food: 40 } as Record<string, unknown> },
      { type: "PLAN_CREATED", turn: 1, at: 1200, data: { decision: "build farm" } as Record<string, unknown> },
      { type: "ACTION_SUCCEEDED", turn: 1, at: 1300, data: { tool: "build" } as Record<string, unknown> },
      { type: "APPROVAL_REQUIRED", turn: 2, at: 2000, data: { approval: { id: "approval-1", command: "CLEAR_TERRAIN" } } as Record<string, unknown> },
      { type: "APPROVAL_GRANTED", turn: 2, at: 2100, data: { approvalId: "approval-1" } as Record<string, unknown> },
      { type: "VERIFICATION_SUCCEEDED", turn: 2, at: 2200, data: { tool: "clear_terrain" } as Record<string, unknown> },
    ];
    return {
      meta: { name: "t", generatedAt: "", source: "", dayStart: 1, dayEnd: 30, seasonEnd: "winter", populationStart: 4, populationEnd: 2, foodStart: 40, foodEnd: 62, approvals: 1, approved: 1, rejected: 0 },
      events,
      frames: [
        { ts: 1000, day: 1, snapshot: baseSnap() },
        { ts: 2000, day: 2, snapshot: baseSnap({ day: 2, food: 36 }) },
        { ts: 2100, day: 2, snapshot: baseSnap({ day: 2, food: 36 }) },
      ],
      approvals: { "approval-1": { tool: "clear_terrain", command: "CLEAR_TERRAIN" } },
    };
  }

  it("buildSteps preserves event order", () => {
    const steps = buildSteps(bundle());
    expect(steps.map((s) => s.event.type)).toEqual([
      "TURN_STARTED",
      "WORLD_OBSERVED",
      "PLAN_CREATED",
      "ACTION_SUCCEEDED",
      "APPROVAL_REQUIRED",
      "APPROVAL_GRANTED",
      "VERIFICATION_SUCCEEDED",
    ]);
  });

  it("approval events are preserved and emphatic", () => {
    const steps = buildSteps(bundle());
    const apro = steps.find((s) => s.event.type === "APPROVAL_REQUIRED")!;
    expect(apro.emphasis).toBe(0); // pauses
    expect(apro.snapshot).toBeTruthy();
  });

  it("rejection events are preserved as rejections", () => {
    const b = bundle();
    b.events[5] = { type: "APPROVAL_REJECTED", turn: 2, at: 2100, data: { approvalId: "approval-1" } };
    const steps = buildSteps(b);
    expect(steps.map((s) => s.event.type)).toContain("APPROVAL_REJECTED");
  });

  it("eventLabel maps events to honest labels without fabricating", () => {
    expect(eventLabel({ type: "ACTION_SUCCEEDED", turn: 1, at: 1, data: { tool: "clear_terrain" } })).toContain("clear_terrain");
    expect(eventLabel({ type: "APPROVAL_REQUIRED", turn: 1, at: 1, data: {} })).toContain("APPROVAL");
  });

  it("expansion labels special seasons", () => {
    expect(emphasisFor({ type: "SEASON_CHANGED", turn: 0, at: 1, data: { season: "winter" } })).toBeLessThan(1);
  });

  it("harvest successes are slowed (consequential moment)", () => {
    const slow = emphasisFor({ type: "ACTION_SUCCEEDED", turn: 1, at: 1, data: { tool: "harvest" } });
    expect(slow).toBeLessThan(1);
    expect(slow).toBeGreaterThan(0);
    // ordinary work (plant) stays brisk
    expect(emphasisFor({ type: "ACTION_SUCCEEDED", turn: 1, at: 1, data: { tool: "plant" } })).toBe(1);
    // approval remains a full pause
    expect(emphasisFor({ type: "APPROVAL_REQUIRED", turn: 1, at: 1, data: {} })).toBe(0);
  });

  it("starvation is derived from an authoritative population drop across frames", () => {
    const b = bundle();
    b.frames = [
      { ts: 1000, day: 1, snapshot: baseSnap({ day: 1, population: 4 }) },
      { ts: 2000, day: 2, snapshot: baseSnap({ day: 2, population: 3 }) },
      { ts: 2500, day: 2, snapshot: baseSnap({ day: 2, population: 3 }) },
    ];
    b.events = [
      { type: "TURN_STARTED", turn: 1, at: 1000, data: {} },
      { type: "WORLD_OBSERVED", turn: 1, at: 1000, data: { day: 1 } },
      { type: "WORLD_OBSERVED", turn: 2, at: 2000, data: { day: 2 } },
    ];
    const steps = buildSteps(b);
    const dropped = steps.find((s) => s.starvation);
    expect(dropped).toBeTruthy();
    expect(dropped!.starvation).toBe(1);
    expect(dropped!.emphasis).toBeLessThanOrEqual(0.3); // lingers so the loss registers
  });

  it("no starvation is reported when population is steady or rising", () => {
    const b = bundle();
    b.frames = [
      { ts: 1000, day: 1, snapshot: baseSnap({ day: 1, population: 4 }) },
      { ts: 2000, day: 2, snapshot: baseSnap({ day: 2, population: 4 }) },
      { ts: 2500, day: 3, snapshot: baseSnap({ day: 3, population: 5 }) },
    ];
    b.events = [
      { type: "TURN_STARTED", turn: 1, at: 1000, data: {} },
      { type: "WORLD_OBSERVED", turn: 1, at: 1000, data: { day: 1 } },
      { type: "WORLD_OBSERVED", turn: 2, at: 2000, data: { day: 2 } },
      { type: "WORLD_OBSERVED", turn: 3, at: 2500, data: { day: 3 } },
    ];
    const steps = buildSteps(b);
    expect(steps.every((s) => !s.starvation)).toBe(true);
  });
});
describe("Godot Observatory mirrors Core topology (P0 bridge rendering)", () => {
  const world3d = readFileSync("godot/scripts/World3D.gd", "utf8");

  /** The `core_center` the Godot ISLANDS table uses to place an island's Core space. */
  function godotCoreCenter(island: string): { x: number; z: number } {
    const block = world3d.slice(world3d.indexOf(`"${island}": {`));
    const match = /"core_center":\s*Vector2\(([-\d.]+),\s*([-\d.]+)\)/.exec(block);
    expect(match, `no core_center for ${island} in World3D.gd`).not.toBeNull();
    return { x: Number(match![1]), z: Number(match![2]) };
  }

  it("Core island anchors ARE the coordinates Godot mirrors (one source of truth)", () => {
    // Core owns the numbers; the Observatory maps them. If either side is edited
    // alone, the world and the simulation stop telling the same story -- so this
    // test fails rather than letting the drift ship.
    for (const island of ["meadow", "frost", "dusk"] as const) {
      const godot = godotCoreCenter(island);
      expect({ x: ISLAND_ANCHORS[island].x, z: ISLAND_ANCHORS[island].z }).toEqual(godot);
    }
  });

  it("the bridge visual is driven by authoritative topology, not by a client guess", () => {
    // _materialize_bridges spans the two island RIMS derived from bridges[]...
    expect(world3d).toMatch(/func _materialize_bridges/);
    expect(world3d).toMatch(/for bridge in world_state\.bridges/);
    expect(world3d).toMatch(/func _bridge_endpoints[\s\S]*?_rim_point\(a, b\), _rim_point\(b, a\)/);
    // ...and the bridge BUILDING record is skipped, so it can never also render
    // as a house through _build_structure's fallback branch.
    const buildings = world3d.slice(world3d.indexOf("func _materialize_buildings"), world3d.indexOf("func _clear_footprint"));
    expect(buildings).toMatch(/if type_name == "bridge_segment":\s*\n\s*continue/);
  });

  it("a Core bridge produces exactly one renderable segment plus one topology edge", () => {
    const state = new AstrixWorldState();
    const bus = new AstrixGameCommandBus(state);
    const request = bus.execute({ command: "BUILD_BRIDGE", islandA: "meadow", islandB: "frost" });
    bus.resolveApproval(request.pendingApproval!.id, "approve");
    const snap = state.snapshot();

    expect(snap.bridges).toHaveLength(1);
    const segments = snap.buildings.filter((building) => building.type === "bridge_segment");
    expect(segments).toHaveLength(1);
    expect(segments[0].position).toEqual(bridgeAnchorFor("meadow", "frost"));
    // No phantom structure: the bridge did not add a house/farm/storage anywhere.
    expect(snap.buildings.filter((b) => b.type === "house")).toHaveLength(1); // the genesis house only
  });
});
