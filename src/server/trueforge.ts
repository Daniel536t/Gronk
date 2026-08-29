// TrueForge backend: drives a named TrueForge agent over its HTTP API
// (POST /api/v1/sessions/{id}/turns) and parses the agent's agent_intent
// decision back out. Plain fetch — no SDK dependency — so the game server
// stays lean and the fallback path can't be broken by SDK churn.
//
// Fail-open contract: decide() NEVER throws a recoverable error. Any network
// failure, 4xx/5xx, timeout, or unparseable output throws a TrueForgeBackendError,
// which the orchestrator turns into a scripted-FSM fallback decision.
import type { AgentBackend, AgentDecision, AgentView } from "./agent";

export interface ModelConfig {
  name?: string;
  provider?: string;
  [key: string]: unknown;
}

export interface TrueForgeConfig {
  baseUrl: string; // e.g. http://localhost:8790 (TrueForge standalone HTTP port)
  apiKey?: string; // optional bearer token (standalone mode has auth disabled)
  decisionTimeoutMs?: number;
  gronkModel: ModelConfig;
  botsModel: ModelConfig;
  /** URL of this game's MCP server over streamable HTTP, for agent tool access. */
  mcpServerUrl?: string;
}

// TrueForge resource names must be 2-64 lowercase chars (ResourceName).
export const GRONK_AGENT_NAME = "gronk";
export const BOT_WIZARD_NAMES = ["botwizard-a", "botwizard-b", "botwizard-c"];
export const GAME_MASTER_AGENT_NAME = "gamemaster";
/** MCP connector name (registered in TrueForge settings). */
export const MCP_CONNECTOR_NAME = "gronks-hoard-mcp";

export class TrueForgeBackendError extends Error {}

/** The exact system prompt from the spec — do not edit casually. */
export const GRONK_SYSTEM_PROMPT = [
  "You are Gronk the troll in Gronk's Hoard. You hunt wizards.",
  "Your ONLY tools are get_state and agent_intent.",
  "Decision priority: (1) latest noise event, (2) stunned players, (3) nearest visible player.",
  "Issue HUNT_NEAREST toward your chosen target.",
  "You cannot see transformed wizards.",
  "You receive game state every 15 seconds (sniff timer) and must issue one intent per sniff.",
  'End every turn with exactly one JSON object and nothing else: {"intent":"HUNT_NEAREST","targetId":"<playerId|noise|stunned|visible>"}',
].join("\n");

export const WIZARD_SYSTEM_PROMPT = [
  "You are a wizard in Gronk's Hoard. Your team must find the treasure and bank it at your pedestal.",
  "Your ONLY tools are get_state and agent_intent.",
  "Strategy:",
  "(1) If you have the treasure, GO_TO_PEDESTAL and bank.",
  "(2) If Gronk is within 15 units, FLEE or HIDE_AS nearby furniture (50% coin flip).",
  "(3) If treasure is dropped nearby, GRAB.",
  "(4) Otherwise, SEARCH_FURNITURE (prefer unsearched furniture; riddles hint at location).",
  "Enemy wizards can stun you by searching furniture you're transformed as.",
  "Issue one intent every 2.5 seconds.",
  'End every turn with exactly one JSON object and nothing else: {"intent":"<SEARCH_FURNITURE|HIDE_AS|FLEE|GRAB|GO_TO_PEDESTAL|HUNT_NEAREST>","targetId":"<furniture id or empty>"}',
].join("\n");

interface TurnDoneState {
  status: "done" | "cancelled" | "error";
  output?: {
    content?: unknown;
    tool_calls?: { function?: { name?: string; arguments?: string } }[];
  } | null;
}

/**
 * A TrueForge agent, provisioned + driven via the HTTP API. The agent is
 * expected to exist (created in the TrueForge UI or by provisionTrueForgeAgents);
 * the session is created lazily here.
 */
export class TrueForgeBackend implements AgentBackend {
  readonly id: string;
  private agentName: string;
  private baseUrl: string;
  private apiKey?: string;
  private sessionId: string | null = null;

  constructor(
    /** The game seat this agent drives: "gronk" or "wizard-0..3". */
    id: string,
    agentName: string,
    cfg: TrueForgeConfig,
  ) {
    this.id = id;
    this.agentName = agentName;
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.apiKey = cfg.apiKey;
  }

