// HTTP-level coverage for the ASTrix parallel API: the read-only simulate_plan
// command route, the fully-open legacy POST /mcp channel (TrueForge is a
// same-host client and sends no Authorization header), and the auth gate on
// the public /astrix/* mutation surface (browser client -> server).
// We use the SDK's real streamable-HTTP client (the same transport TrueForge
// uses) so the session handshake, Accept headers, and session IDs are exact.
import assert from "node:assert/strict";
import { describe, it, afterEach, expect } from "vitest";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LobbyManager } from "../src/server/lobby";
import { createHttpServer } from "../src/server/http";
import { createMcpServer } from "../src/server/mcp";
import { createMcpHttpBridge } from "../src/server/mcpHttp";
import { createAstrixService } from "../src/astrix/server";
import type { StewardDecision, StewardDecisionProvider, StewardRunContext } from "../src/astrix/orchestrator";

const servers: Server[] = [];

/** Replays queued decisions, then idles so the loop ends naturally. */
class FakeStewardProvider implements StewardDecisionProvider {
  readonly id = "fake";
  constructor(private readonly queue: StewardDecision[]) {}
  async decide(_context: StewardRunContext): Promise<StewardDecision> {
    const next = this.queue.shift();
    if (next) return next;
    return { decision: "idle", toolCalls: [] };
  }
}

async function startTestServer(
  opts: { authToken?: string; stewardProvider?: StewardDecisionProvider } = {},
): Promise<{ base: string }> {
  const manager = new LobbyManager({ autoTick: false });
  const astrix = createAstrixService({ authToken: opts.authToken, stewardProvider: opts.stewardProvider });
  const mcpHttp = createMcpHttpBridge(() => createMcpServer(manager, astrix));
  const server = createHttpServer(manager, 0, { mcp: mcpHttp, astrix });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  return { base: `http://127.0.0.1:${port}` };
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("waitFor timed out");
}

interface TextResult {
  content: { type: string; text: string }[];
}

function jsonOf(result: unknown): any {
  const text = (result as TextResult).content[0].text;
  return JSON.parse(text);
}

async function withClient(
  base: string,
  headers: Record<string, string>,
  run: (client: Client) => Promise<void>,
): Promise<void> {
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers },
  });
  const client = new Client({ name: "astrix-http-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    await run(client);
  } finally {
    await client.close();
  }
}

