import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import type { AstrixService } from "../astrix/server";
import { readAstrixBody } from "../astrix/server";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".pck": "application/octet-stream",
  ".ogg": "audio/ogg",
};

function sendJson(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  staticDir: string,
): boolean {
  if (!existsSync(staticDir)) return false;
  let pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  if (pathname === "/") pathname = "/index.html";
  if (pathname.endsWith("/")) pathname += "index.html";
  const resolved = normalize(join(staticDir, pathname));
  if (!resolved.startsWith(normalize(staticDir))) return false;
  if (!existsSync(resolved) || !statSync(resolved).isFile()) return false;
  res.writeHead(200, {
    "Content-Type": MIME[extname(resolved)] ?? "application/octet-stream",
    "Cache-Control": "no-cache",
    "Last-Modified": statSync(resolved).mtime.toUTCString(),
  });
  res.end(readFileSync(resolved));
  return true;
}

export function createHttpServer(
  port = 8787,
  opts: { staticDir?: string; astrix?: AstrixService } = {},
): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const origin = req.headers.origin;
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (origin) res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (opts.astrix && url.pathname.startsWith("/astrix/")) {
      let astrixBody: Record<string, unknown> | undefined;
      if (req.method === "POST") {
        try { astrixBody = await readAstrixBody(req); }
        catch (e) { sendJson(res, 400, { error: (e as Error).message }); return; }
      }
      if (await opts.astrix.handle(req, res, url.pathname, astrixBody)) return;
    }

    if (opts.staticDir && serveStatic(req, res, opts.staticDir)) return;

    sendJson(res, 404, { error: "not found" });
  });
}
