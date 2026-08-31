// ASTrix Observatory — shared projection types.
//
// The Observatory is a pure projection of the authoritative simulation. It
// never simulates: it renders exactly what the server snapshot or the recorded
// replay timeline says. All types here describe the READ side (state + events)
// only. No world-altering logic exists in this layer.

export type BiomeId = "meadow" | "frost" | "dusk";
export type Season = "spring" | "summer" | "autumn" | "winter";

export interface AstrixPosition { x: number; y: number; z: number }

export interface ResourceNode {
  id: string;
  type: string;
  position: AstrixPosition;
  quantity: number;
  islandId: BiomeId;
}

export interface Building {
  id: string;
  type: string;
  position: AstrixPosition;
  health: number;
  islandId: BiomeId;
}

export interface Crop {
  id: string;
  farmPlotId: string;
  cropType: string;
  growthStage: number; // 0..1
  plantedAtDay?: number;
  harvestable?: boolean;
}

export interface FarmlandPlot {
  islandId: BiomeId;
  capacity: number;
  used: number;
  available: number;
}

export interface Bridge { id: string; islandA: BiomeId; islandB: BiomeId }

export interface Island {
  id: BiomeId;
  biome: string;
  health: number;
  connectivity: string[];
}

/** The subset of the authoritative state snapshot the Observatory renders. */
export interface WorldSnapshot {
  day: number;
  season: Season;
  time: string;
  population: number;
  food: number;
  daysUntilWinter: number;
  foodPerDay: number;
  daysOfFoodRemaining: number;
  harvestableFood: number;
  growingFood: number;
  projectedFoodAtWinter: number;
  foodPressureLevel: "critical" | "high" | "ok";
  resources: Record<string, number>;
  biomeHealth: Record<BiomeId, number>;
  crops: Crop[];
  farmland: FarmlandPlot[];
  bridges: Bridge[];
  buildings: Building[];
  resourceNodes: ResourceNode[];
  islands: Island[];
  pendingApprovals: { id: string; command: string; reason: string; impact: Record<string, unknown> }[];
}

export type AgentEventType =
  | "TURN_STARTED"
  | "WORLD_OBSERVED"
  | "DECISION_STARTED"
  | "DECISION_COMPLETED"
  | "DECISION_RETRY"
  | "PLAN_CREATED"
  | "ACTION_PROPOSED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_GRANTED"
  | "APPROVAL_REJECTED"
  | "ACTION_EXECUTING"
  | "ACTION_SUCCEEDED"
  | "ACTION_FAILED"
  | "VERIFICATION_STARTED"
  | "VERIFICATION_SUCCEEDED"
  | "VERIFICATION_FAILED"
  | "TURN_COMPLETED"
  | "TURN_FAILED"
  | "SEASON_CHANGED";

export interface AgentEvent {
  type: AgentEventType;
  turn: number;
  data?: Record<string, unknown>;
  at: number;
}

export interface ApprovalAction {
  approvalId: string;
  tool: string;
  command?: string;
  reason?: string;
  impact?: Record<string, unknown>;
  executionState?: string;
}

export interface AgentStatus {
  state: string;
  turn: number;
  objective?: string;
  provider?: string;
  pendingApproval: { approvalId: string; action: unknown } | null;
  currentAction: unknown | null;
  actions?: unknown[];
  error?: string | null;
}

/** A single point in the derived replay timeline. */
export interface ReplayStateFrame {
  ts: number;
  day: number;
  season: Season;
  population: number;
  food: number;
  farmland: FarmlandPlot[];
  crops: Crop[];
  farms: number;
  loopState: string;
  turn: number;
  // Full snapshot when available (reconstructed from events); null for the
  // reduced frames recorded by the demo driver.
  snapshot: WorldSnapshot | null;
}

export interface ReplayEventFrame {
  event: AgentEvent;
  ts: number;
  day: number;
}