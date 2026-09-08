// HTTP server for the frontend, which must NOT be an MCP client.
//   GET  /state?room=CODE&player=ID   -> public game state (10Hz polling)
//   GET  /api/lobby?room=CODE         -> lobby roster + host + status
//   POST /api/create  { mode?, name? }      -> { roomCode, playerId, team }
//   POST /api/join    { roomCode, name? }   -> { playerId, team }
//   POST /api/start   { roomCode, playerId }-> { ok } (host only)
//   POST /api/move    { roomCode, playerId, dirX, dirY }
//   POST /api/transform { roomCode, playerId, furnitureId }
//   POST /api/action  { roomCode, playerId }
// The browser keeps { roomCode, playerId } in localStorage and sends them per
// request — no cookies, works across refresh (durable-session groundwork).
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { LobbyManager } from "./lobby";
import type { McpHttpHandler } from "./mcpHttp";
import type { AstrixService } from "../astrix/server";
import { readAstrixBody, authorizeWrite } from "../astrix/server";

// AUTH POLICY (R1): the legacy POST /mcp channel exposes 22 tools, including the
// ASTrix mutation set (gather/build/plant/harvest/clear_terrain/build_bridge) and
// the legacy game tools. It is now gated by the SAME rule as the /astrix/* write
// routes — `authorizeWrite` in src/astrix/server.ts:
//   token configured -> require `Authorization: Bearer <ASTRIX_API_KEY>`
//   no token         -> allow direct loopback only (proxied requests are remote)
//
// The historical rationale for leaving this open ("TrueForge is on the same host
// and sends no Authorization header") still works: TrueForge connects over
// loopback, which the policy permits when no token is set. What changed is that
// ASTrix Core now reasons in-process by default (LocalStewardProvider), so the
// server needs no inbound agent access at all — and a PUBLIC caller through the
// Caddy proxy is refused because X-Forwarded-For marks it remote.
//
// GET /mcp (SSE) stays open: it carries no tool invocation.
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  // Godot 4 Web export: browsers refuse to execute WASM without the correct
  // MIME type, and the .pck must be served as a plain binary stream.
  ".wasm": "application/wasm",
  ".pck": "application/octet-stream",
  ".ogg": "audio/ogg",
};

function sendJson(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}


/** Serve the Vite build output (dist/) for single-port production mode. Returns
 *  true if a file was served. Path traversal is blocked by normalizing and
 *  verifying the resolved path stays under staticDir. */
function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  staticDir: string,
): boolean {
  if (!existsSync(staticDir)) return false;
  let pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  if (pathname === "/") pathname = "/index.html";
  // Directory index fallback: /observatory/ -> /observatory/index.html
  if (pathname.endsWith("/")) pathname += "index.html";
  const resolved = normalize(join(staticDir, pathname));
  if (!resolved.startsWith(normalize(staticDir))) return false;
  if (!existsSync(resolved) || !statSync(resolved).isFile()) return false;
  res.writeHead(200, {
    "Content-Type": MIME[extname(resolved)] ?? "application/octet-stream",
  });
  res.end(readFileSync(resolved));
  return true;
}

/** Parse a browser <form> multipart upload and return a single quoted-value part
 *  that looks like a video file. Enforces a hard byte cap and only accepts
 *  well-formed multipart frames, so this is not a general request parser. */
function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

