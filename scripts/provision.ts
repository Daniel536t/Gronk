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
  type AgentSpecInput,
} from "../src/server/trueforge";
import { GAME_MASTER_SYSTEM_PROMPT } from "../src/server/gamemaster";
import { loadConfig } from "../src/server/config";

const cfg = loadConfig().trueforge;
const mcpUrl = cfg.mcpServerUrl ?? "http://localhost:8787/mcp";

const agents: AgentSpecInput[] = [
  {
    name: GRONK_AGENT_NAME,
    model: cfg.gronkModel,
    instructions: GRONK_SYSTEM_PROMPT,
    mcpServers: [{ name: MCP_CONNECTOR_NAME, url: mcpUrl }],
  },
  ...BOT_WIZARD_NAMES.map((name) => ({
    name,
    model: cfg.botsModel,
    instructions: WIZARD_SYSTEM_PROMPT,
    mcpServers: [{ name: MCP_CONNECTOR_NAME, url: mcpUrl }],
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
  const conn = await registerMcpConnector(cfg);
  console.error(`  ${conn.name}: ${conn.status}`);
  console.error(`Provisioning ${agents.length} agents against ${cfg.baseUrl} ...`);
  const results = await provisionTrueForgeAgents(cfg, agents);
  for (const r of results) console.error(`  ${r.name}: ${r.status}`);
  console.error("Done.");
})();