  async decide(view: AgentView): Promise<AgentDecision> {
    const sessionId = await this.ensureSession();
    const turnId = await this.postTurn(sessionId, view);
    const output = await this.waitForTurn(sessionId, turnId);
    return parseDecision(output);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  private async ensureSession(): Promise<string> {
    if (this.sessionId) return this.sessionId;
    const res = await fetch(`${this.baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ agent: { name: this.agentName } }),
    });
    if (!res.ok) {
      throw new TrueForgeBackendError(`create session failed (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as { data?: { id?: string } };
    const id = json.data?.id;
    if (!id) throw new TrueForgeBackendError("create session returned no session id");
    this.sessionId = id;
    return id;
  }

  private async postTurn(sessionId: string, view: AgentView): Promise<string> {
    const prompt = `Current game state (public only):\n${JSON.stringify(view)}\n\nDecide now.`;
    const res = await fetch(`${this.baseUrl}/api/v1/sessions/${sessionId}/turns`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        input: [{ type: "user.message", content: prompt }],
        previous_turn_id: "auto",
        stream: false, // poll via GET; avoid SSE handling
      }),
    });
    if (!res.ok) {
      throw new TrueForgeBackendError(`create turn failed (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as { data?: { id?: string } };
    const id = json.data?.id;
    if (!id) throw new TrueForgeBackendError("create turn returned no turn id");
    return id;
  }

  private async waitForTurn(sessionId: string, turnId: string): Promise<TurnDoneState["output"]> {
    // Poll until terminal. Bounded so the orchestrator's own timeout can also
    // fire (this is a belt-and-suspenders cap; real LLM turns can take a while
    // on cold starts).
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const res = await fetch(`${this.baseUrl}/api/v1/sessions/${sessionId}/turns/${turnId}`, {
        headers: this.headers(),
      });
      if (!res.ok) {
        throw new TrueForgeBackendError(`get turn failed (${res.status})`);
      }
      const json = (await res.json()) as { data?: { state?: TurnDoneState } };
      const state = json.data?.state;
      if (state && state.status === "done") return state.output ?? null;
      if (state && (state.status === "cancelled" || state.status === "error")) {
        throw new TrueForgeBackendError(`turn ${state.status}`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new TrueForgeBackendError("turn poll timed out");
  }
}

/** Parse the agent's final decision from a turn output: prefer an explicit
 *  agent_intent tool call, else scan the assistant text for a JSON object with
 *  an `intent` key. Never throws a plain Error — wraps as backend error. */
export function parseDecision(output: TurnDoneState["output"]): AgentDecision {
  // 1) agent_intent tool call arguments.
  const toolCalls = output?.tool_calls ?? [];
  for (const tc of toolCalls) {
    if (tc?.function?.name === "agent_intent" && tc.function.arguments) {
      try {
        return normalizeDecision(JSON.parse(tc.function.arguments));
      } catch {
        /* fall through to text scan */
      }
    }
  }

  // 2) Scan the final text for a JSON object containing an `intent`.
  const content = output?.content;
  if (content) {
    const text = typeof content === "string" ? content : JSON.stringify(content);
    const match = text.match(/\{[^{}]*"intent"\s*:[^{}]*\}/);
    if (match) {
      try {
        return normalizeDecision(JSON.parse(match[0]));
      } catch {
        /* fall through */
      }
    }
  }

  throw new TrueForgeBackendError("could not parse an agent decision from the turn");
}

function normalizeDecision(raw: unknown): AgentDecision {
  if (typeof raw !== "object" || raw === null) throw new TrueForgeBackendError("bad decision");
  const o = raw as Record<string, unknown>;
  const intent = o.intent;
  if (typeof intent !== "string") throw new TrueForgeBackendError("decision missing intent");
  const d: AgentDecision = { intent: intent as AgentDecision["intent"] };
  if (typeof o.targetId === "string") d.targetId = o.targetId;
  if (typeof o.targetX === "number") d.targetX = o.targetX;
  if (typeof o.targetY === "number") d.targetY = o.targetY;
  return d;
}

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
 * gronk/bots models resolve. Reads the API key from the caller (env) — never
 * committed. Idempotent-ish: re-registering with the same name is an error,
 * but the configured provider is what agents resolve against.
 */
export async function registerNvidiaProvider(
  cfg: TrueForgeConfig,
  apiKey: string,
): Promise<{ name: string; status: string }> {
  // Models verified live against the key's account (many catalog entries are
  // not entitled for it). gpt-oss-20b = reasoning tier (bots);
  // nemotron-3-nano-30b-a3b = fast tier (Gronk's sniffs).
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
 * Register the gronks-hoard skill pack (rules + riddles + reveal schedule)
 * from its git repo. TrueForge loads skills from a git URL, so this needs the
 * repo pushed (Daniel536t/Gronk, ref main). Idempotent: re-registering the
 * same name is an error, but the existing skill is what agents resolve.
 */
export async function registerSkill(
  cfg: TrueForgeConfig,
): Promise<{ name: string; status: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const res = await fetch(`${cfg.baseUrl}/api/v1/settings/skills`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      manifest: {
        type: "git",
        name: "gronks-hoard",
        url: "https://github.com/Daniel536t/Gronk",
        path: "skills/gronks-hoard",
        ref: "main",
        description:
          "Gronk's Hoard game rules, riddle sets, and the riddle reveal schedule (line 1 at 0s, line 2 at 90s, line 3 at 180s).",
      },
    }),
  });
  return {
    name: "gronks-hoard",
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
