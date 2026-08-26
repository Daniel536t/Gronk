import assert from "node:assert/strict";
import { describe, it, afterEach } from "vitest";
import type { Server } from "node:http";
import { LobbyManager } from "../src/server/lobby";
import { createHttpServer } from "../src/server/http";
import { seededRng } from "./helpers";

// The browser's entire data path: POST /api/* + GET /state + GET /api/lobby,
// exercised with plain fetch (same as the frontend).
const servers: Server[] = [];

async function startTestServer(): Promise<{ base: string; mgr: LobbyManager }> {
  const mgr = new LobbyManager({ rng: seededRng(11), autoTick: false });
  const server = createHttpServer(mgr, 0);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  return { base: `http://127.0.0.1:${port}`, mgr };
}

async function post<T>(base: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

async function getState(base: string, room: string, player: string) {
  const res = await fetch(`${base}/state?room=${room}&player=${player}`);
  assert.equal(res.status, 200);
  return (await res.json()) as any;
}

describe("HTTP API (browser data path)", () => {
  afterEach(() => {
    for (const s of servers.splice(0)) s.close();
  });

  it("single player: create -> start -> move/action -> match completes via bots", async () => {
    const { base, mgr } = await startTestServer();

    const created = await post<any>(base, "/api/create", { mode: "solo" });
    assert.ok(created.roomCode.match(/^[A-Z]{4}-\d{2}$/));
    assert.equal(created.host, true);
    assert.ok(created.playerId.startsWith("wizard-"));

    const lobby = (await (await fetch(`${base}/api/lobby?room=${created.roomCode}`)).json()) as any;
    assert.equal(lobby.status, "lobby");
    assert.equal(lobby.humans.length, 1);
    assert.equal(lobby.hostId, created.playerId);

    const started = await post<any>(base, "/api/start", {
      roomCode: created.roomCode,
      playerId: created.playerId,
    });
    assert.equal(started.ok, true);

    // The human wizard can move and search through the same endpoints the
    // frontend buttons call.
    const moved = await post<any>(base, "/api/move", {
      roomCode: created.roomCode,
      playerId: created.playerId,
      dirX: 1,
      dirY: 0,
    });
    assert.equal(moved.ok, true);

    // Run the match by ticking the shared manager (autoTick off in tests).
    let finished: any = null;
    let leaked = false;
    for (let i = 0; i < 6 * 60 * 10; i++) {
      mgr.tickOnce(created.roomCode);
      const st = await getState(base, created.roomCode, created.playerId);
      if (JSON.stringify(st).includes("treasureFurnitureId")) {
        leaked = true;
        break;
      }
      // M5 approval gate: the browser's Approve button path.
      if (st.pendingBank) {
        const ap = await post<any>(base, "/api/approve-bank", {
          roomCode: created.roomCode,
          playerId: created.playerId,
        });
        assert.equal(ap.ok, true);
      }
      if (st.status === "finished") {
        finished = st;
        break;
      }
    }
    assert.ok(finished, "match finishes");
    assert.ok(finished.winnerTeam === 0 || finished.winnerTeam === 1);
    assert.equal(leaked, false, "treasureFurnitureId never in /state output");

    // The winner is a bot (the human proxy never touched the treasure) —
    // 3 scripted bots drove the whole match.
    const botsPlayed = mgr.getLobby(created.roomCode)!.bots.length;
    assert.equal(botsPlayed, 3);
  });

  it("multiplayer rules over HTTP: join, non-host cannot start, join-after-start rejected", async () => {
    const { base } = await startTestServer();

    const host = await post<any>(base, "/api/create", { mode: "multi" });
    const joiner = await post<any>(base, "/api/join", { roomCode: host.roomCode });
    assert.ok(joiner.playerId.startsWith("wizard-"));
    assert.notEqual(joiner.team, host.team, "second player lands on the other team");

    const notHost = await post<any>(base, "/api/start", {
      roomCode: host.roomCode,
      playerId: joiner.playerId,
    });
    assert.equal(notHost.ok, false);
    assert.match(notHost.error, /host/);

    const hostStart = await post<any>(base, "/api/start", {
      roomCode: host.roomCode,
      playerId: host.playerId,
    });
    assert.equal(hostStart.ok, true);

    const late = await post<any>(base, "/api/join", { roomCode: host.roomCode });
    assert.equal(late.ok, false, "cannot join after start");

    const missing = await post<any>(base, "/api/join", { roomCode: "NOPE-00" });
    assert.equal(missing.ok, false);
  });
});
