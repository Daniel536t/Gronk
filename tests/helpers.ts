import assert from "node:assert/strict";
import { GameEngine } from "../src/engine";

/** Deterministic LCG so tests are reproducible. */
export function seededRng(seed = 42): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function makeEngine(opts: { approvalRequired?: boolean; seed?: number } = {}): GameEngine {
  const eng = new GameEngine({
    rng: seededRng(opts.seed ?? 42),
    approvalRequired: opts.approvalRequired ?? false,
  });
  eng.startMatch();
  return eng;
}

export function assertNear(actual: number, expected: number, eps = 1e-6): void {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `expected ${actual} to be near ${expected} (±${eps})`,
  );
}

export function player(eng: GameEngine, id: string) {
  const p = eng.state.players.find((p) => p.id === id);
  assert.ok(p, `player ${id} exists`);
  return p;
}

export function place(eng: GameEngine, id: string, x: number, y: number): void {
  const p = player(eng, id);
  p.x = x;
  p.y = y;
}

/**
 * Neutralize the match for focused tests: everyone except `keepActive` hides
 * as furniture (invisible to Gronk) and Gronk stops sniffing. This removes
 * random wander/touch interference from other rules' assertions.
 * `hideAs` is the furniture the hidden players disguise as (avoid reusing the
 * furniture under test).
 */
export function neutralize(eng: GameEngine, keepActive: string[] = [], hideAs = "furn-0"): void {
  for (const p of eng.state.players) {
    if (keepActive.includes(p.id)) continue;
    p.state = "transformed";
    p.transformedAs = hideAs;
  }
  eng.state.gronk.nextSniffTick = 1e9;
}
