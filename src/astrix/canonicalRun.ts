// ASTrix canonical run — the deterministic Core scenario, as a library.
//
// This is the Part XII canonical demonstration: a reproducible 30-day run of the
// REAL ASTrix Core with no TrueForge involvement. It is exposed as a function
// (not just a script) so the integration test and the evidence generator drive
// exactly the same code path.
//
// What is real here:
//   - AstrixWorldState        : the authoritative world (seasons, crops, food,
//                               population, farmland, connectivity)
//   - AstrixGameCommandBus    : the single mutation boundary
//   - createAstrixToolRegistry: the same tool surface MCP/HTTP expose
//   - AstrixStewardLoop       : observe -> decide -> propose -> gate -> execute
//                               -> verify, with the structural approval gate
//   - LocalStewardProvider    : the in-process reasoning layer (no network)
//   - AstrixEventLog          : the lifecycle record
//
// What this module adds for determinism ONLY:
//   - an explicit clock: days advance by calling state.tick(DAY_SECONDS) between
//     steward runs instead of by wall-clock interval, so a run is reproducible
//   - a deterministic HUMAN policy (see HumanApprovalPolicy) so approve/reject
//     decisions are reproducible instead of interactive
//
// It does NOT script the steward, invent events, or pre-decide outcomes: what
// the steward proposes on each day is whatever the policy derives from the
// authoritative snapshot at that moment.
import { AstrixGameCommandBus } from "./commandBus";
import { AstrixEventLog, type AstrixAgentEvent } from "./events";
import { LocalStewardProvider } from "./localRuntime";
import { createAstrixToolRegistry } from "./mcpTools";
import { AstrixStewardLoop, type AstrixActionRecord } from "./orchestrator";
import { AstrixWorldState, DAY_SECONDS, type AstrixStateSnapshot } from "./state";

export interface CanonicalRunOptions {
  /** Simulated days to run. */
  days?: number;
  /** Recorded in the artifact so a run is identifiable/reproducible. */
  seed?: string;
  /** Loop bounds per day (the loop's own caps still apply). */
  maxTurnsPerRun?: number;
  maxActionsPerTurn?: number;
  /** Deterministic human policy at the approval gate. */
  humanPolicy?: HumanApprovalPolicy;
}

/**
 * The deterministic stand-in for the human Overseer.
 *
 * Default policy — REJECT THE FIRST irreversible request, APPROVE the rest:
 * this is the smallest policy that exercises both governance branches in one
 * run and forces the steward to visibly adapt after a refusal. The decision is
 * a pure function of (index, tool), so it is reproducible without scripting the
 * agent: WHICH action arrives at the gate, and on which day, is entirely the
 * steward's doing.
 */
export type HumanApprovalPolicy = (request: {
  index: number;
  tool: string;
  day: number;
  approvalId: string;
}) => "approve" | "reject";

export const rejectFirstThenApprove: HumanApprovalPolicy = ({ index }) =>
  index === 0 ? "reject" : "approve";

export const DEFAULT_CANONICAL_OPTIONS = {
  days: 30,
  seed: "astrix-canonical-v1",
  maxTurnsPerRun: 4,
  maxActionsPerTurn: 6,
} as const;

// ---- artifact shape --------------------------------------------------------

export interface CanonicalStateFrame {
  day: number;
  season: string;
  time: string;
  population: number;
  food: number;
  foodPerDay: number;
  daysOfFoodRemaining: number;
  foodPressureLevel: string;
  harvestableFood: number;
  growingFood: number;
  /** Days until the soonest possible harvest; null when nothing can mature (Winter). */
  daysUntilNextHarvest: number | null;
  projectedFoodAtWinter: number;
  resources: Record<string, number>;
  farms: number;
  crops: number;
  bridges: number;
  resourceNodes: number;
  farmland: Array<{ islandId: string; capacity: number; used: number; available: number }>;
  biomeHealth: Record<string, number>;
}

export interface CanonicalDecision {
  day: number;
  season: string;
  turn: number;
  /** One-line decision from the steward (observable, not chain-of-thought). */
  decision: string;
  recommendation?: string;
  /** Concise rationale derived from authoritative facts. */
  rationale?: string;
  toolCalls: Array<{ tool: string; args: Record<string, unknown> }>;
}