export function createHttpServer(
  manager: LobbyManager,
  port = 8787,
  opts: { mcp?: McpHttpHandler; staticDir?: string; astrix?: AstrixService } = {},
): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    // Vite dev server runs on another port; allow cross-origin reads.
    // Echo the requesting Origin so the Authorization header is an accepted
    // preflight header on cross-origin ASTrix requests, while still allowing
    // anonymous tool-less clients (curl, same-origin) via the wildcard.
    const origin = req.headers.origin;
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (origin) {
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // ---- ASTrix parallel world API --------------------------------------
    if (opts.astrix && url.pathname.startsWith("/astrix/")) {
      let astrixBody: Record<string, unknown> | undefined;
      if (req.method === "POST") {
        try { astrixBody = await readAstrixBody(req); }
        catch (e) { sendJson(res, 400, { error: (e as Error).message }); return; }
      }
      if (await opts.astrix.handle(req, res, url.pathname, astrixBody)) return;
    }

    // ---- POST /mcp (Streamable HTTP MCP — where TrueForge agents connect) --
    // R1: gated by the shared write policy (see the note at the top of this file).
    if (req.method === "POST" && url.pathname === "/mcp" && opts.mcp) {
      const auth = authorizeWrite(req, opts.astrix?.authToken);
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error });
        return;
      }
      let body: unknown;
      try {
        body = await readBody(req);
      } catch (e) {
        sendJson(res, 400, { error: (e as Error).message });
        return;
      }
      await opts.mcp.handle(req, res, body);
      return;
    }

    // ---- GET /mcp (SSE stream for server-initiated MCP messages) ----------
    if (req.method === "GET" && url.pathname === "/mcp" && opts.mcp) {
      await opts.mcp.handle(req, res, undefined);
      return;
    }

    // ---- GET /state (polled by the canvas at 10Hz) ----------------------
    if (req.method === "GET" && url.pathname === "/state") {
      const room = url.searchParams.get("room");
      const player = url.searchParams.get("player");
      if (!room || !player) {
        sendJson(res, 400, { error: "room and player query params are required" });
        return;
      }
      const r = manager.getState(room, player);
      if (!r.ok) {
        sendJson(res, 404, r);
        return;
      }
      sendJson(res, 200, r.value.state);
      return;
    }

    // ---- GET /api/lobby -------------------------------------------------
    if (req.method === "GET" && url.pathname === "/api/lobby") {
      const room = url.searchParams.get("room");
      const l = room ? manager.getLobby(room) : undefined;
      if (!l) {
        sendJson(res, 404, { ok: false, error: "room not found" });
        return;
      }
      sendJson(res, 200, {
        roomCode: l.roomCode,
        status: l.status,
        hostId: l.hostId,
        humans: l.humans.map((h) => ({
          playerId: h.playerId,
          name: h.name,
          team: l.teamOf(h.playerId),
        })),
        bots: l.bots.length,
      });
      return;
    }

    // ---- POST /api/upload-watch (REMOVED) -------------------------------
    // The reference-upload widget was removed from the site, so the public
    // upload endpoint is gone entirely: no unauth write sink, no disk quota
    // or rate-limit surface, no container-ephemeral storage concern.

    // ---- POST endpoints -------------------------------------------------
    if (req.method === "POST") {
      let body: Record<string, unknown>;
      try {
        body = await readBody(req);
      } catch (e) {
        sendJson(res, 400, { error: (e as Error).message });
        return;
      }
      const str = (v: unknown): string | undefined =>
        typeof v === "string" ? v : undefined;

      if (url.pathname === "/api/create") {
        const mode = str(body.mode) === "solo" ? "solo" : "multi";
        const created = manager.createLobby(mode);
        if (!created.ok) {
          sendJson(res, 500, created);
          return;
        }
        const roomCode = created.value.roomCode;
        const joined = manager.joinLobby(roomCode, str(body.name) ?? "Wizard");
        if (!joined.ok) {
          sendJson(res, 500, joined);
          return;
        }
        sendJson(res, 200, {
          roomCode,
          playerId: joined.value.playerId,
          team: joined.value.team,
          host: true,
        });
        return;
      }

      if (url.pathname === "/api/join") {
        const roomCode = str(body.roomCode);
        if (!roomCode) {
          sendJson(res, 400, { error: "roomCode required" });
          return;
        }
        const joined = manager.joinLobby(roomCode.toUpperCase(), str(body.name) ?? "Wizard");
        if (!joined.ok) {
          sendJson(res, 400, joined);
          return;
        }
        sendJson(res, 200, {
          playerId: joined.value.playerId,
          team: joined.value.team,
        });
        return;
      }

      if (url.pathname === "/api/start") {
        const r = manager.startMatch(str(body.roomCode) ?? "", str(body.playerId) ?? "");
        sendJson(res, r.ok ? 200 : 400, r.ok ? r.value : r);
        return;
      }

      if (url.pathname === "/api/move") {
        const roomCode = str(body.roomCode) ?? "";
        const playerId = str(body.playerId) ?? "";
        const dirX = typeof body.dirX === "number" ? body.dirX : 0;
        const dirY = typeof body.dirY === "number" ? body.dirY : 0;
        const r = manager.move(roomCode, playerId, dirX, dirY);
        sendJson(res, r.ok ? 200 : 400, r);
        return;
      }

      if (url.pathname === "/api/transform") {
        const r = manager.transform(
          str(body.roomCode) ?? "",
          str(body.playerId) ?? "",
          str(body.furnitureId) ?? "",
        );
        sendJson(res, r.ok ? 200 : 400, r);
        return;
      }

      if (url.pathname === "/api/action") {
        const r = manager.action(str(body.roomCode) ?? "", str(body.playerId) ?? "");
        sendJson(res, r.ok ? 200 : 400, r);
        return;
      }

      if (url.pathname === "/api/approve-bank" || url.pathname === "/api/reject-bank") {
        const roomCode = str(body.roomCode) ?? "";
        const playerId = str(body.playerId) ?? "";
        const r =
          url.pathname === "/api/approve-bank"
            ? manager.approveBankByPlayer(roomCode, playerId)
            : manager.rejectBankByPlayer(roomCode, playerId);
        sendJson(res, r.ok ? 200 : 400, r);
        return;
      }
    }

    // ---- static frontend (single-port production mode: npm run prod) ------
    if (opts.staticDir && serveStatic(req, res, opts.staticDir)) return;

    sendJson(res, 404, { error: "not found" });
  });
}
