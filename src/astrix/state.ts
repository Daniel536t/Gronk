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
  /** Food from all planted crops if they all mature (future production potential). */
  growingFood: number;
  /** Projection: food + harvestableFood + growingFood - consumption until Winter (assumes all crops mature). */
  projectedFoodAtWinter: number;
  /** "critical" | "high" | "ok" — deterministic from daysOfFoodRemaining. */
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
    return `${prefix}-${String(this.nextId++).padStart(3, "0")}`;
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
    projectedFoodAtWinter: number;
    foodPressureLevel: "critical" | "high" | "ok";
  } {
    const foodPerDay = this.population * FOOD_PER_VILLAGER_PER_DAY * (this.season === "winter" ? WINTER_FOOD_MULTIPLIER : 1);
    const daysOfFoodRemaining = Math.floor(this.food / Math.max(1, foodPerDay));
    let harvestableFood = 0;
    let growingFood = 0;
    for (const crop of this.crops) {
      const yieldAmount = yieldOf(crop.cropType);
      growingFood += yieldAmount;
      if (crop.growthStage >= 1) harvestableFood += yieldAmount;
    }
    const projectedFoodAtWinter = this.food + harvestableFood + growingFood - daysUntilWinterFor(this.day) * foodPerDay;
    const foodPressureLevel: "critical" | "high" | "ok" =
      daysOfFoodRemaining < 3 ? "critical" : daysOfFoodRemaining < 7 ? "high" : "ok";
    return { foodPerDay, daysOfFoodRemaining, harvestableFood, growingFood, projectedFoodAtWinter, foodPressureLevel };
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