export interface CanonicalApproval {
  approvalId: string;
  day: number;
  tool: string;
  args: Record<string, unknown>;
  risk: string;
  reason: string;
  impact: Record<string, unknown>;
  humanDecision: "approve" | "reject";
  executed: boolean;
  verified: boolean;
  /** Proof the gate held: state fingerprint before the decision vs after. */
  worldBefore: { resourceNodes: number; wood: number; biomeHealthMeadow: number; bridges: number };
  worldAfter: { resourceNodes: number; wood: number; biomeHealthMeadow: number; bridges: number };
  mutated: boolean;
}

export interface CanonicalAdaptation {
  day: number;
  /** The proposal the human refused. */
  rejectedProposal: { tool: string; args: Record<string, unknown> };
  /** What the steward proposed afterwards instead. */
  nextProposal: { tool: string; args: Record<string, unknown> } | null;
  changed: boolean;
  note: string;
}

export interface CanonicalActionRecord {
  day: number;
  turn: number;
  actionId: string;
  tool: string;
  args: Record<string, unknown>;
  risk: string;
  approvalRequired: boolean;
  approvalState: string;
  executionState: string;
  verificationState: string;
  error?: string;
}

export interface CanonicalRunArtifact {
  schema: "astrix-canonical-run/v1";
  runId: string;
  seed: string;
  generatedAt: string;
  provider: string;
  trueforge: { used: false; note: string };
  config: { days: number; maxTurnsPerRun: number; maxActionsPerTurn: number; humanPolicy: string };
  startState: CanonicalStateFrame;
  finalState: CanonicalStateFrame;
  frames: CanonicalStateFrame[];
  decisions: CanonicalDecision[];
  actions: CanonicalActionRecord[];
  approvals: CanonicalApproval[];
  adaptations: CanonicalAdaptation[];
  events: Array<AstrixAgentEvent & { day: number }>;
  consequences: string[];
  summary: {
    days: number;
    decisions: number;
    proposals: number;
    highRiskProposals: number;
    approvalsRequested: number;
    approvalsGranted: number;
    approvalsRejected: number;
    actionsExecuted: number;
    actionsVerified: number;
    actionsFailed: number;
    adaptations: number;
    farmsBuilt: number;
    bridgesBuilt: number;
    cropsHarvested: number;
    villagersStarved: number;
    outcome: "survived" | "collapsed";
    trueforgeUsed: false;
    consistent: boolean;
  };
}

// ---- the run ---------------------------------------------------------------

