import { z } from "zod";
import type { AstrixCommand, AstrixGameCommandBus } from "./commandBus";
import type { AstrixWorldState, BiomeId } from "./state";

export const ASTRIX_TOOL_NAMES = [
  "inspect_world", "inspect_island", "inspect_resources", "inspect_buildings",
  "gather", "build", "plant", "clear_terrain", "build_bridge", "simulate_plan",
] as const;

export type AstrixToolName = typeof ASTRIX_TOOL_NAMES[number];

export interface AstrixToolDefinition {
  name: AstrixToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

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
        case "gather": return bus.execute({ command: "GATHER_RESOURCE", resourceId: typeof args.resource_id === "string" ? args.resource_id : undefined, resourceType: typeof args.resource_type === "string" ? args.resource_type as never : undefined });
        case "build": return bus.execute({ command: "PLACE_BUILDING", buildingType: args.building_type as never, position: positionOf(args.position), islandId: args.island_id as never });
        case "plant": return bus.execute({ command: "PLANT_CROP", farmPlotId: String(args.farm_plot_id ?? ""), cropType: String(args.crop_type ?? "") });
        case "clear_terrain": return bus.execute({ command: "CLEAR_TERRAIN", position: positionOf(args.position), radius: Number(args.radius ?? 1) });
        case "build_bridge": return bus.execute({ command: "BUILD_BRIDGE", position: positionOf(args.position), islandA: args.island_a as never, islandB: args.island_b as never });
        case "simulate_plan": return bus.simulate({ command: "PLACE_BUILDING", buildingType: "house", position: { x: 0, y: 0, z: 0 }, islandId: "meadow", ...(args.plan && typeof args.plan === "object" ? {} : {}) });
        default: return { success: false, error: `unknown ASTrix tool: ${name}` };
      }
    },
  };
}

function inspectIsland(state: AstrixWorldState, id: string): unknown {
  if (!(["meadow", "frost", "dusk"] as string[]).includes(id)) return { success: false, error: "unknown island" };
  const biome = id as BiomeId;
  return {
    id: biome,
    biome,
    health: state.biomeHealth[biome],
    resources: state.resourceNodes.filter((node) => node.islandId === biome),
    buildings: state.buildings.filter((building) => building.islandId === biome),
    connectivity: biome === "meadow" ? ["frost", "dusk"] : ["meadow"],
  };
}

function positionOf(value: unknown): { x: number; y: number; z: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const p = value as Record<string, unknown>;
  if (![p.x, p.y, p.z].every((v) => typeof v === "number")) return undefined;
  return { x: p.x as number, y: p.y as number, z: p.z as number };
}

export const astrixToolSchemas = {
  inspect_island: z.object({ island_id: z.enum(["meadow", "frost", "dusk"]) }),
  gather: z.object({ resource_id: z.string().optional(), resource_type: z.enum(["wood", "stone", "food", "water", "crystal"]).optional() }),
  build: z.object({ building_type: z.enum(["house", "farm", "storage", "bridge_segment"]), position: z.object({ x: z.number(), y: z.number(), z: z.number() }), island_id: z.enum(["meadow", "frost", "dusk"]) }),
};
