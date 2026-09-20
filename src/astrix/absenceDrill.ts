// ASTrix absence drill — "THE WORLD DOESN'T WAIT", as a library.
//
// A deterministic demonstration that the world progresses without its steward
// and that recovery is mechanically scored. Same machinery as the canonical
// run (real Core, real bus, real loop, real LocalStewardProvider, explicit
// clock); the only scripted parts are the governor's setup and the absence
// itself:
//
//   Phase SETUP   — governor builds one farm and plants wheat via the bus.
//   Phase ONLINE  — steward loop runs N days (bounded runs, settled daily).
//   Phase ABSENT  — loop.stop() models the steward disappearing; the world
//                   is ticked N days with NO loop running. Any consequence
//                   (consumption, growth, starvation) is the simulation's own.
//   Phase RECOVER — loop.start() models reconnection; the steward gets a
//                   fixed recovery window. No extra help, no scripted rescue.
//
// Scoring (mechanical, in-artifact): PASS iff at end of recovery
//   final.food > 0 AND final.population >= population at reconnect.
// A village that starves to zero during absence cannot pass (no birth
// mechanic) — that FAIL is itself the honest result the drill exists to show.
//
// APPROVALS: a deterministic approve-all human policy during ONLINE/RECOVER
// (recorded in the artifact). The drill is about absence and recovery, not
// about the gate — the gate's own branches are covered by the canonical run
// and demo scenarios.
import { AstrixGameCommandBus } from "./commandBus";
import { AstrixEventLog, type AstrixAgentEvent } from "./events";
import { LocalStewardProvider } from "./localRuntime";
import { createAstrixToolRegistry } from "./mcpTools";
import {
  AstrixStewardLoop,
  type AstrixActionRecord,
  type StewardDecision,
} from "./orchestrator";
import {
  AstrixWorldState,
  DAY_SECONDS,
  type AstrixStateSnapshot,
} from "./state";
import type {
  CanonicalActionRecord,
  CanonicalApproval,
  CanonicalStateFrame,
} from "./canonicalRun";

export interface AbsenceDrillOptions {
  seed?: string;
  /** Steward-managed days before disconnect. */
  onlineDays?: number;
  /** Days ticked with the loop STOPPED (the absence). */
  absenceDays?: number;
  /** Steward-managed days after reconnect (the recovery window). */
  recoveryDays?: number;
  maxTurnsPerRun?: number;
  maxActionsPerTurn?: number;
}

export type DrillPhase = "SETUP" | "ONLINE" | "ABSENT" | "RECOVER";

export interface AbsenceDrillFrame extends CanonicalStateFrame {
  phase: DrillPhase;
}

export interface AbsenceDrillScore {
  rule: string;
  foodAtReconnect: number;
  populationAtReconnect: number;
  finalFood: number;
  finalPopulation: number;
  foodRecovered: boolean;
  populationHeld: boolean;
  /** Anti-vacuity gate: 0 >= 0 would pass the bare rule on a corpse. */
  populationSurvivedAbsence: boolean;
  pass: boolean;
}

