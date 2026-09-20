// ASTrix TrueForge integration — drives steward and subagent turns over HTTP.
import type { StewardDecision, StewardDecisionProvider, StewardRunContext } from "../astrix/orchestrator";

export interface ModelConfig {
  name?: string;
  provider?: string;
  [key: string]: unknown;
}

export interface TrueForgeConfig {
  baseUrl: string;
  apiKey?: string;
  decisionTimeoutMs?: number;
  /** URL of this game's MCP server over streamable HTTP, for agent tool access. */
  mcpServerUrl?: string;
}

/** MCP connector name (registered in TrueForge settings). */
export const MCP_CONNECTOR_NAME = "astrix-mcp";

export class TrueForgeBackendError extends Error {}

/** One agent spec to create in TrueForge. */
export interface AgentSpecInput {
  name: string;
  model: ModelConfig;
  instructions: string;
  mcpServers?: { name: string; url: string }[];
  skills?: string[];
}

/**
 * Create named agents in TrueForge via the HTTP API (idempotent-ish: existing
 * agents are reused). Run once before BOTS=trueforge. Returns the created names.
 */
export interface AstrixStewardTurnOptions {
  /** The Overseer's current objective, included in the steward prompt. */
  objective?: string;
  /** Compact execution history (memory) included in the steward prompt. */
  memory?: string;
  /** TrueForge agent name to drive (defaults to the provisioned steward). */
  agentName?: string;
  /** Emphasized instruction re-stating the strict JSON contract (set when the
   *  previous attempt failed parsing and is being retried once). */
  retryHint?: string;
}

export interface AstrixStewardTurnResult {
  sessionId: string | null;
  turnId: string | null;
  status: "done" | "error" | "cancelled" | "timeout";
  latencyMs: number;
  response: unknown;
  /** Parsed structured decision, when the turn completed and was parseable. */
  decision: StewardDecision | null;
  /** Why the decision could not be parsed (null when it was). */
  parseError?: string | null;
  /** True when the decision only parsed after the stray-escape repair pass. */
  decisionRepaired?: boolean;
}

/**
 * Drive one ASTrix steward session/turn with a server-authoritative snapshot.
 * Polls to a terminal 'done' state; throws on non-2xx responses, terminal
 * error/cancelled states, missing identifiers, or polling deadline exhaustion.
 * Returns the raw TrueForge {"data":...} turn body plus a parsed decision.
 */
export async function runAstrixStewardTurn(
  cfg: TrueForgeConfig,
  snapshot: unknown,
  deadlineMs = 60_000,
  options: AstrixStewardTurnOptions = {},
): Promise<AstrixStewardTurnResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const started = Date.now();

  const sessionRes = await fetch(`${base}/api/v1/sessions`, {
    method: "POST", headers, body: JSON.stringify({ agent: { name: options.agentName ?? "astrix-steward" } }),
  });
  const sessionBody = await sessionRes.json().catch(() => ({}));
  if (!sessionRes.ok) throw new TrueForgeBackendError(`create session failed (${sessionRes.status}): ${JSON.stringify(sessionBody)}`);
  const sessionId: string | null = (sessionBody as any)?.data?.id ?? null;
  if (!sessionId) throw new TrueForgeBackendError("create session returned no session id");

  const prompt = buildStewardPrompt(snapshot, options);
  const turnRes = await fetch(`${base}/api/v1/sessions/${sessionId}/turns`, {
    method: "POST", headers,
    body: JSON.stringify({ input: [{ type: "user.message", content: prompt }], previous_turn_id: "auto", stream: false }),
  });
  const turnBody = await turnRes.json().catch(() => ({}));
  if (!turnRes.ok) throw new TrueForgeBackendError(`create turn failed (${turnRes.status}): ${JSON.stringify(turnBody)}`);
  const turnId: string | null = (turnBody as any)?.data?.id ?? null;
  if (!turnId) throw new TrueForgeBackendError("create turn returned no turn id");

  let result: AstrixStewardTurnResult = { sessionId, turnId, status: "timeout", latencyMs: 0, response: null, decision: null };
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const poll = await fetch(`${base}/api/v1/sessions/${sessionId}/turns/${turnId}`, { headers });
    const body = await poll.json().catch(() => ({}));
    if (!poll.ok) throw new TrueForgeBackendError(`get turn failed (${poll.status}): ${JSON.stringify(body)}`);
    const state = (body as any)?.data?.state;
    if (state?.status === "error" || state?.status === "cancelled") {
      result = { sessionId, turnId, status: state.status, latencyMs: 0, response: body, decision: null };
      break;
    }
    if (state?.status === "done") {
      const parse = parseAstrixStewardDecisionDetailed((body as any)?.data?.state?.output);
      result = {
        sessionId,
        turnId,
        status: "done",
        latencyMs: 0,
        response: body,
        decision: parse.decision,
        parseError: parse.parseError,
        decisionRepaired: parse.repaired,
      };
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  result.latencyMs = Date.now() - started;
  return result;
}

