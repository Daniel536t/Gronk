// HTTP-level coverage for the ASTrix API: simulate_plan and the auth gate on
// the public /astrix/* mutation surface.
import assert from "node:assert/strict";
import { describe, it, afterEach, expect } from "vitest";
import type { Server } from "node:http";
import { createHttpServer } from "../src/server/http";
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
  const astrix = createAstrixService({ authToken: opts.authToken, stewardProvider: opts.stewardProvider });
  const server = createHttpServer(0, { astrix });
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

describe("GET /astrix/chain — public chain-status observability", () => {
  it("serves the injected reader without auth and defaults to unconfigured", async () => {
    const stub = {
      configured: true, programId: "P", worldPDA: "W", rpc: "https://example.invalid",
      chainDay: "11", owner: "DELEG", slot: 1, updatedAt: Date.now(), error: null,
      heartbeats: [{ t: "t", heartbeat: 1, advanceSig: "a", erMs: 9, commitSig: "c", baseDayBefore: "10", baseDay: "11" }],
    };
    const astrix = createAstrixService({ chainStatus: () => stub as unknown as Record<string, unknown> });
    const server = createHttpServer(0, { astrix });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    // Public by design (same surface class as /astrix/state): no token needed.
    const res = await fetch(`${base}/astrix/chain`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as typeof stub;
    assert.equal(body.chainDay, "11");
    assert.equal(body.heartbeats.length, 1);
    assert.equal(body.heartbeats[0].commitSig, "c");
  });

  it("reports unconfigured when no reader is injected (Core untouched)", async () => {
    const { base } = await startTestServer();
    const res = await fetch(`${base}/astrix/chain`);
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as any).configured, false);
  });
});
