// ASTrix controlled steward execution loop (P0).
//
// Turns the one-shot "return a JSON decision" steward flow into a bounded,
// observable, human-interruptible loop:
//
//   observe -> decide -> propose -> [approval gate] -> execute -> verify -> repeat
//
// Hard rules (from ASTRIX_GAME_AND_AGENT_ARCHITECTURE.md P0):
//   - TrueForge decides/reasons; this loop SAFELY EXECUTES the decision.
//   - Every mutation flows through the existing AstrixGameCommandBus via the
//     existing tool registry — no second mutation system exists here.
//   - The structural approval gate is never weakened: HIGH-risk tools
//     (clear_terrain, build_bridge) are always executed WITHOUT an approval id,
//     so the command bus itself creates the pending approval and blocks until a
//     human resolves it. Agent-supplied approval ids are stripped.
//   - A timeout is NEVER interpreted as approval. The loop pauses indefinitely
//     at the gate until an explicit approve/reject (or stop()).
//   - Failed/timeout actions are never blindly retried; the loop only executes
//     what the provider proposes, exactly once per proposal.
//   - Bounded: maxTurnsPerRun and maxActionsPerTurn caps; an idle turn
//     (no actions executed) ends the run naturally.
import type { AstrixGameCommandBus, AstrixCommandResult } from "./commandBus";
import { AstrixEventLog, type AstrixAgentEventType } from "./events";
import { ASTRIX_TOOL_NAMES, type AstrixToolRegistry } from "./mcpTools";
import type { AstrixApproval, AstrixPosition, AstrixWorldState } from "./state";

export type LoopState =
  | "IDLE"
  | "RUNNING"
  | "AWAITING_APPROVAL"
  | "COMPLETED"
  | "STOPPED"
  | "FAILED";

export type RiskLevel = "low" | "medium" | "high";
export type ApprovalState = "not_required" | "pending" | "granted" | "rejected";
export type ExecutionState =
  | "PROPOSED"
  | "EXECUTING"
  | "AWAITING_APPROVAL"
  | "SUCCEEDED"
  | "FAILED"
  | "REJECTED"
  | "SKIPPED";
export type VerificationState = "PENDING" | "VERIFIED" | "VERIFICATION_FAILED" | "NOT_VERIFIED";

/** Every action the steward proposes, tracked through its full lifecycle. */
export interface AstrixActionRecord {
  id: string;
  turn: number;
  agent: string;
  tool: string;
  args: Record<string, unknown>;
  riskLevel: RiskLevel;
  approvalRequired: boolean;
  approvalId?: string;
  approvalState: ApprovalState;
  executionState: ExecutionState;
  result?: unknown;
  verificationState: VerificationState;
  error?: string;
  createdAt: number;
  executedAt?: number;
  verifiedAt?: number;
}

export interface StewardToolCall {
  tool: string;
  args: Record<string, unknown>;
}

/** A decision produced by the reasoning layer (TrueForge in production). */
export interface StewardDecision {
  decision: string;
  recommendation?: string;
  reasoning?: string;
  /** Informational only — the command bus gate is the authority. */
  approvalRequired?: boolean;
  toolCalls: StewardToolCall[];
}

/** Everything the loop hands the reasoning layer before it decides. */
export interface StewardRunContext {
  turn: number;
  objective?: string;
  snapshot: ReturnType<AstrixWorldState["snapshot"]>;
  /** Every action of the current run (agent memory: what did I attempt?). */
  history: readonly AstrixActionRecord[];
  /** Compact summary of the previous turn's outcomes. */
  lastOutcome?: string;
  /** Set on a retry after a parse failure: tells the provider to re-emphasize
   *  the strict JSON contract (the previous decision was discarded unexecuted). */
  retryHint?: string;
}

export interface StewardDecisionProvider {
  readonly id: string;
  decide(context: StewardRunContext): Promise<StewardDecision>;
}

export interface AstrixStewardLoopOptions {
  state: AstrixWorldState;
  bus: AstrixGameCommandBus;
  tools: AstrixToolRegistry;
  events: AstrixEventLog;
  provider?: StewardDecisionProvider;
  maxTurnsPerRun?: number;
  maxActionsPerTurn?: number;
  decideTimeoutMs?: number;
}