/**
 * Exact ASTrix tool argument schemas, shared by the steward turn prompt and
 * the provisioned agent instructions so the model never has to guess names.
 * snake_case is the contract; camelCase variants are rejected.
 */
export const ASTRIX_TOOL_GUIDE = [
  "TOOL ARGUMENTS (exact snake_case names — camelCase like buildingType or islandId will be REJECTED):",
  "  inspect_world: {}",
  '  inspect_island: { "island_id": "meadow" | "frost" | "dusk" }',
  "  inspect_resources: {}",
  "  inspect_buildings: {}",
  '  gather: { "resource_id": "<node id>" }  OR  { "resource_type": "wood" | "stone" | "food" | "water" | "crystal" }',
  '  build: { "building_type": "house" | "farm" | "storage", "position": { "x": 0-100, "y": <ground level>, "z": 0-60 }, "island_id": "meadow" | "frost" | "dusk" }   (Frost/Dusk are UNREACHABLE from Meadow until a bridge exists — building there also requires a bridge)',
  '  plant: { "farm_plot_id": "<existing farm building id>", "crop_type": "wheat" }',
  '  harvest: { "crop_id": "<crop id>" }   (harvest a MATURE crop — growth 100% — for food; wheat yields 6 food)',
  '  clear_terrain: { "position": { "x", "y", "z" }, "radius": 1-20 }   (IRREVERSIBLE — auto human approval; yields 1 wood + 1 farmland plot per tree cleared but lowers biome health)',
  '  build_bridge: { "island_a": "meadow" | "frost" | "dusk", "island_b": "<different island>" }   (IRREVERSIBLE — auto human approval; Frost/Dusk resources are UNREACHABLE from Meadow until a bridge exists)',
  '  simulate_plan: { "plan": "<JSON string>" }',
].join("\n");