export async function runCanonicalScenario(
  options: CanonicalRunOptions = {},
): Promise<CanonicalRunArtifact> {
  const days = options.days ?? DEFAULT_CANONICAL_OPTIONS.days;
  const seed = options.seed ?? DEFAULT_CANONICAL_OPTIONS.seed;
  const maxTurnsPerRun = options.maxTurnsPerRun ?? DEFAULT_CANONICAL_OPTIONS.maxTurnsPerRun;
  const maxActionsPerTurn = options.maxActionsPerTurn ?? DEFAULT_CANONICAL_OPTIONS.maxActionsPerTurn;
  const humanPolicy = options.humanPolicy ?? rejectFirstThenApprove;

  // --- real Core, assembled exactly as createAstrixService does -------------
  const state = new AstrixWorldState();
  const bus = new AstrixGameCommandBus(state);
  const tools = createAstrixToolRegistry(state, bus);
  const events = new AstrixEventLog(5000); // wide enough to keep a whole run
  const provider = new LocalStewardProvider();

  // Wrap the provider only to RECORD what it decided (observable output), never
  // to alter it. The loop still calls the real policy with the real snapshot.
  const decisions: CanonicalDecision[] = [];
  const recordingProvider = {
    id: provider.id,
    async decide(context: Parameters<typeof provider.decide>[0]) {
      const decision = await provider.decide(context);
      decisions.push({
        day: context.snapshot.day,
        season: context.snapshot.season,
        turn: context.turn,
        decision: decision.decision,
        recommendation: decision.recommendation,
        rationale: decision.reasoning,
        toolCalls: decision.toolCalls.map((call) => ({ tool: call.tool, args: { ...call.args } })),
      });
      return decision;
    },
  };

  const loop = new AstrixStewardLoop({
    state,
    bus,
    tools,
    events,
    provider: recordingProvider,
    maxTurnsPerRun,
    maxActionsPerTurn,
    decideTimeoutMs: 5000,
  });

  // --- recording ------------------------------------------------------------
  const startState = frameOf(state.snapshot());
  const frames: CanonicalStateFrame[] = [startState];
  const approvals: CanonicalApproval[] = [];
  const adaptations: CanonicalAdaptation[] = [];
  const consequences: string[] = [];
  const eventDays = new Map<AstrixAgentEvent, number>();
  events.onEvent((event) => eventDays.set(event, state.day));

  // loop.start() resets the loop's per-run action list, so accumulate action
  // records across runs (ids are namespaced per run to stay unique).
  const allActions: CanonicalActionRecord[] = [];
  let runSeq = 0;
  const drainActions = (day: number): void => {
    for (const action of loop.actions) {
      allActions.push({ ...canonicalAction(action), day, actionId: `r${runSeq}-${action.id}` });
    }
  };
  const beginRun = (day: number): void => {
    drainActions(day);
    runSeq += 1;
    loop.start("Keep the village alive for 30 days");
  };

  let approvalIndex = 0;
  let cropsHarvested = 0;
  let villagersStarved = 0;
  let previousPopulation = state.population;
  let previousSeason = state.season;
  /** Open rejection awaiting the steward's next proposal (adaptation evidence). */
  let pendingRejection:
    | { day: number; tool: string; args: Record<string, unknown>; decisionsBefore: number }
    | null = null;

  /** Close an open rejection once the steward proposes something again. */
  const closeAdaptation = (): void => {
    if (!pendingRejection) return;
    const next = decisions
      .slice(pendingRejection.decisionsBefore)
      .find((entry) => entry.toolCalls.length > 0);
    if (!next) return; // still nothing proposed — keep waiting
    const nextCall = next.toolCalls[0];
    const changed = !sameCall(nextCall, { tool: pendingRejection.tool, args: pendingRejection.args });
    const sameTool = nextCall.tool === pendingRejection.tool;
    adaptations.push({
      day: pendingRejection.day,
      rejectedProposal: { tool: pendingRejection.tool, args: { ...pendingRejection.args } },
      nextProposal: { tool: nextCall.tool, args: { ...nextCall.args } },
      changed,
      note: changed
        ? sameTool
          ? `steward kept the ${nextCall.tool} strategy but chose a different target (day ${next.day}) after the refusal`
          : `steward changed strategy to ${nextCall.tool} (day ${next.day}) after the refusal`
        : "steward repeated the refused proposal (adaptation FAILED)",
    });
    pendingRejection = null;
  };

  for (let day = 1; day <= days && state.population > 0; day++) {
    // 1. Steward run for the day (bounded by the loop's own caps).
    if (["IDLE", "COMPLETED", "STOPPED", "FAILED"].includes(loop.state)) {
      beginRun(state.day);
    }
    await settle(loop);

    // 2. Governance: every approval the steward raised today is decided by the
    //    deterministic human policy. World time is frozen while we deliberate
    //    (AstrixService.tick gates on loop.state) — here the clock is explicit,
    //    so the equivalent guarantee is that we never tick during this block.
    while (loop.state === "AWAITING_APPROVAL") {
      const pending = loop.pendingApproval;
      if (!pending) break;
      const approval = state.pendingApprovals.find((entry) => entry.id === pending.approvalId);
      const action = pending.action;
      const before = fingerprint(state.snapshot());
      const decision = humanPolicy({
        index: approvalIndex,
        tool: action.tool,
        day: state.day,
        approvalId: pending.approvalId,
      });
      approvalIndex += 1;

      loop.resolveApproval(pending.approvalId, decision);
      await settle(loop);

      const after = fingerprint(state.snapshot());
      const executed = action.executionState === "SUCCEEDED";
      approvals.push({
        approvalId: pending.approvalId,
        day: state.day,
        tool: action.tool,
        args: { ...action.args },
        risk: action.riskLevel,
        reason: approval?.reason ?? "",
        impact: approval ? { ...approval.impact } : {},
        humanDecision: decision,
        executed,
        verified: action.verificationState === "VERIFIED",
        worldBefore: before,
        worldAfter: after,
        mutated: !sameFingerprint(before, after),
      });

      if (decision === "reject") {
        consequences.push(
          `Day ${state.day}: human REJECTED ${action.tool} — zero mutation (nodes ${before.resourceNodes}, wood ${before.wood}, meadow health ${before.biomeHealthMeadow} unchanged).`,
        );
        // 3. Adaptation is measured against the NEXT proposal the steward makes
        //    — which may land later the same day or on a following day. The
        //    record is opened here and closed by the first subsequent proposal.
        pendingRejection = {
          day: state.day,
          tool: action.tool,
          args: { ...action.args },
          decisionsBefore: decisions.length,
        };
      } else if (executed) {
        consequences.push(
          `Day ${state.day}: human APPROVED ${action.tool} — executed once and verified (nodes ${before.resourceNodes}->${after.resourceNodes}, wood ${before.wood}->${after.wood}, bridges ${before.bridges}->${after.bridges}).`,
        );
      }
    }

    // 4. Advance the world exactly one day (deterministic clock).
    closeAdaptation();
    state.tick(DAY_SECONDS);
    const snap = state.snapshot();
    frames.push(frameOf(snap));

    // 5. Derive consequences from authoritative deltas only.
    if (snap.population < previousPopulation) {
      const starved = previousPopulation - snap.population;
      villagersStarved += starved;
      consequences.push(`Day ${snap.day}: FOOD SHORTAGE — ${starved} villager(s) starved (population ${previousPopulation} -> ${snap.population}).`);
    }
    if (snap.season !== previousSeason) {
      consequences.push(
        `Day ${snap.day}: season changed to ${snap.season.toUpperCase()}${snap.season === "winter" ? " — crops stop growing and consumption rises 1.5x" : ""}.`,
      );
    }
    previousPopulation = snap.population;
    previousSeason = snap.season;
  }

  if (loop.isRunning()) {
    loop.stop();
    await loop.whenSettled();
  }
  // Capture the final run's actions too.
  drainActions(state.day);

  cropsHarvested = allActions.filter((a) => a.tool === "harvest" && a.executionState === "SUCCEEDED").length;
  const finalSnapshot = state.snapshot();
  const finalState = frameOf(finalSnapshot);
  const allEvents = events.all().map((event) => ({ ...event, day: eventDays.get(event) ?? 0 }));

  const actions: CanonicalActionRecord[] = allActions;
  const highRisk = allActions.filter((a) => a.risk === "high");

  const artifact: CanonicalRunArtifact = {
    schema: "astrix-canonical-run/v1",
    runId: `${seed}-${days}d`,
    seed,
    generatedAt: new Date().toISOString(),
    provider: provider.id,
    trueforge: {
      used: false,
      note: "Canonical run uses the in-process LocalStewardProvider. No TrueForge session, turn, URL, or key is touched.",
    },
    config: { days, maxTurnsPerRun, maxActionsPerTurn, humanPolicy: "reject-first-then-approve" },
    startState,
    finalState,
    frames,
    decisions,
    actions,
    approvals,
    adaptations,
    events: allEvents,
    consequences,
    summary: {
      days: finalSnapshot.day,
      decisions: decisions.length,
      proposals: allActions.length,
      highRiskProposals: highRisk.length,
      approvalsRequested: approvals.length,
      approvalsGranted: approvals.filter((a) => a.humanDecision === "approve").length,
      approvalsRejected: approvals.filter((a) => a.humanDecision === "reject").length,
      actionsExecuted: allActions.filter((a) => a.executionState === "SUCCEEDED").length,
      actionsVerified: allActions.filter((a) => a.verificationState === "VERIFIED").length,
      actionsFailed: allActions.filter((a) => a.executionState === "FAILED").length,
      adaptations: adaptations.filter((a) => a.changed).length,
      farmsBuilt: finalSnapshot.buildings.filter((b) => b.type === "farm").length,
      bridgesBuilt: finalSnapshot.bridges.length,
      cropsHarvested,
      villagersStarved,
      outcome: finalSnapshot.population > 0 ? "survived" : "collapsed",
      trueforgeUsed: false,
      consistent: isConsistent(finalSnapshot),
    },
  };

  return artifact;
}