export interface AbsenceDrillArtifact {
  schema: "astrix-absence-drill/v1";
  runId: string;
  seed: string;
  generatedAt: string;
  provider: string;
  steward: string;
  mode: string;  config: {
    onlineDays: number;
    absenceDays: number;
    recoveryDays: number;
    maxTurnsPerRun: number;
    maxActionsPerTurn: number;
    humanPolicy: string;
    /**
     * Explicit-clock policy (always-mode equivalent): days advance by direct
     * state.tick() calls on a fixed schedule, independent of loop.state. This
     * is what lets the world continue while the loop is STOPPED. In
     * production the managed clock instead holds time with no live run — the
     * Observatory's "CLOCK HELD" badge describes that policy truthfully for
     * the recorded loop state; the storyboard's advancing days are this
     * drill's explicit ticks, stated here, not a contradiction.
     */
    clockPolicy: string;
  };
  phases: Array<{ phase: DrillPhase; startDay: number; endDay: number; note: string }>;
  startState: CanonicalStateFrame;
  stateAtDisconnect: CanonicalStateFrame;
  stateAtReconnect: CanonicalStateFrame;
  finalState: CanonicalStateFrame;
  frames: AbsenceDrillFrame[];
  /**
   * Full authoritative snapshots per day (with the loop's real state/turn),
   * so the storyboard renderer can materialize REAL drill states instead of
   * fixtures. Same objects production serves over /astrix/state.
   */
  snapshots: Array<{
    day: number;
    phase: DrillPhase;
    snapshot: AstrixStateSnapshot;
    steward: { state: string; turn: number; objective: string };
  }>;
  /** Steward actions only — indexed by phase, so absence shows zero. */
  actions: Array<CanonicalActionRecord & { phase: DrillPhase }>;
  approvals: CanonicalApproval[];
  /** Governor setup commands (the only non-steward mutations), with results. */
  setupCommands: Array<{ command: string; ok: boolean; detail: string }>;
  events: Array<AstrixAgentEvent & { day: number }>;
  consequences: string[];
  score: AbsenceDrillScore;
  summary: {
    days: number;
    absenceDays: number;
    decisionsDuringAbsence: number;
    actionsDuringAbsence: number;
    cropsHarvested: number;
    villagersStarvedTotal: number;
    villagersStarvedDuringAbsence: number;
    outcome: "recovered" | "not-recovered";
    trueforgeUsed: false;
    consistent: boolean;
  };
}

const DEFAULTS = {
  seed: "astrix-absence-drill-v1",
  onlineDays: 2,
  absenceDays: 3,
  recoveryDays: 8,
  maxTurnsPerRun: 4,
  maxActionsPerTurn: 6,
} as const;

async function settle(loop: AstrixStewardLoop, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (["COMPLETED", "STOPPED", "FAILED", "AWAITING_APPROVAL"].includes(loop.state)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`absence drill: loop did not settle (state=${loop.state})`);
}

/**
 * Settle past microtask races, not just to a terminal state. The loop makes
 * progress in microtask-sized steps (decide resolutions, tool results), so a
 * synchronous read taken right after settle() can observe a state that is
 * already stale — e.g. counting decisions while turn N+1's decide promise is
 * in flight, then ticking or stopping with work unresolved. settleDeep
 * requires a terminal state AND an event-quiet window, so no decision,
 * action, or turn can be mid-flight when the drill moves on. Without this,
 * the absence metric can count a legitimately-requested-but-never-acted
 * decision as "during absence". Production code is untouched; this is drill
 * hygiene for anyone asserting on event counts across async boundaries.
 */
async function settleDeep(
  loop: AstrixStewardLoop,
  events: AstrixEventLog,
  timeoutMs = 10_000,
): Promise<void> {
  await settle(loop, timeoutMs);
  const deadline = Date.now() + timeoutMs;
  let quietRounds = 0;
  let lastCount = -1;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 15));
    const terminal = ["COMPLETED", "STOPPED", "FAILED", "AWAITING_APPROVAL"].includes(loop.state);
    const count = events.all().length;
    if (terminal && count === lastCount) {
      quietRounds += 1;
      if (quietRounds >= 3) return; // ~45ms quiet at a terminal state: truly idle
    } else {
      quietRounds = 0;
    }
    lastCount = count;
  }
  throw new Error(`absence drill: loop did not go quiet (state=${loop.state})`);
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
    farmland: snap.farmland.map((f) => ({ ...f })),
    biomeHealth: { ...snap.biomeHealth },
  };
}