/** Build the steward turn prompt: objective + memory + strict JSON contract. */
export function buildStewardPrompt(snapshot: unknown, options: AstrixStewardTurnOptions = {}): string {
  const parts: string[] = [
    "You are the ASTrix World Steward operating a living village on three islands: Meadow, Frost, Dusk.",
    "Your job is to advance the Overseer's objective by choosing REAL tool calls that are then EXECUTED for real by the ASTrix execution layer through the authoritative command bus.",
  ];
  if (options.objective) parts.push(`Current objective from the Overseer: "${options.objective}"`);
  if (options.memory) parts.push(`Outcomes of your recent actions (what you attempted, what happened, whether it was approved, whether the world changed):\n${options.memory}`);
  if (options.retryHint) parts.push(`RETRY NOTICE (your previous turn was discarded unexecuted): ${options.retryHint}`);
  parts.push(
    "The ONLY tools that exist in ASTrix are: inspect_world, inspect_island, inspect_resources, inspect_buildings, gather, build, plant, harvest, clear_terrain, build_bridge, simulate_plan.",
    "NEVER call create_sub_agent, sub_agent, list_tools, get_tool_info, tools/list, resources/list, mcp__* or ANY TrueForge protocol/meta tool. Those do not exist in ASTrix and are always REJECTED — delegation is handled by the TrueForge orchestration layer outside the world, NOT by your tool calls. Never invent ASTrix tools and NEVER invent IDs: only use the exact IDs (farm_plot_id, crop_id, resource_id, island) returned by your own previous observations and action results.",
    ASTRIX_TOOL_GUIDE,
    "Every mutation flows through the authoritative command bus. Irreversible actions (clear_terrain, build_bridge) AUTOMATICALLY pause for HUMAN approval before execution — never include an approval id, the gate is automatic.",
    "Return ONE JSON object and nothing else (no markdown fences) with EXACTLY these fields:",
    '{ "decision": "<one-line decision>", "recommendation": "<what you recommend>", "reasoning": "<why>", "toolCalls": [{ "tool": "<ASTrix tool>", "args": { ... } }] }',
    "ACT, do not merely observe: observation-only turns accomplish nothing and the village is starving. Inspect once or twice, then choose real mutations (gather, build a farm, plant, harvest mature crops; clear terrain only if genuinely needed — it pauses for human approval).",
    "WORLD RULES: a year is 30 days (Spring 1-8, Summer 9-16, Autumn 17-24, Winter 25-30 — see `season` in the state). Wheat matures in 8 days and STOPS growing in Winter, so plant early and HARVEST mature crops (growth 100%) before winter. Each villager eats 1 food/day (1.5 in Winter). Farmland is limited per island (see `farmland`: a farm consumes one plot, each farm holds up to 3 crops). When no farmland remains, clear_terrain creates new plots on that island (IRREVERSIBLE — pauses for human approval), or build a bridge to farm another island.",
    "ECONOMICS: every turn compare projected food demand against available and future production. The state provides deterministic derived facts — `foodPerDay` (daily consumption), `daysOfFoodRemaining` (food divided by consumption, ignoring production), `harvestableFood` (harvest these now), `growingFood` (every planted crop if it matures -- mature crops included, so never add it to `harvestableFood`), `daysUntilNextHarvest` (days until the soonest food can arrive; null when nothing can mature, as in Winter), `projectedFoodAtWinter` (food + growingFood minus consumption until Winter), `foodPressureLevel` (critical when under 3 days of food OR the granary empties before `daysUntilNextHarvest`; high when under 7 days OR `projectedFoodAtWinter` is negative). Empty farm plots are wasted production: if survival requires more food, plant every free plot and harvest as soon as crops mature. Never let the village run out of food before the next harvest.",
    "TIME-TO-PRODUCTION: actions whose benefits arrive later must be started BEFORE the resource deadline. Food reserves are finite (4 villagers eat `foodPerDay` per day) and wheat takes 8 days to mature — so the day you PLANT is not the day you EAT. Maintain a forward food forecast across the crop-maturity window: if `daysOfFoodRemaining` is below `daysUntilNextHarvest` the village starves before the next harvest lands -- that is what `foodPressureLevel: critical` means. Establish sufficient food production capacity EARLY — a farm built today yields nothing for ~8 days, so building it when food is nearly gone is too late. Plan against the future (winter, `projectedFoodAtWinter`), not merely today's balance.",
    "If nothing needs doing, return toolCalls: [] — that is a valid idle decision.",
    `Authoritative world state:\n${JSON.stringify(snapshot)}`,
  );
  return parts.join("\n");
}

/**
 * Extract a structured StewardDecision from a TrueForge turn output. Accepts
 * an explicit decision tool call or a JSON object embedded in the text
 * (markdown fences stripped). Returns null when nothing usable is found so the
 * caller can fail observably instead of guessing.
 */
export function parseAstrixStewardDecision(output: unknown): StewardDecision | null {
  return parseAstrixStewardDecisionDetailed(output).decision;
}

/** A decision parse plus the reason it failed, so callers can report it. */
export interface StewardDecisionParse {
  decision: StewardDecision | null;
  /** Why no decision could be read. Null on success. */
  parseError: string | null;
  /** True when the decision only parsed after the stray-escape repair pass. */
  repaired: boolean;
}

/**
 * Same as parseAstrixStewardDecision, but surfaces WHY parsing failed instead
 * of collapsing every cause into a bare null. The reason reaches the operator
 * through DECISION_COMPLETED, so the next parse failure is diagnosable from
 * the event log alone rather than from msgpack in TrueForge's database.
 */
