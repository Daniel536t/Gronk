// Gronk's Hoard — authoritative game engine (pure TypeScript, zero deps).
//
// The engine owns the only copy of the truth. All timing is in whole ticks at
// 10/sec. Clients and agents never mutate state directly; they call the
// command methods (move / transform / action) or read getPublicState().
//
// Secret boundary: `treasureFurnitureId` is stored on the engine instance,
// never inside GameState, so getPublicState() can never leak it.

import {
  ACTION_RANGE,
  BANK_COOLDOWN,
  CARRY_SPEED_MULT,
  CLOSET_DURATION,
  ENRAGE_AT,
  GRAB_RANGE,
  GRONK_ENRAGE_SPEED_MULT,
  GRONK_RADIUS,
  GRONK_SPEED,
  MATCH_DURATION,
  MOVE_SPEED,
  PEDESTAL_RANGE,
  PLAYER_RADIUS,
  RIDDLE_REVEAL_INTERVAL,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  SNIFF_INTERVAL,
  STUN_DURATION,
  STUN_IMMUNITY,
  SUDDEN_DEATH_PING_INTERVAL,
  TICKS_PER_SECOND,
  TOUCH_RANGE,
  TRANSFORM_RANGE,
  WANDER_RETARGET_INTERVAL,
} from "./constants";
import { RIDDLE_SETS } from "./riddles";
import type {
  Furniture,
  GameState,
  GronkTarget,
  Player,
  TeamId,
  Vec2,
  WinReason,
} from "./types";

// Fixed world layout: 10 furniture spots + 2 pedestals + 2 closets.
export const FURNITURE_LAYOUT: Furniture[] = [
  { id: "furn-0", name: "Fridge", x: 20, y: 12, w: 6, h: 4 },
  { id: "furn-1", name: "Barrel", x: 45, y: 10, w: 4, h: 4 },
  { id: "furn-2", name: "Chest", x: 70, y: 15, w: 5, h: 4 },
  { id: "furn-3", name: "Bookshelf", x: 25, y: 30, w: 6, h: 3 },
  { id: "furn-4", name: "Couch", x: 50, y: 32, w: 3, h: 5 },
  { id: "furn-5", name: "Tapestry", x: 75, y: 30, w: 5, h: 6 },
  { id: "furn-6", name: "Brazier", x: 18, y: 48, w: 4, h: 4 },
  { id: "furn-7", name: "Statue", x: 50, y: 50, w: 4, h: 6 },
  { id: "furn-8", name: "Cauldron", x: 82, y: 48, w: 5, h: 4 },
  { id: "furn-9", name: "Throne", x: 50, y: 20, w: 6, h: 5 },
];

export const PEDESTALS: Vec2[] = [
  { x: 10, y: 54 }, // team 0
  { x: 90, y: 6 }, // team 1
];

export const CLOSET_SPOTS: Vec2[] = [
  { x: 3, y: 3 }, // team 0
  { x: 97, y: 57 }, // team 1
];

// Player spawns: two wizards per team, offset slightly so they don't overlap
// exactly on the pedestal.
const PLAYER_SPAWNS: { team: TeamId; x: number; y: number }[] = [
  { team: 0, x: 9, y: 54 },
  { team: 0, x: 11, y: 54 },
  { team: 1, x: 89, y: 6 },
  { team: 1, x: 91, y: 6 },
];

export type EngineEvent =
  | { type: "riddle_reveal"; line: number; text: string }
  | { type: "noise"; x: number; y: number; tick: number }
  | { type: "pickup"; playerId: string }
  | { type: "reveal"; playerId: string }
  | { type: "stun"; playerId: string; untilTick: number }
  | { type: "drop"; playerId: string; x: number; y: number }
  | { type: "grab"; playerId: string }
  | { type: "bank_requested"; team: TeamId; playerId: string }
  | { type: "bank_approved"; team: TeamId }
  | { type: "bank_rejected"; team: TeamId }
  | { type: "closet"; playerId: string; untilTick: number }
  | { type: "respawn"; playerId: string }
  | { type: "enrage" }
  | { type: "sudden_death" }
  | { type: "treasure_ping"; tick: number; x: number; y: number }
  | { type: "win"; team: TeamId; reason: WinReason };

