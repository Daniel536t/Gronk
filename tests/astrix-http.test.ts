// HTTP-level coverage for the ASTrix parallel API: the read-only simulate_plan
// command route, the fully-open legacy POST /mcp channel (TrueForge is a
// same-host client and sends no Authorization header), and the auth gate on
// the public /astrix/* mutation surface (browser client -> server).
// We use the SDK's real streamable-HTTP client (the same transport TrueForge
// uses) so the session handshake, Accept headers, and session IDs are exact.
import assert from "node:assert/strict";
import { describe, it, afterEach } from "vitest";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LobbyManager } from "../src/server/lobby";
import { createHttpServer } from "../src/server/http";
import { createMcpServer } from "../src/server/mcp";
import { createMcpHttpBridge } from "../src/server/mcpHttp";
import { createAstrixService } from "../src/astrix/server";

const servers: Server[] = [];

async function startTestServer(opts: { authToken?: string } = {}): Promise<{ base: string }> {
  const manager = new LobbyManager({ autoTick: false });
  const astrix = createAstrixService({ authToken: opts.authToken });
  const mcpHttp = createMcpHttpBridge(() => createMcpServer(manager, astrix));
  const server = createHttpServer(manager, 0, { mcp: mcpHttp, astrix });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  return { base: `http://127.0.0.1:${port}` };
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

  it("allows ASTrix mutation tools on legacy /mcp without a bearer token", async () => {
    // TrueForge connects here from the same host and sends no Authorization
    // header; /mcp must be fully open for the steward to act on the world.
    const { base } = await startTestServer({ authToken: "sekret" });
    await withClient(base, {}, async (client) => {
      const result = await client.callTool({ name: "gather", arguments: { resource_type: "wood" } });
      const parsed = jsonOf(result);
      assert.equal(parsed.success, true);
      assert.equal(parsed.gathered, 1);
    });
  });

  it("keeps read-only ASTrix tools open on legacy /mcp without the token", async () => {
    const { base } = await startTestServer({ authToken: "sekret" });
    await withClient(base, {}, async (client) => {
      const result = await client.callTool({ name: "inspect_world", arguments: {} });
      assert.ok(jsonOf(result).day >= 1);
    });
  });

  it("leaves legacy game tools open on /mcp even when an ASTrix token is set", async () => {
    const { base } = await startTestServer({ authToken: "sekret" });
    await withClient(base, {}, async (client) => {
      const result = await client.callTool({ name: "create_lobby", arguments: { mode: "multi" } });
      const created = jsonOf(result);
      assert.match(created.roomCode, /^[A-Z]{4}-\d{2}$/);
    });
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
