// Smoke test for the MCP wire layer: a real MCP client connects to the server
// over stdio (the same way TrueForge agents will in M4), lists the legacy and
// additive ASTrix tools, and runs a create -> join -> start -> intent -> get_state round trip.
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";

const TSX_BIN = resolve("node_modules/.bin/tsx");
const ENTRY = resolve("src/server/index.ts");

interface TextResult {
  content: { type: string; text: string }[];
}

function jsonOf(result: unknown): any {
  const text = (result as TextResult).content[0].text;
  return JSON.parse(text);
}

const EXPECTED_TOOLS = [
  "create_lobby",
  "join_lobby",
  "start_match",
  "get_state",
  "move",
  "transform",
  "action",
  "approve_bank",
  "reject_bank",
  "reveal_riddle",
  "agent_intent",
  "inspect_world",
  "inspect_island",
  "inspect_resources",
  "inspect_buildings",
  "gather",
  "build",
  "plant",
  "clear_terrain",
  "build_bridge",
  "simulate_plan",
].sort();

describe("MCP server", () => {
  it("exposes legacy and ASTrix tools and runs a lobby round trip over stdio", async () => {
    const transport = new StdioClientTransport({
      command: TSX_BIN,
      args: [ENTRY],
      env: { ...process.env, PORT: "0", BOTS: "scripted" },
    });
    const client = new Client({ name: "smoke-test", version: "1.0.0" });

    try {
      await client.connect(transport);

      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name).sort();
      assert.deepEqual(names, EXPECTED_TOOLS, "all 11 tools with exact names");

      // create -> join -> start -> agent_intent -> get_state
      const created = await client.callTool({
        name: "create_lobby",
        arguments: { mode: "multi" },
      });
      const roomCode = jsonOf(created).roomCode;
      assert.match(roomCode, /^[A-Z]{4}-\d{2}$/);

      const joined = await client.callTool({
        name: "join_lobby",
        arguments: { roomCode },
      });
      const { playerId, team } = jsonOf(joined);
      assert.ok(playerId.startsWith("wizard-"));
      assert.ok(team === 0 || team === 1);

      const started = await client.callTool({
        name: "start_match",
        arguments: { roomCode },
      });
      assert.equal(jsonOf(started).ok, true);

      const intent = await client.callTool({
        name: "agent_intent",
        arguments: { agentId: playerId, intent: "SEARCH_FURNITURE", targetId: "furn-0" },
      });
      assert.equal(jsonOf(intent).ok, true);

      const state = await client.callTool({
        name: "get_state",
        arguments: { roomCode, playerId },
      });
      const st = jsonOf(state);
      assert.equal(st.status, "playing");
      assert.equal(
        JSON.stringify(st).includes("treasureFurnitureId"),
        false,
        "secret never crosses the MCP wire",
      );
      assert.equal(st.players.length, 4);
      assert.ok(Array.isArray(st.furniture) && st.furniture.length === 10);
    } finally {
      await client.close();
    }
  }, 30000);
});
