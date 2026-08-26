// Headless M6 playtest runner: three full single-player matches, printed for
// the record. Run: npx tsx scripts/playtest.ts
import { LobbyManager } from "../src/server/lobby";
import { seededRng } from "../tests/helpers";

function playMatch(seed: number): void {
  const mgr = new LobbyManager({ rng: seededRng(seed), autoTick: false });
  const c = mgr.createLobby("solo");
  const code = c.value.roomCode;
  const human = mgr.joinLobby(code, "You");
  mgr.startMatch(code, human.value.playerId);
  const eng = mgr.getLobby(code)!.engine;

  const log = { seed, finished: false, winner: null as number | null, reason: null as string | null, searched: false, closeted: 0, riddles: 0, enrage: false, suddenDeath: false, pings: 0, leaked: false };
  for (let i = 0; i < 6 * 60 * 10; i++) {
    mgr.tickOnce(code);
    const s = eng.state;
    if (JSON.stringify(s).includes("treasureFurnitureId")) { log.leaked = true; break; }
    if (s.latestNoise) log.searched = true;
    log.closeted = Math.max(log.closeted, s.players.filter((p) => p.state === "in_closet").length);
    log.riddles = s.visibleRiddleLines.length;
    if (s.enraged) log.enrage = true;
    if (s.suddenDeath) { log.suddenDeath = true; log.pings = s.treasurePings.length; }
    if (s.pendingBank) mgr.approveBank(code, s.pendingBank.team);
    if (s.status === "finished") { log.finished = true; log.winner = s.winnerTeam; log.reason = s.winReason; break; }
  }
  console.log(
    `match ${log.seed}: ${log.finished ? "✅ complete" : "❌ stalled"} winner=Team${(log.winner ?? 0) + 1} reason=${log.reason} ` +
    `searched=${log.searched} closeted=${log.closeted} riddles=${log.riddles} enrage@4:00=${log.enrage} suddenDeath=${log.suddenDeath} pings=${log.pings} leaked=${log.leaked}`,
  );
}

console.log("M6 playtest — three full solo matches (1 human + 3 scripted bots):");
playMatch(1);
playMatch(21);
playMatch(99);