export interface EngineOptions {
  /** When true, banking only finishes the match after approveBank(). M5 wires the human approval prompt. */
  approvalRequired?: boolean;
  /** Injectable RNG for deterministic tests. */
  rng?: () => number;
  /** When true, Gronk does NOT sniff on its own timer — an external driver
   *  (a TrueForge Gronk agent) calls forceSniff() every sniff interval. */
  externalSniff?: boolean;
}

export type MoveResult = { ok: true } | { ok: false; error: string };

export type TransformResult =
  | { ok: true; action: "transform" | "untransform" }
  | { ok: false; error: string };

export type ActionResult =
  | { ok: true; type: "treasure_found"; message: string }
  | { ok: true; type: "enemy_revealed"; message: string }
  | { ok: true; type: "empty"; message: string }
  | { ok: true; type: "bank_requested"; message: string }
  | { ok: false; type: "no_furniture" | "not_at_pedestal" | "cooldown" | "cannot_act"; message: string };

export function createInitialState(matchId: string): GameState {
  const players: Player[] = PLAYER_SPAWNS.map((spawn, i) => ({
    id: `wizard-${i}`,
    team: spawn.team,
    name: `Wizard ${i + 1}`,
    x: spawn.x,
    y: spawn.y,
    state: "active",
    transformedAs: null,
    carrying: false,
    stunnedUntilTick: 0,
    immunityUntilTick: 0,
    closetUntilTick: 0,
    spawnX: spawn.x,
    spawnY: spawn.y,
    moveDx: 0,
    moveDy: 0,
  }));

  return {
    matchId,
    status: "lobby",
    tick: 0,
    elapsed: 0,
    matchDuration: MATCH_DURATION,
    winnerTeam: null,
    winReason: null,
    suddenDeath: false,
    enraged: false,
    riddleSet: 0,
    visibleRiddleLines: [],
    players,
    furniture: FURNITURE_LAYOUT,
    gronk: {
      x: ROOM_WIDTH / 2,
      y: ROOM_HEIGHT / 2,
      mode: "wander",
      target: null,
      enraged: false,
      nextSniffTick: SNIFF_INTERVAL * TICKS_PER_SECOND,
      wanderTarget: null,
    },
    pedestals: PEDESTALS,
    closetSpots: CLOSET_SPOTS,
    groundTreasure: null,
    treasurePings: [],
    pendingBank: null,
    bankCooldownUntilTick: [0, 0],
    latestNoise: null,
  };
}

export class GameEngine {
  readonly state: GameState;

  // SECRET: the id of the furniture containing the treasure. Stored on the
  // engine, never in state — getPublicState() cannot leak it.
  treasureFurnitureId: string;

  private noise: { x: number; y: number; tick: number } | null = null;
  // Optional override for the next sniff target, set by a TrueForge Gronk
  // agent via steerGronk(). Consumed (and cleared) by pickSniffTarget().
  private gronkSteerTarget: { x: number; y: number } | null = null;
  private externalSniff: boolean;
  private treasureInFurniture: boolean;
  private approvalRequired: boolean;
  private rng: () => number;
  private listeners = new Set<(e: EngineEvent) => void>();

  constructor(opts: EngineOptions = {}) {
    this.rng = opts.rng ?? Math.random;
    // M5: the approval gate is ON by default. Unit tests that want the old
    // immediate-bank behavior pass approvalRequired: false explicitly.
    this.approvalRequired = opts.approvalRequired ?? true;
    this.externalSniff = opts.externalSniff ?? false;
    this.state = createInitialState(this.makeMatchId());
    this.treasureFurnitureId = this.pickRandomFurniture().id;
    this.treasureInFurniture = true;
  }

  // ---- match lifecycle ------------------------------------------------

