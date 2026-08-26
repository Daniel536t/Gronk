// Scripted fallback bots (no LLM). The decision FSM is the permanent fallback
// opponent behind the BOTS=scripted|trueforge flag and the demo insurance —
// it must stay functional forever. It now speaks the same AgentDecision
// language as the TrueForge backend (see agent.ts) so the orchestrator can
// swap between them (and use it as the timeout fallback) transparently.
import type { GameState } from "../engine";
import type { AgentBackend, AgentDecision, AgentView } from "./agent";

export const BOT_DECISION_SECONDS = 2.5;

const FLEE_RANGE = 15; // Gronk within 15 units -> panic
const HIDE_NEAR_RANGE = 10; // "if near furniture" -> only hide when one is close
const GRAB_NOTICE_RANGE = 20; // dropped treasure within sight

// The three riddle sets pair with three fixed furniture spots (see riddles.ts):
// set 0 = Kitchen -> Fridge (furn-0), set 1 = Living room -> Bookshelf (furn-3),
// set 2 = Lounge -> Couch (furn-4). Weight these over pure random — the
// "latest riddle line, if parseable" search strategy.
const RIDDLE_FURNITURE: Record<number, string> = {
  0: "furn-0",
  1: "furn-3",
  2: "furn-4",
};

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** Turn a full engine GameState into the restricted AgentView agents see. */
export function toAgentView(s: GameState): AgentView {
  return {
    tick: s.tick,
    elapsed: s.elapsed,
    enraged: s.enraged,
    suddenDeath: s.suddenDeath,
    riddleSet: s.riddleSet,
    visibleRiddleLines: s.visibleRiddleLines,
    players: s.players.map((p) => ({
      id: p.id,
      team: p.team,
      x: p.x,
      y: p.y,
      state: p.state,
      carrying: p.carrying,
      transformedAs: p.transformedAs,
    })),
    furniture: s.furniture.map((f) => ({ id: f.id, name: f.name, x: f.x, y: f.y })),
    gronk: { x: s.gronk.x, y: s.gronk.y, enraged: s.gronk.enraged },
    pedestals: s.pedestals,
    groundTreasure: s.groundTreasure,
    latestNoise: s.latestNoise,
  };
}

/**
 * The scripted wizard FSM, expressed as a pure function view -> decision. This
 * is the exact strategy from the M2/M3 fallback, now shared by:
 *  - ScriptedBackend (BOTS=scripted)
 *  - the TrueForge timeout fallback (when the LLM is too slow)
 */
export function scriptedWizardDecision(view: AgentView, playerId: string, rng: () => number): AgentDecision {
  const me = view.players.find((p) => p.id === playerId);
  if (!me) return { intent: "SEARCH_FURNITURE" };
  const g = view.gronk;

  // 1) Carrying the treasure -> get it home and bank.
  if (me.carrying) return { intent: "GO_TO_PEDESTAL" };

  // 2) Gronk too close -> flee, or hide as nearby furniture (50% coin flip).
  if (dist(me.x, me.y, g.x, g.y) <= FLEE_RANGE) {
    if (rng() < 0.5) {
      const hide = nearestFurniture(view, me.x, me.y, HIDE_NEAR_RANGE);
      if (hide) return { intent: "HIDE_AS", targetId: hide.id };
    }
    return { intent: "FLEE" };
  }

  // 3) Treasure dropped on the ground nearby -> grab it.
  if (
    view.groundTreasure &&
    dist(me.x, me.y, view.groundTreasure.x, view.groundTreasure.y) <= GRAB_NOTICE_RANGE
  ) {
    return { intent: "GRAB" };
  }

  // 4) Enemy team is carrying -> hunt them down.
  const enemyCarrier = view.players.find(
    (q) => q.team !== me.team && q.carrying && q.state === "active",
  );
  if (enemyCarrier) return { intent: "HUNT_NEAREST" };

  // 5) Otherwise keep searching, weighted toward the riddle's furniture.
  return { intent: "SEARCH_FURNITURE", targetId: pickSearchTarget(view, rng) };
}

/** The scripted Gronk, mirroring the engine's built-in priority. */
export function scriptedGronkDecision(view: AgentView): AgentDecision {
  // 1) latest noise, 2) stunned, 3) nearest visible player.
  if (view.latestNoise) {
    return { intent: "HUNT_NEAREST", targetX: view.latestNoise.x, targetY: view.latestNoise.y };
  }
  const stunned = view.players.filter((p) => p.state === "stunned");
  if (stunned.length > 0) {
    const nearest = nearestPlayer(view, stunned, view.gronk.x, view.gronk.y);
    return { intent: "HUNT_NEAREST", targetX: nearest.x, targetY: nearest.y };
  }
  const visible = view.players.filter((p) => p.state === "active");
  if (visible.length > 0) {
    const nearest = nearestPlayer(view, visible, view.gronk.x, view.gronk.y);
    return { intent: "HUNT_NEAREST", targetX: nearest.x, targetY: nearest.y };
  }
  return { intent: "HUNT_NEAREST" }; // no target -> wander (engine keeps wandering)
}

function nearestFurniture(
  view: AgentView,
  x: number,
  y: number,
  range: number,
): { id: string; x: number; y: number } | null {
  let best: { id: string; x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const f of view.furniture) {
    const d = dist(x, y, f.x, f.y);
    if (d <= range && d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

function nearestPlayer(
  view: AgentView,
  pool: AgentView["players"],
  x: number,
  y: number,
): { x: number; y: number } {
  let best = pool[0];
  let bestD = Infinity;
  for (const p of pool) {
    const d = dist(x, y, p.x, p.y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return { x: best.x, y: best.y };
}

function pickSearchTarget(view: AgentView, rng: () => number): string {
  const hinted = RIDDLE_FURNITURE[view.riddleSet];
  if (hinted && rng() < 0.5) return hinted;
  const all = view.furniture.map((f) => f.id);
  return all[Math.floor(rng() * all.length)];
}

/** BOTS=scripted backend: zero latency, never fails. */
export class ScriptedBackend implements AgentBackend {
  readonly id: string;
  private role: "wizard" | "gronk";
  private rng: () => number;

  constructor(id: string, role: "wizard" | "gronk", rng: () => number = Math.random) {
    this.id = id;
    this.role = role;
    this.rng = rng;
  }

  async decide(view: AgentView): Promise<AgentDecision> {
    return this.decideSync(view);
  }

  /** Synchronous decision — the orchestrator applies this inline so scripted
   *  bots stay deterministic inside a synchronous tick loop (headless tests). */
  decideSync(view: AgentView): AgentDecision {
    if (this.role === "gronk") return scriptedGronkDecision(view);
    return scriptedWizardDecision(view, this.id, this.rng);
  }
}
