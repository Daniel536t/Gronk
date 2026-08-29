import http from "node:http";
import { randomUUID } from "node:crypto";
import { AstrixGameCommandBus, type AstrixCommand } from "./commandBus";
import { createAstrixToolRegistry } from "./mcpTools";
import { AstrixWorldState } from "./state";

export interface AstrixService {
  state: AstrixWorldState;
  bus: AstrixGameCommandBus;
  tools: ReturnType<typeof createAstrixToolRegistry>;
  authToken?: string;
  tick(deltaSeconds: number): void;
  handle(req: http.IncomingMessage, res: http.ServerResponse, pathname: string, body?: Record<string, unknown>): Promise<boolean>;
}

let activeAuthToken: string | undefined;

export function createAstrixService(opts: { authToken?: string } = {}): AstrixService {
  activeAuthToken = opts.authToken;
  const state = new AstrixWorldState();
  const bus = new AstrixGameCommandBus(state);
  const tools = createAstrixToolRegistry(state, bus);
  const eventClients = new Set<http.ServerResponse>();
  bus.onStateChanged((snapshot) => {
    const payload = `event: state\ndata: ${JSON.stringify(snapshot)}\n\n`;
    for (const client of eventClients) client.write(payload);
  });

  return {
    state,
    bus,
    tools,
    authToken: activeAuthToken,
    tick(deltaSeconds: number): void {
      if (state.tick(deltaSeconds)) {
        const snapshot = state.snapshot();
        const payload = `event: state\ndata: ${JSON.stringify(snapshot)}\n\n`;
        for (const client of eventClients) client.write(payload);
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
        if (!authorized(req)) {
          sendJson(res, 401, { success: false, error: "unauthorized" });
          return true;
        }
        sendJson(res, 200, bus.execute(normalizeCommand(body)));
        return true;
      }
      if (pathname === "/astrix/approval/respond" && req.method === "POST") {
        if (!authorized(req)) {
          sendJson(res, 401, { success: false, error: "unauthorized" });
          return true;
        }
        const approvalId = typeof body.approval_id === "string" ? body.approval_id : "";
        const decision = body.decision === "approve" || body.decision === "reject" ? body.decision : "";
        if (!approvalId || !decision) {
          sendJson(res, 400, { success: false, error: "approval_id and decision are required" });
          return true;
        }
        const result = bus.resolveApproval(approvalId, decision);
        sendJson(res, result.success || result.error === "approval rejected" ? 200 : 404, result);
        return true;
      }
      if (pathname === "/astrix/mcp" && (req.method === "GET" || req.method === "POST")) {
        if (req.method === "GET") {
          sendJson(res, 200, { tools: tools.listTools() });
        } else {
          if (!authorized(req)) {
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
        if (!authorized(req)) {
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
  });
  res.end(JSON.stringify(value));
}

function authorized(req: http.IncomingMessage): boolean {
  if (!activeAuthToken) return true; // no token configured -> open (default local mode)
  const header = req.headers.authorization;
  return header === `Bearer ${activeAuthToken}`;
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
