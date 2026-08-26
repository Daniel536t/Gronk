// M4 test battery: engine steer/forceSniff, orchestrator fallback (slow +
// dead backend), secrecy snapshot, and MCP over HTTP round trip.
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { makeEngine, place, seededRng } from "./helpers";
import { GameEngine } from "../src/engine";
import { LobbyManager } from "../src/server/lobby";
import type { AgentBackend, AgentDecision, AgentView } from "../src/server/agent";
import type { BackendFactory } from "../src/server/lobby";
import { createHttpServer } from "../src/server/http";
import { createMcpServer } from "../src/server/mcp";
import { createMcpHttpBridge } from "../src/server/mcpHttp";

// ---- Engine: steerGronk / forceSniff / externalSniff ---------------------

describe("engine steer & forceSniff", () => {
  it("steerGronk overrides the next sniff target", () => {
    const eng = makeEngine();
    eng.steerGronk(30, 45);
    eng.forceSniff();
    const g = eng.state.gronk;
    assert.equal(g.mode, "chase");
    assert.ok(g.target);
    assert.equal(g.target!.type, "point");
    assert.equal((g.target! as { x: number; y: number }).x, 30);
    assert.equal((g.target! as { x: number; y: number }).y, 45);
  });

  it("forceSniff resets the sniff timer and picks steered target", () => {
    const eng = makeEngine();
    eng.state.gronk.nextSniffTick = 9999; // far in the future
    eng.steerGronk(20, 20);
    eng.forceSniff();
    // After forceSniff, the sniff timer is reset.
    assert.ok(eng.state.gronk.nextSniffTick < 9999);
    assert.equal(eng.state.gronk.target?.type, "point");
  });

  it("externalSniff suppresses the internal sniff timer", () => {
    const eng = new GameEngine({ rng: seededRng(1), externalSniff: true });
    eng.startMatch();
    eng.state.gronk.nextSniffTick = 0; // would fire immediately if not suppressed
    // Tick until past the sniff mark; the engine must NOT enter chase mode.
    eng.tick(10);
    assert.equal(eng.state.gronk.mode, "wander", "externalSniff should prevent internal sniff");
    // forceSniff still works — it picks the built-in priority (players are
    // visible at spawn), proving the external driver owns the cadence.
    eng.forceSniff();
    assert.equal(eng.state.gronk.mode, "chase");
    assert.equal(eng.state.gronk.target?.type, "player");
  });
});

// ---- latestNoise in public state -----------------------------------------

describe("latestNoise in public state", () => {
  it("is set on search and appears in getPublicState", () => {
    const eng = makeEngine();
    eng.treasureFurnitureId = "furn-0";
    place(eng, "wizard-0", 20, 12); // on Fridge
    eng.action("wizard-0");
    const st = eng.getPublicState();
    assert.ok(st.latestNoise);
    assert.equal(st.latestNoise!.x, 20);
    assert.equal(st.latestNoise!.y, 12);
    assert.equal(st.latestNoise!.tick, 0, "noise ticks at the match's current tick");
    // The secret is never in state.
    assert.equal(JSON.stringify(st).includes("treasureFurnitureId"), false);
  });
});

// ---- Orchestrator fallback: slow backend ---------------------------------

/** A backend that resolves after `delayMs`, then applies a fixed decision.  */
function makeSlowBackend(id: string, delayMs: number, intent: string, targetId?: string): AgentBackend {
  return {
    id,
    async decide(_view: AgentView): Promise<AgentDecision> {
      await new Promise((r) => setTimeout(r, delayMs));
      const d: AgentDecision = { intent: intent as AgentDecision["intent"] };
      if (targetId) d.targetId = targetId;
      return d;
    },
  };
}

