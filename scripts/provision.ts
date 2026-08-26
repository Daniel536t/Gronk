// Provision TrueForge agents. Run once before BOTS=trueforge:
//   npm run provision
// Registers the game's MCP connector, then creates the 5 named agents
// (gronk, 3 bot wizards, gamemaster) and attaches the MCP server to each.
// Requires TrueForge running on the baseUrl in config/trueforge.json
// (default http://localhost:8790) and a model-provider API key configured
// in the TrueForge UI (Settings -> Providers) so turns can run.
import {
  GRONK_AGENT_NAME,
  GRONK_SYSTEM_PROMPT,
  BOT_WIZARD_NAMES,
  GAME_MASTER_AGENT_NAME,
  WIZARD_SYSTEM_PROMPT,
  MCP_CONNECTOR_NAME,
  provisionTrueForgeAgents,
  registerMcpConnector,
  registerNvidiaProvider,
  registerSkill,
  type AgentSpecInput,
} from "../src/server/trueforge";
import { GAME_MASTER_SYSTEM_PROMPT } from "../src/server/gamemaster";
import { loadConfig } from "../src/server/config";

const cfg = loadConfig().trueforge;
const mcpUrl = cfg.mcpServerUrl ?? "http://localhost:8787/mcp";

// The four PLAYING agents (gronk + bot wizards) get NO MCP connector: the full
// public state is injected into every turn prompt by TrueForgeBackend, so they
// answer directly with an agent_intent JSON — no tool calls, no transport
// fragility. The secret boundary still holds (they only ever see public
// state). The GameMaster keeps the connector + skill for the harness demo.
const agents: AgentSpecInput[] = [
  {
    name: GRONK_AGENT_NAME,
    model: cfg.gronkModel,
    instructions: GRONK_SYSTEM_PROMPT,
  },
  ...BOT_WIZARD_NAMES.map((name) => ({
    name,
    model: cfg.botsModel,
    instructions: WIZARD_SYSTEM_PROMPT,
  })),
  {
    name: GAME_MASTER_AGENT_NAME,
    model: cfg.botsModel,
    instructions: GAME_MASTER_SYSTEM_PROMPT,
    mcpServers: [{ name: MCP_CONNECTOR_NAME, url: mcpUrl }],
    skills: ["gronks-hoard"],
  },
];

console.error(`Registering MCP connector (${mcpUrl}) against ${cfg.baseUrl} ...`);
void (async () => {
  // Optional: register the NVIDIA NIM provider so the models in
  // config/gronk-model.json + config/bots-model.json resolve. Pass the key via
  // env (never committed):  NVIDIA_API_KEY=nvapi-... npm run provision
  const nvidiaKey = process.env.NVIDIA_API_KEY?.trim();
  if (nvidiaKey) {
    console.error(`Registering NVIDIA NIM model provider ...`);
    const prov = await registerNvidiaProvider(cfg, nvidiaKey);
    console.error(`  ${prov.name}: ${prov.status}`);
  } else {
    console.error(`  (skip model provider — set NVIDIA_API_KEY to register NVIDIA NIM)`);
  }
  const conn = await registerMcpConnector(cfg);
  console.error(`  ${conn.name}: ${conn.status}`);
  console.error(`Registering gronks-hoard skill pack (from Daniel536t/Gronk, ref main) ...`);
  const skill = await registerSkill(cfg);
  console.error(`  ${skill.name}: ${skill.status}`);
  console.error(`Provisioning ${agents.length} agents against ${cfg.baseUrl} ...`);
  let results = await provisionTrueForgeAgents(cfg, agents);

  // Attaching skills requires a working sandbox (local bwrap runtime with
  // socat + ripgrep + python3-venv installed, or a Daytona provider). If
  // GameMaster fails for that reason, create it without the skill pack so all
  // 5 agents exist (riddles are still revealed by the engine; the skill is a
  // harness flourish).
  const gm = results.find((r) => r.name === GAME_MASTER_AGENT_NAME);
  if (gm && gm.status.includes("sandbox provider")) {
    console.error("  (skills need a sandbox provider — creating gamemaster without the skill pack)");
    const noSkill = agents.find((a) => a.name === GAME_MASTER_AGENT_NAME)!;
    const retry = await provisionTrueForgeAgents(cfg, [{ ...noSkill, skills: undefined }]);
    results = results.map((r) => (r.name === GAME_MASTER_AGENT_NAME ? retry[0] : r));
  }
  for (const r of results) console.error(`  ${r.name}: ${r.status}`);
  console.error("Done.");
})();