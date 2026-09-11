export type BiomeId = "meadow" | "frost" | "dusk";
export type ResourceType = "wood" | "stone" | "food" | "water" | "crystal";
export type Season = "spring" | "summer" | "autumn" | "winter";

export interface AstrixPosition {
  x: number;
  y: number;
  z: number;
}

export interface AstrixResourceNode {
  id: string;
  type: ResourceType;
  position: AstrixPosition;
  quantity: number;
  islandId: BiomeId;
}

export interface AstrixBuilding {
  id: string;
  type: "house" | "farm" | "storage" | "bridge_segment";
  position: AstrixPosition;
  health: number;
  islandId: BiomeId;
}

export interface AstrixCrop {
  id: string;
  farmPlotId: string;
  cropType: string;
  /** Growth progress 0..1 — 1.0 means harvestable. Advanced per simulated day. */
  growthStage: number;
  plantedAtDay: number;
}

export interface AstrixStateSnapshot {
  day: number;
  time: string;
  elapsedSeconds: number;
  population: number;
  food: number;
  foodSecurity: number;
  /** Current season (30-day year: Spring 1-8, Summer 9-16, Autumn 17-24, Winter 25-30). */
  season: Season;
  /** Days until the next Winter start (0 when it is Winter). */
  daysUntilWinter: number;
  /** Daily food consumption at current population/season (villagers eat 1/day, 1.5 in Winter). */
  foodPerDay: number;
  /** Whole days of food remaining at the current consumption rate, ignoring production. */
  daysOfFoodRemaining: number;
  /** Food that could be produced by harvesting every harvestable crop right now. */
  harvestableFood: number;
  /**
   * Food from ALL planted crops if they all mature (future production
   * potential), counted once each -- mature crops are included here as well as
   * in `harvestableFood`, so the two must never be summed.
   */
  growingFood: number;
  /**
   * Days until the soonest food can arrive: 0 when something is harvestable
   * now, otherwise the growth days the nearest planted crop still needs; with
   * nothing planted, the maturity time of a crop planted TODAY. `null` when no
   * crop can mature under current conditions (Winter halts all growth).
   */
  daysUntilNextHarvest: number | null;
  /** Projection: food + growingFood - consumption until Winter (assumes every planted crop matures). */
  projectedFoodAtWinter: number;
  /**
   * How much trouble the food supply is in, from the authoritative numbers:
   *   critical — under 3 days of food, OR the granary empties before the
   *              soonest possible harvest (starvation is already scheduled).
   *   high     — under 7 days of food, OR the village cannot reach Winter
   *              (projectedFoodAtWinter < 0).
   *   ok       — neither hazard applies.
   */
  foodPressureLevel: "critical" | "high" | "ok";
  resources: Record<ResourceType, number>;
  biomeHealth: Record<BiomeId, number>;
  crops: Array<AstrixCrop & { harvestable: boolean }>;
  /** Farmland per island: a farm consumes one plot; clearing terrain adds plots. */
  farmland: Array<{ islandId: BiomeId; capacity: number; used: number; available: number }>;
  bridges: Array<{ id: string; islandA: BiomeId; islandB: BiomeId }>;
  buildings: AstrixBuilding[];
  resourceNodes: AstrixResourceNode[];
  islands: { id: BiomeId; biome: string; health: number; connectivity: string[] }[];
  pendingApprovals: AstrixApproval[];
}

export interface AstrixApproval {
  id: string;
  command: string;
  reason: string;
  impact: Record<string, unknown>;
  createdAt: number;
}

export const DAY_SECONDS = 120;
export const FOOD_PER_VILLAGER_PER_DAY = 1;
/** Winter is harder: heating + harsher conditions raise consumption 50%. */
export const WINTER_FOOD_MULTIPLIER = 1.5;
export const YEAR_DAYS = 30;
/** Wheat: 8 days to mature in Spring/Summer/Autumn, 0 growth in Winter, yield 6 food. */
export const CROP_TYPES = {
  wheat: { daysToMature: 8, yield: 6 },
} as const;
export type CropType = keyof typeof CROP_TYPES;
/** Maximum crops a single farm can hold. */
export const FARM_CROP_CAPACITY = 3;
/** Initial farmland plots per island (a farm consumes one). */
export const FARMLAND_CAPACITY: Record<BiomeId, number> = { meadow: 2, frost: 2, dusk: 1 };