export interface LoopStartResult {
  ok: boolean;
  error?: string;
}

type ApprovalOutcome = "granted" | "rejected" | "stopped";

const DEFAULT_MAX_TURNS = 5;
const DEFAULT_MAX_ACTIONS_PER_TURN = 10;
const DEFAULT_DECIDE_TIMEOUT_MS = 60_000;

/** Tools that never mutate the world (no verification applies). */
const READ_ONLY_TOOLS = new Set(["inspect_world", "inspect_island", "inspect_resources", "inspect_buildings", "simulate_plan"]);
/** Tools whose execution is structurally approval-gated by the command bus. */
const HIGH_RISK_TOOLS = new Set(["clear_terrain", "build_bridge"]);
/** Keys an agent must never control (the gate is server-side, automatic). */
const FORBIDDEN_ARG_KEYS = new Set(["approval_id", "approvalId"]);

function riskOf(tool: string): RiskLevel {
  if (HIGH_RISK_TOOLS.has(tool)) return "high";
  if (READ_ONLY_TOOLS.has(tool)) return "low";
  return "medium";
}

export class AstrixStewardLoop {
  private _state: LoopState = "IDLE";
  private _turn = 0;
  private _objective?: string;
  private _actions: AstrixActionRecord[] = [];
  private _pendingApproval: PendingApproval | null = null;
  private _stopped = false;
  private _stopReason: string | null = null;
  private _startedAt: number | null = null;
  private _lastOutcome?: string;
  private _runError?: string;
  private _runPromise: Promise<void> | null = null;
  private _approvalWaiter: ((outcome: ApprovalOutcome) => void) | null = null;
  private _actionSeq = 0;

  private readonly maxTurns: number;
  private readonly maxActionsPerTurn: number;
  private readonly decideTimeoutMs: number;

  constructor(private readonly opts: AstrixStewardLoopOptions) {
    this.maxTurns = opts.maxTurnsPerRun ?? DEFAULT_MAX_TURNS;
    this.maxActionsPerTurn = opts.maxActionsPerTurn ?? DEFAULT_MAX_ACTIONS_PER_TURN;
    this.decideTimeoutMs = opts.decideTimeoutMs ?? DEFAULT_DECIDE_TIMEOUT_MS;
  }

  get state(): LoopState {
    return this._state;
  }

  get turn(): number {
    return this._turn;
  }

  get objective(): string | undefined {
    return this._objective;
  }

  get actions(): readonly AstrixActionRecord[] {
    return this._actions;
  }

  get pendingApproval(): PendingApproval | null {
    return this._pendingApproval;
  }

  get error(): string | undefined {
    return this._runError;
  }

  get providerId(): string {
    return this.opts.provider?.id ?? "(none)";
  }

  /** The most recent action that has not reached a terminal state, if any. */
  get currentAction(): AstrixActionRecord | null {
    const active = this._actions.filter(
      (a) => a.executionState === "PROPOSED" || a.executionState === "EXECUTING" || a.executionState === "AWAITING_APPROVAL",
    );
    return active.length > 0 ? active[active.length - 1] : null;
  }

  /** True while the loop is actively working or paused at the approval gate. */
  isRunning(): boolean {
    return this._state === "RUNNING" || this._state === "AWAITING_APPROVAL";
  }

  /** Resolves when the current run settles (completed/stopped/failed). */
  whenSettled(): Promise<void> {
    return this._runPromise ?? Promise.resolve();
  }

  /** Begin a bounded run. Returns immediately; the loop runs in the background. */
  start(objective?: string): LoopStartResult {
    if (this.isRunning()) return { ok: false, error: "steward loop is already running" };
    if (!this.opts.provider) return { ok: false, error: "no steward provider configured" };
    this._objective = objective?.trim() ? objective.trim() : undefined;
    this._turn = 0;
    this._actions = [];
    this._pendingApproval = null;
    this._stopped = false;
    this._stopReason = null;
    this._lastOutcome = undefined;
    this._runError = undefined;
    this._actionSeq = 0;
    this._state = "RUNNING";
    this._startedAt = Date.now();
    this._runPromise = this.run();
    // run() catches everything internally, so this cannot reject unhandled.
    void this._runPromise;
    return { ok: true };
  }

