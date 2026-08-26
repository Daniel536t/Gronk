// Agent decision seam. Both the scripted FSM (permanent fallback) and the
// TrueForge backend (M4) produce the same AgentDecision, and the orchestrator
// applies it to the engine through the public API only. This is the single
// point where a bot "thinks", so latency/timeouts are measured here.
import type { AgentIntentType } from "./intents";

/** Everything an agent may learn from public state. Deliberately the SAME data
 *  get_state returns — no secret, no hidden extras. */
export interface AgentView {
  tick: number;
  elapsed: number;
  enraged: boolean;
  suddenDeath: boolean;
  riddleSet: number;
  visibleRiddleLines: string[];
  players: {
    id: string;
    team: number;
    x: number;
    y: number;
    state: string;
    carrying: boolean;
    transformedAs: string | null;
  }[];
  furniture: { id: string; name: string; x: number; y: number }[];
  gronk: { x: number; y: number; enraged: boolean };
  pedestals: { x: number; y: number }[];
  groundTreasure: { x: number; y: number } | null;
  latestNoise: { x: number; y: number; tick: number } | null;
}

/** One high-level choice: a persistent intent (+ optional target). */
export interface AgentDecision {
  intent: AgentIntentType;
  targetId?: string;
  targetX?: number;
  targetY?: number;
}

/** An agent backend turns an AgentView into an AgentDecision. Implementations
 *  may be slow (LLM) or fast (FSM) — the orchestrator enforces a timeout. */
export interface AgentBackend {
  readonly id: string;
  decide(view: AgentView): Promise<AgentDecision>;
}

/** Result envelope so the orchestrator can log latency per decision. */
export interface DecisionRecord {
  agentId: string;
  view: AgentView;
  decision: AgentDecision | null;
  latencyMs: number;
  backend: "scripted" | "trueforge";
  fellBack: boolean; // true when the LLM timed out and the FSM answered
}