export function parseAstrixStewardDecisionDetailed(output: unknown): StewardDecisionParse {
  const o = output as { content?: unknown; tool_calls?: { function?: { name?: string; arguments?: string } }[] } | null | undefined;
  for (const tc of o?.tool_calls ?? []) {
    const name = tc?.function?.name;
    if (name === "astrix_decision" || name === "decision" || name === "submit_decision") {
      const parsed = tryParseArguments(tc.function?.arguments);
      if (parsed) {
        const decision = normalizeStewardDecision(parsed);
        if (decision) return { decision, parseError: null, repaired: false };
      }
    }
  }
  const extraction = extractJsonObjectDetailed(contentToText(o?.content));
  if (extraction.value) {
    const decision = normalizeStewardDecision(extraction.value);
    if (decision) return { decision, parseError: null, repaired: extraction.repaired };
    return {
      decision: null,
      parseError: "parsed a JSON object but it carried neither a `decision` string nor any `toolCalls`",
      repaired: extraction.repaired,
    };
  }
  return { decision: null, parseError: extraction.error, repaired: false };
}

/** Normalize TrueForge content (string, or an array of text blocks) to text. */
function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const text = (part as Record<string, unknown>).text;
          if (typeof text === "string") return text;
        }
        return "";
      })
      .join("\n");
  }
  return "";
}

function tryParseArguments(raw: string | undefined): Record<string, unknown> | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** One JSON-object extraction attempt, including WHY it failed. */
export interface JsonExtraction {
  value: Record<string, unknown> | null;
  /** JSON.parse's own message when extraction failed — never swallowed. */
  error: string | null;
  /** True when the candidate only parsed after the stray-escape repair pass. */
  repaired: boolean;
}

/**
 * Remove `\n`, `\r` and `\t` ESCAPE SEQUENCES that appear OUTSIDE string
 * literals, and nothing else.
 *
 * WHY THIS EXISTS: gpt-oss-20b emits them as element separators inside JSON
 * arrays -- `"toolCalls":[{"tool":"build_bridge",...},\n{"tool":"build",...}]`
 * -- where a literal backslash-n between two array elements is simply invalid
 * JSON. A whole 15-call plan was discarded over punctuation (turn 2 of the
 * 2026-09-05 live run, see artifacts/forensics/).
 *
 * This is deliberately NOT a general "make malformed JSON valid" sanitizer:
 * escapes inside strings are copied byte for byte (so `reasoning` text keeps
 * its real newlines), and every other kind of malformation -- unbalanced
 * braces, trailing commas, unquoted keys -- still fails to parse.
 */
export function repairStrayEscapes(candidate: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < candidate.length; i += 1) {
    const ch = candidate[i];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        // Inside a string an escape pair is DATA: copy both characters as-is.
        i += 1;
        if (i < candidate.length) out += candidate[i];
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    const next = candidate[i + 1];
    if (ch === "\\" && (next === "n" || next === "r" || next === "t")) {
      i += 1; // drop exactly this stray two-character escape sequence
      continue;
    }
    out += ch;
  }
  return out;
}

function tryParseObject(candidate: string): { value: Record<string, unknown> | null; error: string | null } {
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { value: parsed as Record<string, unknown>, error: null };
    }
    return { value: null, error: `top-level JSON value is ${Array.isArray(parsed) ? "an array" : typeof parsed}, not an object` };
  } catch (error) {
    return { value: null, error: (error as Error).message };
  }
}

/**
 * Find the first JSON object in a text blob (tolerates prose + fences), and
 * report the parse error when there isn't one. Parsing is attempted on the raw
 * candidate FIRST; only if that fails is exactly ONE repair pass applied.
 */
export function extractJsonObjectDetailed(text: string): JsonExtraction {
  if (!text) return { value: null, error: "model output was empty", repaired: false };
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { value: null, error: "no JSON object delimiters ({ ... }) in model output", repaired: false };
  const candidate = text.slice(start, end + 1);

  const first = tryParseObject(candidate);
  if (first.value) return { value: first.value, error: null, repaired: false };

  const repaired = repairStrayEscapes(candidate);
  if (repaired === candidate) return { value: null, error: first.error, repaired: false };
  const second = tryParseObject(repaired);
  if (second.value) return { value: second.value, error: null, repaired: true };
  return { value: null, error: `${first.error} (stray-escape repair also failed: ${second.error})`, repaired: false };
}

/** Find the first JSON object in a text blob (tolerates prose + fences). */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  return extractJsonObjectDetailed(text).value;
}

