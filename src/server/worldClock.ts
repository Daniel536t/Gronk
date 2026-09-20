// World-clock policy. Wiring layer only: this module DECIDES WHETHER to advance
// time, and has no way to mutate the world — all mutation still goes through the
// authoritative command bus, and the clock itself is Core's own `tick()`.
//
// Split out of index.ts purely so the policy is testable without booting the
// server (index.ts listens on a port and connects stdio at import time).
import type { LoopState } from "../astrix/orchestrator";

/** `managed` binds time to stewardship; `always` is the old ungated behaviour. */
export type WorldClockMode = "managed" | "always";

/**
 * Steward states in which a run is LIVE and time should therefore pass.
 *
 * AWAITING_APPROVAL is listed for honesty rather than effect: Core's tick()
 * already freezes the day clock behind an open approval gate, so including it
 * only keeps this predicate meaning what its name says.
 */
const LIVE_STATES: ReadonlySet<string> = new Set<LoopState>(["RUNNING", "AWAITING_APPROVAL"]);

export function worldClockMode(raw: string | undefined): WorldClockMode {
  return (raw ?? "managed").trim().toLowerCase() === "always" ? "always" : "managed";
}

/**
 * Whether the world clock should advance one second right now.
 *
 * THE BUG THIS FIXES: the clock used to be armed at boot regardless of the
 * steward, while the steward only ever starts on POST /astrix/agent/start. An
 * idle deployment therefore aged its settlement in real time with nobody
 * managing it — the live world had reached day 237 with population 0, food 0, no
 * crops and no bridges. It had starved over ~9.5 unattended hours, so every
 * reader who opened the page saw a corpse.
 *
 * ASTrix is an AI-MANAGED world: time passing is a consequence of management,
 * not a background process. Unmanaged, the world HOLDS rather than decays — a
 * held world is honest and recoverable, a starved one is neither.
 */
export function clockShouldTick(mode: WorldClockMode, loopState: LoopState | string): boolean {
  return mode === "always" || LIVE_STATES.has(loopState);
}
