// Entrypoint: one LobbyManager shared by the MCP server (agents) and the HTTP
// server (frontend). BOTS=scripted|trueforge selects the bot driver; scripted
// is the permanent fallback. When BOTS=trueforge, Gronk + bot wizards are
// TrueForge agents (config/*.json), and the MCP server also listens over HTTP
// on POST /mcp so TrueForge can reach it.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LobbyManager, scriptedBackendFactory, type BotMode } from "./lobby";
import { createMcpServer, connectStdio } from "./mcp";
import { createMcpHttpBridge } from "./mcpHttp";
import { createHttpServer } from "./http";
import { trueforgeBackendFactory } from "./trueforgeFactory";
import { loadConfig } from "./config";
import { createAstrixService } from "../astrix/server";

const botMode: BotMode = (process.env.BOTS as BotMode) ?? "scripted";
const port = Number(process.env.PORT ?? 8787);

// In production the server serves the client so one port serves everything:
// http://localhost:8787. The ASTrix Godot HTML5 export lives in server/static/
// (repo-root/server/static) and replaces the old Vite client at the root.
// The Vite dist/ dir remains as a fallback for local dev builds.
const serverStaticDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "server", "static");
const distDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist");

const manager = new LobbyManager({
  autoTick: true,
  botMode,
  backendFactory:
    botMode === "trueforge"
      ? trueforgeBackendFactory(loadConfig().trueforge)
      : scriptedBackendFactory(Math.random),
  decisionTimeoutMs: loadConfig().trueforge.decisionTimeoutMs,
});

// stdio gets its own McpServer; each HTTP session gets one too (the SDK
// connects one server to one transport). All share the single LobbyManager.
const astrix = createAstrixService({ authToken: process.env.ASTRIX_API_KEY?.trim() || undefined });
const stdioMcp = createMcpServer(manager, astrix);
const mcpHttp = createMcpHttpBridge(() => createMcpServer(manager, astrix));

const httpServer = createHttpServer(manager, port, {
  mcp: mcpHttp,
  astrix,
  staticDir: existsSync(serverStaticDir)
    ? serverStaticDir
    : existsSync(distDir)
      ? distDir
      : undefined,
});
setInterval(() => astrix.tick(1), 1000);
// HOST env lets ops rebind the app to 127.0.0.1 behind the Caddy reverse
// proxy so 8787 is not exposed on the public interface (default: all).
const host = process.env.HOST ?? "0.0.0.0";
httpServer.listen(port, host, () => {
  console.error(`[gronks-hoard] HTTP listening on ${host}:${port} (BOTS=${botMode})`);
});

void connectStdio(stdioMcp)
  .then(() => {
    console.error("[gronks-hoard] MCP server ready on stdio");
  })
  .catch((err) => {
    console.error("[gronks-hoard] MCP stdio failed:", err);
    process.exit(1);
  });
