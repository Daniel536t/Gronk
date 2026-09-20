// ASTrix entrypoint — single HTTP server on one port.
// Serves the Three.js observatory (server/static) and the ASTrix world API.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { clockShouldTick, worldClockMode } from "./worldClock";
import { getChainStatus } from "./chainStatus";
import { createAstrixService } from "../astrix/server";
import { createHttpServer } from "./http";
import { TrueForgeStewardProvider } from "./trueforge";
import type { StewardDecisionProvider } from "../astrix/orchestrator";

const port = Number(process.env.PORT ?? 8787);

const serverStaticDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "server", "static");
const distDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist");

const astrix = createAstrixService({
  authToken: process.env.ASTRIX_API_KEY?.trim() || undefined,
  stewardProvider: selectStewardProvider(),
  chainStatus: () => getChainStatus() as unknown as Record<string, unknown>,
  maxTurnsPerRun: numEnv("ASTRIX_MAX_TURNS_PER_RUN"),
  maxActionsPerTurn: numEnv("ASTRIX_MAX_ACTIONS_PER_TURN"),
  decideTimeoutMs: decideTimeoutMs(),
});

const httpServer = createHttpServer(port, {
  astrix,
  staticDir: existsSync(serverStaticDir)
    ? serverStaticDir
    : existsSync(distDir)
      ? distDir
      : undefined,
});
startWorldClock();

function startWorldClock(): void {
  const mode = worldClockMode(process.env.ASTRIX_CLOCK);
  console.error(
    mode === "always"
      ? "[astrix] world clock: always — time advances with or without a steward (ASTRIX_CLOCK=always)"
      : "[astrix] world clock: managed — time advances only while a steward run is live",
  );
  let held = false;
  setInterval(() => {
    if (!clockShouldTick(mode, astrix.loop.state)) {
      if (!held) {
        held = true;
        console.error(
          `[astrix] world clock held at day ${astrix.state.snapshot().day} — steward ${astrix.loop.state}`,
        );
      }
      return;
    }
    held = false;
    astrix.tick(1);
  }, 1000);
}

function numEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const TRUEFORGE_DECIDE_TIMEOUT_MS = 240_000;
function decideTimeoutMs(): number | undefined {
  const explicit = numEnv("ASTRIX_DECIDE_TIMEOUT_MS");
  if (explicit) return explicit;
  if (!wantsTrueForge()) return undefined;
  console.error(
    `[astrix] no ASTRIX_DECIDE_TIMEOUT_MS set; using ${TRUEFORGE_DECIDE_TIMEOUT_MS}ms for the TrueForge runtime ` +
      `(a real LLM turn measured ~95s; the 60s default would time out every turn)`,
  );
  return TRUEFORGE_DECIDE_TIMEOUT_MS;
}

function wantsTrueForge(): boolean {
  const mode = (process.env.ASTRIX_RUNTIME ?? "local").trim().toLowerCase();
  return mode === "trueforge" || (mode === "auto" && !!process.env.TRUEFORGE_URL?.trim());
}

function selectStewardProvider(): StewardDecisionProvider | undefined {
  if (!wantsTrueForge()) {
    const mode = (process.env.ASTRIX_RUNTIME ?? "local").trim().toLowerCase();
    console.error(`[astrix] steward runtime: local (ASTRIX_RUNTIME=${mode}) — TrueForge not required`);
    return undefined;
  }
  const baseUrl = process.env.TRUEFORGE_URL?.trim() ?? "http://localhost:8790";
  console.error(`[astrix] steward runtime: trueforge (${baseUrl})`);
  return new TrueForgeStewardProvider(
    { baseUrl, apiKey: process.env.TRUEFORGE_API_KEY, mcpServerUrl: process.env.MCP_SERVER_URL },
    { deadlineMs: decideTimeoutMs() },
  );
}

const host = process.env.HOST ?? "0.0.0.0";
httpServer.listen(port, host, () => {
  console.error(`[astrix] HTTP listening on ${host}:${port}`);
});
