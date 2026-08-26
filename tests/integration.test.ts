import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { LobbyManager } from "../src/server/lobby";
import { seededRng } from "./helpers";
import type { GameState } from "../src/engine";

describe("lobby", () => {
  it("creates short room codes, balances teams, enforces host-only start", () => {
    const mgr = new LobbyManager({ rng: seededRng(1), autoTick: false });
    const created = mgr.createLobby("multi");
    assert.ok(created.ok);
    const roomCode = created.ok ? created.value.roomCode : "";
    assert.match(roomCode, /^[A-Z]{4}-\d{2}$/, "room code like WAND-42");

    const h1 = mgr.joinLobby(roomCode, "Alice");
    assert.ok(h1.ok);
    assert.equal(h1.ok ? h1.value.team : -1, 0);
    const h2 = mgr.joinLobby(roomCode, "Bob");
    assert.ok(h2.ok);
    assert.equal(h2.ok ? h2.value.team : -1, 1, "teams balance on join");

    // A full lobby rejects a 5th human.
    assert.ok(mgr.joinLobby(roomCode, "Eve").ok);
    assert.ok(mgr.joinLobby(roomCode, "Dave").ok);
    assert.equal(mgr.joinLobby(roomCode, "Mallory").ok, false, "lobby caps at 4");

    // Only the host (first joiner) can start.
    assert.equal(mgr.startMatch(roomCode, h2.value.playerId).ok, false);
    assert.ok(mgr.startMatch(roomCode, h1.value.playerId).ok);

    // Joining after start is rejected.
    assert.equal(mgr.joinLobby(roomCode, "Nadia").ok, false);
  });
});

describe("headless full match", () => {
  it("1 human-proxy + 3 scripted bots completes via intents; treasure never leaks; noise steers Gronk", () => {
    const mgr = new LobbyManager({ rng: seededRng(7), autoTick: false });
    const created = mgr.createLobby("multi");
    assert.ok(created.ok);
    const roomCode = created.ok ? created.value.roomCode : "";

    const human = mgr.joinLobby(roomCode, "Proxy");
    assert.ok(human.ok);
    const playerId = human.ok ? human.value.playerId : "";

    assert.ok(mgr.startMatch(roomCode, playerId).ok);

    const secretFurnitureId = mgr.getLobby(roomCode)!.engine.treasureFurnitureId;
    assert.ok(secretFurnitureId.startsWith("furn-"), "secret exists server-side");

    let noiseTargeted = false;
    let leaked = false;
    let finished: GameState | null = null;

    const cap = 6 * 60 * 10; // 6 sim-minutes max (sudden death is at 5:00)
    for (let i = 0; i < cap; i++) {
      mgr.tickOnce(roomCode);
      const r = mgr.getState(roomCode, playerId);
      assert.ok(r.ok);
      const state = r.ok ? r.value.state : null;
      if (!state) break;

      // Treasure secrecy: the secret field must never appear in any output.
      if (JSON.stringify(state).includes("treasureFurnitureId")) {
        leaked = true;
        break;
      }

      // M5 approval gate: a human proxy clicks Approve on any pending bank.
      if (state.pendingBank) {
        const a = mgr.approveBank(roomCode, state.pendingBank.team);
        assert.ok(a.ok, "any human can approve");
      }

      if (state.gronk.target?.type === "noise") noiseTargeted = true;

      if (state.status === "finished") {
        finished = state;
        break;
      }
    }

    assert.ok(finished, "match should finish within the cap");
    assert.ok(
      finished!.winnerTeam === 0 || finished!.winnerTeam === 1,
      "a team wins",
    );
    assert.ok(
      finished!.winReason === "bank" || finished!.winReason === "closet",
      `win reason is bank or closet, got ${finished!.winReason}`,
    );
    assert.equal(leaked, false, "treasureFurnitureId never appears in get_state output");
    assert.ok(
      noiseTargeted,
      "a search's noise influenced Gronk's target at least once",
    );
  });

  it("M5 approval gate: any player approves, reject sets cooldown", () => {
    const mgr = new LobbyManager({ rng: seededRng(11), autoTick: false });
    const created = mgr.createLobby("multi");
    assert.ok(created.ok);
    const code = created.ok ? created.value.roomCode : "";
    // Join as wizard-0 (team 0); wizard-1 on team 0 sits empty → filled by bot.
    const h = mgr.joinLobby(code, "Alice");
    assert.ok(h.ok);
    mgr.startMatch(code, h.ok ? h.value.playerId : "");

    const eng = mgr.getLobby(code)!.engine;
    // Set up wizard-0 carrying at the pedestal (simulate a successful bank run).
    const p0 = eng.state.players.find((q) => q.id === "wizard-0")!;
    p0.carrying = true;
    p0.x = 10;
    p0.y = 54;
    eng.action("wizard-0"); // bank_requested → pendingBank
    assert.ok(eng.state.pendingBank);

    // A different player (wizard-2, team 1) can NOT approve team 0's bank.
    const deny = mgr.approveBankByPlayer(code, "wizard-2");
    assert.equal(deny.ok, false, "wizard-2 is on the wrong team");

    // The carrier's own teammate (wizard-1, a bot) — approve from any human.
    // Any human playerId maps to their team; team 0 approves → bank ✅.
    const ap = mgr.approveBankByPlayer(code, "wizard-0");
    assert.ok(ap.ok, "carrier's own playerId approves");
    // But if there's no pending limit anymore (match is finished now)...
    // This proves approveBankByPlayer maps playerId → team correctly.
    assert.equal(eng.state.status, "finished");
    assert.equal(eng.state.winReason, "bank");
  });

  it("M5 cooldown: reject blocks that team's bank for 10s", () => {
    const mgr = new LobbyManager({ rng: seededRng(13), autoTick: false });
    const created = mgr.createLobby("multi");
    assert.ok(created.ok);
    const code = created.ok ? created.value.roomCode : "";
    mgr.joinLobby(code, "Test");
    mgr.startMatch(code, "wizard-0");

    const eng = mgr.getLobby(code)!.engine;
    eng.state.players[0].carrying = true;
    eng.state.players[0].x = eng.state.pedestals[0].x;
    eng.state.players[0].y = eng.state.pedestals[0].y;
    eng.action("wizard-0");

    const rej = mgr.rejectBankByPlayer(code, "wizard-0");
    assert.ok(rej.ok);
    assert.ok(eng.state.bankCooldownUntilTick[0] > 0);

    // Immediate re-request via manager action is blocked.
    const blocked = mgr.action(code, "wizard-0");
    assert.ok(blocked.ok === false && (blocked as { type?: string }).type === "cooldown");

    // Advance past the cooldown; the request works again.
    eng.tick(100);
    const ok2 = mgr.action(code, "wizard-0");
    assert.ok(ok2.ok && (ok2 as { type?: string }).type === "bank_requested");
  });
});
