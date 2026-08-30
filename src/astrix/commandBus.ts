import { CROP_TYPES, FARM_CROP_CAPACITY } from "./state";
import type { AstrixApproval, AstrixPosition, AstrixResourceNode, AstrixWorldState, BiomeId, ResourceType } from "./state";

export type AstrixCommandName =
  | "PLACE_BUILDING"
  | "GATHER_RESOURCE"
  | "PLANT_CROP"
  | "HARVEST_CROP"
  | "CLEAR_TERRAIN"
  | "BUILD_BRIDGE";

export interface AstrixCommand {
  command: AstrixCommandName;
  position?: AstrixPosition;
  resourceId?: string;
  resourceType?: ResourceType;
  buildingType?: "house" | "farm" | "storage" | "bridge_segment";
  islandId?: BiomeId;
  farmPlotId?: string;
  cropType?: string;
  cropId?: string;
  radius?: number;
  islandA?: BiomeId;
  islandB?: BiomeId;
  approvalId?: string;
}

export interface AstrixCommandResult {
  success: boolean;
  command: AstrixCommandName;
  irreversible: boolean;
  pendingApproval?: AstrixApproval;
  error?: string;
  [key: string]: unknown;
}

export type AstrixListener = (snapshot: ReturnType<AstrixWorldState["snapshot"]>) => void;

const COSTS = {
  house: { wood: 4, stone: 2 },
  farm: { wood: 2, stone: 1 },
  storage: { wood: 3, stone: 2 },
  bridge_segment: { wood: 3, stone: 1 },
} as const;

export class AstrixGameCommandBus {
  private readonly listeners = new Set<AstrixListener>();

  constructor(private readonly state: AstrixWorldState) {}