describe("ASTrix HTTP API", () => {
  afterEach(() => {
    for (const s of servers.splice(0)) s.close();
  });

  it("routes simulate_plan through /astrix/command to the read-only simulator", async () => {
    const { base } = await startTestServer();
    const res = await fetch(`${base}/astrix/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: "simulate_plan",
        params: { plan: { commands: [{ command: "build", building_type: "farm", position: { x: 5, y: 0, z: 5 }, island_id: "meadow" }] } },
      }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.readOnly, true);
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.results));
    // No mutation: world resources unchanged by simulation.
    const state = await (await fetch(`${base}/astrix/state`)).json() as any;
    assert.equal(state.resources.wood, 30);
  });

  // R1: POST /mcp is no longer unconditionally open. With a token configured it
  // requires the bearer; with no token it is loopback-only. These three tests
  // pin the new policy (they previously asserted the open behaviour).
  it("R1: ASTrix mutation tools on /mcp REQUIRE the bearer when a token is configured", async () => {
    const { base } = await startTestServer({ authToken: "sekret" });
    await assert.rejects(
      () => withClient(base, {}, async (client) => {
        await client.callTool({ name: "gather", arguments: { resource_type: "wood" } });
      }),
      /unauthorized/,
    );
    // The world was not mutated by the refused call.
    const state = (await (await fetch(`${base}/astrix/state`)).json()) as any;
    assert.equal(state.resources.wood, 30);
  });

  it("R1: ASTrix mutation tools on /mcp succeed WITH the bearer", async () => {
    const { base } = await startTestServer({ authToken: "sekret" });
    await withClient(base, { Authorization: "Bearer sekret" }, async (client) => {
      const result = await client.callTool({ name: "gather", arguments: { resource_type: "wood" } });
      const parsed = jsonOf(result);
      assert.equal(parsed.success, true);
      assert.equal(parsed.gathered, 1);
    });
  });

  it("R1: /mcp stays usable on loopback with NO token (local dev + same-host TrueForge)", async () => {
    const { base } = await startTestServer();
    await withClient(base, {}, async (client) => {
      const world = await client.callTool({ name: "inspect_world", arguments: {} });
      assert.ok(jsonOf(world).day >= 1);
      // Legacy game tools remain reachable on the same channel.
      const created = jsonOf(await client.callTool({ name: "create_lobby", arguments: { mode: "multi" } }));
      assert.match(created.roomCode, /^[A-Z]{4}-\d{2}$/);
    });
  });

  it("reports idle status and an empty event log before any run", async () => {
    const { base } = await startTestServer({ stewardProvider: new FakeStewardProvider([]) });
    const status = (await (await fetch(`${base}/astrix/agent/status`)).json()) as any;
    expect(status.state).toBe("IDLE");
    const log = (await (await fetch(`${base}/astrix/log`)).json()) as any;
    expect(log.events).toEqual([]);
  });

  it("start with NO external provider runs on the built-in local runtime (Core needs no TrueForge)", async () => {
    const { base } = await startTestServer();
    const res = await fetch(`${base}/astrix/agent/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objective: "survive" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);

    // The loop reasons with the local provider — not a mock, not TrueForge.
    const status = (await (await fetch(`${base}/astrix/agent/status`)).json()) as any;
    expect(status.provider).toBe("local-astrix-steward");
  });

  it("agent start runs a bounded loop that executes safe actions and records events", async () => {
    const { base } = await startTestServer({
      stewardProvider: new FakeStewardProvider([
        { decision: "gather wood", toolCalls: [{ tool: "gather", args: { resource_id: "tree-meadow-001" } }] },
      ]),
    });
    const start = await fetch(`${base}/astrix/agent/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objective: "keep the village alive for 30 days" }),
    });
    expect(start.status).toBe(200);

    await waitFor(async () => {
      const status = (await (await fetch(`${base}/astrix/agent/status`)).json()) as any;
      return status.state === "COMPLETED";
    });

    const status = (await (await fetch(`${base}/astrix/agent/status`)).json()) as any;
    expect(status.objective).toBe("keep the village alive for 30 days");
    expect(status.turn).toBeGreaterThanOrEqual(1);
    // The world changed authoritatively.
    const state = (await (await fetch(`${base}/astrix/state`)).json()) as any;
    expect(state.resources.wood).toBe(31);

    const log = (await (await fetch(`${base}/astrix/log`)).json()) as any;
    const types = (log.events as any[]).map((e: any) => e.type);
    expect(types).toContain("TURN_STARTED");
    expect(types).toContain("ACTION_SUCCEEDED");
    expect(types).toContain("VERIFICATION_SUCCEEDED");
    expect(types).toContain("TURN_COMPLETED");
  });

  it("agent approval flow: clear_terrain pauses, approval via HTTP executes it", async () => {
    const { base } = await startTestServer({
      stewardProvider: new FakeStewardProvider([
        {
          decision: "clear for farmland",
          toolCalls: [{ tool: "clear_terrain", args: { position: { x: 12, y: 3.5, z: 24 }, radius: 2 } }],
        },
      ]),
    });
    await fetch(`${base}/astrix/agent/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });

    await waitFor(async () => {
      const status = (await (await fetch(`${base}/astrix/agent/status`)).json()) as any;
      return status.state === "AWAITING_APPROVAL";
    });

    const stateBefore = (await (await fetch(`${base}/astrix/state`)).json()) as any;
    expect(stateBefore.resourceNodes).toHaveLength(5); // no mutation before approval
    const approvalId = stateBefore.pendingApprovals[0].id;

    const respond = await fetch(`${base}/astrix/approval/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approval_id: approvalId, decision: "approve" }),
    });
    expect(respond.status).toBe(200);

    await waitFor(async () => {
      const status = (await (await fetch(`${base}/astrix/agent/status`)).json()) as any;
      return status.state === "COMPLETED";
    });

    const stateAfter = (await (await fetch(`${base}/astrix/state`)).json()) as any;
    expect(stateAfter.resourceNodes).toHaveLength(4);
    expect(stateAfter.pendingApprovals).toHaveLength(0);
    const log = (await (await fetch(`${base}/astrix/log`)).json()) as any;
    const types = (log.events as any[]).map((e: any) => e.type);
    expect(types).toContain("APPROVAL_REQUIRED");
    expect(types).toContain("APPROVAL_GRANTED");
    expect(types).toContain("VERIFICATION_SUCCEEDED");
  });

  it("agent start requires the bearer token when one is configured", async () => {
    const { base } = await startTestServer({ authToken: "sekret", stewardProvider: new FakeStewardProvider([]) });
    const denied = await fetch(`${base}/astrix/agent/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objective: "x" }),
    });
    expect(denied.status).toBe(401);
    const allowed = await fetch(`${base}/astrix/agent/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer sekret" },
      body: JSON.stringify({ objective: "x" }),
    });
    expect(allowed.status).toBe(200);
  });

  it("still requires the bearer token on the public /astrix/command surface", async () => {
    const { base } = await startTestServer({ authToken: "sekret" });
    const build = {
      command: "build",
      params: { building_type: "farm", position: { x: 5, y: 0, z: 5 }, island_id: "meadow" },
      player_id: "test",
    };
    const denied = await fetch(`${base}/astrix/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(build),
    });
    assert.equal(denied.status, 401);

    const allowed = await fetch(`${base}/astrix/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer sekret" },
      body: JSON.stringify(build),
    });
    assert.equal(allowed.status, 200);
    const parsed = (await allowed.json()) as any;
    assert.equal(parsed.success, true);
    assert.ok(typeof parsed.buildingId === "string" || parsed.buildingId === undefined, "build resolves through the command bus");
  });
});