function normalizeStewardDecision(raw: Record<string, unknown>): StewardDecision | null {
  const rawCalls = Array.isArray(raw.toolCalls) ? raw.toolCalls : [];
  const toolCalls: StewardDecision["toolCalls"] = [];
  for (const entry of rawCalls) {
    if (typeof entry !== "object" || entry === null) continue;
    const call = entry as Record<string, unknown>;
    const tool = typeof call.tool === "string" ? call.tool : "";
    const args =
      call.args && typeof call.args === "object" && !Array.isArray(call.args)
        ? (call.args as Record<string, unknown>)
        : {};
    toolCalls.push({ tool, args });
  }
  if (typeof raw.decision !== "string" && toolCalls.length === 0) return null;
  return {
    decision: typeof raw.decision === "string" ? raw.decision : "",
    recommendation: typeof raw.recommendation === "string" ? raw.recommendation : undefined,
    reasoning: typeof raw.reasoning === "string" ? raw.reasoning : undefined,
    approvalRequired: raw.approvalRequired === true,
    toolCalls,
  };
}

/**
 * Why a steward turn produced no usable decision, as the loop will see it.
 *
 * The "no parseable decision" phrase is load-bearing: AstrixStewardLoop matches
 * on it to classify failureKind="parse", the only failure it retries. The real
 * JSON.parse message is appended so the cause reaches DECISION_COMPLETED
 * instead of being swallowed. Exported so tests assert on the SAME string the
 * provider throws rather than a copy of it.
 */
export function stewardTurnFailureMessage(result: Pick<AstrixStewardTurnResult, "status" | "decision" | "parseError">): string {
  const why = result.decision ? "" : `no parseable decision in output${result.parseError ? ` -- ${result.parseError}` : ""}`;
  return `steward turn ${result.status ?? "incomplete"}: ${why}`;
}

/**
 * TrueForge-backed StewardDecisionProvider for the ASTrix execution loop.
 * TrueForge decides/reasons; the loop safely executes. Each decide() drives
 * one steward turn via the audited session/turn API and parses the decision.
 */
export class TrueForgeStewardProvider implements StewardDecisionProvider {
  readonly id = "trueforge-astrix-steward";

  constructor(
    private readonly cfg: TrueForgeConfig,
    private readonly opts: { deadlineMs?: number; agentName?: string } = {},
  ) {}

  async decide(context: StewardRunContext): Promise<StewardDecision> {
    const memory = summarizeContextMemory(context);
    const result = await runAstrixStewardTurn(
      this.cfg,
      context.snapshot,
      this.opts.deadlineMs ?? 60_000,
      { objective: context.objective, memory, agentName: this.opts.agentName, retryHint: context.retryHint },
    );
    if (result.status !== "done" || !result.decision) {
      throw new TrueForgeBackendError(stewardTurnFailureMessage(result));
    }
    return result.decision;
  }
}

/** Build the compact memory block for the next steward turn. */
function summarizeContextMemory(context: StewardRunContext): string {
  const lines: string[] = [];
  if (context.lastOutcome) lines.push(context.lastOutcome);
  const recent = context.history.slice(-5);
  for (const action of recent) {
    const approved =
      action.approvalState === "granted" ? " approved"
      : action.approvalState === "rejected" ? " rejected"
      : "";
    const verified =
      action.verificationState === "VERIFIED" ? " verified"
      : action.verificationState === "VERIFICATION_FAILED" ? " verification_failed"
      : "";
    lines.push(
      `- attempted ${action.tool} -> ${action.executionState}${approved}${verified}${action.error ? ` (${action.error})` : ""}`,
    );
  }
  return lines.length > 0 ? lines.join("\n") : "(no prior actions in this run)";
}

