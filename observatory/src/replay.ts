// ASTrix Observatory — replay engine.
//
// Consumes a DerivedReplayBundle generated from the canonical evaluation
// artifacts (events.jsonl + state.jsonl + approval payloads). It never
// fabricates state or events: it replays exactly the recorded timeline and
// reconstructs the authoritative world snapshot at each WORLD_OBSERVED event.
// Playback speed/emphasis is presentation only and never alters the data.
import type { AgentEvent, Crop, FarmlandPlot, Season, WorldSnapshot } from "./types";

export interface DerivedReplayBundle {
  meta: {
    name: string;
    generatedAt: string;
    source: string;
    dayStart: number;
    dayEnd: number;
    seasonEnd: Season;
    populationStart: number;
    populationEnd: number;
    foodStart: number;
    foodEnd: number;
    farmsEnd?: number;
    bridgesEnd?: number;
    approvals: number;
    approved: number;
    rejected: number;
  };
  /** Ordered agent events (from events.jsonl). */
  events: AgentEvent[];
  /** World state frames reconstructed at each day-event, keyed by elapsed ms. */
  frames: { ts: number; day: number; snapshot: WorldSnapshot }[];
  /** Approval reference payloads (id -> data) from approval-*.json. */
  approvals: Record<string, { tool: string; command?: string; reason?: string; impact?: Record<string, unknown> }>;
}

let loadedBundle: DerivedReplayBundle | null = null;
let loadError: string | null = null;

export async function loadReplayBundle(url: string): Promise<DerivedReplayBundle> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("replay bundle " + url + " -> " + res.status);
  loadedBundle = (await res.json()) as DerivedReplayBundle;
  return loadedBundle;
}

export function getBundle(): DerivedReplayBundle | null {
  return loadedBundle;
}

export function setLoadError(msg: string): void {
  loadError = msg;
}
export function getLoadError(): string | null {
  return loadError;
}

/** Map an event type to a short user-facing label (for the timeline/activity). */
export function eventLabel(ev: AgentEvent): string {
  const d = ev.data ?? {};
  switch (ev.type) {
    case "WORLD_OBSERVED": return `Observed world (day ${d.day})`;
    case "PLAN_CREATED": return `Plan: ${String(d.decision ?? "…")}`;
    case "ACTION_PROPOSED": return `Proposed ${String(d.tool ?? "")}`;
    case "ACTION_EXECUTING": return `Executing ${String(d.tool ?? "")}`;
    case "ACTION_SUCCEEDED": return `✓ ${String(d.tool ?? "action")} executed`;
    case "ACTION_FAILED": return `✗ ${String(d.tool ?? "action")} failed${d.error ? ` (${String(d.error).slice(0, 60)})` : ""}`;
    case "VERIFICATION_SUCCEEDED": return `✓ ${String(d.tool ?? "")} verified`;
    case "VERIFICATION_FAILED": return `✗ verification failed`;
    case "APPROVAL_REQUIRED": return `⚠ HUMAN APPROVAL REQUIRED`;
    case "APPROVAL_GRANTED": return `Approval GRANTED`;
    case "APPROVAL_REJECTED": return `Approval REJECTED`;
    case "SEASON_CHANGED": return `❄ ${String(d.season ?? "").toUpperCase()} begins`;
    case "TURN_STARTED": return `Turn ${ev.turn} started`;
    case "TURN_COMPLETED": return `Turn ${ev.turn} completed`;
    case "TURN_FAILED": return `Turn ${ev.turn} failed`;
    case "DECISION_COMPLETED": return (d.ok ? `Decision (${d.durationMs}ms)` : `Decision failed: ${String(d.failureKind ?? "")}`);
    case "DECISION_RETRY": return `Retrying decision`;
    default: return ev.type.replace(/_/g, " ").toLowerCase();
  }
}

/** Emphatic event types — the presentation layer slows/pauses the replay on them. */
const EMPHATIC: Record<string, number> = {
  APPROVAL_REQUIRED: 0, // pause until human
  SEASON_CHANGED: 0.4,
  ACTION_FAILED: 0.7,
  TURN_FAILED: 0.7,
};

export function emphasisFor(ev: AgentEvent): number {
  if (ev.type === "APPROVAL_REQUIRED") return 0; // full pause
  const mult = EMPHATIC[ev.type];
  return mult ?? 1;
}

/**
 * Build an ordered list of { event, frameAtOrAfter } steps for playback.
 * Returns array of { event, emphasis, targetSnapshot } where targetSnapshot is
 * the authoritative WORLD_OBSERVED frame closest at-or-after the event.
 */
export function buildSteps(b: DerivedReplayBundle): {
  event: AgentEvent;
  emphasis: number;
  snapshot: WorldSnapshot | null;
}[] {
  const steps: { event: AgentEvent; emphasis: number; snapshot: WorldSnapshot | null }[] = [];
  for (const event of b.events) {
    // Find the first frame with ts >= event.at (the world state that reflects
    // this event).
    const frame = b.frames.find((f) => f.ts >= event.at) ?? b.frames[b.frames.length - 1] ?? null;
    steps.push({ event, emphasis: emphasisFor(event), snapshot: frame ? frame.snapshot : null });
  }
  return steps;
}

export { loadedBundle as _bundle };