/**
 * AUTHORITATIVE island anchors, in Core coordinates: the centre of the region
 * each island owns. These are the regions the seeded world already uses
 * (meadow x10-30 z20-36, frost x44-56 z12-14, dusk x72-84 z32-36) written down
 * once, in Core, where world topology belongs.
 *
 * The Observatory MIRRORS these through its own `core_center` mapping; it does
 * not define them. Core stays the single source of truth for where things are,
 * so derived geometry (a bridge span) is computed here and merely rendered
 * there.
 */
export const ISLAND_ANCHORS: Record<BiomeId, AstrixPosition> = {
  meadow: { x: 17, y: 3.5, z: 20 },
  frost: { x: 48, y: 4.5, z: 12 },
  dusk: { x: 76, y: 3.2, z: 32 },
};

/**
 * Deterministic bridge position for an island pair: the midpoint of the two
 * island anchors, order-independent.
 *
 * WHY THIS EXISTS: `build_bridge` takes an island PAIR, not coordinates -- the
 * steward names the topology it wants and never invents world geometry. Before
 * this, a positionless bridge fell back to { 0, 0, 0 }, so the simulation said
 * "meadow <-> frost" while the world carried a structure at the origin. The
 * position is derived, not stored, so it is identical on every restart and
 * re-render.
 */
export function bridgeAnchorFor(a: BiomeId, b: BiomeId): AstrixPosition {
  const [first, second] = [a, b].slice().sort() as BiomeId[];
  const pa = ISLAND_ANCHORS[first];
  const pb = ISLAND_ANCHORS[second];
  // The deck spans two plateaus of different heights: its midpoint sits at the
  // mean of the two, which needs no invented constant.
  return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2, z: (pa.z + pb.z) / 2 };
}

export function seasonForDay(day: number): Season {
  const d = ((day - 1) % YEAR_DAYS) + 1;
  if (d <= 8) return "spring";
  if (d <= 16) return "summer";
  if (d <= 24) return "autumn";
  return "winter";
}

export function daysUntilWinterFor(day: number): number {
  const d = ((day - 1) % YEAR_DAYS) + 1;
  if (d < 25) return 25 - d;
  return YEAR_DAYS - d + 25; // next year's winter
}

/** Growth progress gained by a crop over one simulated day of the given season. */
export function growthPerDay(cropType: string, season: Season): number {
  if (season === "winter") return 0;
  const config = (CROP_TYPES as Record<string, { daysToMature: number; yield: number }>)[cropType];
  if (!config) return 0;
  return 1 / config.daysToMature;
}

/** Food a crop of this type yields when harvested. */
export function yieldOf(cropType: string): number {
  const config = (CROP_TYPES as Record<string, { daysToMature: number; yield: number }>)[cropType];
  return config?.yield ?? 1;
}

export class AstrixWorldState {
  private elapsed = 0;
  private nextId = 1;
  population = 4;
  food = 40;
  readonly resources: Record<ResourceType, number> = {
    wood: 30,
    stone: 15,
    food: 40,
    water: 0,
    crystal: 5,
  };
  readonly biomeHealth: Record<BiomeId, number> = {
    meadow: 0.8,
    frost: 0.6,
    dusk: 0.4,
  };
  readonly crops: AstrixCrop[] = [];
  readonly bridges: Array<{ id: string; islandA: BiomeId; islandB: BiomeId }> = [];
  readonly farmlandCapacity: Record<BiomeId, number> = { ...FARMLAND_CAPACITY };
  buildings: AstrixBuilding[] = [
    { id: "house-001", type: "house", position: { x: 20, y: 3.6, z: 30 }, health: 1, islandId: "meadow" },
  ];
  readonly resourceNodes: AstrixResourceNode[] = [
    { id: "tree-meadow-001", type: "wood", position: { x: 12, y: 3.5, z: 24 }, quantity: 5, islandId: "meadow" },
    { id: "tree-meadow-002", type: "wood", position: { x: 30, y: 3.5, z: 36 }, quantity: 5, islandId: "meadow" },
    { id: "rock-frost-001", type: "stone", position: { x: 44, y: 4.5, z: 14 }, quantity: 4, islandId: "frost" },
    { id: "crystal-dusk-001", type: "crystal", position: { x: 72, y: 3.2, z: 36 }, quantity: 3, islandId: "dusk" },
    { id: "water-source-001", type: "water", position: { x: 50, y: 0, z: 30 }, quantity: 999, islandId: "meadow" },
  ];
  readonly pendingApprovals: AstrixApproval[] = [];