  startMatch(): void {
    const s = this.state;
    s.status = "playing";
    s.tick = 0;
    s.elapsed = 0;
    s.winnerTeam = null;
    s.winReason = null;
    s.suddenDeath = false;
    s.enraged = false;
    s.riddleSet = Math.floor(this.rng() * RIDDLE_SETS.length);
    s.visibleRiddleLines = [RIDDLE_SETS[s.riddleSet][0]];
    s.groundTreasure = null;
    s.treasurePings = [];
    s.pendingBank = null;
    s.bankCooldownUntilTick = [0, 0];
    s.latestNoise = null;

    // Secretly pick the treasure furniture.
    this.treasureFurnitureId = this.pickRandomFurniture().id;
    this.treasureInFurniture = true;
    this.noise = null;
    this.gronkSteerTarget = null;

    for (const p of s.players) {
      p.state = "active";
      p.transformedAs = null;
      p.carrying = false;
      p.stunnedUntilTick = 0;
      p.immunityUntilTick = 0;
      p.closetUntilTick = 0;
      p.x = p.spawnX;
      p.y = p.spawnY;
      p.moveDx = 0;
      p.moveDy = 0;
    }

    const g = s.gronk;
    g.x = ROOM_WIDTH / 2;
    g.y = ROOM_HEIGHT / 2;
    g.mode = "wander";
    g.target = null;
    g.enraged = false;
    g.nextSniffTick = SNIFF_INTERVAL * TICKS_PER_SECOND;
    g.wanderTarget = null;

    this.emit({ type: "riddle_reveal", line: 1, text: s.visibleRiddleLines[0] });
  }

  /** Advance the simulation by n ticks (each tick = 1/10 s). */
  tick(n = 1): void {
    for (let i = 0; i < n; i++) this.tickOnce();
  }

  private tickOnce(): void {
    const s = this.state;
    if (s.status !== "playing") return;

    s.tick += 1;
    s.elapsed = s.tick / TICKS_PER_SECOND;

    this.updateRiddles();
    this.updateGronk();
    this.updatePlayers();
    this.updateSuddenDeath();
    this.checkClosetWin();
  }

  // ---- riddles ---------------------------------------------------------

  private updateRiddles(): void {
    const s = this.state;
    const set = RIDDLE_SETS[s.riddleSet];
    const visible = Math.min(set.length, Math.floor(s.elapsed / RIDDLE_REVEAL_INTERVAL) + 1);
    while (s.visibleRiddleLines.length < visible) {
      const line = s.visibleRiddleLines.length + 1;
      s.visibleRiddleLines.push(set[line - 1]);
      this.emit({ type: "riddle_reveal", line, text: set[line - 1] });
    }
  }

  // ---- Gronk FSM -------------------------------------------------------

  private updateGronk(): void {
    const s = this.state;
    const g = s.gronk;

    // Final 60s: enrage (2x speed). Stays on through sudden death.
    if (!s.enraged && s.elapsed >= ENRAGE_AT) {
      s.enraged = true;
      g.enraged = true;
      this.emit({ type: "enrage" });
    }

    // SNIFF every SNIFF_INTERVAL seconds: pick a target by priority —
    // 1) latest noise (every search is a gamble), 2) nearest stunned
    // player (they glow), 3) nearest visible (active) non-transformed player.
    // When externalSniff is set, an agent owns the cadence via forceSniff().
    if (!this.externalSniff && s.tick >= g.nextSniffTick) {
      this.doSniff();
    }

    // Wander: keep a random point, retarget every few seconds.
    if (g.mode === "wander") {
      const wt = g.wanderTarget;
      if (!wt || this.dist(g, wt) <= 0.5 || s.tick % (WANDER_RETARGET_INTERVAL * TICKS_PER_SECOND) === 0) {
        g.wanderTarget = { x: this.rng() * ROOM_WIDTH, y: this.rng() * ROOM_HEIGHT };
      }
    }

    // Move toward the current goal.
    const goal = g.mode === "chase" ? this.chaseGoal() : g.wanderTarget;
    if (goal) {
      this.stepGronkToward(goal);
      // Arrived at a point/noise target -> back to wandering.
      if (g.mode === "chase" && g.target && g.target.type !== "player" && this.dist(g, goal) <= 0.5) {
        g.mode = "wander";
        g.target = null;
      }
    }

    // Touch: anyone Gronk reaches (who isn't hiding or in the closet) gets caught.
    for (const p of s.players) {
      if (p.state === "in_closet" || p.state === "transformed") continue;
      if (this.dist(g, p) <= TOUCH_RANGE) this.sendToCloset(p);
    }
  }

