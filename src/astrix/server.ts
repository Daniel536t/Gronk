import http from "node:http";
import { randomUUID } from "node:crypto";
import { AstrixGameCommandBus, type AstrixCommand } from "./commandBus";
import { AstrixEventLog } from "./events";
import { createAstrixToolRegistry } from "./mcpTools";
import { AstrixStewardLoop, type StewardDecisionProvider } from "./orchestrator";
import { AstrixWorldState } from "./state";

export interface AstrixService {
  state: AstrixWorldState;
  bus: AstrixGameCommandBus;
  tools: ReturnType<typeof createAstrixToolRegistry>;
  loop: AstrixStewardLoop;
  events: AstrixEventLog;
  authToken?: string;
  tick(deltaSeconds: number): void;
  handle(req: http.IncomingMessage, res: http.ServerResponse, pathname: string, body?: Record<string, unknown>): Promise<boolean>;
}

export interface AstrixServiceOptions {
  authToken?: string;
  /** TrueForge-backed reasoning layer; the loop executes its decisions. */
  stewardProvider?: StewardDecisionProvider;
  maxTurnsPerRun?: number;
  maxActionsPerTurn?: number;
  decideTimeoutMs?: number;
}

export function createAstrixService(opts: AstrixServiceOptions = {}): AstrixService {
  const authToken = opts.authToken;
  const state = new AstrixWorldState();
  const bus = new AstrixGameCommandBus(state);
  const tools = createAstrixToolRegistry(state, bus);
  const events = new AstrixEventLog();
  const loop = new AstrixStewardLoop({
    state,
    bus,
    tools,
    events,
    provider: opts.stewardProvider,
    maxTurnsPerRun: opts.maxTurnsPerRun,
    maxActionsPerTurn: opts.maxActionsPerTurn,
    decideTimeoutMs: opts.decideTimeoutMs,
  });
  const eventClients = new Set<http.ServerResponse>();
  let lastSeason = state.season;
  const writeState = (snapshot: ReturnType<AstrixWorldState["snapshot"]>): void => {
    const payload = `event: state\ndata: ${JSON.stringify(snapshot)}\n\n`;
    for (const client of eventClients) client.write(payload);
  };
  bus.onStateChanged((snapshot) => writeState(snapshot));
  // World-level observability: season transitions ride the agent event stream
  // (turn 0 — these are not steward-turn events).
  const emitSeasonChange = (): void => {
    const season = state.season;
    if (season === lastSeason) return;
    lastSeason = season;
    events.record({ type: "SEASON_CHANGED", turn: 0, data: { season, day: state.day } });
  };
  // Structured agent events ride the same SSE stream (event: agent).
  events.onEvent((event) => {
    const payload = `event: agent\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of eventClients) client.write(payload);
  });

  return {
    state,
    bus,
    tools,
    loop,
    events,
    authToken,
    tick(deltaSeconds: number): void {
      // Approval is a true control boundary: while the agent is AWAITING human
      // approval, world time is frozen. The pending action is immutable, no
      // mutation occurs, and (via this gate) the day clock does not advance
      // silently underneath the paused decision. Time resumes only once the
      // human approves or rejects (loop.state leaves AWAITING_APPROVAL).
      if (loop.state === "AWAITING_APPROVAL") return;
      if (state.tick(deltaSeconds)) {
        writeState(state.snapshot());
        emitSeasonChange();
      }
    },
    async handle(req, res, pathname, body = {}): Promise<boolean> {
      if (pathname === "/astrix/state" && req.method === "GET") {
        sendJson(res, 200, state.snapshot(), req);
        return true;
      }
      if (pathname === "/astrix/events" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "Access-Control-Allow-Origin": req.headers.origin ?? "*" });
        res.write(`event: state\ndata: ${JSON.stringify(state.snapshot())}\n\n`);
        eventClients.add(res);
        req.on("close", () => eventClients.delete(res));
        return true;
      }
      if (pathname === "/astrix/command" && req.method === "POST") {
        if (!authorized(req, authToken)) {
          sendJson(res, 401, { success: false, error: "unauthorized" });
          return true;
        }
        const rawName = String(body.command ?? "").toLowerCase();
        if (rawName === "simulate_plan") {
          // Read-only plan simulation: route to the simulator, never the bus.
          const params = body.params && typeof body.params === "object" ? body.params as Record<string, unknown> : body;
          sendJson(res, 200, await tools.callTool("simulate_plan", { plan: params.plan }));
          return true;
        }
        sendJson(res, 200, bus.execute(normalizeCommand(body)));
        return true;
      }
      if (pathname === "/astrix/approval/respond" && req.method === "POST") {
        if (!authorized(req, authToken)) {
          sendJson(res, 401, { success: false, error: "unauthorized" });
          return true;
        }
        const approvalId = typeof body.approval_id === "string" ? body.approval_id : "";
        const decision = body.decision === "approve" || body.decision === "reject" ? body.decision : "";
        if (!approvalId || !decision) {
          sendJson(res, 400, { success: false, error: "approval_id and decision are required" });
          return true;
        }
        // Route through the loop so approval outcomes are recorded and a
        // paused run resumes; the loop delegates to the command bus.
        const result = loop.resolveApproval(approvalId, decision);
        sendJson(res, result.success || result.error === "approval rejected" ? 200 : 404, result);
        return true;
      }
      if (pathname === "/astrix/agent/start" && req.method === "POST") {
        if (!authorized(req, authToken)) {
          sendJson(res, 401, { success: false, error: "unauthorized" });
          return true;
        }
        const objective = typeof body.objective === "string" && body.objective.trim() ? body.objective.trim() : undefined;
        const result = loop.start(objective);
        sendJson(res, result.ok ? 200 : result.error?.includes("already running") ? 409 : 400, result);
        return true;
      }
      if (pathname === "/astrix/agent/stop" && req.method === "POST") {
        if (!authorized(req, authToken)) {
          sendJson(res, 401, { success: false, error: "unauthorized" });
          return true;
        }
        const result = loop.stop();
        sendJson(res, result.ok ? 200 : 409, result);
        return true;
      }
      if (pathname === "/astrix/agent/status" && req.method === "GET") {
        sendJson(res, 200, loop.status());
        return true;
      }
      if (pathname === "/astrix/log" && req.method === "GET") {
        sendJson(res, 200, { events: events.all() });
        return true;
      }
      if (pathname === "/astrix/mcp" && (req.method === "GET" || req.method === "POST")) {
        if (req.method === "GET") {
          sendJson(res, 200, { tools: tools.listTools() });
        } else {
          if (!authorized(req, authToken)) {
            sendJson(res, 401, { success: false, error: "unauthorized" });
            return true;
          }
          const name = typeof body.name === "string" ? body.name : typeof body.params === "object" && body.params ? String((body.params as Record<string, unknown>).name ?? "") : "";
          const args = body.arguments && typeof body.arguments === "object" ? body.arguments as Record<string, unknown> : body.params && typeof body.params === "object" ? body.params as Record<string, unknown> : {};
          sendJson(res, 200, await tools.callTool(name, args));
        }
        return true;
      }
      if (pathname === "/astrix/mcp/tools/list" && req.method === "GET") {
        sendJson(res, 200, { tools: tools.listTools() });
        return true;
      }
      if (pathname === "/astrix/mcp/tools/call" && req.method === "POST") {
        if (!authorized(req, authToken)) {
          sendJson(res, 401, { success: false, error: "unauthorized" });
          return true;
        }
        const name = typeof body.name === "string" ? body.name : "";
        const args = body.arguments && typeof body.arguments === "object" ? body.arguments as Record<string, unknown> : {};
        sendJson(res, 200, await tools.callTool(name, args));
        return true;
      }
      return false;
    },
  };
}

export function sendJson(res: http.ServerResponse, code: number, value: unknown, req?: http.IncomingMessage): void {
  const origin = req?.headers.origin;
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin || "*",
    ...(origin ? { "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" } : {}),
    ...(origin ? { "Vary": "Origin" } : {}),
  });
  res.end(JSON.stringify(value));
}

function authorized(req: http.IncomingMessage, authToken: string | undefined): boolean {
  if (!authToken) return true; // no legacy token configured -> open (default local/dev mode)
  const header = req.headers.authorization;
  return header === `Bearer ${authToken}`;
}

export function readAstrixBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error("invalid JSON")); }
    });
    req.on("error", reject);
  });
}

export function createAstrixRequestId(): string {
  return randomUUID();
}

function normalizeCommand(body: Record<string, unknown>): AstrixCommand {
  const params = body.params && typeof body.params === "object" ? body.params as Record<string, unknown> : body;
  const command = String(body.command ?? "").toLowerCase();
  const map: Record<string, AstrixCommand["command"]> = {
    build: "PLACE_BUILDING",
    gather: "GATHER_RESOURCE",
    plant: "PLANT_CROP",
    clear: "CLEAR_TERRAIN",
    bridge: "BUILD_BRIDGE",
    place_building: "PLACE_BUILDING",
    gather_resource: "GATHER_RESOURCE",
    plant_crop: "PLANT_CROP",
    clear_terrain: "CLEAR_TERRAIN",
    build_bridge: "BUILD_BRIDGE",
  };
  return {
    command: map[command] ?? "__INVALID__" as AstrixCommand["command"],
    position: params.position as AstrixCommand["position"],
    resourceId: params.resource_id as string | undefined,
    resourceType: params.resource_type as AstrixCommand["resourceType"],
    buildingType: params.building_type as AstrixCommand["buildingType"],
    islandId: params.island_id as AstrixCommand["islandId"],
    farmPlotId: params.farm_plot_id as string | undefined,
    cropType: params.crop_type as string | undefined,
    radius: typeof params.radius === "number" ? params.radius : undefined,
    islandA: params.island_a as AstrixCommand["islandA"],
    islandB: params.island_b as AstrixCommand["islandB"],
    approvalId: typeof body.approval_id === "string" ? body.approval_id : undefined,
  };
}