export async function provisionTrueForgeAgents(
  cfg: TrueForgeConfig,
  agents: AgentSpecInput[],
): Promise<{ name: string; status: string }[]> {
  const out: { name: string; status: string }[] = [];
  for (const a of agents) {
    // v0.1.4 API: { name, manifest: { model, instructions, mcp_servers, skills, config } }.
    // No max_tokens cap: the harness errors on "max_tokens breached" instead
    // of truncating, and these NIM models pad output (~2k tokens) — capping
    // made turns ERROR rather than faster. parseDecision extracts the decision
    // JSON from the start of the content regardless.
    const manifest: Record<string, unknown> = {
      model: { name: a.model.name },
      instructions: a.instructions,
    };
    if (a.mcpServers && a.mcpServers.length > 0) {
      manifest.mcp_servers = a.mcpServers.map((m) => ({ name: m.name, enable_tools: ["@all"] }));
    }
    if (a.skills && a.skills.length > 0) {
      manifest.skills = a.skills.map((s) => ({ name: s }));
      // Skills require the sandbox to be enabled on the agent.
      manifest.config = { sandbox: { enabled: true } };
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
    let res = await fetch(`${cfg.baseUrl}/api/v1/agents`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: a.name, manifest }),
    });
    if (res.status === 409) {
      // Exists — update it (PUT by internal agent id) so re-running provision
      // syncs config changes (e.g. a model swap).
      const listed = await fetch(`${cfg.baseUrl}/api/v1/agents`, { headers });
      const list = (await listed.json()) as { data?: { id?: string; name?: string }[] };
      const found = list.data?.find((ag) => ag.name === a.name);
      if (found?.id) {
        res = await fetch(`${cfg.baseUrl}/api/v1/agents/${encodeURIComponent(found.id)}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ manifest }),
        });
        out.push({ name: a.name, status: res.ok ? `updated (${res.status})` : `error (${res.status}): ${await res.text()}` });
        continue;
      }
      out.push({ name: a.name, status: `error (409): could not resolve agent id for update` });
      continue;
    }
    out.push({ name: a.name, status: res.ok ? `created (${res.status})` : `error (${res.status}): ${await res.text()}` });
  }
  return out;
}

/**
 * Register the NVIDIA NIM provider (OpenAI-compatible) in TrueForge so the
 * steward models resolve. Reads the API key from the caller (env) — never
 * committed. Idempotent-ish: re-registering with the same name is an error,
 * but the configured provider is what agents resolve against.
 */
export async function registerNvidiaProvider(
  cfg: TrueForgeConfig,
  apiKey: string,
): Promise<{ name: string; status: string }> {
  // Models verified live against the key's account.
  // gpt-oss-20b = reasoning tier; nemotron-3-nano-30b-a3b = fast tier.
  const models = [
    { model_id: "nvidia/nemotron-3-nano-30b-a3b", name: "nemotron-3-nano-30b-a3b", properties: {} },
    { model_id: "openai/gpt-oss-20b", name: "gpt-oss-20b", properties: {} },
  ];
  const manifest = {
    type: "custom",
    name: "nvidia",
    base_url: "https://integrate.api.nvidia.com/v1",
    auth: { api_key: apiKey },
    models,
  };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  // PUT replaces the provider idempotently; fall back to POST when it's new.
  let res = await fetch(`${cfg.baseUrl}/api/v1/settings/model-providers`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ manifest }),
  });
  if (res.status === 404) {
    res = await fetch(`${cfg.baseUrl}/api/v1/settings/model-providers`, {
      method: "POST",
      headers,
      body: JSON.stringify({ manifest }),
    });
  }
  return {
    name: "nvidia",
    status: res.ok ? `registered (${res.status})` : `error (${res.status}): ${await res.text()}`,
  };
}

/**
 * Register this game's MCP server as a TrueForge connector (Settings ->
 * Connectors) so agents can use its tools. Idempotent: existing connectors are
 * reused. Returns the registered name or an error string.
 */
export async function registerMcpConnector(
  cfg: TrueForgeConfig,
  name = MCP_CONNECTOR_NAME,
  url = cfg.mcpServerUrl ?? "http://localhost:8787/mcp",
): Promise<{ name: string; status: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const listed = await fetch(`${cfg.baseUrl}/api/v1/settings/mcp-servers`, { headers });
  if (listed.ok) {
    const json = (await listed.json()) as { data?: { name?: string; manifest?: Record<string, unknown> }[] };
    const existing = json.data?.find((server) => server.name === name || server.manifest?.name === name);
    if (existing) return { name, status: "already configured" };
  }
  const res = await fetch(`${cfg.baseUrl}/api/v1/settings/mcp-servers`, {
    method: "POST",
    headers,
    body: JSON.stringify({ manifest: { type: "remote", name, url, description: `ASTrix MCP server (${name}).` } }),
  });
  return { name, status: res.ok ? `registered (${res.status})` : `error (${res.status}): ${await res.text()}` };
}