// ---- markdown summary ------------------------------------------------------

export function renderCanonicalMarkdown(artifact: CanonicalRunArtifact): string {
  const s = artifact.summary;
  const lines: string[] = [];
  lines.push("# ASTrix Canonical Run — Core Evidence");
  lines.push("");
  lines.push(
    `> Deterministic ${artifact.config.days}-day run of ASTrix Core with **no TrueForge**. ` +
      `Reasoning: \`${artifact.provider}\`. Run id: \`${artifact.runId}\` (seed \`${artifact.seed}\`). ` +
      `Generated ${artifact.generatedAt}.`,
  );
  lines.push("");
  lines.push("Every mutation below travelled the real command bus; every irreversible action stopped at the");
  lines.push("structural approval gate until the human policy decided. Nothing here is scripted narrative —");
  lines.push("the steward's proposals are whatever it derived from the authoritative snapshot that day.");
  lines.push("");

  lines.push("## Verdict");
  lines.push("");
  lines.push("| Property | Result |");
  lines.push("|---|---|");
  lines.push(`| Outcome | **${s.outcome === "survived" ? "VILLAGE SURVIVED" : "VILLAGE COLLAPSED"}** (day ${s.days}) |`);
  lines.push(`| Population | ${artifact.startState.population} → ${artifact.finalState.population} |`);
  lines.push(`| Food | ${artifact.startState.food} → ${artifact.finalState.food} |`);
  lines.push(`| Farms / bridges | ${s.farmsBuilt} / ${s.bridgesBuilt} |`);
  lines.push(`| Steward decisions | ${s.decisions} |`);
  lines.push(`| Proposals (high-risk) | ${s.proposals} (${s.highRiskProposals}) |`);
  lines.push(`| Approvals | ${s.approvalsGranted} granted, ${s.approvalsRejected} rejected |`);
  lines.push(`| Executed / verified | ${s.actionsExecuted} / ${s.actionsVerified} |`);
  lines.push(`| Failed actions | ${s.actionsFailed} |`);
  lines.push(`| Adaptations after refusal | ${s.adaptations} |`);
  lines.push(`| Crops harvested | ${s.cropsHarvested} |`);
  lines.push(`| Villagers starved | ${s.villagersStarved} |`);
  lines.push(`| Events recorded | ${artifact.events.length} |`);
  lines.push(`| TrueForge used | ${s.trueforgeUsed ? "YES" : "**NO**"} |`);
  lines.push(`| Final state consistent | ${s.consistent ? "yes" : "NO"} |`);
  lines.push("");

  lines.push("## Timeline");
  lines.push("");
  lines.push("```");
  lines.push(
    `DAY 1   World initialized — population ${artifact.startState.population}, food ${artifact.startState.food}, ` +
      `${artifact.startState.farms} farms, farmland ${artifact.startState.farmland.map((f) => `${f.islandId} ${f.used}/${f.capacity}`).join(" ")}`,
  );

  const shown = new Set<string>();
  for (const decision of artifact.decisions) {
    if (decision.toolCalls.length === 0) continue;
    const key = `${decision.day}:${decision.decision}`;
    if (shown.has(key)) continue;
    shown.add(key);
    lines.push(`DAY ${String(decision.day).padEnd(3)} Steward: ${decision.decision}`);
  }
  for (const approval of artifact.approvals) {
    lines.push(
      `DAY ${String(approval.day).padEnd(3)} APPROVAL GATE — ${approval.tool} (${approval.risk} risk) → human ${approval.humanDecision.toUpperCase()}` +
        (approval.humanDecision === "reject"
          ? "  → ZERO MUTATION"
          : approval.executed
            ? `  → executed${approval.verified ? " + verified" : ""}`
            : "  → not executed"),
    );
  }
  for (const adaptation of artifact.adaptations) {
    lines.push(
      `DAY ${String(adaptation.day).padEnd(3)} ADAPTATION — ${adaptation.changed ? "changed" : "REPEATED"}: ${adaptation.note}`,
    );
  }
  for (const consequence of artifact.consequences) lines.push(consequence);
  lines.push(
    `DAY ${artifact.finalState.day}  Final state — population ${artifact.finalState.population}, food ${artifact.finalState.food}, ` +
      `${artifact.finalState.season}, ${artifact.finalState.farms} farms, ${artifact.finalState.bridges} bridges, ` +
      `${artifact.finalState.resourceNodes} resource nodes`,
  );
  lines.push("```");
  lines.push("");

  if (artifact.approvals.length > 0) {
    lines.push("## Governance detail");
    lines.push("");
    for (const approval of artifact.approvals) {
      lines.push(`### ${approval.approvalId} — ${approval.tool} (day ${approval.day})`);
      lines.push("");
      lines.push(`- Reason recorded by the bus: ${approval.reason}`);
      lines.push(`- Impact bound to the approval: \`${JSON.stringify(approval.impact)}\``);
      lines.push(`- Human decision: **${approval.humanDecision.toUpperCase()}**`);
      lines.push(
        `- World before: nodes ${approval.worldBefore.resourceNodes}, wood ${approval.worldBefore.wood}, ` +
          `meadow health ${approval.worldBefore.biomeHealthMeadow}, bridges ${approval.worldBefore.bridges}`,
      );
      lines.push(
        `- World after: nodes ${approval.worldAfter.resourceNodes}, wood ${approval.worldAfter.wood}, ` +
          `meadow health ${approval.worldAfter.biomeHealthMeadow}, bridges ${approval.worldAfter.bridges}`,
      );
      lines.push(`- Mutated: ${approval.mutated ? "yes" : "**no**"} · executed: ${approval.executed ? "yes" : "no"} · verified: ${approval.verified ? "yes" : "no"}`);
      lines.push("");
    }
  }

  lines.push("## Reproduce");
  lines.push("");
  lines.push("```bash");
  lines.push(`ASTRIX_RUN_DAYS=${artifact.config.days} ASTRIX_RUN_SEED=${artifact.seed} npm run astrix:canonical`);
  lines.push("```");
  lines.push("");
  lines.push(`Machine-readable evidence: \`artifacts/astrix-canonical-run.json\` (schema \`${artifact.schema}\`).`);
  lines.push("");
  return lines.join("\n");
}

