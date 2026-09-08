// ASTrix Local Runtime — the independent, TrueForge-free reasoning layer.
//
// This is the canonical local execution path required by ASTrix Core: a real
// StewardDecisionProvider that observes the authoritative snapshot and proposes
// real tool calls which the AstrixStewardLoop executes through the real
// AstrixGameCommandBus. It is NOT a mock and NOT a test double:
//
//   - It reads only the authoritative snapshot the loop hands it (no privileged
//     access, no direct state handle, no bus handle) — exactly the same
//     information an external LLM steward receives.
//   - It proposes; it cannot execute. Every mutation still travels
//     loop -> tool registry -> command bus, and HIGH-risk tools still stop at
//     the structural approval gate (the loop strips approval ids).
//   - It adapts: rejected irreversible proposals are remembered from the run
//     history and never re-proposed identically, so a human rejection visibly
//     changes subsequent behaviour.
//
// The difference between this provider and TrueForgeStewardProvider is only
// WHERE the reasoning happens (in-process policy vs remote LLM turn). The
// authority boundary, command path, gate, and verification are identical.
import { FARM_CROP_CAPACITY } from "./state";
import type { AstrixStateSnapshot, BiomeId } from "./state";
import type {
  AstrixActionRecord,
  StewardDecision,
  StewardDecisionProvider,
  StewardRunContext,
  StewardToolCall,
} from "./orchestrator";

/** Cost table mirrored from the command bus for pre-flight affordability checks.
 *  The bus remains the authority — this only avoids proposing doomed actions. */
const BUILD_COSTS = {
  house: { wood: 4, stone: 2 },
  farm: { wood: 2, stone: 1 },
  storage: { wood: 3, stone: 2 },
  bridge_segment: { wood: 3, stone: 1 },
} as const;

export interface LocalStewardPolicyOptions {
  /** Cap on farms the policy will build. Undefined = limited only by farmland. */
  maxFarms?: number;
  /** Allow proposing irreversible (approval-gated) expansion. Default true. */
  allowIrreversible?: boolean;
  /** Plant only while a harvest can still mature before the run ends. Default true. */
  respectSeason?: boolean;
}

/**
 * Deterministic survival policy for the ASTrix world.
 *
 * Priority order (re-evaluated every turn against fresh authoritative state):
 *   1. HARVEST mature crops            — realises food that already exists
 *   2. PLANT into free farm capacity   — the day you plant is not the day you eat
 *   3. BUILD a farm on free farmland   — expands production capacity
 *   4. GATHER wood/stone               — unblocks the builds above
 *   5. CLEAR_TERRAIN (irreversible)    — creates farmland when none remains
 *   6. BUILD_BRIDGE (irreversible)     — unlocks another island's farmland
 *   7. IDLE                            — nothing useful to do
 *
 * Steps 5 and 6 are the only high-risk proposals; both are approval-gated by
 * the command bus, and a rejection of one causes the policy to try the other,
 * then to stop proposing irreversible work altogether for the rest of the run.
 */
export class LocalStewardProvider implements StewardDecisionProvider {
  readonly id = "local-astrix-steward";

  constructor(private readonly options: LocalStewardPolicyOptions = {}) {}

  async decide(context: StewardRunContext): Promise<StewardDecision> {
    return decideLocalSteward(context, this.options);
  }
}

