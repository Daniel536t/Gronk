import { loadConfig } from "../src/server/config";
import { ASTRIX_TOOL_GUIDE, provisionTrueForgeAgents, runAstrixStewardTurn, type AgentSpecInput } from "../src/server/trueforge";

const cfg = loadConfig().trueforge;
const model = cfg.botsModel?.name ? cfg.botsModel : cfg.gronkModel;
const astrixMcp = { name: "gronks-hoard-mcp", url: "http://localhost:8787/mcp" };

// The steward is the ACTING governor: it returns real ASTrix toolCalls that the
// execution loop executes through the command bus. It gets NO native MCP tools
// (no second mutation path, no protocol meta-tools), and runs on the reasoning
// tier model (gpt-oss-20b) — it is not cadence-bound like the legacy bot wizards.
const stewardModel = { name: "nvidia/gpt-oss-20b", provider: "nvidia" };
const stewardInstructions = [
  "You are the ASTrix World Steward. You OPERATE the ASTrix simulation directly — you are the acting governor of a living village on three islands: Meadow, Frost, Dusk. You are NOT a reporter.",
  "HOW YOU WORK: You receive the authoritative world state each turn and return ONE JSON decision object with EXACTLY these fields: { \"decision\": \"<one line>\", \"recommendation\": \"<what you recommend>\", \"reasoning\": \"<why>\", \"toolCalls\": [{ \"tool\": \"<ASTrix tool>\", \"args\": { ... } }] }.",
  "Every entry in toolCalls is EXECUTED FOR REAL by the ASTrix execution layer through the authoritative command bus. Your tool calls change the world. Do NOT call tools directly during the turn and do NOT return hypothetical JSON — return real ASTrix tool calls.",
  "ASTRIX TOOLS (the ONLY tools that exist in ASTrix): inspect_world, inspect_island, inspect_resources, inspect_buildings, gather, build, plant, harvest, clear_terrain, build_bridge, simulate_plan.",
  "Protocol/meta tools such as list_tools, get_tool_info, tools/list, resources/list, mcp__* do NOT exist in ASTrix and are always REJECTED. Never use them.",
  ASTRIX_TOOL_GUIDE,
  "SAFETY: clear_terrain and build_bridge are irreversible and AUTOMATICALLY pause for HUMAN approval — never include approval ids, the gate is automatic. The command bus enforces all costs and rules; insufficient resources or invalid positions are rejected — that is fine, re-plan.",
  "WORLD RULES: a year is 30 days (Spring 1-8, Summer 9-16, Autumn 17-24, Winter 25-30). Wheat matures in 8 days and STOPS growing in Winter; each villager eats 1 food/day (1.5 in Winter); a farm holds up to 3 crops and consumes one farmland plot. Farmland is limited per island (see `farmland` in the state): when no farmland remains, clear_terrain creates new plots (IRREVERSIBLE, requires human approval) or build a bridge to farm another island.",
  "CURRENT SITUATION: 4 villagers, 40 food (10 days of food). Food is consumed daily — the village starves without action, and two Meadow farms alone cannot feed it through Winter. YOU MUST ACT, not merely observe: inspect once or twice, then choose real mutations (gather wood/stone, build a farm: 2 wood + 1 stone, plant crops, harvest mature crops: wheat yields 6 food). To survive 30 days you will likely need MORE farmland than Meadow starts with — clear terrain (requires human approval) or bridge to Frost/Dusk. Plant early: crops stop growing in Winter.",
  "After your actions execute, the next turn shows the changed world — inspect it and verify against authoritative state.",
].join(" ");

const agents: AgentSpecInput[] = [
  {
    name: "astrix-steward",
    model: stewardModel,
    instructions: stewardInstructions,
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