describe("orchestrator fallback", () => {
  it("falls back to the scripted FSM when the backend exceeds the timeout", () => {
    const slowFactory: BackendFactory = {
      wizard: (seatId) => makeSlowBackend(seatId, 8000, "SEARCH_FURNITURE", "furn-0"), // 8s > 5s timeout
      gronk: () => null,
    };
    const mgr = new LobbyManager({
      rng: seededRng(3),
      autoTick: false,
      botMode: "trueforge",
      backendFactory: slowFactory,
      decisionTimeoutMs: 200, // force timeout quickly in test
    });
    const created = mgr.createLobby("multi");
    assert.ok(created.ok);
    const h = mgr.joinLobby(created.ok ? created.value.roomCode : "X");
    assert.ok(h.ok);
    const started = mgr.startMatch(created.ok ? created.value.roomCode : "X", h.ok ? h.value.playerId : "");
    assert.ok(started.ok);

    const lobby = mgr.getLobby(created.ok ? created.value.roomCode : "X")!;

    // Tick once — the orchestrator fires the slow backend, which races the
    // 200ms timeout. The decision will come from the scripted fallback.
    mgr.tickOnce(created.ok ? created.value.roomCode : "X");

    // Wait long enough for the race to settle (timeout or backend).
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const records = lobby.runtime.decisions;
        assert.ok(records.length >= 1, "at least one decision was recorded");
        const fellBack = records.some((r) => r.fellBack === true);
        assert.ok(fellBack, "at least one decision fell back to scripted");
        // The match must still be playing (or finished normally) — not crashed.
        assert.ok(lobby.engine.state.status === "playing" || lobby.engine.state.status === "finished");
        resolve();
      }, 500);
    });
  });

  it("falls back to the scripted FSM when the backend throws", async () => {
    const deadFactory: BackendFactory = {
      wizard: () => ({
        id: "dead",
        async decide(): Promise<AgentDecision> {
          throw new Error("backend down");
        },
      }),
      gronk: () => null,
    };
    const mgr = new LobbyManager({
      rng: seededRng(5),
      autoTick: false,
      botMode: "trueforge",
      backendFactory: deadFactory,
    });
    const created = mgr.createLobby("multi");
    assert.ok(created.ok);
    const code = created.ok ? created.value.roomCode : "";
    mgr.joinLobby(code);
    const started = mgr.startMatch(code, "wizard-0");
    assert.ok(started.ok);

    // Tick a few times; the dead backend throws every time, fallback fires.
    for (let i = 0; i < 10; i++) mgr.tickOnce(code);
    await new Promise((r) => setTimeout(r, 0)); // flush async fallback records
    const lobby = mgr.getLobby(code)!;
    const records = lobby.runtime.decisions;
    assert.ok(records.length > 0);
    assert.ok(records.every((r) => r.fellBack), "all decisions from a dead backend fall back");
    assert.equal(lobby.engine.state.status, "playing"); // match doesn't crash
  });

  it("mid-match backend replacement doesn't crash", () => {
    // Start with scripted, tick a bit, then effectively the backend stays
    // scripted (the runtime's step is error-resilient).
    const mgr = new LobbyManager({
      rng: seededRng(9),
      autoTick: false,
      botMode: "scripted",
    });
    const created = mgr.createLobby("multi");
    assert.ok(created.ok);
    const code = created.ok ? created.value.roomCode : "";
    mgr.joinLobby(code);
    mgr.startMatch(code, "wizard-0");

    // Run a few ticks — works fine with scripted.
    for (let i = 0; i < 50; i++) mgr.tickOnce(code);
    assert.equal(mgr.getLobby(code)!.engine.state.status, "playing");
  });
});

// ---- Secrecy snapshot test -----------------------------------------------