  /** Request the loop to stop. Takes effect at the next loop boundary.
   *
   * The optional reason is recorded and surfaced in status() — revocation
   * ("authority-revoked") is a stop with an explicit governance reason, not a
   * separate code path: the same boundary checks, gate wake-up, and
   * no-partial-mutation guarantees apply. A later start() clears the reason
   * (restarting is itself a fresh, explicit authorization).
   */
  stop(reason = "stopped"): LoopStartResult {
    if (!this.isRunning()) return { ok: false, error: "steward loop is not running" };
    this._stopped = true;
    this._stopReason = reason;
    if (this._state === "AWAITING_APPROVAL") this.wake("stopped");
    return { ok: true };
  }

  /**
   * Resolve a pending approval through the command bus. This is the ONLY path
   * that consumes an approval: it delegates to bus.resolveApproval (which
   * executes the stored irreversible command on approve), records the outcome
   * on the awaiting action, and resumes a paused loop on approve/reject.
   * Timeout is never treated as approval — the loop stays paused otherwise.
   */
  resolveApproval(approvalId: string, decision: "approve" | "reject"): AstrixCommandResult {
    const result = this.opts.bus.resolveApproval(approvalId, decision);
    const waiter = this._pendingApproval;
    if (waiter && waiter.approvalId === approvalId) {
      const action = waiter.action;
      action.result = result;
      this._pendingApproval = null;
      if (decision === "reject") {
        action.approvalState = "rejected";
        action.executionState = "REJECTED";
        action.verificationState = "NOT_VERIFIED";
        this.wake("rejected");
      } else {
        action.approvalState = "granted";
        action.executionState = result.success ? "SUCCEEDED" : "FAILED";
        if (!result.success) action.error = result.error ?? "approved action failed";
        this.wake("granted");
      }
    }
    return result;
  }

  /** Structured status for GET /astrix/agent/status. */
  status(): Record<string, unknown> {
    const pending = this._pendingApproval
      ? summarizePendingApproval(this._pendingApproval)
      : null;
    return {
      state: this._state,
      turn: this._turn,
      objective: this._objective,
      provider: this.providerId,
      stopReason: this._stopReason,
      pendingApproval: pending,
      currentAction: this.currentAction ? summarizeAction(this.currentAction) : null,
      actions: this._actions.slice(-10).map(summarizeAction),
      lastEvents: this.opts.events.recent(8),
      startedAt: this._startedAt,
      updatedAt: Date.now(),
      error: this._runError ?? null,
    };
  }

  // ---- internals ----------------------------------------------------------