  /** Perform a sniff now (pick target by priority, or the steered override),
   *  and reset the sniff timer. Used by the engine's own timer and by an
   *  external Gronk agent via forceSniff(). */
  private doSniff(): void {
    const s = this.state;
    const g = s.gronk;
    g.nextSniffTick = s.tick + SNIFF_INTERVAL * TICKS_PER_SECOND;
    const target = this.pickSniffTarget();
    g.target = target;
    g.mode = target ? "chase" : "wander";
  }

  /** A TrueForge Gronk agent decides on the sniff cadence; this triggers the
   *  actual sniff immediately. Safe to call in scripted mode too. */
  forceSniff(): void {
    if (this.state.status !== "playing") return;
    this.doSniff();
  }

  private pickSniffTarget(): GronkTarget | null {
    const s = this.state;
    const g = s.gronk;

    // A TrueForge Gronk agent may steer this sniff (HUNT_NEAREST). Its choice
    // wins; otherwise the engine's built-in priority (noise > stunned >
    // visible) applies — the same order the Gronk agent prompt mandates.
    if (this.gronkSteerTarget) {
      const t = { type: "point" as const, x: this.gronkSteerTarget.x, y: this.gronkSteerTarget.y };
      this.gronkSteerTarget = null;
      return t;
    }

    if (this.noise) return { type: "noise", x: this.noise.x, y: this.noise.y };

    const stunned = s.players.filter((p) => p.state === "stunned");
    if (stunned.length > 0) {
      const nearest = this.nearestOf(stunned, g.x, g.y);
      return { type: "player", playerId: nearest.id };
    }

    const visible = s.players.filter((p) => p.state === "active");
    if (visible.length > 0) {
      const nearest = this.nearestOf(visible, g.x, g.y);
      return { type: "player", playerId: nearest.id };
    }

    return null;
  }

  private chaseGoal(): Vec2 | null {
    const g = this.state.gronk;
    const t = g.target;
    if (!t) return null;
    if (t.type === "player") {
      const p = this.player(t.playerId);
      // Lost sight: hiding or closeted players are invisible.
      if (!p || p.state === "in_closet" || p.state === "transformed") return null;
      return { x: p.x, y: p.y };
    }
    return { x: t.x, y: t.y };
  }

