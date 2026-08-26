// Provision TrueForge agents. Run once before BOTS=trueforge:
//   npx tsx scripts/provision.ts
// Creates the 5 named agents (Gronk, 3 bot wizards, game master) and connects
// them to the game's MCP server. Requires TrueForge running on the baseUrl in
// config/trueforge.json (default http://localhost:8790).
import {
  GRONK_AGENT_NAME,
  GRONK_SYSTEM_PROMPT,
  BOT_WIZARD_NAMES,
  WIZARD_SYSTEM_PROMPT,
  provisionTrueForgeAgents,
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
    mcpServers: [{ name: "gronks-hoard-mcp", url: mcpUrl }],
  },
  ...BOT_WIZARD_NAMES.map((name) => ({
    name,
    model: cfg.botsModel,
    instructions: WIZARD_SYSTEM_PROMPT,
    mcpServers: [{ name: "gronks-hoard-mcp", url: mcpUrl }],
  })),
  {
    name: "GameMaster",
    model: cfg.botsModel,
    instructions: GAME_MASTER_SYSTEM_PROMPT,
    mcpServers: [{ name: "gronks-hoard-mcp", url: mcpUrl }],
    skills: ["gronks-hoard"],
  },
];

console.error(`Provisioning ${agents.length} agents against ${cfg.baseUrl} ...`);
void provisionTrueForgeAgents(cfg, agents).then((results) => {
  for (const r of results) console.error(`  ${r.name}: ${r.status}`);
  console.error("Done.");
});