// ---- helpers ---------------------------------------------------------------

async function settle(loop: AstrixStewardLoop, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (["COMPLETED", "STOPPED", "FAILED", "AWAITING_APPROVAL"].includes(loop.state)) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`canonical run: loop did not settle (state=${loop.state})`);
}

function frameOf(snap: AstrixStateSnapshot): CanonicalStateFrame {
  return {
    day: snap.day,
    season: snap.season,
    time: snap.time,
    population: snap.population,
    food: snap.food,
    foodPerDay: snap.foodPerDay,
    daysOfFoodRemaining: snap.daysOfFoodRemaining,
    foodPressureLevel: snap.foodPressureLevel,
    harvestableFood: snap.harvestableFood,
    growingFood: snap.growingFood,
    daysUntilNextHarvest: snap.daysUntilNextHarvest,
    projectedFoodAtWinter: snap.projectedFoodAtWinter,
    resources: { ...snap.resources },
    farms: snap.buildings.filter((b) => b.type === "farm").length,
    crops: snap.crops.length,
    bridges: snap.bridges.length,
    resourceNodes: snap.resourceNodes.length,
    farmland: snap.farmland.map((entry) => ({ ...entry })),
    biomeHealth: { ...snap.biomeHealth },
  };
}

function canonicalAction(action: AstrixActionRecord): CanonicalActionRecord {
  return {
    day: 0, // filled from the event stream when needed; action records are ordered
    turn: action.turn,
    actionId: action.id,
    tool: action.tool,
    args: { ...action.args },
    risk: action.riskLevel,
    approvalRequired: action.approvalRequired,
    approvalState: action.approvalState,
    executionState: action.executionState,
    verificationState: action.verificationState,
    error: action.error,
  };
}

