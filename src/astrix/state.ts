export type BiomeId = "meadow" | "frost" | "dusk";
export type ResourceType = "wood" | "stone" | "food" | "water" | "crystal";

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

export interface AstrixStateSnapshot {
  day: number;
  time: string;
  elapsedSeconds: number;
  population: number;
  food: number;
  foodSecurity: number;
  resources: Record<ResourceType, number>;
  biomeHealth: Record<BiomeId, number>;
  crops: Array<{ id: string; farmPlotId: string; cropType: string; growthStage: number }>;
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

const DAY_SECONDS = 120;
const FOOD_PER_VILLAGER_PER_DAY = 1;

export class AstrixWorldState {
  private elapsed = 0;
  private nextId = 1;
  readonly population = 4;
  food = 12;
  readonly resources: Record<ResourceType, number> = {
    wood: 30,
    stone: 15,
    food: 12,
    water: 0,
    crystal: 5,
  };
  readonly biomeHealth: Record<BiomeId, number> = {
    meadow: 0.8,
    frost: 0.6,
    dusk: 0.4,
  };
  readonly crops: Array<{ id: string; farmPlotId: string; cropType: string; growthStage: number }> = [];
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

  tick(deltaSeconds: number): boolean {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return false;
    const previousDay = this.day;
    this.elapsed += deltaSeconds;
    if (this.day !== previousDay) {
      this.food = Math.max(0, this.food - this.population * FOOD_PER_VILLAGER_PER_DAY);
      this.resources.food = this.food;
    }
    return this.day !== previousDay;
  }

  get day(): number {
    return Math.floor(this.elapsed / DAY_SECONDS) + 1;
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

  snapshot(): AstrixStateSnapshot {
    return {
      day: this.day,
      time: this.time,
      elapsedSeconds: this.elapsed,
      population: this.population,
      food: this.food,
      foodSecurity: this.foodSecurity,
      resources: { ...this.resources },
      biomeHealth: { ...this.biomeHealth },
      crops: this.crops.map((crop) => ({ ...crop })),
      buildings: this.buildings.map((building) => ({ ...building, position: { ...building.position } })),
      resourceNodes: this.resourceNodes.map((node) => ({ ...node, position: { ...node.position } })),
      islands: [
        { id: "meadow", biome: "meadow", health: this.biomeHealth.meadow, connectivity: ["frost", "dusk"] },
        { id: "frost", biome: "frost", health: this.biomeHealth.frost, connectivity: ["meadow"] },
        { id: "dusk", biome: "dusk", health: this.biomeHealth.dusk, connectivity: ["meadow"] },
      ],
      pendingApprovals: this.pendingApprovals.map((approval) => ({ ...approval, impact: { ...approval.impact } })),
    };
  }
}