  private async run(): Promise<void> {
    try {
      while (this._state === "RUNNING" && !this._stopped && this._turn < this.maxTurns) {
        this._turn += 1;
        const turn = this._turn;
        this.emit("TURN_STARTED", { turn, objective: this._objective });
        const snapshot = this.opts.state.snapshot();
        this.emit("WORLD_OBSERVED", {
          turn,
          day: snapshot.day,
          season: snapshot.season,
          daysUntilWinter: snapshot.daysUntilWinter,
          time: snapshot.time,
          population: snapshot.population,
          food: snapshot.food,
          foodSecurity: snapshot.foodSecurity,
          foodPerDay: snapshot.foodPerDay,
          daysOfFoodRemaining: snapshot.daysOfFoodRemaining,
          harvestableFood: snapshot.harvestableFood,
          growingFood: snapshot.growingFood,
          daysUntilNextHarvest: snapshot.daysUntilNextHarvest,
          projectedFoodAtWinter: snapshot.projectedFoodAtWinter,
          foodPressureLevel: snapshot.foodPressureLevel,
          resources: snapshot.resources,
          farmland: snapshot.farmland,
          crops: snapshot.crops.map((c) => ({
            id: c.id,
            farmPlotId: c.farmPlotId,
            cropType: c.cropType,
            growth: Math.round(c.growthStage * 100),
            harvestable: c.harvestable,
          })),
        });

        // Decision lifecycle observability: DECISION_STARTED -> DECISION_COMPLETED
        // with durationMs and a failureKind so MODEL LATENCY (timeout), PARSING
        // FAILURE, and PROVIDER FAILURE are distinguishable in the event log.
        const decidedAt = Date.now();
        this.emit("DECISION_STARTED", { turn, provider: this.providerId, timeoutMs: this.decideTimeoutMs });
        let decision: StewardDecision | null = null;
        let decisionError: Error | null = null;
        try {
          decision = await this.decideWithTimeout({
            turn,
            objective: this._objective,
            snapshot,
            history: this._actions,
            lastOutcome: this._lastOutcome,
          });
          this.emit("DECISION_COMPLETED", {
            turn,
            provider: this.providerId,
            durationMs: Date.now() - decidedAt,
            ok: true,
            toolCallCount: Array.isArray(decision.toolCalls) ? decision.toolCalls.length : 0,
            failureKind: null,
          });
        } catch (error) {
          const message = (error as Error).message;
          const durationMs = Date.now() - decidedAt;
          const failureKind = message.includes("timed out") ? "timeout" : message.includes("no parseable decision") ? "parse" : "provider";
          // Bounded retry: exactly ONE extra attempt for PARSING failures only
          // (the discarded decision was never executed, so no mutation can be
          // duplicated). Timeouts and provider failures are NOT retried — the
          // mission requires no blind retry of potentially non-idempotent work.
          if (failureKind === "parse") {
            const retryAt = Date.now();
            // Record the failed first attempt, then the retry, then its outcome
            // — the full decision lifecycle stays reconstructable.
            this.emit("DECISION_COMPLETED", {
              turn,
              provider: this.providerId,
              durationMs,
              ok: false,
              failureKind,
              error: message,
            });
            this.emit("DECISION_RETRY", {
              turn,
              provider: this.providerId,
              attempt: 2,
              firstFailureKind: failureKind,
              firstError: message,
              firstDurationMs: durationMs,
            });
            try {
              decision = await this.decideWithTimeout({
                turn,
                objective: this._objective,
                snapshot,
                history: this._actions,
                lastOutcome: this._lastOutcome,
                retryHint: "Your previous response was discarded because it was not a single JSON object with the required fields. Return ONLY the JSON contract object described above, nothing else, no prose, no markdown fences.",
              });
              this.emit("DECISION_COMPLETED", {
                turn,
                provider: this.providerId,
                durationMs: Date.now() - retryAt,
                ok: true,
                retriedAfter: "parse",
                toolCallCount: Array.isArray(decision.toolCalls) ? decision.toolCalls.length : 0,
                failureKind: null,
              });
            } catch (retryError) {
              const retryMessage = (retryError as Error).message;
              const retryKind = retryMessage.includes("timed out") ? "timeout" : retryMessage.includes("no parseable decision") ? "parse" : "provider";
              this.emit("DECISION_COMPLETED", {
                turn,
                provider: this.providerId,
                durationMs: Date.now() - retryAt,
                ok: false,
                retriedAfter: "parse",
                failureKind: retryKind,
                error: retryMessage,
              });
              decisionError = retryError as Error;
            }
          } else {
            // Non-retryable failure (timeout / provider): record it and fail.
            decisionError = error as Error;
            this.emit("DECISION_COMPLETED", {
              turn,
              provider: this.providerId,
              durationMs,
              ok: false,
              failureKind,
              error: message,
            });
          }
        }
        if (decisionError) {
          const message = decisionError.message;
          const failureKind = message.includes("timed out") ? "timeout" : message.includes("no parseable decision") ? "parse" : "provider";
          this._runError = `steward decision failed: ${message}`;
          this.emit("TURN_FAILED", {
            turn,
            error: this._runError,
            decisionDurationMs: Date.now() - decidedAt,
            decisionFailureKind: failureKind,
          });
          this._state = "FAILED";
          return;
        }

        // decisionError non-null always returns above, so `decision` is assigned
        // here (either in the primary attempt or the bounded parse retry).
        const decided: StewardDecision = decision!;
        this.emit("PLAN_CREATED", {
          turn,
          decision: decided.decision,
          recommendation: decided.recommendation,
          toolCallCount: Array.isArray(decided.toolCalls) ? decided.toolCalls.length : 0,
        });

        const calls = Array.isArray(decided.toolCalls) ? decided.toolCalls : [];
        let acted = 0;
        for (const call of calls) {
          if (this._stopped) break;
          if (acted >= this.maxActionsPerTurn) break; // bounded tool calls per turn
          acted += 1;
          const record = this.propose(turn, call);
          if (record.executionState === "SKIPPED") continue; // unknown tool: recorded, never executed
          if (record.riskLevel === "high") {
            const outcome = await this.runApprovalGated(record);
            if (outcome === "stopped") {
              this._state = "STOPPED";
              return;
            }
          } else {
            await this.runSafe(record);
          }
        }

        this._lastOutcome = summarizeOutcome(this._actions, turn);
        // actionsExecuted counts actions that actually EXECUTED (SUCCEEDED),
        // never mere attempts: SKIPPED/FAILED/REJECTED records are real
        // outcomes of the turn but claiming them as executed would be a false
        // whole-turn-success signal to anyone reading the event log.
        const executedThisTurn = this._actions.filter(
          (a) => a.turn === turn && a.executionState === "SUCCEEDED",
        ).length;
        this.emit("TURN_COMPLETED", { turn, actionsExecuted: executedThisTurn });
        if (acted === 0) break; // idle turn — the steward has nothing to do
      }
      this._state = this._stopped ? "STOPPED" : "COMPLETED";
    } catch (error) {
      this._runError = (error as Error).message;
      this.emit("TURN_FAILED", { error: this._runError });
      this._state = "FAILED";
    }
  }

