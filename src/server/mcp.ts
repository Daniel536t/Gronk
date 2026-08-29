// MCP server wrapping the game. Every tool returns { content: [{ type: "text",
// text: <JSON> }] } so TrueForge agents (M4) and any MCP client get plain JSON.
//
// Tool signatures match the spec: create_lobby / join_lobby / start_match /
// get_state carry a roomCode, while move / transform / action / agent_intent
// operate on the client's *current* room, remembered per MCP session after
// create_lobby or join_lobby.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { LobbyManager, type LobbyMode } from "./lobby";
import { type AgentIntentType } from "./intents";
import { createAstrixToolRegistry } from "../astrix/mcpTools";
import { AstrixGameCommandBus } from "../astrix/commandBus";
import type { AstrixWorldState } from "../astrix/state";
import { AstrixWorldState as AstrixWorldStateClass } from "../astrix/state";

const INTENTS = [
  "SEARCH_FURNITURE",
  "HIDE_AS",
  "FLEE",
  "GRAB",
  "GO_TO_PEDESTAL",
  "HUNT_NEAREST",
] as const;

function text(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}

interface SessionCtx {
  roomCode?: string;
  playerId?: string;
}

// The SDK's RequestHandlerExtra has more fields; we only use sessionId.
interface ToolExtra {
  sessionId?: string;
}

function ctxOf(extra: ToolExtra, sessions: Map<string, SessionCtx>): SessionCtx {
  const sid = extra.sessionId ?? "default";
  let ctx = sessions.get(sid);
  if (!ctx) {
    ctx = {};
    sessions.set(sid, ctx);
  }
  return ctx;
}

