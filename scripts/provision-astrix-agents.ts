import { loadConfig } from "../src/server/config";
import { provisionTrueForgeAgents, runAstrixStewardTurn, type AgentSpecInput } from "../src/server/trueforge";

const cfg = loadConfig().trueforge;
const model = cfg.botsModel?.name ? cfg.botsModel : cfg.gronkModel;
const astrixMcp = { name: "gronks-hoard-mcp", url: "http://localhost:8787/mcp" };

const agents: AgentSpecInput[] = [
  {
    name: "astrix-steward",
    model,
    instructions: "You are the ASTrix World Steward. You manage three islands: Meadow, Frost, Dusk. Population: 4. Food is critical — only 12 units remain (3 days). Your goal: keep the village alive. You have MCP tools to inspect and modify the world. Before any irreversible action (clear_terrain, build_bridge, demolish), you MUST request human approval by setting approval_required: true. Delegate to subagents for specialized analysis. Return your decisions as structured JSON.",
    mcpServers: [astrixMcp],
    skills: [],
  },
  {
    name: "astrix-agriculture",
    model,
    instructions: "You are the Agriculture Subagent. Focus ONLY on food production, farms, crops, and harvest timing. You CANNOT propose bridges, houses, or terrain clearing. Return analysis as JSON.",
    mcpServers: [astrixMcp],
  },
  {
    name: "astrix-construction",
    model,
    instructions: "You are the Construction Subagent. Focus ONLY on buildings, bridges, material costs, and placement. You CANNOT propose what to farm or where. Return analysis as JSON.",
    mcpServers: [astrixMcp],
  },
  {
    name: "astrix-ecology",
    model,
    instructions: "You are the Ecology Subagent. Focus ONLY on biome health, sustainability, and tree count. You can VETO plans that damage biomes. You CANNOT propose construction or farming directly. Return analysis as JSON.",
    mcpServers: [astrixMcp],
  },
];

const results = await provisionTrueForgeAgents(cfg, agents);
for (const result of results) console.log(JSON.stringify(result));
if (results.some((result) => result.status.startsWith("error"))) {
  process.exitCode = 1;
} else if (process.env.ASTRIX_STEWARD_SMOKE === "1") {
  const astrixBase = (process.env.ASTRIX_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
  const worldResponse = await fetch(`${astrixBase}/astrix/state`);
  const snapshot = await worldResponse.json();
  if (!worldResponse.ok) {
    console.error(JSON.stringify({ step: "steward_turn", error: `ASTrix state ${worldResponse.status}` }));
    process.exitCode = 1;
  } else {
    try {
      const result = await runAstrixStewardTurn(cfg, snapshot, Number(process.env.STEWARD_DEADLINE_MS ?? 60000));
      console.log(JSON.stringify({ step: "steward_turn", latencyMs: result.latencyMs, status: result.status, response: result.response }));
      if (result.status !== "done") process.exitCode = 1;
    } catch (error) {
      console.error(JSON.stringify({ step: "steward_turn", error: String(error) }));
      process.exitCode = 1;
    }
  }
}
