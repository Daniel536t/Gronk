import { z } from "zod";
import type { AstrixCommand, AstrixGameCommandBus } from "./commandBus";
import type { AstrixWorldState, BiomeId, ResourceType } from "./state";

export const ASTRIX_TOOL_NAMES = ["inspect_world", "inspect_island", "inspect_resources", "inspect_buildings", "gather", "build", "plant", "clear_terrain", "build_bridge", "simulate_plan"] as const;
export type AstrixToolName = typeof ASTRIX_TOOL_NAMES[number];

export interface AstrixToolDefinition { name: AstrixToolName; description: string; inputSchema: Record<string, unknown>; }

export function listAstrixTools(): AstrixToolDefinition[] {
  return ASTRIX_TOOL_NAMES.map((name) => ({ name, description: `ASTrix ${name.replaceAll("_", " ")} tool`, inputSchema: {} }));
}

export function createAstrixToolRegistry(state: AstrixWorldState, bus: AstrixGameCommandBus) {
  return {
    listTools: listAstrixTools,
    async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
      switch (name) {
        case "inspect_world": return state.snapshot();
        case "inspect_island": return inspectIsland(state, String(args.island_id ?? ""));
        case "inspect_resources": return state.resourceNodes.map((node) => ({ ...node, position: { ...node.position } }));
        case "inspect_buildings": return state.buildings.map((building) => ({ ...building, position: { ...building.position } }));
        case "gather": return bus.execute({ command: "GATHER_RESOURCE", resourceId: stringOrUndefined(args.resource_id), resourceType: resourceTypeOrUndefined(args.resource_type) });
        case "build": return bus.execute({ command: "PLACE_BUILDING", buildingType: args.building_type as AstrixCommand["buildingType"], position: positionOf(args.position), islandId: args.island_id as BiomeId });
        case "plant": return bus.execute({ command: "PLANT_CROP", farmPlotId: stringOrUndefined(args.farm_plot_id), cropType: stringOrUndefined(args.crop_type) });
        case "clear_terrain": return bus.execute({ command: "CLEAR_TERRAIN", position: positionOf(args.position), radius: Number(args.radius ?? 1), approvalId: stringOrUndefined(args.approval_id) });
        case "build_bridge": return bus.execute({ command: "BUILD_BRIDGE", position: positionOf(args.position), islandA: args.island_a as BiomeId, islandB: args.island_b as BiomeId, approvalId: stringOrUndefined(args.approval_id) });
        case "simulate_plan": return simulatePlan(state, bus, args.plan);
        default: return { success: false, error: `unknown ASTrix tool: ${name}` };
      }
    },
  };
}

function inspectIsland(state: AstrixWorldState, id: string): unknown {
  if (!( ["meadow", "frost", "dusk"] as string[]).includes(id)) return { success: false, error: "unknown island" };
  const biome = id as BiomeId;
  return { id: biome, biome, health: state.biomeHealth[biome], resources: state.resourceNodes.filter((node) => node.islandId === biome), buildings: state.buildings.filter((building) => building.islandId === biome), connectivity: biome === "meadow" ? ["frost", "dusk"] : ["meadow"] };
}

function simulatePlan(state: AstrixWorldState, bus: AstrixGameCommandBus, value: unknown): unknown {
  if (!value || typeof value !== "object") return { success: false, readOnly: true, error: "plan must be an object" };
  const plan = value as Record<string, unknown>;
  const commands = Array.isArray(plan.commands) ? plan.commands : [plan];
  const results = commands.map((item) => {
    if (!item || typeof item !== "object") return { success: false, error: "plan command must be an object" };
    const command = item as Record<string, unknown>;
    const name = String(command.command ?? "").toLowerCase();
    const map: Record<string, AstrixCommand["command"]> = { build: "PLACE_BUILDING", place_building: "PLACE_BUILDING", gather: "GATHER_RESOURCE", gather_resource: "GATHER_RESOURCE", plant: "PLANT_CROP", plant_crop: "PLANT_CROP", clear: "CLEAR_TERRAIN", clear_terrain: "CLEAR_TERRAIN", bridge: "BUILD_BRIDGE", build_bridge: "BUILD_BRIDGE" };
    const normalized = map[name];
    if (!normalized) return { success: false, error: "unknown plan command" };
    return bus.simulate({ command: normalized, position: positionOf(command.position), resourceId: stringOrUndefined(command.resource_id), resourceType: resourceTypeOrUndefined(command.resource_type), buildingType: command.building_type as AstrixCommand["buildingType"], islandId: command.island_id as BiomeId | undefined, farmPlotId: stringOrUndefined(command.farm_plot_id), cropType: stringOrUndefined(command.crop_type), radius: typeof command.radius === "number" ? command.radius : undefined, islandA: command.island_a as BiomeId | undefined, islandB: command.island_b as BiomeId | undefined });
  });
  return { success: results.every((result) => result.success), readOnly: true, projected: state.snapshot(), results };
}

function positionOf(value: unknown): { x: number; y: number; z: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const p = value as Record<string, unknown>;
  if (![p.x, p.y, p.z].every((v) => typeof v === "number")) return undefined;
  return { x: p.x as number, y: p.y as number, z: p.z as number };
}
function stringOrUndefined(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function resourceTypeOrUndefined(value: unknown): ResourceType | undefined { return typeof value === "string" && ["wood", "stone", "food", "water", "crystal"].includes(value) ? value as ResourceType : undefined; }

export const astrixToolSchemas = {
  inspect_island: z.object({ island_id: z.enum(["meadow", "frost", "dusk"]) }),
  gather: z.object({ resource_id: z.string().optional(), resource_type: z.enum(["wood", "stone", "food", "water", "crystal"]).optional() }),
  build: z.object({ building_type: z.enum(["house", "farm", "storage", "bridge_segment"]), position: z.object({ x: z.number(), y: z.number(), z: z.number() }), island_id: z.enum(["meadow", "frost", "dusk"]) }),
};
