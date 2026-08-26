// Live TrueForge smoke test: drive real agent decisions against the running
// harness (localhost:8790) with the NVIDIA NIM models configured in
// config/*.json. Proves the full LLM path end-to-end:
//   ensureSession -> postTurn (stream:false) -> poll -> parseDecision.
//
//   npm run tf:smoke
//
// Prints one decision per agent with real latency. Requires the harness up
// (pm2) and agents provisioned (npm run provision).
import { GameEngine } from "../src/engine";
import { toAgentView } from "../src/server/bots";
import { TrueForgeBackend } from "../src/server/trueforge";
import { loadConfig } from "../src/server/config";

const cfg = loadConfig().trueforge;

const eng = new GameEngine({ rng: () => 0.5 });
eng.startMatch();
const view = toAgentView(eng.state);

console.error(`[tf-smoke] harness ${cfg.baseUrl} | models: gronk=${cfg.gronkModel.name} bots=${cfg.botsModel.name}`);
console.error(`[tf-smoke] state: ${view.players.length} players, ${view.furniture.length} furniture, gronk @ ${view.gronk.x.toFixed(0)},${view.gronk.y.toFixed(0)}`);

const seats: [string, string][] = [
  ["gronk", "gronk"],
  ["wizard-1", "botwizard-a"],
];

for (const [seat, agentName] of seats) {
  const t0 = Date.now();
  const backend = new TrueForgeBackend(seat, agentName, cfg);
  try {
    const d = await backend.decide(view);
    const ms = Date.now() - t0;
    console.error(`[tf-smoke] ${agentName}: intent=${d.intent}${d.targetId ? ` target=${d.targetId}` : ""} latency=${ms}ms`);
    if (!d.intent) process.exit(1);
  } catch (e) {
    const ms = Date.now() - t0;
    console.error(`[tf-smoke] ${agentName}: ERROR after ${ms}ms: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
console.error("[tf-smoke] PASS — real TrueForge agents produce decisions against NVIDIA NIM.");