function fingerprint(snap: AstrixStateSnapshot) {
  return {
    resourceNodes: snap.resourceNodes.length,
    wood: snap.resources.wood,
    biomeHealthMeadow: snap.biomeHealth.meadow,
    bridges: snap.bridges.length,
  };
}

function sameFingerprint(a: ReturnType<typeof fingerprint>, b: ReturnType<typeof fingerprint>): boolean {
  return (
    a.resourceNodes === b.resourceNodes &&
    a.wood === b.wood &&
    a.biomeHealthMeadow === b.biomeHealthMeadow &&
    a.bridges === b.bridges
  );
}

function sameCall(
  a: { tool: string; args: Record<string, unknown> },
  b: { tool: string; args: Record<string, unknown> },
): boolean {
  return a.tool === b.tool && JSON.stringify(a.args) === JSON.stringify(b.args);
}

/** Internal consistency checks on the final authoritative state. */
function isConsistent(snap: AstrixStateSnapshot): boolean {
  if (snap.food < 0 || snap.population < 0) return false;
  if (snap.resources.food !== snap.food) return false;
  if (Object.values(snap.resources).some((value) => value < 0)) return false;
  // Every crop belongs to an existing farm.
  const farmIds = new Set(snap.buildings.filter((b) => b.type === "farm").map((b) => b.id));
  if (snap.crops.some((crop) => !farmIds.has(crop.farmPlotId))) return false;
  // Farmland accounting matches the buildings actually placed.
  for (const entry of snap.farmland) {
    const used = snap.buildings.filter((b) => b.type === "farm" && b.islandId === entry.islandId).length;
    if (entry.used !== used) return false;
    if (entry.available !== Math.max(0, entry.capacity - used)) return false;
  }
  // Biome health stays in range.
  if (Object.values(snap.biomeHealth).some((value) => value < 0 || value > 1)) return false;
  return true;
}
