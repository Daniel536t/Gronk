// Agent orchestrator: the fixed cadence + fallback brain that sits between the
// engine tick loop and the agents. Scripted backends decide synchronously every
// tick (2.5s wizards / engine-owned Gronk). TrueForge backends decide async on
// the same cadence; if they exceed decisionTimeoutMs (default 5s) — or throw —
// the scripted FSM answers instead. Every decision is recorded with latency so
// M4's "how long did agents take" question is answerable from a live match.
import type { Lobby } from "./lobby";
import type { AgentBackend, AgentDecision, AgentView, DecisionRecord } from "./agent";
import {
  BOT_DECISION_SECONDS,
  ScriptedBackend,
  scriptedGronkDecision,
  scriptedWizardDecision,
  toAgentView,
} from "./bots";
import { TICKS_PER_SECOND } from "../engine";

export const GRONK_DECISION_SECONDS = 15; // sniff cadence
export const DEFAULT_DECISION_TIMEOUT_MS = 5000; // >5s -> scripted fallback

export interface AgentRuntimeOptions {
  decisionTimeoutMs?: number;
  fallbackRng?: () => number;
  /** Snapshot the JSON of every payload sent to an agent (secrecy proof). */
  capturePayloads?: boolean;
}

interface Settled {
  decision: AgentDecision;
  latencyMs: number;
  fellBack: boolean;
}

export class AgentRuntime {
  private wizardBackends = new Map<string, AgentBackend>();
  private gronkBackend: AgentBackend | null = null;
  private lastWizardTick = new Map<string, number>();
  private lastGronkTick = -Infinity;
  private inflight = new Set<string>();
  private records: DecisionRecord[] = [];
  private payloads: string[] = [];
  private decisionTimeoutMs: number;
  private fallbackRng: () => number;
  private capturePayloads: boolean;

  constructor(opts: AgentRuntimeOptions = {}) {
    this.decisionTimeoutMs = opts.decisionTimeoutMs ?? DEFAULT_DECISION_TIMEOUT_MS;
    this.fallbackRng = opts.fallbackRng ?? Math.random;
    this.capturePayloads = opts.capturePayloads ?? false;
  }

  setWizard(id: string, backend: AgentBackend): void {
    this.wizardBackends.set(id, backend);
  }

  setGronk(backend: AgentBackend): void {
    this.gronkBackend = backend;
  }

  get wizardCount(): number {
    return this.wizardBackends.size;
  }

  get decisions(): readonly DecisionRecord[] {
    return this.records;
  }

  /** JSON of every AgentView sent to any backend, when capturePayloads is on. */
  get capturedPayloads(): readonly string[] {
    return this.payloads;
  }

  /** Fire due decisions. Scripted backends are applied synchronously so the
   *  tick loop stays deterministic (matters for headless tests); TrueForge
   *  backends are fired async and applied on settlement (or timeout). */
  step(lobby: Lobby): void {
    const s = lobby.engine.state;
    if (s.status !== "playing") return;

    // Gronk is only externally driven when a backend is registered (trueforge).
    if (
      this.gronkBackend &&
      s.tick >= this.lastGronkTick + GRONK_DECISION_SECONDS * TICKS_PER_SECOND
    ) {
      this.lastGronkTick = s.tick;
      this.fire(lobby, "gronk", this.gronkBackend);
    }

    for (const [id, b] of this.wizardBackends) {
      const last = this.lastWizardTick.get(id) ?? -Infinity;
      if (s.tick >= last + BOT_DECISION_SECONDS * TICKS_PER_SECOND) {
        this.lastWizardTick.set(id, s.tick);
        this.fire(lobby, id, b);
      }
    }
  }