  private async decideWithTimeout(context: StewardRunContext): Promise<StewardDecision> {
    const provider = this.opts.provider!;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`steward decision timed out after ${this.decideTimeoutMs}ms`)),
        this.decideTimeoutMs,
      );
    });
    try {
      return await Promise.race([provider.decide(context), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Validate a proposed tool call, record it, and emit ACTION_PROPOSED. */
  private propose(turn: number, call: StewardToolCall): AstrixActionRecord {
    const tool = typeof call?.tool === "string" ? call.tool : "";
    const args =
      call && typeof call.args === "object" && call.args !== null && !Array.isArray(call.args)
        ? { ...call.args }
        : {};
    const record: AstrixActionRecord = {
      id: `act-${String(++this._actionSeq).padStart(3, "0")}`,
      turn,
      agent: "steward",
      tool,
      args,
      riskLevel: riskOf(tool),
      approvalRequired: HIGH_RISK_TOOLS.has(tool),
      approvalState: "not_required",
      executionState: "PROPOSED",
      verificationState: "PENDING",
      createdAt: Date.now(),
    };
    this._actions.push(record);

    if (!ASTRIX_TOOL_NAMES.includes(tool as (typeof ASTRIX_TOOL_NAMES)[number])) {
      record.executionState = "SKIPPED";
      record.verificationState = "NOT_VERIFIED";
      record.error = `unknown tool: ${tool || "(empty)"}`;
      this.emit("ACTION_PROPOSED", { actionId: record.id, tool, risk: record.riskLevel });
      this.emit("ACTION_FAILED", { actionId: record.id, tool, error: record.error });
      return record;
    }

    this.emit("ACTION_PROPOSED", {
      actionId: record.id,
      tool,
      risk: record.riskLevel,
      approvalRequired: record.approvalRequired,
    });
    return record;
  }

  /** Execute a non-gated (low/medium risk) action through the tool registry. */
  private async runSafe(record: AstrixActionRecord): Promise<void> {
    this.emit("ACTION_EXECUTING", { actionId: record.id, tool: record.tool });
    record.executionState = "EXECUTING";
    const before = this.opts.state.snapshot();
    try {
      const result = await this.opts.tools.callTool(record.tool, sanitizeArgs(record.args));
      record.result = result;
      record.executedAt = Date.now();
      const readOnly = READ_ONLY_TOOLS.has(record.tool);
      const success = readOnly || (isRecord(result) && result.success === true);
      if (success) {
        record.executionState = "SUCCEEDED";
        this.emit("ACTION_SUCCEEDED", { actionId: record.id, tool: record.tool });
        this.verify(record, before);
      } else {
        record.executionState = "FAILED";
        record.error = String(isRecord(result) ? result.error ?? "command failed" : "command failed");
        record.verificationState = "NOT_VERIFIED";
        this.emit("ACTION_FAILED", { actionId: record.id, tool: record.tool, error: record.error });
      }
    } catch (error) {
      record.executionState = "FAILED";
      record.error = (error as Error).message;
      record.verificationState = "NOT_VERIFIED";
      this.emit("ACTION_FAILED", { actionId: record.id, tool: record.tool, error: record.error });
    }
  }

  /**
   * Execute a HIGH-risk action through the tool registry WITHOUT an approval id
   * so the command bus itself raises the gate. Pauses (AWAITING_APPROVAL) until
   * the human resolves the approval; resumes only on an explicit decision.
   */
  private async runApprovalGated(record: AstrixActionRecord): Promise<ApprovalOutcome> {
    this.emit("ACTION_EXECUTING", { actionId: record.id, tool: record.tool });
    record.executionState = "EXECUTING";
    const before = this.opts.state.snapshot();
    let result: unknown;
    try {
      result = await this.opts.tools.callTool(record.tool, sanitizeArgs(record.args));
    } catch (error) {
      record.executionState = "FAILED";
      record.error = (error as Error).message;
      record.verificationState = "NOT_VERIFIED";
      this.emit("ACTION_FAILED", { actionId: record.id, tool: record.tool, error: record.error });
      return "rejected";
    }
    record.result = result;
    record.executedAt = Date.now();

    const pending = isRecord(result) ? result.pendingApproval : undefined;
    if (isRecord(result) && result.success === true) {
      // The bus allowed execution without a gate (should not happen for these
      // tools, but handle it defensively without weakening the gate).
      record.executionState = "SUCCEEDED";
      this.emit("ACTION_SUCCEEDED", { actionId: record.id, tool: record.tool });
      this.verify(record, before);
      return "granted";
    }
    if (!pending || typeof pending.id !== "string") {
      record.executionState = "FAILED";
      record.error = String(isRecord(result) ? result.error ?? "command failed" : "command failed");
      record.verificationState = "NOT_VERIFIED";
      this.emit("ACTION_FAILED", { actionId: record.id, tool: record.tool, error: record.error });
      return "rejected";
    }

    // The command bus created a pending approval: the loop pauses here.
    record.approvalState = "pending";
    record.approvalId = pending.id;
    record.executionState = "AWAITING_APPROVAL";
    // Keep the bus's own approval record: status() renders the human-facing
    // proposal from it, so the approver reads the SAME data the bus will replay.
    this._pendingApproval = { approvalId: pending.id, action: record, approval: pending as unknown as AstrixApproval };
    this._state = "AWAITING_APPROVAL";
    this.emit("APPROVAL_REQUIRED", {
      actionId: record.id,
      tool: record.tool,
      approval: pending,
    });

    const outcome = await this.awaitApproval(pending.id);
    this._state = this._stopped ? "STOPPED" : "RUNNING";
    if (outcome === "stopped") return "stopped";

    if (outcome === "rejected") {
      this.emit("APPROVAL_REJECTED", { actionId: record.id, approvalId: pending.id });
      return "rejected";
    }

    this.emit("APPROVAL_GRANTED", { actionId: record.id, approvalId: pending.id });
    // resolveApproval already applied the bus outcome to the record.
    if (isRecord(record.result) && record.result.success === true) {
      this.emit("ACTION_SUCCEEDED", { actionId: record.id, tool: record.tool });
      this.verify(record, before);
    } else {
      this.emit("ACTION_FAILED", { actionId: record.id, tool: record.tool, error: record.error ?? "approved action failed" });
    }
    return "granted";
  }

  /** Wait for an explicit approval decision (or stop). Never auto-approves. */
  private awaitApproval(approvalId: string): Promise<ApprovalOutcome> {
    return new Promise<ApprovalOutcome>((resolve) => {
      this._approvalWaiter = (outcome) => resolve(outcome);
      if (this._stopped) {
        this._approvalWaiter = null;
        resolve("stopped");
      }
    });
  }

  private wake(outcome: ApprovalOutcome): void {
    const waiter = this._approvalWaiter;
    this._approvalWaiter = null;
    if (waiter) waiter(outcome);
  }

  /** Verify a successful mutation against the authoritative world. */
  private verify(record: AstrixActionRecord, before: ReturnType<AstrixWorldState["snapshot"]>): void {
    if (READ_ONLY_TOOLS.has(record.tool)) {
      record.verificationState = "NOT_VERIFIED";
      return;
    }
    this.emit("VERIFICATION_STARTED", { actionId: record.id, tool: record.tool });
    let ok = false;
    try {
      ok = this.checkVerification(record, before);
    } catch {
      ok = false;
    }
    record.verifiedAt = Date.now();
    if (ok) {
      record.verificationState = "VERIFIED";
      this.emit("VERIFICATION_SUCCEEDED", { actionId: record.id, tool: record.tool });
    } else {
      record.verificationState = "VERIFICATION_FAILED";
      this.emit("VERIFICATION_FAILED", { actionId: record.id, tool: record.tool });
    }
  }

  /** Evidence-based verification: the world must actually reflect the action. */
  protected checkVerification(record: AstrixActionRecord, before: ReturnType<AstrixWorldState["snapshot"]>): boolean {
    const snap = this.opts.state.snapshot();
    const result = isRecord(record.result) ? record.result : {};
    switch (record.tool) {
      case "build": {
        const id = typeof result.buildingId === "string" ? result.buildingId : undefined;
        return typeof id === "string" && snap.buildings.some((b) => b.id === id);
      }
      case "build_bridge": {
        const id = typeof result.bridgeId === "string" ? result.bridgeId : undefined;
        return typeof id === "string" && snap.bridges.some((b) => b.id === id);
      }
      case "plant": {
        const id = typeof result.cropId === "string" ? result.cropId : undefined;
        return typeof id === "string" && snap.crops.some((c) => c.id === id);
      }
      case "harvest": {
        const cropId = typeof result.cropId === "string" ? result.cropId : undefined;
        const gained = typeof result.foodGained === "number" ? result.foodGained : 0;
        if (!cropId || gained <= 0) return false;
        const existed = before.crops.some((c) => c.id === cropId);
        const removed = !snap.crops.some((c) => c.id === cropId);
        const foodDelta = (snap.resources.food ?? 0) - (before.resources.food ?? 0);
        return existed && removed && foodDelta === gained;
      }
      case "gather": {
        const nodeId = typeof result.resourceId === "string" ? result.resourceId : undefined;
        const gathered = typeof result.gathered === "number" ? result.gathered : 0;
        const beforeNode = nodeId ? before.resourceNodes.find((n) => n.id === nodeId) : undefined;
        const afterNode = nodeId ? snap.resourceNodes.find((n) => n.id === nodeId) : undefined;
        if (beforeNode && afterNode) return afterNode.quantity === beforeNode.quantity - gathered;
        if (beforeNode && !afterNode) return beforeNode.quantity - gathered <= 0; // node fully depleted
        const type = typeof result.resourceType === "string" ? result.resourceType : undefined;
        if (type && gathered > 0) {
          return (snap.resources[type as keyof typeof snap.resources] ?? 0) >= (before.resources[type as keyof typeof before.resources] ?? 0);
        }
        return false;
      }
      case "clear_terrain": {
        if (result.success !== true || result.permanent !== true) return false;
        const position = asPosition(record.args.position);
        const radius = typeof record.args.radius === "number" ? record.args.radius : 1;
        if (position) {
          const remaining = snap.resourceNodes.filter((n) => distance(n.position, position) <= radius);
          return remaining.length === 0;
        }
        return typeof result.treesCleared === "number" && result.treesCleared >= 0;
      }
      default:
        return true; // defensive: unknown mutating tool — nothing to check
    }
  }

  private emit(type: AstrixAgentEventType, data: Record<string, unknown> = {}): void {
    this.opts.events.record({
      type,
      turn: this._turn,
      actionId: typeof data.actionId === "string" ? data.actionId : undefined,
      data,
    });
  }
}

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (!FORBIDDEN_ARG_KEYS.has(key)) out[key] = value;
  }
  return out;
}