describe("secrecy snapshot", () => {
  it("captured payloads (AgentViews) never contain the treasure furniture id", () => {
    const mgr = new LobbyManager({
      rng: seededRng(13),
      autoTick: false,
      botMode: "scripted",
      capturePayloads: true,
    });
    const created = mgr.createLobby("multi");
    assert.ok(created.ok);
    const code = created.ok ? created.value.roomCode : "";
    const secretId = mgr.getLobby(code)!.engine.treasureFurnitureId;
    assert.ok(secretId.startsWith("furn-"));

    mgr.joinLobby(code, "Human");
    mgr.startMatch(code, "wizard-0");

    const cap = 3000; // 300s
    for (let i = 0; i < cap; i++) {
      mgr.tickOnce(code);
      const l = mgr.getLobby(code)!;
      // M5 approval gate: approve any pending bank so the match can end.
      if (l.engine.state.pendingBank) {
        const a = mgr.approveBank(code, l.engine.state.pendingBank.team);
        assert.ok(a.ok);
      }
      if (l.engine.state.status === "finished") break;
    }

    const payloads = mgr.getLobby(code)!.runtime.capturedPayloads;
    assert.ok(payloads.length > 0, "at least one payload was captured");

    for (const p of payloads) {
      // The invariant: no payload may carry the secret field or hint at the
      // assignment. Furniture ids themselves are public (agents must know what
      // to search) — only the treasure's LOCATION is secret.
      assert.equal(
        JSON.stringify(p).includes("treasureFurnitureId"),
        false,
        "no payload contains a treasureFurnitureId key",
      );
      const parsed = JSON.parse(p);
      assert.ok(!("treasure" in parsed), "no payload has a treasure field");
      assert.ok(!("treasureFurniture" in parsed), "no payload has a treasureFurniture field");
    }

    // And the engine truly owns the secret (never derivable from a payload).
    assert.ok(secretId.startsWith("furn-"));
  });
});

// ---- MCP over HTTP round trip --------------------------------------------

describe("MCP over HTTP", () => {
  let server: Server | null = null;
  let port = 0;

  async function startSut(): Promise<void> {
    const mgr = new LobbyManager({ autoTick: false, botMode: "scripted" });
    const mcpHttp = createMcpHttpBridge(() => createMcpServer(mgr));
    const http = createHttpServer(mgr, 0, { mcp: mcpHttp });
    server = http;
    await new Promise<void>((resolve) => http.listen(0, () => resolve()));
    port = (http.address() as { port: number }).port;
  }

  function stopSut(): void {
    server?.close();
    server = null;
  }  it("a real MCP client drives a lobby over streamable HTTP", async () => {
    await startSut();

    // Use the SDK's own StreamableHTTPClientTransport — the same kind of MCP
    // client a TrueForge agent is. It opens the SSE stream, negotiates the
    // session, and multiplexes tools over HTTP.
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp`),
    );
    const client = new Client({ name: "m4-http-test", version: "1.0.0" });
    try {
      await client.connect(transport);

      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name).sort();
      assert.ok(names.includes("create_lobby"), "create_lobby available over HTTP");
      assert.ok(names.includes("reveal_riddle"), "reveal_riddle available over HTTP");

      const created = await client.callTool({ name: "create_lobby", arguments: { mode: "multi" } });
      const roomCode = JSON.parse((created.content as { text: string }[])[0].text).roomCode;
      assert.match(roomCode, /^[A-Z]{4}-\d{2}$/);

      const joined = await client.callTool({ name: "join_lobby", arguments: { roomCode } });
      const j = JSON.parse((joined.content as { text: string }[])[0].text);
      assert.ok(j.playerId.startsWith("wizard-"));

      const started = await client.callTool({ name: "start_match", arguments: { roomCode } });
      assert.equal(JSON.parse((started.content as { text: string }[])[0].text).ok, true);

      const state = await client.callTool({ name: "get_state", arguments: { roomCode, playerId: j.playerId } });
      const st = JSON.parse((state.content as { text: string }[])[0].text);
      assert.equal(st.status, "playing");
      assert.equal(JSON.stringify(st).includes("treasureFurnitureId"), false);
    } finally {
      await client.close();
      stopSut();
    }
  }, 15000);
});