/** Pure decision function — exported so tests can exercise the policy directly. */
export function decideLocalSteward(
  context: StewardRunContext,
  options: LocalStewardPolicyOptions = {},
): StewardDecision {
  const snap = context.snapshot;
  const allowIrreversible = options.allowIrreversible !== false;
  const rejected = rejectedSignatures(context.history);

  // 1. HARVEST — mature crops are food already produced but not yet banked.
  const harvestable = snap.crops.filter((crop) => crop.harvestable);
  if (harvestable.length > 0) {
    const food = harvestable.reduce((sum) => sum + 6, 0);
    return {
      decision: `harvest ${harvestable.length} mature crop(s)`,
      recommendation: "realise standing production before it is needed",
      reasoning:
        `${harvestable.length} crop(s) are at 100% growth; harvesting adds ~${food} food ` +
        `against ${snap.foodPerDay}/day consumption (${snap.daysOfFoodRemaining} days of food remaining).`,
      toolCalls: harvestable.slice(0, 10).map((crop) => ({ tool: "harvest", args: { crop_id: crop.id } })),
    };
  }

  const farms = snap.buildings.filter((building) => building.type === "farm");
  const cropsPerFarm = new Map<string, number>();
  for (const crop of snap.crops) {
    cropsPerFarm.set(crop.farmPlotId, (cropsPerFarm.get(crop.farmPlotId) ?? 0) + 1);
  }

  // 2. PLANT — an empty farm plot is wasted production capacity.
  if (options.respectSeason !== false || snap.season !== "winter") {
    for (const farm of farms) {
      const planted = cropsPerFarm.get(farm.id) ?? 0;
      if (planted < FARM_CROP_CAPACITY) {
        const slots = FARM_CROP_CAPACITY - planted;
        return {
          decision: `plant ${slots} wheat on ${farm.id}`,
          recommendation: "fill every free farm plot",
          reasoning:
            `${farm.id} holds ${planted}/${FARM_CROP_CAPACITY} crops. Wheat matures in 8 days and ` +
            `does not grow in Winter (${snap.daysUntilWinter} days until Winter), so unplanted plots ` +
            `are lost production.`,
          toolCalls: Array.from({ length: slots }, () => ({
            tool: "plant",
            args: { farm_plot_id: farm.id, crop_type: "wheat" },
          })),
        };
      }
    }
  }

  // 3. BUILD a farm — only where farmland is genuinely available and reachable.
  const farmCapReached = options.maxFarms !== undefined && farms.length >= options.maxFarms;
  if (!farmCapReached && affordable("farm", snap)) {
    const island = reachableIslandWithFarmland(snap);
    if (island) {
      const position = farmPosition(island, farms.length);
      return {
        decision: `build a farm on ${island}`,
        recommendation: "expand food production capacity",
        reasoning:
          `${island} has free farmland (${farmlandOf(snap, island)?.available ?? 0} plot(s)) and the ` +
          `settlement can afford wood ${BUILD_COSTS.farm.wood} / stone ${BUILD_COSTS.farm.stone} ` +
          `(have wood ${snap.resources.wood} / stone ${snap.resources.stone}).`,
        toolCalls: [
          { tool: "build", args: { building_type: "farm", position, island_id: island } },
        ],
      };
    }
  }

  // 4. GATHER — unblock construction when materials are the binding constraint.
  if (!farmCapReached && !affordable("farm", snap)) {
    const need: "wood" | "stone" = snap.resources.wood < BUILD_COSTS.farm.wood ? "wood" : "stone";
    const node = snap.resourceNodes.find(
      (candidate) => candidate.type === need && candidate.quantity > 0 && isReachable(snap, candidate.islandId),
    );
    if (node) {
      return {
        decision: `gather ${need} from ${node.id}`,
        recommendation: "acquire the materials the next build needs",
        reasoning:
          `A farm costs wood ${BUILD_COSTS.farm.wood} / stone ${BUILD_COSTS.farm.stone}; the settlement ` +
          `holds wood ${snap.resources.wood} / stone ${snap.resources.stone}, so ${need} is the binding constraint.`,
        toolCalls: [{ tool: "gather", args: { resource_id: node.id } }],
      };
    }
  }

  // 5/6. IRREVERSIBLE EXPANSION — only when no reversible option remains.
  // Both proposals below stop at the structural approval gate. A rejection is
  // remembered (rejectedSignatures) so the policy adapts instead of repeating:
  // it first tries a DIFFERENT clearing target, then changes strategy entirely.
  if (allowIrreversible && !farmCapReached && needsMoreFarmland(snap)) {
    const clearTarget = clearableNode(snap, rejected);
    if (clearTarget) {
      const call: StewardToolCall = {
        tool: "clear_terrain",
        args: { position: { ...clearTarget.position }, radius: 2 },
      };
      return {
        decision: `clear terrain near ${clearTarget.id} to create farmland`,
        recommendation: "request human approval for an irreversible clearing",
        reasoning:
          `No reachable farmland remains (${describeFarmland(snap)}) and food pressure is ` +
          `${snap.foodPressureLevel} with ${snap.daysOfFoodRemaining} days of food. Clearing frees ` +
          `farmland permanently and lowers biome health — irreversible, so it requires human approval.`,
        approvalRequired: true,
        toolCalls: [call],
      };
    }

    // Adaptation path: every clearing option was rejected (or none exists) —
    // change strategy to connectivity instead of repeating a refused request.
    if (affordable("bridge_segment", snap)) {
      const target = unreachableIslandWithFarmland(snap);
      if (target) {
        const call: StewardToolCall = {
          tool: "build_bridge",
          args: { island_a: "meadow", island_b: target },
        };
        if (!rejected.has(signatureOf(call))) {
          return {
            decision: `build a bridge from meadow to ${target}`,
            recommendation: "request human approval for an irreversible connection",
            reasoning:
              `${target} holds ${farmlandOf(snap, target)?.available ?? 0} unused farmland plot(s) but is ` +
              `unreachable without a bridge. A bridge permanently changes island connectivity, so it ` +
              `requires human approval.`,
            approvalRequired: true,
            toolCalls: [call],
          };
        }
      }
    }
  }

  // 7. IDLE — the honest answer when nothing productive is available.
  return {
    decision: "hold — no productive action available",
    recommendation: "conserve and re-observe next turn",
    reasoning: idleReason(snap, rejected.size > 0, farmCapReached),
    toolCalls: [],
  };
}