  /** Advance the simulation. Returns true when at least one day boundary was crossed. */
  tick(deltaSeconds: number): boolean {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return false;
    const startDay = this.day;
    this.elapsed += deltaSeconds;
    const endDay = this.day;
    if (endDay <= startDay) return false;
    for (let day = startDay; day < endDay; day++) this.advanceDay(day + 1);
    return true;
  }

  get day(): number {
    return Math.floor(this.elapsed / DAY_SECONDS) + 1;
  }

  get season(): Season {
    return seasonForDay(this.day);
  }

  get time(): string {
    const secondsIntoDay = Math.floor(this.elapsed % DAY_SECONDS);
    const hour = 8 + Math.floor(secondsIntoDay / 5);
    const minute = (secondsIntoDay % 5) * 12;
    return `${String(hour % 24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  get foodSecurity(): number {
    return this.food / Math.max(1, this.population);
  }

  nextEntityId(prefix: string): string {
    // Identity integrity (trust-boundary hardening): generated ids must never
    // collide with seeded ones. The seed contains `house-001` while the
    // counter used to start at 1, so the first built house ALSO became
    // `house-001` — two buildings sharing one id. Every id-based lookup
    // (verification, farmPlotId references, bridge records) resolves by first
    // match, so a collision silently binds records to the wrong entity. Skip
    // taken ids instead of assuming the namespace is empty.
    let id: string;
    do {
      id = `${prefix}-${String(this.nextId++).padStart(3, "0")}`;
    } while (this.isIdTaken(id));
    return id;
  }

  private isIdTaken(id: string): boolean {
    return (
      this.buildings.some((b) => b.id === id) ||
      this.crops.some((c) => c.id === id) ||
      this.bridges.some((b) => b.id === id) ||
      this.resourceNodes.some((n) => n.id === id) ||
      this.pendingApprovals.some((a) => a.id === id)
    );
  }

  /**
   * Deterministic derived survival facts (computed from authoritative state,
   * never a recommendation). These give the steward the facts it needs to
   * reason about consequences without being scripted toward an action.
   */
  private survivalProjection(): {
    foodPerDay: number;
    daysOfFoodRemaining: number;
    harvestableFood: number;
    growingFood: number;
    daysUntilNextHarvest: number | null;
    projectedFoodAtWinter: number;
    foodPressureLevel: "critical" | "high" | "ok";
  } {
    const foodPerDay = this.population * FOOD_PER_VILLAGER_PER_DAY * (this.season === "winter" ? WINTER_FOOD_MULTIPLIER : 1);
    const daysOfFoodRemaining = Math.floor(this.food / Math.max(1, foodPerDay));
    let harvestableFood = 0;
    let growingFood = 0;
    let soonestHarvest = Number.POSITIVE_INFINITY;
    for (const crop of this.crops) {
      const yieldAmount = yieldOf(crop.cropType);
      // growingFood is the yield of EVERY planted crop, mature ones included --
      // counted once. harvestableFood is the already-mature subset of the same
      // food, so the projection below adds growingFood alone.
      growingFood += yieldAmount;
      if (crop.growthStage >= 1) {
        harvestableFood += yieldAmount;
        soonestHarvest = 0;
        continue;
      }
      const perDay = growthPerDay(crop.cropType, this.season);
      if (perDay > 0) soonestHarvest = Math.min(soonestHarvest, Math.ceil((1 - crop.growthStage) / perDay));
    }
    // With nothing in the ground the soonest food is whatever could be planted
    // TODAY -- which is how long a decision made now takes to feed anyone. In
    // Winter nothing grows at all, so no harvest is reachable: null, not a
    // number that would read as a promise.
    const plantableToday = growthPerDay("wheat", this.season) > 0 ? CROP_TYPES.wheat.daysToMature : null;
    const daysUntilNextHarvest = Number.isFinite(soonestHarvest) ? soonestHarvest : plantableToday;
    const projectedFoodAtWinter = this.food + growingFood - daysUntilWinterFor(this.day) * foodPerDay;
    // Starvation is already scheduled when the granary empties before the
    // soonest harvest can land. That is a fact about THIS state, not a forecast
    // of agent behaviour, so it belongs in the authoritative telemetry: a
    // village with 7 days of food and an 8-day harvest gap is not "ok".
    const starvesBeforeHarvest = daysUntilNextHarvest !== null && daysOfFoodRemaining < daysUntilNextHarvest;
    const foodPressureLevel: "critical" | "high" | "ok" =
      daysOfFoodRemaining < 3 || starvesBeforeHarvest
        ? "critical"
        : daysOfFoodRemaining < 7 || projectedFoodAtWinter < 0
          ? "high"
          : "ok";
    return { foodPerDay, daysOfFoodRemaining, harvestableFood, growingFood, daysUntilNextHarvest, projectedFoodAtWinter, foodPressureLevel };
  }

  snapshot(): AstrixStateSnapshot {
    const usedFarmland = (island: BiomeId): number =>
      this.buildings.filter((building) => building.type === "farm" && building.islandId === island).length;
    return {
      day: this.day,
      time: this.time,
      elapsedSeconds: this.elapsed,
      population: this.population,
      food: this.food,
      foodSecurity: this.foodSecurity,
      season: this.season,
      daysUntilWinter: daysUntilWinterFor(this.day),
      ...this.survivalProjection(),
      resources: { ...this.resources },
      biomeHealth: { ...this.biomeHealth },
      crops: this.crops.map((crop) => ({ ...crop, harvestable: crop.growthStage >= 1 })),
      farmland: (["meadow", "frost", "dusk"] as BiomeId[]).map((island) => {
        const capacity = this.farmlandCapacity[island];
        const used = usedFarmland(island);
        return { islandId: island, capacity, used, available: Math.max(0, capacity - used) };
      }),
      bridges: this.bridges.map((bridge) => ({ ...bridge })),
      buildings: this.buildings.map((building) => ({ ...building, position: { ...building.position } })),
      resourceNodes: this.resourceNodes.map((node) => ({ ...node, position: { ...node.position } })),
      islands: [
        { id: "meadow", biome: "meadow", health: this.biomeHealth.meadow, connectivity: connectivityFor("meadow", this.bridges) },
        { id: "frost", biome: "frost", health: this.biomeHealth.frost, connectivity: connectivityFor("frost", this.bridges) },
        { id: "dusk", biome: "dusk", health: this.biomeHealth.dusk, connectivity: connectivityFor("dusk", this.bridges) },
      ],
      pendingApprovals: this.pendingApprovals.map((approval) => ({ ...approval, impact: { ...approval.impact } })),
    };
  }

  /**
   * One full simulated day: seasonal food consumption (winter is harder),
   * starvation when food runs out, and crop growth for that day's season.
   */
  private advanceDay(day: number): void {
    const season = seasonForDay(day);
    const required = this.population * FOOD_PER_VILLAGER_PER_DAY * (season === "winter" ? WINTER_FOOD_MULTIPLIER : 1);
    if (this.food >= required) {
      this.food -= required;
    } else {
      const ration = FOOD_PER_VILLAGER_PER_DAY * (season === "winter" ? WINTER_FOOD_MULTIPLIER : 1);
      const shortfall = required - this.food;
      const starved = Math.min(this.population, Math.max(1, Math.ceil(shortfall / ration)));
      this.population -= starved;
      this.food = 0;
    }
    this.resources.food = this.food;
    for (const crop of this.crops) {
      crop.growthStage = Math.min(1, crop.growthStage + growthPerDay(crop.cropType, season));
    }
  }
}

function connectivityFor(island: BiomeId, bridges: Array<{ id: string; islandA: BiomeId; islandB: BiomeId }>): string[] {
  return bridges.filter((bridge) => bridge.islandA === island || bridge.islandB === island).map((bridge) => bridge.islandA === island ? bridge.islandB : bridge.islandA);
}
