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

const botMode: BotMode = (process.env.BOTS as BotMode) ?? "scripted";
const port = Number(process.env.PORT ?? 8787);

// In production (npm run prod), the game server serves the built frontend so
// one port serves everything: http://localhost:8787.
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
const stdioMcp = createMcpServer(manager);
const mcpHttp = createMcpHttpBridge(() => createMcpServer(manager));

const httpServer = createHttpServer(manager, port, {
  mcp: mcpHttp,
  staticDir: existsSync(distDir) ? distDir : undefined,
});
httpServer.listen(port, () => {
  console.error(`[gronks-hoard] HTTP listening on :${port} (BOTS=${botMode})`);
});

void connectStdio(stdioMcp)
  .then(() => {
    console.error("[gronks-hoard] MCP server ready on stdio");
  })
  .catch((err) => {
    console.error("[gronks-hoard] MCP stdio failed:", err);
    process.exit(1);
  });