// ---- policy helpers --------------------------------------------------------

/** Signatures of irreversible proposals a human already rejected in this run. */
function rejectedSignatures(history: readonly AstrixActionRecord[]): Set<string> {
  const out = new Set<string>();
  for (const action of history) {
    if (action.approvalState === "rejected" || action.executionState === "REJECTED") {
      out.add(signatureOf({ tool: action.tool, args: action.args }));
    }
  }
  return out;
}

/** Stable identity for a proposal, so "the same request again" is detectable. */
function signatureOf(call: StewardToolCall): string {
  const args = call.args ?? {};
  const keys = Object.keys(args).sort();
  const parts = keys.map((key) => {
    const value = args[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const inner = value as Record<string, unknown>;
      const innerKeys = Object.keys(inner).sort();
      return `${key}={${innerKeys.map((k) => `${k}:${String(inner[k])}`).join(",")}}`;
    }
    return `${key}=${String(value)}`;
  });
  return `${call.tool}(${parts.join("|")})`;
}

function affordable(type: keyof typeof BUILD_COSTS, snap: AstrixStateSnapshot): boolean {
  const cost = BUILD_COSTS[type];
  return Object.entries(cost).every(
    ([resource, amount]) => (snap.resources[resource as keyof typeof snap.resources] ?? 0) >= amount,
  );
}

function isReachable(snap: AstrixStateSnapshot, island: BiomeId): boolean {
  if (island === "meadow") return true;
  return snap.bridges.some(
    (bridge) =>
      (bridge.islandA === "meadow" && bridge.islandB === island) ||
      (bridge.islandA === island && bridge.islandB === "meadow"),
  );
}

function farmlandOf(snap: AstrixStateSnapshot, island: BiomeId) {
  return snap.farmland.find((entry) => entry.islandId === island);
}

function reachableIslandWithFarmland(snap: AstrixStateSnapshot): BiomeId | null {
  for (const entry of snap.farmland) {
    if (entry.available > 0 && isReachable(snap, entry.islandId)) return entry.islandId;
  }
  return null;
}

function unreachableIslandWithFarmland(snap: AstrixStateSnapshot): BiomeId | null {
  for (const entry of snap.farmland) {
    if (entry.available > 0 && !isReachable(snap, entry.islandId)) return entry.islandId;
  }
  return null;
}

function needsMoreFarmland(snap: AstrixStateSnapshot): boolean {
  return reachableIslandWithFarmland(snap) === null;
}

/**
 * A wood node on a reachable island is the only clearing that yields farmland.
 * Skips targets whose identical proposal a human already rejected, so the
 * steward tries a different site rather than re-asking for a refused one.
 */
function clearableNode(snap: AstrixStateSnapshot, rejected: Set<string>) {
  return snap.resourceNodes.find((node) => {
    if (node.type !== "wood" || node.quantity <= 0) return false;
    if (!isReachable(snap, node.islandId)) return false;
    const signature = signatureOf({
      tool: "clear_terrain",
      args: { position: { ...node.position }, radius: 2 },
    });
    return !rejected.has(signature);
  });
}

function farmPosition(island: BiomeId, index: number): { x: number; y: number; z: number } {
  const origin: Record<BiomeId, { x: number; z: number; y: number }> = {
    meadow: { x: 10, z: 10, y: 0 },
    frost: { x: 44, z: 10, y: 0 },
    dusk: { x: 72, z: 30, y: 0 },
  };
  const base = origin[island];
  return { x: base.x + (index % 4) * 4, y: base.y, z: base.z + Math.floor(index / 4) * 4 };
}

function describeFarmland(snap: AstrixStateSnapshot): string {
  return snap.farmland
    .map((entry) => `${entry.islandId} ${entry.used}/${entry.capacity}${isReachable(snap, entry.islandId) ? "" : " (unreachable)"}`)
    .join(", ");
}

function idleReason(snap: AstrixStateSnapshot, hadRejection: boolean, farmCapReached: boolean): string {
  const parts = [
    `day ${snap.day} (${snap.season})`,
    `population ${snap.population}`,
    `food ${snap.food} at ${snap.foodPerDay}/day`,
    `pressure ${snap.foodPressureLevel}`,
    `farmland ${describeFarmland(snap)}`,
  ];
  if (hadRejection) {
    parts.push("an irreversible expansion was rejected by the human, so it will not be re-proposed this run");
  }
  if (farmCapReached) parts.push("the configured farm cap has been reached");
  return parts.join("; ") + ".";
}