export function createMcpServer(manager: LobbyManager, astrix?: { state: AstrixWorldState; bus: AstrixGameCommandBus }): McpServer {
  const sessions = new Map<string, SessionCtx>();
  const localAstrix = astrix ?? (() => { const state = new AstrixWorldStateClass(); return { state, bus: new AstrixGameCommandBus(state) }; })();
  const astrixTools = createAstrixToolRegistry(localAstrix.state, localAstrix.bus);
  const server = new McpServer({
    name: "gronks-hoard",
    version: "0.2.0",
  });

  server.registerTool(
    "create_lobby",
    {
      description:
        "Create a new Gronk's Hoard game lobby. Returns a short room code (e.g. WAND-42). The creator is the host and is joined to the room.",
      inputSchema: z.object({
        mode: z
          .enum(["multi", "solo"])
          .optional()
          .describe("multi = 2v2 multiplayer (default), solo = single-player (M6)"),
      }),
    },
    async ({ mode }, extra) => {
      const res = manager.createLobby((mode ?? "multi") as LobbyMode);
      if (res.ok) {
        const ctx = ctxOf(extra, sessions);
        ctx.roomCode = res.value.roomCode;
      }
      return text(res.ok ? res.value : res);
    },
  );

  server.registerTool(
    "join_lobby",
    {
      description: "Join an existing lobby by room code. Returns your playerId and team (0 or 1).",
      inputSchema: z.object({
        roomCode: z.string().describe("Room code from create_lobby, e.g. WAND-42"),
      }),
    },
    async ({ roomCode }, extra) => {
      const res = manager.joinLobby(roomCode);
      if (res.ok) {
        const ctx = ctxOf(extra, sessions);
        ctx.roomCode = roomCode;
        ctx.playerId = res.value.playerId;
      }
      return text(res.ok ? res.value : res);
    },
  );

  server.registerTool(
    "start_match",
    {
      description:
        "Start the match in a lobby. Only the host (first joiner) may start. Empty seats are filled with scripted FSM bots.",
      inputSchema: z.object({
        roomCode: z.string(),
      }),
    },
    async ({ roomCode }, extra) => {
      const ctx = ctxOf(extra, sessions);
      if (!ctx.playerId) {
        return text({ ok: false, error: "join the lobby first so we know who is starting" });
      }
      const res = manager.startMatch(roomCode, ctx.playerId);
      return text(res.ok ? res.value : res);
    },
  );

  server.registerTool(
    "get_state",
    {
      description:
        "Get the public game state for a player. The secret treasure furniture id is NEVER included. Players are plain circles with x/y — your only senses are positions, furniture spots, riddles, and your own action results.",
      inputSchema: z.object({
        roomCode: z.string(),
        playerId: z.string(),
      }),
    },
    async ({ roomCode, playerId }) => {
      const res = manager.getState(roomCode, playerId);
      return text(res.ok ? res.value.state : res);
    },
  );

  server.registerTool(
    "move",
    {
      description:
        "Move your wizard. dirX/dirY is a direction vector; the engine normalizes it and moves you continuously until you change direction.",
      inputSchema: z.object({
        playerId: z.string(),
        dirX: z.number(),
        dirY: z.number(),
      }),
    },
    async ({ playerId, dirX, dirY }, extra) => {
      const ctx = ctxOf(extra, sessions);
      if (!ctx.roomCode) return text({ ok: false, error: "create or join a lobby first" });
      const res = manager.move(ctx.roomCode, playerId, dirX, dirY);
      return text(res);
    },
  );

  server.registerTool(
    "transform",
    {
      description:
        "Transform into (hide as) a furniture piece you stand next to. You cannot move while hidden; moving breaks the disguise.",
      inputSchema: z.object({
        playerId: z.string(),
        furnitureId: z.string(),
      }),
    },
    async ({ playerId, furnitureId }, extra) => {
      const ctx = ctxOf(extra, sessions);
      if (!ctx.roomCode) return text({ ok: false, error: "create or join a lobby first" });
      const res = manager.transform(ctx.roomCode, playerId, furnitureId);
      return text(res);
    },
  );

  server.registerTool(
    "action",
    {
      description:
        "The one verb, near furniture = SEARCH. Resolves per engine rules: treasure -> pick it up, hidden enemy -> reveal + stun, else empty. Every search makes noise that attracts Gronk. If you carry the treasure, use it at your own pedestal to bank.",
      inputSchema: z.object({
        playerId: z.string(),
        targetId: z.string().optional().describe("Accepted for symmetry; the engine resolves context."),
      }),
    },
    async ({ playerId, targetId }, extra) => {
      const ctx = ctxOf(extra, sessions);
      if (!ctx.roomCode) return text({ ok: false, error: "create or join a lobby first" });
      const res = manager.action(ctx.roomCode, playerId, targetId);
      return text(res);
    },
  );

  server.registerTool(
    "approve_bank",
    {
      description:
        "Approve a pending bank request for the given player's team (any human player may call this, not just the carrier). On approval the match ends and that team wins.",
      inputSchema: z.object({
        roomCode: z.string(),
        playerId: z.string(),
      }),
    },
    async ({ roomCode, playerId }) => {
      const res = manager.approveBankByPlayer(roomCode, playerId);
      return text(res);
    },
  );

  server.registerTool(
    "reject_bank",
    {
      description:
        "Reject a pending bank request for the given player's team (any human player may call this). The carrier keeps the treasure and that team gets a 10s bank cooldown.",
      inputSchema: z.object({
        roomCode: z.string(),
        playerId: z.string(),
      }),
    },
    async ({ roomCode, playerId }) => {
      const res = manager.rejectBankByPlayer(roomCode, playerId);
      return text(res);
    },
  );

  server.registerTool(
    "reveal_riddle",
    {
      description:
        "Reveal a riddle line for a room. lineNumber is 1..3 (line 1 at 0s, line 2 at 90s, line 3 at 180s). Returns the line text if it has been revealed (the engine reveals on schedule; the frontend polls get_state and shows it).",
      inputSchema: z.object({
        roomCode: z.string(),
        lineNumber: z.number().int().min(1).max(3),
      }),
    },
    async ({ roomCode, lineNumber }) => {
      const res = manager.revealRiddle(roomCode, lineNumber);
      return text(res.ok ? res.value : res);
    },
  );

  server.registerTool(
    "agent_intent",
    {
      description:
        "Set a continuous intent your agent keeps executing until replaced. SEARCH_FURNITURE(targetId=furniture) searches a spot; HIDE_AS(targetId=furniture) hides as it; FLEE runs from Gronk; GRAB picks up a dropped treasure; GO_TO_PEDESTAL banks your own treasure; HUNT_NEAREST chases the nearest visible enemy. agentId may be 'gronk' to steer Gronk's next sniff toward a target.",
      inputSchema: z.object({
        agentId: z.string(),
        intent: z.enum(INTENTS),
        targetId: z.string().optional(),
      }),
    },
    async ({ agentId, intent, targetId }, extra) => {
      const ctx = ctxOf(extra, sessions);
      if (!ctx.roomCode) return text({ ok: false, error: "create or join a lobby first" });
      const res = manager.agentIntent(
        ctx.roomCode,
        agentId,
        intent as AgentIntentType,
        targetId,
      );
      return text(res.ok ? res.value : res);
    },
  );

  if (astrixTools) {
    server.registerTool("inspect_world", { description: "Inspect the complete ASTrix world state.", inputSchema: z.object({}) }, async () => text(await astrixTools.callTool("inspect_world", {})));
    server.registerTool("inspect_island", { description: "Inspect one ASTrix island.", inputSchema: z.object({ island_id: z.enum(["meadow", "frost", "dusk"]) }) }, async (args) => text(await astrixTools.callTool("inspect_island", args)));
    server.registerTool("inspect_resources", { description: "Inspect ASTrix resource nodes.", inputSchema: z.object({}) }, async () => text(await astrixTools.callTool("inspect_resources", {})));
    server.registerTool("inspect_buildings", { description: "Inspect ASTrix buildings.", inputSchema: z.object({}) }, async () => text(await astrixTools.callTool("inspect_buildings", {})));
    server.registerTool("gather", { description: "Gather an ASTrix resource through the command bus.", inputSchema: z.object({ resource_id: z.string().optional(), resource_type: z.enum(["wood", "stone", "food", "water", "crystal"]).optional() }) }, async (args) => text(await astrixTools.callTool("gather", args)));
    server.registerTool("build", { description: "Build an ASTrix structure through the command bus.", inputSchema: z.object({ building_type: z.enum(["house", "farm", "storage", "bridge_segment"]), position: z.object({ x: z.number(), y: z.number(), z: z.number() }), island_id: z.enum(["meadow", "frost", "dusk"]) }) }, async (args) => text(await astrixTools.callTool("build", args)));
    server.registerTool("plant", { description: "Plant an ASTrix crop.", inputSchema: z.object({ farm_plot_id: z.string(), crop_type: z.string() }) }, async (args) => text(await astrixTools.callTool("plant", args)));
    server.registerTool("clear_terrain", { description: "Clear ASTrix terrain; requires human approval.", inputSchema: z.object({ position: z.object({ x: z.number(), y: z.number(), z: z.number() }), radius: z.number().int().positive() }) }, async (args) => text(await astrixTools.callTool("clear_terrain", args)));
    server.registerTool("build_bridge", { description: "Build an ASTrix bridge; requires human approval.", inputSchema: z.object({ position: z.object({ x: z.number(), y: z.number(), z: z.number() }), island_a: z.enum(["meadow", "frost", "dusk"]), island_b: z.enum(["meadow", "frost", "dusk"]) }) }, async (args) => text(await astrixTools.callTool("build_bridge", args)));
    server.registerTool("simulate_plan", { description: "Simulate an ASTrix plan without mutation.", inputSchema: z.object({ plan: z.string() }) }, async (args) => text(await astrixTools.callTool("simulate_plan", args)));
  }

  return server;
}

/** Connect over stdio. Note: never console.log to stdout after this — the MCP
 *  protocol owns stdout; use console.error for diagnostics. */
export async function connectStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/** Back-compat convenience used by tests / entrypoints. */
export async function startMcpServer(manager: LobbyManager): Promise<void> {
  await connectStdio(createMcpServer(manager));
}