/** What the loop is blocked on: the action, plus the bus's approval record. */
export interface PendingApproval {
  approvalId: string;
  action: AstrixActionRecord;
  /** The command bus's own approval record (null only for legacy callers). */
  approval: AstrixApproval | null;
}

/**
 * Everything a human needs in order to authorize an irreversible mutation,
 * flattened so no reader has to dig through nested impact blocks: what the
 * command is, which islands it joins, what it costs, whether it can be undone,
 * what topology results, and which action/turn is blocked on the answer.
 *
 * The `approvalId` here is the SERVER's id, surfaced for the human to quote
 * back. It is never sourced from agent args -- sanitizeArgs strips
 * approval_id/approvalId before they are shown or replayed.
 */
function summarizePendingApproval(pending: PendingApproval): Record<string, unknown> {
  const action = pending.action;
  const impact = pending.approval?.impact ?? {};
  const args = sanitizeArgs(action.args);
  const pick = (...keys: string[]): unknown => {
    for (const key of keys) {
      if (impact[key] !== undefined) return impact[key];
      if (args[key] !== undefined) return args[key];
    }
    return null;
  };
  return {
    approvalId: pending.approvalId,
    actionId: action.id,
    turn: action.turn,
    agent: action.agent,
    tool: action.tool,
    command: pending.approval?.command ?? null,
    reason: pending.approval?.reason ?? null,
    riskLevel: action.riskLevel,
    approvalRequired: action.approvalRequired,
    sourceIsland: pick("islandA", "island_a", "from"),
    destinationIsland: pick("islandB", "island_b", "to"),
    position: pick("bridgePosition", "position"),
    cost: impact.cost ?? null,
    irreversible: impact.irreversible ?? true,
    permanent: impact.permanent ?? true,
    resultingTopology: impact.resultingTopology ?? null,
    unlocks: impact.unlocks ?? null,
    impact,
    args,
    requestedAt: pending.approval?.createdAt ?? action.createdAt,
    action: summarizeAction(action),
  };
}

