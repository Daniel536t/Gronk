// Live Mode A walkthrough: plays a human through the real HTTP API against the
// running BOTS=trueforge server (:8787), narrating what the browser would show.
//   npm run live:demo
//
// The human is a riddle-aware searcher: it checks the hinted furniture first,
// flees Gronk, banks the treasure, and approves the bank request — the full
// demo arc. Real-agent decisions are ~10-28s on NIM, so matches often end by
// closet before anyone banks; run it a few times to catch the approval gate.
import { ACTION_RANGE, PEDESTAL_RANGE } from "../src/engine";

const BASE = "http://localhost:8787";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface St {
  status: string;
  elapsed: number;
  tick: number;
  players: {
    id: string;
    team: number;
    name?: string;
    x: number;
    y: number;
    state: string;
    carrying: boolean;
    transformedAs: string | null;
    closetUntilTick?: number;
  }[];
  furniture: { id: string; name: string; x: number; y: number }[];
  pedestals: { x: number; y: number }[];
  gronk: { x: number; y: number; enraged: boolean };
  groundTreasure: { x: number; y: number } | null;
  pendingBank?: { team: number } | null;
  riddleSet?: number;
  visibleRiddleLines?: string[];
  winnerTeam?: number | null;
  winReason?: string | null;
}

const post = (path: string, body: unknown) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const get = async (path: string) => (await fetch(`${BASE}${path}`)).json();

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

async function main() {
  // 1) Browser: title -> Single Player
  const created = await post("/api/create", { mode: "solo" });
  const { roomCode, playerId, team } = created;
  console.log(`[lobby] Room ${roomCode} — you are ${playerId} (team ${team}). Bots are TrueForge agents (BOTS=trueforge).`);

  await post("/api/start", { roomCode, playerId });
  console.log(`[start] Match started. 3 bot wizards + Gronk are live NVIDIA NIM agents.`);

  let st = (await get(`/state?room=${roomCode}&player=${playerId}`)) as St;
  const lastRiddle = { n: 0, text: "" };
  const inCloset = new Set<string>();
  let searchCycle = 0;
  let lastSearched = -1;
  let sawPing = false;
  let t0 = st.elapsed;
  // Riddle hints: set 0 = Fridge, 1 = Bookshelf, 2 = Couch — search those first.
  const hintMap: Record<number, string> = { 0: "Fridge", 1: "Bookshelf", 2: "Couch" };
  const hintName = hintMap[st.riddleSet ?? 0];
  let searchOrder = st.furniture.map((f) => f.id);
  const hinted = searchOrder.find((id) => st.furniture.find((f) => f.id === id)?.name === hintName);
  if (hinted) searchOrder = [hinted, ...searchOrder.filter((id) => id !== hinted)];
  console.log(`[plan] riddle hints at the ${hintName} — searching there first.`);

  // Browser polls /state every 100ms; the human plays via move/action.
  while (true) {
    st = (await get(`/state?room=${roomCode}&player=${playerId}`)) as St;
    const t = st.elapsed;

    if (st.status === "finished") {
      console.log(`[result] WINNER: team ${st.winnerTeam} (${st.winReason}) after ${t.toFixed(0)}s sim — ${st.winReason === "bank" ? "treasure banked with approval!" : "enemy team locked in the closet!"}`);
      break;
    }
    if (t > 360) {
      console.log(`[result] Walkthrough capped at 360s sim; match still ${st.status}.`);
      break;
    }

    // Riddle banner updates at 0/90/180s.
    const lines = st.visibleRiddleLines ?? [];
    if (lines.length > lastRiddle.n) {
      const newLine = lines[lines.length - 1];
      console.log(`[riddle] +${t.toFixed(0)}s — banner: "${newLine}"`);
      lastRiddle.n = lines.length;
      lastRiddle.text = newLine;
    }

    // Gronk's nose flare -> sniff: watch for enrage too.
    if (st.gronk.enraged && !sawPing) {
      sawPing = true;
      console.log(`[gronk] ENRAGE at ${t.toFixed(0)}s — Gronk turns dark red and doubles speed!`);
    }

    // Closet toasts.
    for (const p of st.players) {
      if (p.state === "in_closet" && !inCloset.has(p.id)) {
        inCloset.add(p.id);
        console.log(`[toast] Gronk got ${p.name ?? p.id}! → closet (25s)`);
      }
      if (p.state !== "in_closet") inCloset.delete(p.id);
    }
    // Ground treasure dropped (stunned carrier fumble).
    if (st.groundTreasure && t > 5) {
      console.log(`[fumble] treasure dropped on the floor at (${st.groundTreasure.x.toFixed(0)},${st.groundTreasure.y.toFixed(0)}) — anyone can grab it!`);
    }

    // Approval modal.
    if (st.pendingBank) {
      console.log(`[approval] ⚠ TEAM ${st.pendingBank.team} IS BANKING THE TREASURE — APPROVE? (modal to all humans)`);
      const r = await post("/api/approve-bank", { roomCode, playerId });
      console.log(`[approval] You clicked APPROVE → ${JSON.stringify(r)}`);
      continue;
    }

    // Drive the human (same controls the browser sends).
    const me = st.players.find((p) => p.id === playerId)!;
    if (me.state === "in_closet" || me.state === "stunned") {
      await post("/api/move", { roomCode, playerId, dirX: 0, dirY: 0 });
    } else if (me.carrying) {
      const ped = st.pedestals[me.team];
      if (ped && dist(me, ped) < PEDESTAL_RANGE + 1) {
        await post("/api/action", { roomCode, playerId });
      } else if (ped) {
        await moveToward(me, ped);
      }
    } else if (st.groundTreasure && dist(me, st.groundTreasure) < 10) {
      await moveToward(me, st.groundTreasure);
    } else if (dist(me, st.gronk) < 8) {
      const dx = me.x - st.gronk.x;
      const dy = me.y - st.gronk.y;
      const d = Math.hypot(dx, dy) || 1;
      await post("/api/move", { roomCode, playerId, dirX: dx / d, dirY: dy / d });
    } else {
      const target = st.furniture.find((f) => f.id === searchOrder[searchCycle % searchOrder.length]);
      if (target && dist(me, target) < ACTION_RANGE + 1.5) {
        // Stop first (the engine keeps the last direction), then act.
        await post("/api/move", { roomCode, playerId, dirX: 0, dirY: 0 });
        if (dist(me, target) <= ACTION_RANGE) {
          const r = await post("/api/action", { roomCode, playerId });
          if (t !== lastSearched) {
            console.log(`[search] you searched the ${target.name} @ +${t.toFixed(0)}s → ${JSON.stringify(r).slice(0, 80)}`);
            lastSearched = t;
          }
          searchCycle += 1;
        }
      } else if (target) {
        await moveToward(me, target);
      }
    }

    await sleep(100);
  }

  async function moveToward(me: { x: number; y: number }, target: { x: number; y: number }) {
    const dx = target.x - me.x;
    const dy = target.y - me.y;
    const d = Math.hypot(dx, dy) || 1;
    await post("/api/move", { roomCode, playerId, dirX: dx / d, dirY: dy / d });
  }
}

void main().then(
  () => process.exit(0),
  (e) => {
    console.error(`[error] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
