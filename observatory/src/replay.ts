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
  SEASON_CHANGED: 0.35, // slow so a season (esp. winter) lands visibly
  ACTION_FAILED: 0.6,
  TURN_FAILED: 0.6,
  APPROVAL_GRANTED: 0.55,
  APPROVAL_REJECTED: 0.55,
};

// Slow the replay on consequential actions so the audience sees the effect.
// Smaller emphasis => slower pacing (wait = baseDelay / emphasis). Only harvest
// is slowed here; planting/gathering stay brisk so ordinary work fast-forwards.
function consequential(ev: AgentEvent): number | undefined {
  const tool = ev.data?.tool;
  if (tool === "harvest" && (ev.type === "ACTION_SUCCEEDED" || ev.type === "VERIFICATION_SUCCEEDED" || ev.type === "ACTION_EXECUTING")) {
    return 0.45;
  }
  return undefined;
}

export function emphasisFor(ev: AgentEvent): number {
  if (ev.type === "APPROVAL_REQUIRED") return 0; // full pause
  const conc = consequential(ev);
  if (conc !== undefined) return conc;
  const mult = EMPHATIC[ev.type];
  return mult ?? 1;
}

/**
 * Build an ordered list of { event, frameAtOrAfter } steps for playback.
 * Returns array of { event, emphasis, targetSnapshot } where targetSnapshot is
 * the authoritative WORLD_OBSERVED frame closest at-or-after the event.
 */
export interface ReplayStep {
  event: AgentEvent;
  emphasis: number;
  snapshot: WorldSnapshot | null;
  /** Villagers lost at this step, derived deterministically from a drop in the
   *  authoritative recorded population between consecutive snapshots. This is
   *  how "starvation" surfaces in the recorded data (no synthetic event). */
  starvation?: number;
}

export function buildSteps(b: DerivedReplayBundle): ReplayStep[] {
  const steps: ReplayStep[] = [];
  let lastPop: number | null = null;
  for (const event of b.events) {
    // Find the first frame with ts >= event.at (the world state that reflects
    // this event).
    const frame = b.frames.find((f) => f.ts >= event.at) ?? b.frames[b.frames.length - 1] ?? null;
    const snapshot = frame ? frame.snapshot : null;
    let emphasis = emphasisFor(event);
    let starvation: number | undefined;
    if (snapshot) {
      const pop = Number(snapshot.population ?? 0);
      if (lastPop !== null && pop < lastPop && pop >= 0) {
        starvation = lastPop - pop;
        // lingers so the audience registers the loss
        emphasis = Math.min(emphasis, 0.3);
      }
      lastPop = pop;
    }
    steps.push({ event, emphasis, snapshot, starvation });
  }
  return steps;
}

export { loadedBundle as _bundle };