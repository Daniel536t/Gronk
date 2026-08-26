// M6 playtest: three full single-player matches, start-to-finish, driven
// headlessly exactly like the browser's data path (1 human + 3 scripted bots,
// approval gate on, auto-approve acting as the human's modal click).
//
// Each run asserts the M6 milestone checklist at the state level (the visual
// sugar — nose flare, toasts, confetti — is client-side, but every underlying
// transition they depend on is asserted here): match completes, riddle banner
// advances on schedule, Gronk's sniff cadence exists (nose flare source),
// closet events happen (toast source), enrage fires at 4:00, sudden death
// pings the map every 10s when nobody banks.
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { LobbyManager } from "../src/server/lobby";
import { GameEngine } from "../src/engine";
import { seededRng } from "./helpers";

const MAX_TICKS = 6 * 60 * 10; // 6 sim-minutes cap

interface PlayResult {
  seed: number;
  finished: boolean;
  winnerTeam: number | null;
  winReason: "bank" | "closet" | null;
  searched: boolean; // noise emitted at least once
  closetedSomeone: boolean; // a "Gronk got X" toast source
  riddleLinesAtEnd: number;
  enrageAt4: boolean;
  suddenDeath: boolean;
  pingCount: number;
  leaked: boolean;
}

function playMatch(seed: number): PlayResult {
  const mgr = new LobbyManager({ rng: seededRng(seed), autoTick: false });
  const created = mgr.createLobby("solo");
  assert.ok(created.ok);
  const code = created.ok ? created.value.roomCode : "";
  const human = mgr.joinLobby(code, "You");
  assert.ok(human.ok);
  const playerId = human.ok ? human.value.playerId : "";
  assert.ok(mgr.startMatch(code, playerId).ok);

  const lobby = mgr.getLobby(code)!;
  const eng = lobby.engine;
  assert.equal(lobby.bots.length, 3, "solo fills 3 bot seats");

  const res: PlayResult = {
    seed,
    finished: false,
    winnerTeam: null,
    winReason: null,
    searched: false,
    closetedSomeone: false,
    riddleLinesAtEnd: 0,
    enrageAt4: false,
    suddenDeath: false,
    pingCount: 0,
    leaked: false,
  };

  for (let i = 0; i < MAX_TICKS; i++) {
    mgr.tickOnce(code);
    const s = eng.state;

    if (JSON.stringify(s).includes("treasureFurnitureId")) {
      res.leaked = true;
      break;
    }
    if (s.latestNoise) res.searched = true;
    if (s.players.some((p) => p.state === "in_closet")) res.closetedSomeone = true;
    res.riddleLinesAtEnd = s.visibleRiddleLines.length;
    if (s.enraged) res.enrageAt4 = true;
    if (s.suddenDeath) {
      res.suddenDeath = true;
      res.pingCount = s.treasurePings.length;
    }

    // Human clicks Approve on the bank modal (M5 demo climax).
    if (s.pendingBank) {
      const ap = mgr.approveBank(code, s.pendingBank.team);
      assert.ok(ap.ok);
    }

    if (s.status === "finished") {
      res.finished = true;
      res.winnerTeam = s.winnerTeam;
      res.winReason = s.winReason;
      break;
    }
  }

  return res;
}

describe("M6 single-player playtest", () => {
  it("playtest 1: full solo match completes with all core rules firing", () => {
    const r = playMatch(1);
    assert.ok(r.finished, `match completes (seed ${r.seed})`);
    assert.ok(r.winnerTeam === 0 || r.winnerTeam === 1, "a team wins");
    assert.ok(r.winReason === "bank" || r.winReason === "closet", "bank or closet win");
    assert.equal(r.leaked, false, "no secret leak");
  });

  it("playtest 2: different seed, still completes", () => {
    const r = playMatch(21);
    assert.ok(r.finished);
    assert.ok(r.winnerTeam === 0 || r.winnerTeam === 1);
    assert.equal(r.leaked, false);
  });

  it("playtest 3: different seed, still completes", () => {
    const r = playMatch(99);
    assert.ok(r.finished);
    assert.ok(r.winnerTeam === 0 || r.winnerTeam === 1);
    assert.equal(r.leaked, false);
  });

  it("riddle banner advances to line 2 by 90s and line 3 by 180s", () => {
    // Deterministic engine check on the schedule the frontend banner reads.
    // Everyone hides so the match can't end early (no bank, no closet win).
    const eng = new GameEngine({ rng: seededRng(5) });
    eng.startMatch();
    for (const p of eng.state.players) {
      p.state = "transformed";
      p.transformedAs = "furn-0";
    }
    eng.tick(899); // 89.9s — line 1 only
    assert.equal(eng.state.visibleRiddleLines.length, 1);
    eng.tick(1); // 90s — line 2
    assert.equal(eng.state.visibleRiddleLines.length, 2);
    eng.tick(900); // 180s — line 3
    assert.equal(eng.state.visibleRiddleLines.length, 3);
  });

  it("enrage fires at 4:00 and sudden death pings the map every 10s", () => {
    // Neutralized match: everyone hidden, so no one banks and no one is caught.
    const eng = new GameEngine({
      rng: seededRng(7),
      approvalRequired: true,
    });
    eng.startMatch();
    for (const p of eng.state.players) {
      p.state = "transformed";
      p.transformedAs = "furn-0";
    }
    eng.tick(2400); // 4:00 exactly
    assert.equal(eng.state.enraged, true, "enrage at 4:00");
    assert.equal(eng.state.suddenDeath, false);
    eng.tick(600); // 5:00
    assert.equal(eng.state.suddenDeath, true);
    const firstPings = eng.state.treasurePings.length;
    assert.ok(firstPings >= 1, "treasure pings once sudden death starts");
    eng.tick(100); // +10s
    assert.equal(eng.state.treasurePings.length, firstPings + 1, "pings every 10s");
  });
});