  private fire(lobby: Lobby, id: string, backend: AgentBackend): void {
    if (this.inflight.has(id)) return; // previous decision still pending
    const view = toAgentView(lobby.engine.state);
    if (this.capturePayloads) this.payloads.push(JSON.stringify(view));

    // Synchronous backend (scripted): decide + apply inline, zero latency.
    const sync = (backend as unknown as { decideSync?: (v: AgentView) => AgentDecision })
      .decideSync;
    if (typeof sync === "function") {
      const decision = sync.call(backend, view);
      this.record(id, view, decision, 0, "scripted", false);
      this.apply(lobby, id, decision);
      return;
    }

    // Async backend (TrueForge): race the LLM against the timeout; the loser's
    // result is discarded. Either way we apply a decision exactly once.
    this.inflight.add(id);
    const started = Date.now();
    const fallback = this.fallback(id, view);
    const timeout: Promise<Settled> = new Promise((resolve) =>
      setTimeout(
        () => resolve({ decision: fallback, latencyMs: this.decisionTimeoutMs, fellBack: true }),
        this.decisionTimeoutMs,
      ),
    );
    const decided: Promise<Settled> = backend.decide(view).then(
      (decision) => ({ decision, latencyMs: Date.now() - started, fellBack: false }),
      () => ({ decision: fallback, latencyMs: Date.now() - started, fellBack: true }),
    );

    void Promise.race([decided, timeout]).then((settled) => {
      this.record(id, view, settled.decision, settled.latencyMs, "trueforge", settled.fellBack);
      this.apply(lobby, id, settled.decision);
      this.inflight.delete(id);
    });
  }

  private fallback(id: string, view: AgentView): AgentDecision {
    if (id === "gronk") return scriptedGronkDecision(view);
    return scriptedWizardDecision(view, id, this.fallbackRng);
  }

  private apply(lobby: Lobby, id: string, decision: AgentDecision): void {
    if (id === "gronk") {
      // Gronk's HUNT_NEAREST steers the next sniff to a chosen point.
      const pt = resolveGronkPoint(viewOf(lobby), decision);
      if (pt) lobby.engine.steerGronk(pt.x, pt.y);
      lobby.engine.forceSniff(); // agent owns the sniff cadence (externalSniff)
      return;
    }
    lobby.intentExec.setIntent(id, {
      intent: decision.intent,
      targetId: decision.targetId,
      targetX: decision.targetX,
      targetY: decision.targetY,
    });
  }

  private record(
    id: string,
    view: AgentView,
    decision: AgentDecision,
    latencyMs: number,
    backend: "scripted" | "trueforge",
    fellBack: boolean,
  ): void {
    this.records.push({ agentId: id, view, decision, latencyMs, backend, fellBack });
    if (this.records.length > 2000) this.records.shift();
  }
}

/** Resolve a Gronk HUNT_NEAREST decision into a concrete point, using the
 *  same priority the Gronk prompt mandates (noise > stunned > visible) as the
 *  default when the agent doesn't pick a concrete target. */
function resolveGronkPoint(
  view: AgentView,
  decision: AgentDecision,
): { x: number; y: number } | null {
  if (decision.targetX !== undefined && decision.targetY !== undefined) {
    return { x: decision.targetX, y: decision.targetY };
  }
  const t = decision.targetId;
  if (t === "noise" && view.latestNoise) return { x: view.latestNoise.x, y: view.latestNoise.y };
  const byId = view.players.find((p) => p.id === t);
  if (byId) return { x: byId.x, y: byId.y };

  // Fall back to the built-in priority order.
  if (view.latestNoise) return { x: view.latestNoise.x, y: view.latestNoise.y };
  const stunned = view.players.filter((p) => p.state === "stunned");
  const visible = view.players.filter((p) => p.state === "active");
  const pool = stunned.length > 0 ? stunned : visible;
  if (pool.length === 0) return null;
  let best = pool[0];
  let bestD = Infinity;
  for (const p of pool) {
    const d = (p.x - view.gronk.x) ** 2 + (p.y - view.gronk.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return { x: best.x, y: best.y };
}

function viewOf(lobby: Lobby): AgentView {
  return toAgentView(lobby.engine.state);
}

/** Convenience: build a scripted backend for a wizard seat (used by lobby). */
export function scriptedWizardBackend(id: string, rng: () => number): ScriptedBackend {
  return new ScriptedBackend(id, "wizard", rng);
}
