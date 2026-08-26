// Agent intents. The engine has no notion of intents — this executor translates
// a persistent intent into engine public-API calls (move/transform/action) on
// every tick, until the intent is replaced or cleared. The engine is never
// touched except through its public API.
import type { GameEngine, Player } from "../engine";
import { ACTION_RANGE, PEDESTAL_RANGE, TRANSFORM_RANGE } from "../engine";

export type AgentIntentType =
  | "SEARCH_FURNITURE" // targetId = furniture id; walk to it, search once on arrival
  | "HIDE_AS" // targetId = furniture id; walk to it, transform once on arrival
  | "FLEE" // re-path each tick away from Gronk
  | "GRAB" // walk to the dropped treasure (engine auto-grabs on contact)
  | "GO_TO_PEDESTAL" // walk to own team pedestal; bank via action when there
  | "HUNT_NEAREST"; // chase nearest visible enemy (prefers the enemy carrier)

export interface AgentIntent {
  intent: AgentIntentType;
  /** Furniture id (SEARCH_FURNITURE / HIDE_AS) or explicit point target. */
  targetId?: string;
  targetX?: number;
  targetY?: number;
}

export class IntentExecutor {
  private intents = new Map<string, AgentIntent>();
  // Edge-trigger: has the one-shot act (search / transform / bank) already
  // fired at the current target? Prevents re-spamming action() every tick.
  private arrived = new Map<string, boolean>();

  setIntent(playerId: string, intent: AgentIntent): void {
    this.intents.set(playerId, intent);
    this.arrived.set(playerId, false);
  }

  clearIntent(playerId: string): void {
    this.intents.delete(playerId);
    this.arrived.delete(playerId);
  }

  getIntent(playerId: string): AgentIntent | undefined {
    return this.intents.get(playerId);
  }

  /** Execute every player's intent one step. Call before engine.tick(). */
  step(eng: GameEngine): void {
    for (const [playerId, intent] of this.intents) {
      this.stepPlayer(eng, playerId, intent);
    }
  }

  private stepPlayer(eng: GameEngine, playerId: string, intent: AgentIntent): void {
    const p = eng.state.players.find((q) => q.id === playerId);
    if (!p) return;
    if (p.state === "in_closet" || p.state === "stunned") return; // can't act

    if (p.state === "transformed") {
      // Hiding is passive — stay hidden unless the intent demands movement.
      if (intent.intent === "HIDE_AS") return;
      // Any movement intent breaks the disguise: engine.move() untransforms.
      eng.move(p.id, 0, 0);
      this.arrived.set(p.id, false);
      return; // act next tick, now that we are active again
    }

    switch (intent.intent) {
      case "SEARCH_FURNITURE":
        this.doSearch(eng, p, intent);
        break;
      case "HIDE_AS":
        this.doHide(eng, p, intent);
        break;
      case "FLEE":
        this.doFlee(eng, p);
        break;
      case "GRAB":
        this.doGrab(eng, p);
        break;
      case "GO_TO_PEDESTAL":
        this.doGoToPedestal(eng, p);
        break;
      case "HUNT_NEAREST":
        this.doHunt(eng, p);
        break;
    }
  }

  private moveToward(eng: GameEngine, p: Player, tx: number, ty: number): void {
    const dx = tx - p.x;
    const dy = ty - p.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      eng.move(p.id, 0, 0);
      return;
    }
    eng.move(p.id, dx / len, dy / len);
  }

  private doSearch(eng: GameEngine, p: Player, intent: AgentIntent): void {
    const f = eng.state.furniture.find((q) => q.id === intent.targetId);
    if (!f) {
      eng.move(p.id, 0, 0); // unknown target; the FSM will re-decide
      return;
    }
    const d = Math.hypot(f.x - p.x, f.y - p.y);
    if (d <= ACTION_RANGE) {
      if (!this.arrived.get(p.id)) {
        this.arrived.set(p.id, true);
        eng.action(p.id); // search once per visit (every search makes noise)
      } else {
        eng.move(p.id, 0, 0);
      }
    } else {
      this.arrived.set(p.id, false);
      this.moveToward(eng, p, f.x, f.y);
    }
  }

  private doHide(eng: GameEngine, p: Player, intent: AgentIntent): void {
    const f = eng.state.furniture.find((q) => q.id === intent.targetId);
    if (!f) {
      eng.move(p.id, 0, 0);
      return;
    }
    const d = Math.hypot(f.x - p.x, f.y - p.y);
    if (d <= TRANSFORM_RANGE) {
      if (!this.arrived.get(p.id)) {
        this.arrived.set(p.id, true);
        eng.transform(p.id, f.id);
      } else {
        eng.move(p.id, 0, 0);
      }
    } else {
      this.arrived.set(p.id, false);
      this.moveToward(eng, p, f.x, f.y);
    }
  }

  private doFlee(eng: GameEngine, p: Player): void {
    const g = eng.state.gronk;
    this.moveToward(eng, p, p.x * 2 - g.x, p.y * 2 - g.y);
  }

  private doGrab(eng: GameEngine, p: Player): void {
    const gt = eng.state.groundTreasure;
    if (!gt) {
      eng.move(p.id, 0, 0); // nothing on the ground; FSM will re-decide
      return;
    }
    // Engine auto-grabs when the player gets within GRAB_RANGE (engine.tick).
    this.moveToward(eng, p, gt.x, gt.y);
  }

  private doGoToPedestal(eng: GameEngine, p: Player): void {
    const ped = eng.state.pedestals[p.team];
    const d = Math.hypot(ped.x - p.x, ped.y - p.y);
    if (d <= PEDESTAL_RANGE) {
      if (!this.arrived.get(p.id)) {
        this.arrived.set(p.id, true);
        if (p.carrying) eng.action(p.id); // bank request (auto-approved pre-M5)
      } else {
        eng.move(p.id, 0, 0);
      }
    } else {
      this.arrived.set(p.id, false);
      this.moveToward(eng, p, ped.x, ped.y);
    }
  }

  private doHunt(eng: GameEngine, p: Player): void {
    const targets = eng.state.players.filter(
      (q) => q.team !== p.team && q.state === "active",
    );
    if (targets.length === 0) {
      eng.move(p.id, 0, 0);
      return;
    }
    // Prefer the enemy carrier (they glow gold); otherwise the nearest enemy.
    const carriers = targets.filter((q) => q.carrying);
    const pool = carriers.length > 0 ? carriers : targets;
    let best = pool[0];
    let bestD = Infinity;
    for (const q of pool) {
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    this.moveToward(eng, p, best.x, best.y);
  }
}
