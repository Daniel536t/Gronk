// Game-master agent: owns the riddle reveal schedule. In M4 the engine already
// advances visibleRiddleLines on the 0s/90s/180s schedule and get_state exposes
// them (so the frontend banner updates for free). The game-master agent loads
// the gronks-hoard skill (rules + riddles + schedule) and, on each reveal,
// calls reveal_riddle to fetch + broadcast the line text.
//
// This in-process driver mirrors that job so the riddle reveal flow is testable
// without a running TrueForge harness; when a TrueForge game-master agent is
// wired in, it drives the same reveal_riddle tool over MCP.
import type { GameEngine } from "../engine";
import { RIDDLE_SETS } from "../engine";
import { RIDDLE_REVEAL_INTERVAL } from "../engine";

export const GAME_MASTER_SYSTEM_PROMPT = [
  "You are the game master for Gronk's Hoard.",
  "Load the gronks-hoard skill for the full rules and the three riddle sets.",
  "Reveal riddle lines on schedule: line 1 at 0s, line 2 at 90s, line 3 at 180s.",
  "For each reveal, call reveal_riddle(roomCode, lineNumber) and broadcast the returned text.",
  "The frontend polls get_state and shows visibleRiddleLines automatically; your job is to keep the reveal schedule honest.",
].join("\n");

export interface RiddleReveal {
  line: number;
  text: string;
  elapsed: number;
}

export class GameMaster {
  /** Reveals observed so far (line -> text), keyed for the current match. */
  readonly reveals: RiddleReveal[] = [];
  private detach: (() => void) | null = null;

  /** Watch an engine and record its riddle reveals. Returns an unsubscribe. */
  watch(engine: GameEngine): () => void {
    this.detach?.();
    this.reveals.length = 0;
    this.detach = engine.onEvent((e) => {
      if (e.type === "riddle_reveal") {
        this.reveals.push({ line: e.line, text: e.text, elapsed: engine.state.elapsed });
      }
    });
    return this.detach;
  }

  /** The text for a line number (1..3) for a given riddle set. */
  static lineFor(set: number, line: number): string {
    return RIDDLE_SETS[set]?.[line - 1] ?? "";
  }

  static schedule(): number[] {
    return [0, RIDDLE_REVEAL_INTERVAL, RIDDLE_REVEAL_INTERVAL * 2];
  }
}