  onStateChanged(listener: AstrixListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  resolveApproval(approvalId: string, decision: "approve" | "reject"): AstrixCommandResult {
    const index = this.state.pendingApprovals.findIndex((approval) => approval.id === approvalId);
    if (index < 0) return { success: false, command: "CLEAR_TERRAIN", irreversible: true, error: "approval not found" };
    const approval = this.state.pendingApprovals[index];
    if (decision === "reject") {
      this.state.pendingApprovals.splice(index, 1);
      this.emitState();
      return { success: false, command: approval.command as AstrixCommandName, irreversible: true, error: "approval rejected" };
    }
    const impact = approval.impact;
    const command: AstrixCommand = {
      command: approval.command as AstrixCommandName,
      position: impact.position as AstrixPosition | undefined,
      radius: typeof impact.radius === "number" ? impact.radius : undefined,
      islandA: impact.islandA as BiomeId | undefined,
      islandB: impact.islandB as BiomeId | undefined,
      approvalId,
    };
    const validation = this.validate(command);
    if (!validation.success) {
      // The stored approval can no longer execute (e.g. invalid/absent params).
      // Remove it so it cannot stay pending forever; report why it was dropped.
      this.state.pendingApprovals.splice(index, 1);
      this.emitState();
      return { success: false, command: command.command, irreversible: true, error: "approval invalid: " + validation.error };
    }
    const result = this.execute(command);
    if (result.error === "approval does not match command" || result.error === "approval not found") {
      // The stored approval can no longer be satisfied by the command it captured:
      // clear it so it cannot stay pending forever.
      this.state.pendingApprovals.splice(index, 1);
      this.emitState();
      return { success: false, command: command.command, irreversible: true, error: "approval invalid: " + result.error };
    }
    return result;
  }

  execute(command: AstrixCommand): AstrixCommandResult {
    const irreversible = command.command === "CLEAR_TERRAIN" || command.command === "BUILD_BRIDGE";
    const validation = this.validate(command);
    if (!validation.success) return validation;
    if (irreversible && command.approvalId !== undefined) {
      const approvalIndex = this.state.pendingApprovals.findIndex((approval) => approval.id === command.approvalId);
      if (approvalIndex < 0) return { success: false, command: command.command, irreversible, error: "approval not found" };
      const approval = this.state.pendingApprovals[approvalIndex];
      if (!approvalMatchesCommand(approval, command)) return { success: false, command: command.command, irreversible, error: "approval does not match command" };
    }
    if (irreversible && command.approvalId === undefined) {
      const approval: AstrixApproval = {
        id: this.state.nextEntityId("approval"),
        command: command.command,
        reason: command.command === "CLEAR_TERRAIN" ? "Terrain will be permanently cleared" : "Bridge construction changes island connectivity",
        impact: { position: command.position, radius: command.radius, islandA: command.islandA, islandB: command.islandB },
        createdAt: Date.now(),
      };
      this.state.pendingApprovals.push(approval);
      this.emitState();
      return { success: false, command: command.command, irreversible, pendingApproval: approval, error: "human approval required" };
    }

    let result: AstrixCommandResult;
    switch (command.command) {
      case "PLACE_BUILDING": result = this.placeBuilding(command, irreversible); break;
      case "GATHER_RESOURCE": result = this.gather(command, irreversible); break;
      case "PLANT_CROP": result = this.plant(command, irreversible); break;
      case "HARVEST_CROP": result = this.harvest(command, irreversible); break;
      case "CLEAR_TERRAIN": result = this.clearTerrain(command, irreversible); break;
      case "BUILD_BRIDGE": result = this.buildBridge(command, irreversible); break;
      default: return { success: false, command: command.command, irreversible, error: "unknown command" };
    }
    if (result.success) {
      if (irreversible && command.approvalId !== undefined) {
        const index = this.state.pendingApprovals.findIndex((approval) => approval.id === command.approvalId);
        if (index >= 0) this.state.pendingApprovals.splice(index, 1);
      }
      this.emitState();
    }
    return result;
  }

  simulate(command: AstrixCommand): AstrixCommandResult {
    const known: AstrixCommandName[] = ["PLACE_BUILDING", "GATHER_RESOURCE", "PLANT_CROP", "HARVEST_CROP", "CLEAR_TERRAIN", "BUILD_BRIDGE"];
    if (!known.includes(command.command)) return { success: false, command: command.command, irreversible: false, error: "unsupported command for simulation" };
    const validation = this.validate(command);
    return { ...validation, irreversible: command.command === "CLEAR_TERRAIN" || command.command === "BUILD_BRIDGE" };
  }

  private validate(command: AstrixCommand): AstrixCommandResult {
    const irreversible = command.command === "CLEAR_TERRAIN" || command.command === "BUILD_BRIDGE";
    if (command.position && !this.validPosition(command.position)) return { success: false, command: command.command, irreversible, error: "position outside world bounds" };
    if (command.command === "PLACE_BUILDING") {
      if (!command.buildingType || !COSTS[command.buildingType]) return { success: false, command: command.command, irreversible, error: "unknown building type" };
      if (!command.islandId) return { success: false, command: command.command, irreversible, error: "islandId is required" };
      const cost = COSTS[command.buildingType];
      for (const [resource, amount] of Object.entries(cost)) if (this.state.resources[resource as ResourceType] < amount) return { success: false, command: command.command, irreversible, error: `insufficient ${resource}` };
      if (command.buildingType === "farm") {
        const capacity = this.state.farmlandCapacity[command.islandId] ?? 0;
        const used = this.state.buildings.filter((building) => building.type === "farm" && building.islandId === command.islandId).length;
        if (used >= capacity) return { success: false, command: command.command, irreversible, error: `no available farmland on ${command.islandId} (${used}/${capacity}): clear terrain to expand farmland` };
      }
    }
    if (command.command === "GATHER_RESOURCE" && !command.resourceId && !command.resourceType) return { success: false, command: command.command, irreversible, error: "resourceId or resourceType is required" };
    if (command.command === "PLANT_CROP" && (!command.farmPlotId || !command.cropType)) return { success: false, command: command.command, irreversible, error: "farmPlotId and cropType are required" };
    if (command.command === "PLANT_CROP" && !this.state.buildings.some((building) => building.type === "farm" && building.id === command.farmPlotId)) return { success: false, command: command.command, irreversible, error: "farm plot not found" };
    if (command.command === "PLANT_CROP") {
      const plotCrops = this.state.crops.filter((crop) => crop.farmPlotId === command.farmPlotId).length;
      if (plotCrops >= FARM_CROP_CAPACITY) return { success: false, command: command.command, irreversible, error: `farm plot is full (${plotCrops}/${FARM_CROP_CAPACITY})` };
    }
    if (command.command === "HARVEST_CROP" && !command.cropId) return { success: false, command: command.command, irreversible, error: "cropId is required" };
    if (command.command === "HARVEST_CROP" && !this.state.crops.some((crop) => crop.id === command.cropId)) return { success: false, command: command.command, irreversible, error: "crop not found" };
    if (command.command === "CLEAR_TERRAIN" && (!command.position || !Number.isFinite(command.radius) || command.radius! <= 0 || command.radius! > 20)) return { success: false, command: command.command, irreversible, error: "position and radius between 0 and 20 are required" };
    if (command.command === "BUILD_BRIDGE" && (!command.islandA || !command.islandB || command.islandA === command.islandB)) return { success: false, command: command.command, irreversible, error: "two distinct islands are required" };
    return { success: true, command: command.command, irreversible };
  }

  private placeBuilding(command: AstrixCommand, irreversible: boolean): AstrixCommandResult {
    const type = command.buildingType!;
    const cost = COSTS[type];
    for (const [resource, amount] of Object.entries(cost)) this.state.resources[resource as ResourceType] -= amount;
    const building = { id: this.state.nextEntityId(type), type, position: command.position ?? { x: 0, y: 0, z: 0 }, health: 1, islandId: command.islandId! };
    this.state.buildings.push(building);
    return { success: true, command: command.command, irreversible, buildingId: building.id, costDeducted: cost };
  }

  private gather(command: AstrixCommand, irreversible: boolean): AstrixCommandResult {
    const node = this.state.resourceNodes.find((candidate: AstrixResourceNode) => candidate.id === command.resourceId || candidate.type === command.resourceType && candidate.quantity > 0);
    if (!node) return { success: false, command: command.command, irreversible, error: "resource node not found" };
    // Connectivity (design spec chain #3): the settlement lives on Meadow; other
    // islands' resources are unreachable until a bridge connects them.
    if (node.islandId !== "meadow" && !this.state.bridges.some((bridge) => (bridge.islandA === "meadow" && bridge.islandB === node.islandId) || (bridge.islandA === node.islandId && bridge.islandB === "meadow"))) {
      return { success: false, command: command.command, irreversible, error: `no bridge to ${node.islandId}: build a bridge to reach it` };
    }
    const gathered = Math.min(1, node.quantity);
    node.quantity -= gathered;
    this.state.resources[node.type] += gathered;
    return { success: true, command: command.command, irreversible, gathered, resourceId: node.id, resourceType: node.type, inventoryAfter: { ...this.state.resources } };
  }

  private plant(command: AstrixCommand, irreversible: boolean): AstrixCommandResult {
    const crop = { id: this.state.nextEntityId("crop"), farmPlotId: command.farmPlotId!, cropType: command.cropType!, growthStage: 0, plantedAtDay: this.state.day };
    this.state.crops.push(crop);
    return { success: true, command: command.command, irreversible, farmPlotId: crop.farmPlotId, cropType: crop.cropType, growthStage: crop.growthStage, cropId: crop.id, plantedAtDay: crop.plantedAtDay };
  }

  private harvest(command: AstrixCommand, irreversible: boolean): AstrixCommandResult {
    const crop = this.state.crops.find((candidate) => candidate.id === command.cropId);
    if (!crop) return { success: false, command: command.command, irreversible, error: "crop not found" };
    if (crop.growthStage < 1) return { success: false, command: command.command, irreversible, error: `crop not harvestable yet (growth ${Math.round(crop.growthStage * 100)}%)` };
    const config = (CROP_TYPES as Record<string, { daysToMature: number; yield: number }>)[crop.cropType];
    const foodGained = config?.yield ?? 1;
    this.state.crops.splice(this.state.crops.indexOf(crop), 1);
    this.state.food += foodGained;
    this.state.resources.food = this.state.food;
    return { success: true, command: command.command, irreversible, cropId: crop.id, cropType: crop.cropType, foodGained, foodAfter: this.state.food };
  }

  private clearTerrain(command: AstrixCommand, irreversible: boolean): AstrixCommandResult {
    const radius = command.radius ?? 1;
    const before = this.state.resourceNodes.length;
    const remaining = this.state.resourceNodes.filter((node) => !command.position || distance(node.position, command.position) > radius);
    const removed = this.state.resourceNodes.filter((node) => command.position && distance(node.position, command.position) <= radius);
    this.state.resourceNodes.splice(0, this.state.resourceNodes.length, ...remaining);
    // Clearing forest yields wood (design spec: clear_terrain -> wood_gained).
    // Irreversible: nodes are gone; biome health drops on the cleared island.
    const woodGained = before - remaining.length;
    if (woodGained > 0) this.state.resources.wood += woodGained;
    const clearedIsland = removed[0]?.islandId ?? command.islandId;
    if (clearedIsland && woodGained > 0) {
      const health = this.state.biomeHealth[clearedIsland];
      this.state.biomeHealth[clearedIsland] = Math.max(0, health - 0.05 * radius);
      // Each cleared tree frees one farmland plot on that island — this is the
      // economic reason clearing exists (expansion is approval-gated above).
      this.state.farmlandCapacity[clearedIsland] += woodGained;
    }
    return { success: true, command: command.command, irreversible, treesCleared: woodGained, woodGained, permanent: true, farmlandAfter: { ...this.state.farmlandCapacity } };
  }

  private buildBridge(command: AstrixCommand, irreversible: boolean): AstrixCommandResult {
    const cost = COSTS.bridge_segment;
    for (const [resource, amount] of Object.entries(cost)) {
      if (this.state.resources[resource as ResourceType] < amount) return { success: false, command: command.command, irreversible, error: `insufficient ${resource}` };
    }
    for (const [resource, amount] of Object.entries(cost)) this.state.resources[resource as ResourceType] -= amount;
    const building = { id: this.state.nextEntityId("bridge"), type: "bridge_segment" as const, position: command.position ?? { x: 0, y: 0, z: 0 }, health: 1, islandId: command.islandA! };
    this.state.buildings.push(building);
    this.state.bridges.push({ id: building.id, islandA: command.islandA!, islandB: command.islandB! });
    return { success: true, command: command.command, irreversible, bridgeId: building.id, costDeducted: cost, length: 8, permanent: true };
  }

  private validPosition(position: AstrixPosition): boolean {
    return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z) && position.x >= 0 && position.x <= 100 && position.z >= 0 && position.z <= 60;
  }

  private emitState(): void {
    const snapshot = this.state.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

function approvalMatchesCommand(approval: AstrixApproval, command: AstrixCommand): boolean {
  if (approval.command !== command.command) return false;
  const impact = approval.impact;
  if (command.command === "CLEAR_TERRAIN") return samePosition(impact.position, command.position) && impact.radius === command.radius;
  return impact.islandA === command.islandA && impact.islandB === command.islandB && positionMatches(impact.position, command.position);
}

// Bridge position is optional: both absent is a match, both present must be
// equal, and present-vs-absent is a mismatch (never silently approves a
// different command than the one that was recorded).
function positionMatches(a: unknown, b: unknown): boolean {
  if (!a && !b) return true;
  return samePosition(a, b);
}

function samePosition(a: unknown, b: unknown): boolean {
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const left = a as AstrixPosition;
  const right = b as AstrixPosition;
  return left.x === right.x && left.y === right.y && left.z === right.z;
}

function distance(a: AstrixPosition, b: AstrixPosition): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
