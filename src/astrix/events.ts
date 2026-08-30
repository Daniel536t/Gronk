// Structured ASTrix agent event log (P0 observability).
// A small ring buffer + subscription point that the steward execution loop
// writes to and the server forwards to SSE clients and the /astrix/log
// replay endpoint. This is the ASTrix observability surface — it does not
// replace the legacy hide-and-seek EngineEvent system.
export const ASTRIX_AGENT_EVENT_TYPES = [
  "TURN_STARTED",
  "WORLD_OBSERVED",
  // Steward decision lifecycle: started/completed with duration and a failure
  // kind so MODEL LATENCY vs PARSING FAILURE vs PROVIDER FAILURE are
  // distinguishable in the log without a second logging system.
  "DECISION_STARTED",
  "DECISION_COMPLETED",
  "PLAN_CREATED",
  "SUBAGENT_REQUESTED",
  "SUBAGENT_RESULT",
  "ACTION_PROPOSED",
  "APPROVAL_REQUIRED",
  "APPROVAL_GRANTED",
  "APPROVAL_REJECTED",
  "ACTION_EXECUTING",
  "ACTION_SUCCEEDED",
  "ACTION_FAILED",
  "VERIFICATION_STARTED",
  "VERIFICATION_SUCCEEDED",
  "VERIFICATION_FAILED",
  "TURN_COMPLETED",
  "TURN_FAILED",
  // World-level events (not tied to a steward turn; turn is 0 for these).
  "SEASON_CHANGED",
] as const;

export type AstrixAgentEventType = (typeof ASTRIX_AGENT_EVENT_TYPES)[number];

export interface AstrixAgentEvent {
  type: AstrixAgentEventType;
  at: number;
  turn: number;
  actionId?: string;
  data?: Record<string, unknown>;
}

export class AstrixEventLog {
  private readonly buffer: AstrixAgentEvent[] = [];
  private readonly listeners = new Set<(event: AstrixAgentEvent) => void>();

  constructor(private readonly capacity = 500) {}

  record(event: Omit<AstrixAgentEvent, "at"> & { at?: number }): AstrixAgentEvent {
    const full: AstrixAgentEvent = { ...event, at: event.at ?? Date.now() };
    this.buffer.push(full);
    if (this.buffer.length > this.capacity) {
      this.buffer.splice(0, this.buffer.length - this.capacity);
    }
    for (const listener of this.listeners) listener(full);
    return full;
  }

  /** Subscribe to every recorded event; returns an unsubscribe function. */
  onEvent(listener: (event: AstrixAgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  recent(count = 50): AstrixAgentEvent[] {
    return this.buffer.slice(-count);
  }

  all(): AstrixAgentEvent[] {
    return [...this.buffer];
  }

  clear(): void {
    this.buffer.length = 0;
  }

  get size(): number {
    return this.buffer.length;
  }
}