  private stepGronkToward(goal: Vec2): void {
    const g = this.state.gronk;
    const speed = GRONK_SPEED * (g.enraged ? GRONK_ENRAGE_SPEED_MULT : 1);
    const dx = goal.x - g.x;
    const dy = goal.y - g.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= 0.001) return;
    const step = Math.min(speed / TICKS_PER_SECOND, dist);
    g.x += (dx / dist) * step;
    g.y += (dy / dist) * step;
  }

  private sendToCloset(p: Player): void {
    const s = this.state;
    p.state = "in_closet";
    p.closetUntilTick = s.tick + CLOSET_DURATION * TICKS_PER_SECOND;
    const spot = s.closetSpots[p.team];
    p.x = spot.x;
    p.y = spot.y;
    this.emit({ type: "closet", playerId: p.id, untilTick: p.closetUntilTick });
  }

  // ---- players ---------------------------------------------------------

  private updatePlayers(): void {
    for (const p of this.state.players) {
      if (p.state === "in_closet") {
        if (this.state.tick >= p.closetUntilTick) this.respawn(p);
        continue;
      }
      if (p.state === "stunned") {
        if (this.state.tick >= p.stunnedUntilTick) {
          p.state = "active";
          // Post-stun immunity starts when the stun wears off.
          p.immunityUntilTick = this.state.tick + STUN_IMMUNITY * TICKS_PER_SECOND;
        }
        continue; // can't move while stunned
      }
      if (p.state === "transformed") continue; // position locked

      this.applyMove(p);
      this.tryAutoGrab(p);
    }
  }

  private respawn(p: Player): void {
    p.state = "active";
    p.closetUntilTick = 0;
    p.x = p.spawnX;
    p.y = p.spawnY;
    this.emit({ type: "respawn", playerId: p.id });
  }

  private applyMove(p: Player): void {
    const speed = p.carrying ? MOVE_SPEED * CARRY_SPEED_MULT : MOVE_SPEED;
    const len = Math.hypot(p.moveDx, p.moveDy);
    if (len <= 0) return;
    const step = speed / TICKS_PER_SECOND;
    p.x = this.clamp(p.x + (p.moveDx / len) * step, PLAYER_RADIUS, ROOM_WIDTH - PLAYER_RADIUS);
    p.y = this.clamp(p.y + (p.moveDy / len) * step, PLAYER_RADIUS, ROOM_HEIGHT - PLAYER_RADIUS);
  }

  private clamp(v: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, v));
  }

  // ---- sudden death ----------------------------------------------------

  private updateSuddenDeath(): void {
    const s = this.state;
    if (!s.suddenDeath && s.elapsed >= MATCH_DURATION) {
      s.suddenDeath = true;
      this.emit({ type: "sudden_death" });
    }
    // Treasure pings the map every 10s while in sudden death.
    if (s.suddenDeath && s.tick % (SUDDEN_DEATH_PING_INTERVAL * TICKS_PER_SECOND) === 0) {
      const loc = this.treasureLocation();
      s.treasurePings.push({ tick: s.tick, x: loc.x, y: loc.y });
      this.emit({ type: "treasure_ping", tick: s.tick, x: loc.x, y: loc.y });
    }
  }

  // ---- win conditions --------------------------------------------------

  private checkClosetWin(): void {
    const s = this.state;
    for (const team of [0, 1] as TeamId[]) {
      const bothInCloset = s.players.filter((p) => p.team === team && p.state === "in_closet").length === 2;
      if (bothInCloset) {
        this.finish(team === 0 ? 1 : 0, "closet");
        return;
      }
    }
  }

  private finish(team: TeamId, reason: WinReason): void {
    const s = this.state;
    if (s.status === "finished") return;
    s.status = "finished";
    s.winnerTeam = team;
    s.winReason = reason;
    this.emit({ type: "win", team, reason });
  }

  // ---- commands --------------------------------------------------------

  /** Set a wizard's movement direction (dx,dy in [-1,1], e.g. from joystick/WASD). */
  move(playerId: string, dx: number, dy: number): MoveResult {
    const p = this.player(playerId);
    if (!p) return { ok: false, error: "unknown player" };
    const s = this.state;
    if (s.status !== "playing") return { ok: false, error: "match not running" };
    if (p.state === "in_closet") return { ok: false, error: "you are in the closet" };
    if (p.state === "stunned") return { ok: false, error: "you are stunned" };
    if (p.state === "transformed") {
      // Moving while hidden breaks the disguise.
      p.state = "active";
      p.transformedAs = null;
    }
    const len = Math.hypot(dx, dy);
    p.moveDx = len > 0 ? dx / len : 0;
    p.moveDy = len > 0 ? dy / len : 0;
    return { ok: true };
  }

  /** Transform into (or untransform out of) a furniture piece. */
  transform(playerId: string, furnitureId: string): TransformResult {
    const p = this.player(playerId);
    if (!p) return { ok: false, error: "unknown player" };
    const s = this.state;
    if (s.status !== "playing") return { ok: false, error: "match not running" };
    if (p.state === "in_closet") return { ok: false, error: "you are in the closet" };
    if (p.state === "stunned") return { ok: false, error: "you are stunned" };
    if (p.state === "transformed") {
      p.state = "active";
      p.transformedAs = null;
      return { ok: true, action: "untransform" };
    }
    if (p.carrying) return { ok: false, error: "cannot hide while carrying the treasure" };
    const f = this.furniture(furnitureId);
    if (!f) return { ok: false, error: "unknown furniture" };
    if (this.dist(p, f) > TRANSFORM_RANGE) return { ok: false, error: "too far from that furniture" };
    p.state = "transformed";
    p.transformedAs = f.id;
    p.x = f.x;
    p.y = f.y;
    p.moveDx = 0;
    p.moveDy = 0;
    return { ok: true, action: "transform" };
  }

  /**
   * The one verb. Context-resolved:
   *  - carrying + at own pedestal      -> bank request (approval-gated in M5)
   *  - carrying + elsewhere            -> error: go to your pedestal
   *  - near furniture with the treasure-> pick it up
   *  - near furniture hiding an enemy  -> reveal + stun (3s)
   *  - otherwise                       -> "empty!"
   * Every search emits a noise event that attracts Gronk.
   */
  action(playerId: string): ActionResult {
    const p = this.player(playerId);
    if (!p) return { ok: false, type: "cannot_act", message: "unknown player" };
    const s = this.state;
    if (s.status !== "playing") return { ok: false, type: "cannot_act", message: "match not running" };
    if (p.state === "in_closet") return { ok: false, type: "cannot_act", message: "you are in the closet" };
    if (p.state === "stunned") return { ok: false, type: "cannot_act", message: "you are stunned" };
    if (p.state === "transformed") return { ok: false, type: "cannot_act", message: "untransform first" };

    if (p.carrying) {
      if (this.dist(p, s.pedestals[p.team]) <= PEDESTAL_RANGE) {
        if (s.tick < s.bankCooldownUntilTick[p.team]) {
          return {
            ok: false,
            type: "cooldown",
            message: `Bank rejected recently — wait ${Math.ceil((s.bankCooldownUntilTick[p.team] - s.tick) / TICKS_PER_SECOND)}s.`,
          };
        }
        s.pendingBank = { team: p.team, playerId: p.id, tick: s.tick };
        this.emit({ type: "bank_requested", team: p.team, playerId: p.id });
        if (!this.approvalRequired) this.approveBank(p.team);
        return { ok: true, type: "bank_requested", message: "Bank request sent!" };
      }
      return {
        ok: false,
        type: "not_at_pedestal",
        message: "Carry the treasure to your own pedestal to bank it.",
      };
    }

    // SEARCH
    const f = this.nearestFurnitureInRange(p, ACTION_RANGE);
    if (!f) return { ok: false, type: "no_furniture", message: "No furniture nearby to search." };

    // Every search makes noise.
    this.noise = { x: p.x, y: p.y, tick: s.tick };
    s.latestNoise = { x: p.x, y: p.y, tick: s.tick };
    this.emit({ type: "noise", x: p.x, y: p.y, tick: s.tick });

    if (this.treasureInFurniture && f.id === this.treasureFurnitureId) {
      p.carrying = true;
      this.treasureInFurniture = false;
      this.emit({ type: "pickup", playerId: p.id });
      return { ok: true, type: "treasure_found", message: "You found the treasure! Now get it to your pedestal." };
    }

    const enemies = s.players.filter((q) => q.team !== p.team && q.transformedAs === f.id);
    if (enemies.length > 0) {
      let stunned = 0;
      for (const e of enemies) {
        e.state = "active";
        e.transformedAs = null;
        this.emit({ type: "reveal", playerId: e.id });
        if (s.tick >= e.immunityUntilTick) {
          e.state = "stunned";
          e.stunnedUntilTick = s.tick + STUN_DURATION * TICKS_PER_SECOND;
          // Immunity begins when the stun ends.
          e.immunityUntilTick = e.stunnedUntilTick + STUN_IMMUNITY * TICKS_PER_SECOND;
          this.emit({ type: "stun", playerId: e.id, untilTick: e.stunnedUntilTick });
          stunned++;
          if (e.carrying) this.dropTreasure(e);
        }
      }
      const msg = stunned > 0 ? `Revealed ${enemies.length} hider(s) — stunned!` : "Revealed a hider.";
      return { ok: true, type: "enemy_revealed", message: msg };
    }

    return { ok: true, type: "empty", message: "Empty!" };
  }

  /** Approve a pending bank request (human-in-the-loop, M5). */
  approveBank(team: TeamId): { ok: boolean; message: string } {
    const s = this.state;
    if (!s.pendingBank) return { ok: false, message: "No pending bank request." };
    if (s.pendingBank.team !== team) return { ok: false, message: "Not this team's request." };
    this.emit({ type: "bank_approved", team });
    s.pendingBank = null;
    this.finish(team, "bank");
    return { ok: true, message: "Treasure banked!" };
  }

  rejectBank(team: TeamId): { ok: boolean; message: string } {
    const s = this.state;
    if (!s.pendingBank) return { ok: false, message: "No pending bank request." };
    if (s.pendingBank.team !== team) return { ok: false, message: "Not this team's request." };
    this.emit({ type: "bank_rejected", team });
    s.pendingBank = null;
    // M5: rejected banks put that team on a 10s cooldown.
    s.bankCooldownUntilTick[team] = s.tick + BANK_COOLDOWN * TICKS_PER_SECOND;
    return { ok: true, message: "Bank request rejected — 10s cooldown." };
  }

  // ---- queries ---------------------------------------------------------

  /** Deep copy of state safe to serialize: never contains the treasure id. */
  getPublicState(): GameState {
    return structuredClone(this.state);
  }

  get lastNoise(): { x: number; y: number; tick: number } | null {
    return this.noise;
  }

  /** Steer Gronk's next sniff toward a point chosen by a TrueForge agent.
   *  Overrides the built-in priority for exactly one sniff; the engine keeps
   *  owning movement, enrage speed, and touch->closet. */
  steerGronk(x: number, y: number): void {
    this.gronkSteerTarget = { x, y };
  }

  onEvent(cb: (e: EngineEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ---- internals -------------------------------------------------------

  private emit(e: EngineEvent): void {
    for (const cb of this.listeners) cb(e);
  }

  private makeMatchId(): string {
    return `match-${Math.floor(this.rng() * 100000)}`;
  }

  private pickRandomFurniture(): Furniture {
    return this.state.furniture[Math.floor(this.rng() * this.state.furniture.length)];
  }

  private player(id: string): Player | undefined {
    return this.state.players.find((p) => p.id === id);
  }

  private furniture(id: string): Furniture | undefined {
    return this.state.furniture.find((f) => f.id === id);
  }

  private nearestFurnitureInRange(p: Player, range: number): Furniture | null {
    let best: Furniture | null = null;
    let bestD = Infinity;
    for (const f of this.state.furniture) {
      const d = this.dist(p, f);
      if (d <= range && d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  }

  private nearestOf(players: Player[], x: number, y: number): Player {
    let best = players[0];
    let bestD = Infinity;
    for (const p of players) {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  private dist(a: Vec2, b: Vec2): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private treasureLocation(): Vec2 {
    const s = this.state;
    if (this.treasureInFurniture) {
      const f = this.furniture(this.treasureFurnitureId);
      if (f) return { x: f.x, y: f.y };
    }
    const carrier = s.players.find((p) => p.carrying);
    if (carrier) return { x: carrier.x, y: carrier.y };
    if (s.groundTreasure) return { ...s.groundTreasure };
    return { x: ROOM_WIDTH / 2, y: ROOM_HEIGHT / 2 };
  }

  private tryAutoGrab(p: Player): void {
    const s = this.state;
    if (p.carrying || !s.groundTreasure) return;
    if (this.dist(p, s.groundTreasure) <= GRAB_RANGE) {
      p.carrying = true;
      s.groundTreasure = null;
      this.emit({ type: "grab", playerId: p.id });
    }
  }

  private dropTreasure(p: Player): void {
    p.carrying = false;
    this.state.groundTreasure = { x: p.x, y: p.y };
    this.emit({ type: "drop", playerId: p.id, x: p.x, y: p.y });
  }
}