function summarizeAction(action: AstrixActionRecord): Record<string, unknown> {
  return {
    id: action.id,
    turn: action.turn,
    agent: action.agent,
    tool: action.tool,
    // The args are WHY an action exists; without them a build_bridge record
    // reads as "build_bridge null". Sanitized so an agent-supplied approval id
    // can never travel to a human as if it were the server's authorization.
    args: sanitizeArgs(action.args),
    riskLevel: action.riskLevel,
    approvalRequired: action.approvalRequired,
    approvalId: action.approvalId ?? null,
    approvalState: action.approvalState,
    executionState: action.executionState,
    verificationState: action.verificationState,
    error: action.error ?? null,
    createdAt: action.createdAt,
  };
}

/** Compact "what did I attempt / what happened / was it approved / did the world change?" memory. */
function summarizeOutcome(actions: readonly AstrixActionRecord[], turn: number): string {
  const lines = actions
    .filter((a) => a.turn === turn)
    .map((a) => {
      const approved =
        a.approvalState === "granted" ? " approved" : a.approvalState === "rejected" ? " rejected" : "";
      const verified =
        a.verificationState === "VERIFIED" ? " verified"
        : a.verificationState === "VERIFICATION_FAILED" ? " verification_failed"
        : a.verificationState === "NOT_VERIFIED" ? "" : "";
      const state = a.executionState === "SUCCEEDED" ? "succeeded" : a.executionState;
      return `  - ${a.tool} -> ${state}${approved}${verified}${a.error ? ` (${a.error})` : ""}`;
    });
  return lines.length > 0 ? `Turn ${turn}:\n${lines.join("\n")}` : `Turn ${turn}: no actions executed`;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asPosition(value: unknown): AstrixPosition | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.x !== "number" || typeof value.y !== "number" || typeof value.z !== "number") return undefined;
  return { x: value.x, y: value.y, z: value.z };
}

function distance(a: AstrixPosition, b: AstrixPosition): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
