// GameState is a plain, serializable object (fixed-size arrays, no classes).
// The one thing that NEVER lives in GameState is treasure_furniture_id — it is
// kept only on the GameEngine instance so it can never leak through /state.
//
// JSON schema (draft-07) for the public state the server exposes:
//
// {
//   "$schema": "http://json-schema.org/draft-07/schema#",
//   "title": "GronksHoardGameState",
//   "type": "object",
//   "required": [
//     "matchId", "status", "tick", "elapsed", "matchDuration",
//     "winnerTeam", "winReason", "suddenDeath", "enraged",
//     "riddleSet", "visibleRiddleLines", "players", "furniture",
//     "gronk", "pedestals", "closetSpots", "groundTreasure",
//     "treasurePings", "pendingBank", "bankCooldownUntilTick", "latestNoise"
//   ],
//   "properties": {
//     "matchId": { "type": "string" },
//     "status": { "enum": ["lobby", "playing", "finished"] },
//     "tick": { "type": "integer", "minimum": 0 },
//     "elapsed": { "type": "number", "minimum": 0 },
//     "matchDuration": { "type": "number" },
//     "winnerTeam": { "type": ["integer", "null"], "enum": [0, 1, null] },
//     "winReason": { "type": ["string", "null"], "enum": ["bank", "closet", null] },
//     "suddenDeath": { "type": "boolean" },
//     "enraged": { "type": "boolean" },
//     "riddleSet": { "type": "integer" },
//     "visibleRiddleLines": { "type": "array", "items": { "type": "string" } },
//     "players": {
//       "type": "array", "minItems": 4, "maxItems": 4,
//       "items": {
//         "type": "object",
//         "required": [
//           "id", "team", "name", "x", "y", "state", "transformedAs",
//           "carrying", "stunnedUntilTick", "immunityUntilTick",
//           "closetUntilTick", "spawnX", "spawnY", "moveDx", "moveDy"
//         ],
//         "properties": {
//           "id": { "type": "string" },
//           "team": { "enum": [0, 1] },
//           "name": { "type": "string" },
//           "x": { "type": "number" },
//           "y": { "type": "number" },
//           "state": { "enum": ["active", "transformed", "stunned", "in_closet"] },
//           "transformedAs": { "type": ["string", "null"] },
//           "carrying": { "type": "boolean" },
//           "stunnedUntilTick": { "type": "integer" },
//           "immunityUntilTick": { "type": "integer" },
//           "closetUntilTick": { "type": "integer" },
//           "spawnX": { "type": "number" },
//           "spawnY": { "type": "number" },
//           "moveDx": { "type": "number" },
//           "moveDy": { "type": "number" }
//         }
//       }
//     },
//     "furniture": {
//       "type": "array",
//       "items": {
//         "type": "object",
//         "required": ["id", "name", "x", "y", "w", "h"],
//         "properties": {
//           "id": { "type": "string" },
//           "name": { "type": "string" },
//           "x": { "type": "number" },
//           "y": { "type": "number" },
//           "w": { "type": "number" },
//           "h": { "type": "number" }
//         }
//       }
//     },
//     "gronk": {
//       "type": "object",
//       "required": ["x", "y", "mode", "target", "enraged", "nextSniffTick", "wanderTarget"],
//       "properties": {
//         "x": { "type": "number" },
//         "y": { "type": "number" },
//         "mode": { "enum": ["wander", "chase"] },
//         "target": {
//           "type": ["object", "null"],
//           "properties": {
//             "type": { "enum": ["player", "noise", "point"] },
//             "playerId": { "type": "string" },
//             "x": { "type": "number" },
//             "y": { "type": "number" }
//           }
//         },
//         "enraged": { "type": "boolean" },
//         "nextSniffTick": { "type": "integer" },
//         "wanderTarget": {
//           "type": ["object", "null"],
//           "properties": { "x": { "type": "number" }, "y": { "type": "number" } }
//         }
//       }
//     },
//     "pedestals": {
//       "type": "array", "minItems": 2, "maxItems": 2,
//       "items": { "type": "object", "properties": { "x": { "type": "number" }, "y": { "type": "number" } } }
//     },
//     "closetSpots": {
//       "type": "array", "minItems": 2, "maxItems": 2,
//       "items": { "type": "object", "properties": { "x": { "type": "number" }, "y": { "type": "number" } } }
//     },
//     "groundTreasure": {
//       "type": ["object", "null"],
//       "properties": { "x": { "type": "number" }, "y": { "type": "number" } }
//     },
//     "treasurePings": {
//       "type": "array",
//       "items": {
//         "type": "object",
//         "properties": {
//           "tick": { "type": "integer" },
//           "x": { "type": "number" },
//           "y": { "type": "number" }
//         }
//       }
//     },
//     "pendingBank": {
//       "type": ["object", "null"],
//       "properties": {
//         "team": { "enum": [0, 1] },
//         "playerId": { "type": "string" },
//         "tick": { "type": "integer" }
//       }
//     },
//     "bankCooldownUntilTick": {
//       "type": "array", "minItems": 2, "maxItems": 2,
//       "items": { "type": "integer" }
//     },
//     "latestNoise": {
//       "type": ["object", "null"],
//       "properties": {
//         "x": { "type": "number" },
//         "y": { "type": "number" },
//         "tick": { "type": "integer" }
//       }
//     }
//   }
// }

export type TeamId = 0 | 1;
export type PlayerState = "active" | "transformed" | "stunned" | "in_closet";
export type MatchStatus = "lobby" | "playing" | "finished";
export type WinReason = "bank" | "closet";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Player {
  id: string;
  team: TeamId;
  name: string;
  x: number;
  y: number;
  state: PlayerState;
  transformedAs: string | null; // furniture id while hidden
  carrying: boolean;
  stunnedUntilTick: number;
  immunityUntilTick: number; // 2s post-stun immunity
  closetUntilTick: number;
  spawnX: number;
  spawnY: number;
  moveDx: number; // normalized movement input (from move())
  moveDy: number;
}

export interface Furniture {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type GronkTarget =
  | { type: "player"; playerId: string }
  | { type: "noise"; x: number; y: number }
  | { type: "point"; x: number; y: number };

export interface GronkState {
  x: number;
  y: number;
  mode: "wander" | "chase";
  target: GronkTarget | null;
  enraged: boolean;
  nextSniffTick: number;
  wanderTarget: Vec2 | null;
}

export interface GameState {
  matchId: string;
  status: MatchStatus;
  tick: number;
  elapsed: number; // seconds
  matchDuration: number;
  winnerTeam: TeamId | null;
  winReason: WinReason | null;
  suddenDeath: boolean;
  enraged: boolean;
  riddleSet: number;
  visibleRiddleLines: string[];
  players: Player[]; // fixed size: 4 (2 per team)
  furniture: Furniture[]; // fixed size: 10
  gronk: GronkState;
  pedestals: Vec2[]; // index = team id
  closetSpots: Vec2[]; // index = team id
  groundTreasure: Vec2 | null;
  treasurePings: { tick: number; x: number; y: number }[];
  pendingBank: { team: TeamId; playerId: string; tick: number } | null;
  // After a bank request is REJECTED, that team can't re-request for 10s.
  // Index = team id; value = tick until which the cooldown is active.
  bankCooldownUntilTick: [number, number];
  // Most recent search noise. Never the treasure id; Gronk agents use this
  // for their priority #1. Point-only, so it can't leak the secret.
  latestNoise: { x: number; y: number; tick: number } | null;
}