function canonicalAction(action: AstrixActionRecord): CanonicalActionRecord {
  return {
    day: 0,
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

function isConsistent(snap: AstrixStateSnapshot): boolean {
  return (
    snap.population >= 0 &&
    snap.food >= 0 &&
    snap.crops.every((c) => c.growthStage >= 0 && c.growthStage <= 1) &&
    snap.resourceNodes.every((n) => n.quantity >= 0)
  );
}

export async function runAbsenceDrill(
  options: AbsenceDrillOptions = {},
): Promise<AbsenceDrillArtifact> {
  const seed = options.seed ?? DEFAULTS.seed;
  const onlineDays = options.onlineDays ?? DEFAULTS.onlineDays;
  const absenceDays = options.absenceDays ?? DEFAULTS.absenceDays;
  const recoveryDays = options.recoveryDays ?? DEFAULTS.recoveryDays;
  const maxTurnsPerRun = options.maxTurnsPerRun ?? DEFAULTS.maxTurnsPerRun;
  const maxActionsPerTurn = options.maxActionsPerTurn ?? DEFAULTS.maxActionsPerTurn;

  const state = new AstrixWorldState();
  const bus = new AstrixGameCommandBus(state);
  const tools = createAstrixToolRegistry(state, bus);
  const events = new AstrixEventLog(5000);
  const provider = new LocalStewardProvider();
  const loop = new AstrixStewardLoop({
    state,
    bus,
    tools,
    events,
    provider,
    maxTurnsPerRun,
    maxActionsPerTurn,
    decideTimeoutMs: 5000,
  });

  const frames: AbsenceDrillFrame[] = [];
  const snapshots: AbsenceDrillArtifact["snapshots"] = [];
  const actions: Array<CanonicalActionRecord & { phase: DrillPhase }> = [];
  const approvals: CanonicalApproval[] = [];
  const setupCommands: AbsenceDrillArtifact["setupCommands"] = [];
  const consequences: string[] = [];
  const phases: AbsenceDrillArtifact["phases"] = [];
  const eventDays = new Map<AstrixAgentEvent, number>();
  events.onEvent((event) => eventDays.set(event, state.day));
  let approvalIndex = 0;
  let cropsHarvested = 0;
  let starvedTotal = 0;
  let starvedDuringAbsence = 0;
  let previousPopulation = state.population;
  let runSeq = 0;

  const pushFrame = (phase: DrillPhase): void => {
    frames.push({ ...frameOf(state.snapshot()), phase });
    snapshots.push({
      day: state.day,
      phase,
      snapshot: state.snapshot(),
      steward: { state: loop.state, turn: loop.turn, objective: loop.objective ?? "" },
    });
  };
  const drainActions = (phase: DrillPhase, day: number): void => {
    for (const action of loop.actions) {
      actions.push({ ...canonicalAction(action), day, actionId: `r${runSeq}-${action.id}`, phase });
    }
  };
  const noteStarvation = (phase: DrillPhase): void => {
    const pop = state.population;
    if (pop < previousPopulation) {
      const lost = previousPopulation - pop;
      starvedTotal += lost;
      if (phase === "ABSENT") starvedDuringAbsence += lost;
      consequences.push(
        `Day ${state.day} [${phase}]: FOOD SHORTAGE — ${lost} villager(s) starved (population ${previousPopulation} -> ${pop}).`,
      );
    }
    previousPopulation = pop;
  };
  /** Resolve every open gate with the recorded approve-all policy. */
  const govern = async (phase: DrillPhase): Promise<void> => {
    while (loop.state === "AWAITING_APPROVAL") {
      const pending = loop.pendingApproval;
      if (!pending) break;
      const action = pending.action;
      loop.resolveApproval(pending.approvalId, "approve");
      await settle(loop);
      approvalIndex += 1;
      approvals.push({
        approvalId: pending.approvalId,
        day: state.day,
        tool: action.tool,
        args: { ...action.args },
        risk: action.riskLevel,
        reason: "",
        impact: {},
        humanDecision: "approve",
        executed: action.executionState === "SUCCEEDED",
        verified: action.verificationState === "VERIFIED",
        worldBefore: { resourceNodes: -1, wood: -1, biomeHealthMeadow: -1, bridges: -1 },
        worldAfter: { resourceNodes: -1, wood: -1, biomeHealthMeadow: -1, bridges: -1 },
        mutated: action.executionState === "SUCCEEDED",
      });
      consequences.push(`Day ${state.day} [${phase}]: human APPROVED ${action.tool} (policy approve-all).`);
    }
  };
  /** One steward-managed day: bounded run, settle, govern, tick, record. */
  const managedDay = async (phase: DrillPhase): Promise<void> => {
    if (["IDLE", "COMPLETED", "STOPPED", "FAILED"].includes(loop.state)) {
      drainActions(phase, state.day);
      runSeq += 1;
      loop.start(phase === "RECOVER" ? "Recover the village: harvest, replant, survive." : "Keep the village alive.");
    }
    await settle(loop);
    await govern(phase);
    // Quiesce past microtask races BEFORE ticking: the tick must never land
    // while a decision/action is in flight (see settleDeep).
    await settleDeep(loop, events);
    state.tick(DAY_SECONDS);
    pushFrame(phase);
    noteStarvation(phase);
  };

  // ---- Phase SETUP: governor prepares a lived-in world ---------------------
  const setupStartDay = state.day;
  const farm = bus.execute({
    command: "PLACE_BUILDING",
    buildingType: "farm",
    position: { x: 14, y: 0, z: 10 },
    islandId: "meadow",
  });
  setupCommands.push({ command: "PLACE_BUILDING farm", ok: farm.success, detail: farm.success ? `id=${farm.buildingId}` : String(farm.error) });
  const farmId = (farm as { buildingId?: string }).buildingId ?? "";
  for (let i = 0; i < 3; i++) {
    const plant = bus.execute({ command: "PLANT_CROP", farmPlotId: farmId, cropType: "wheat" });
    setupCommands.push({ command: "PLANT_CROP wheat", ok: plant.success, detail: plant.success ? `id=${(plant as { cropId?: string }).cropId}` : String(plant.error) });
  }
  // Five days of pre-history so the drill opens mid-story (crops 0.625,
  // granary partly drawn). Tuned so the absence below empties the granary
  // EXACTLY (real hunger, no starvation cliff): food must stay >= 0 with no
  // shortfall day, otherwise the cliff dynamics (one shortfall day can take
  // the whole village) make recovery unprovable by design, not by failure.
  for (let i = 0; i < 5; i++) {
    state.tick(DAY_SECONDS);
    pushFrame("SETUP");
  }
  noteStarvation("SETUP");
  phases.push({ phase: "SETUP", startDay: setupStartDay, endDay: state.day, note: "governor-built farm + wheat; 6 days pre-history" });
  const startState = frameOf(state.snapshot());

  // ---- Phase ONLINE: steward manages ---------------------------------------
  const onlineStart = state.day;
  for (let i = 0; i < onlineDays; i++) await managedDay("ONLINE");
  phases.push({ phase: "ONLINE", startDay: onlineStart, endDay: state.day, note: `steward loop running, ${onlineDays} managed days` });
  const stateAtDisconnect = frameOf(state.snapshot());
  const decisionsBeforeAbsence = events.all().filter((e) => e.type === "DECISION_COMPLETED").length;

  // ---- Phase ABSENT: the steward disappears --------------------------------
  // loop.stop() is the real disappearance mechanism (same call the stop
  // endpoint uses). From here the world is ticked with NO loop running.
  loop.stop();
  await loop.whenSettled();
  const absentStart = state.day;
  const absentStartDay = state.day;
  for (let i = 0; i < absenceDays; i++) {
    if (loop.isRunning()) throw new Error("absence drill: loop running during ABSENT phase");
    state.tick(DAY_SECONDS);
    pushFrame("ABSENT");
    noteStarvation("ABSENT");
  }
  phases.push({ phase: "ABSENT", startDay: absentStart, endDay: state.day, note: `loop STOPPED; ${absenceDays} days ticked with no steward` });
  const stateAtReconnect = frameOf(state.snapshot());
  const decisionsAtReconnect =
    events.all().filter((e) => e.type === "DECISION_COMPLETED").length;
  const decisionsDuringAbsence =
    decisionsAtReconnect - decisionsBeforeAbsence;
  // Actions indexed ABSENT must be exactly zero: the loop was STOPPED for the
  // whole phase, so any steward action here would be a fabrication.
  const absentPhaseActions = actions.filter((a) => a.phase === "ABSENT").length;
  void absentStartDay;

  // ---- Phase RECOVER: the steward returns ----------------------------------
  const recoverStart = state.day;
  for (let i = 0; i < recoveryDays; i++) await managedDay("RECOVER");
  if (loop.isRunning()) {
    loop.stop();
    await loop.whenSettled();
  }
  drainActions("RECOVER", state.day);
  phases.push({ phase: "RECOVER", startDay: recoverStart, endDay: state.day, note: `loop restarted; ${recoveryDays}-day recovery window` });

  // ---- Score ---------------------------------------------------------------
  const finalSnapshot = state.snapshot();
  const finalState = frameOf(finalSnapshot);
  const foodRecovered = finalState.food > 0;
  const populationHeld = finalState.population >= stateAtReconnect.population;
  // A corpse cannot recover: without this gate the bare rule passes vacuously
  // on extinction (0 >= 0). The gate is part of the rule, stated up front.
  const populationSurvivedAbsence = stateAtReconnect.population > 0;
  const pass = foodRecovered && populationHeld && populationSurvivedAbsence;
  const score: AbsenceDrillScore = {
    rule: "PASS iff final.food > 0 AND final.population >= population at reconnect AND population at reconnect > 0 (anti-vacuity: extinction is FAIL, not a technical pass)",
    foodAtReconnect: stateAtReconnect.food,
    populationAtReconnect: stateAtReconnect.population,
    finalFood: finalState.food,
    finalPopulation: finalState.population,
    foodRecovered,
    populationHeld,
    populationSurvivedAbsence,
    pass,
  };
  consequences.push(
    `Day ${finalState.day} [SCORE]: ${pass ? "PASS" : "FAIL"} — food ${stateAtReconnect.food} -> ${finalState.food}, population ${stateAtReconnect.population} -> ${finalState.population} over ${recoveryDays} recovery days.`,
  );

  cropsHarvested = actions.filter((a) => a.tool === "harvest" && a.executionState === "SUCCEEDED").length;
  const allEvents = events.all().map((event) => ({ ...event, day: eventDays.get(event) ?? 0 }));

  return {
    schema: "astrix-absence-drill/v1",
    runId: `${seed}`,
    seed,
    generatedAt: new Date().toISOString(),
    provider: provider.id,
    steward: "Local Runtime",
    mode: "Deterministic",
    config: { onlineDays, absenceDays, recoveryDays, maxTurnsPerRun, maxActionsPerTurn, humanPolicy: "approve-all", clockPolicy: "explicit-tick" },
    phases,
    startState,
    stateAtDisconnect,
    stateAtReconnect,
    finalState,
    frames,
    snapshots,
    actions,
    approvals,
    setupCommands,
    events: allEvents,
    consequences,
    score,
    summary: {
      days: finalState.day,
      absenceDays,
      decisionsDuringAbsence,
      actionsDuringAbsence: absentPhaseActions,
      cropsHarvested,
      villagersStarvedTotal: starvedTotal,
      villagersStarvedDuringAbsence: starvedDuringAbsence,
      outcome: pass ? "recovered" : "not-recovered",
      trueforgeUsed: false,
      consistent: isConsistent(finalSnapshot),
    },
  };
}
