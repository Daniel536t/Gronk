import { loadConfig } from "../src/server/config";
import { runAstrixStewardTurn } from "../src/server/trueforge";

const astrixBase = (process.env.ASTRIX_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const worldResponse = await fetch(`${astrixBase}/astrix/state`);
const world = await worldResponse.json();
if (!worldResponse.ok) throw new Error(`ASTrix state ${worldResponse.status}: ${JSON.stringify(world)}`);

const started = Date.now();
const cfg = loadConfig().trueforge;
const result = await runAstrixStewardTurn(cfg, world, Number(process.env.STEWARD_DEADLINE_MS ?? 60000));

const output = {
  worldRequest: { method: "GET", url: `${astrixBase}/astrix/state` },
  world,
  sessionAndTurn: { sessionId: result.sessionId, turnId: result.turnId, status: result.status, elapsedMs: result.latencyMs },
  response: result.response,
};
console.log(JSON.stringify(output));
if (result.status !== "done") {
  process.exitCode = 1;
}