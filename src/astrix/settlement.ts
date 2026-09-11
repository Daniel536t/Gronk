// ASTrix governance receipts — PURE definitions and builders (Core side).
//
// A receipt is the externally settleable claim for one VERIFIED high-risk
// action: approval + exact command + outcome, hash-chained to the previous
// receipt. This file defines the schema, the canonical command encoding, and
// the builder. It performs no IO, holds no handles, imports nothing beyond
// node:crypto and Core types — the same standing as bridgeAnchorFor().
//
// Submission, journals, retries, and chain contact live OUTSIDE Core
// (src/settlement/), consuming the event log. Core executes and verifies;
// the adapter witnesses. See ASTRIX_MAGICBLOCK_ARCHITECTURE.md §§8-19.
import { createHash } from "node:crypto";
import type { AstrixPosition, BiomeId, ResourceType } from "./state";

/** Commands eligible for settlement: verified HIGH-risk actions only. */
export type SettleableCommand = "CLEAR_TERRAIN" | "BUILD_BRIDGE";

export type SettlementBuildingType = "house" | "farm" | "storage" | "bridge_segment";

/** Canonical command parameters: enums in Core case, positions in Core units. */
export interface CanonicalParams {
  command: SettleableCommand;
  islandA?: BiomeId;
  islandB?: BiomeId;
  position?: AstrixPosition;
  radius?: number;
  buildingType?: SettlementBuildingType;
  islandId?: BiomeId;
  farmPlotId?: string;
  cropType?: string;
  cropId?: string;
  resourceId?: string;
  resourceType?: ResourceType;
}

export interface GovernanceReceipt {
  receiptVersion: 1;
  approvalId: string;
  command: SettleableCommand;
  commandHash: string;
  /** Canonical params bytes (base64) so verifiers recompute the hash w/o us. */
  params: string;
  /** approve: only approved-then-verified actions settle. */
  decision: "approve";
  resultEntityId: string;
  /** Hex; zeros for the first receipt. Continuity, not completeness (§15). */
  prevReceiptHash: string;
  /** Receipt's own chain hash: sha256(prevReceiptHash + commandHash). */
  receiptHash: string;
  runId: string;
  turn: number;
  actionId: string;
  /** Logical sim time (day + turn), never wall-clock. */
  decidedDay: number;
  decidedTurn: number;
  chainId: string;
  programId: string;
}

export const RECEIPT_VERSION = 1 as const;
export const RECEIPT_DOMAIN = "astrix-receipt-v1";
const ZERO_HASH = "00".repeat(32);

/** Fixed field order — the heart of hash stability. Never reorder. */
const FIELD_ORDER: Array<keyof CanonicalParams | "command"> = [
  "command",
  "islandA",
  "islandB",
  "position",
  "radius",
  "buildingType",
  "islandId",
  "farmPlotId",
  "cropType",
  "cropId",
  "resourceId",
  "resourceType",
];

/** Quantize to 3 decimals, ASCII, no exponents, no negative zero. */
export function canonicalNumber(value: number): string {
  const q = Math.round(value * 1000) / 1000;
  const clean = Object.is(q, -0) ? 0 : q;
  return String(clean);
}

function canonicalPosition(p: AstrixPosition): string {
  return `${canonicalNumber(p.x)},${canonicalNumber(p.y)},${canonicalNumber(p.z)}`;
}

function fieldValue(params: CanonicalParams, field: keyof CanonicalParams | "command"): string {
  switch (field) {
    case "command": return params.command;
    case "position": return params.position ? canonicalPosition(params.position) : "";
    case "radius": return params.radius === undefined ? "" : canonicalNumber(params.radius);
    default: {
      const v = params[field];
      return v === undefined ? "" : String(v);
    }
  }
}

/**
 * Canonical bytes: domain || length-prefixed fields in FIELD_ORDER.
 * Absent fields encode empty (never omitted). Pure function of intent:
 * costs, timestamps, and approval ids are NOT inputs (costs derive from the
 * command; binding approvalId→hash is the receipt's own job).
 */
export function canonicalizeCommand(params: CanonicalParams): string {
  const parts = FIELD_ORDER.map((f) => {
    const v = fieldValue(params, f);
    return `${v.length}:${v}`;
  });
  return `${RECEIPT_DOMAIN}|${parts.join("|")}`;
}

/** SHA-256 hex of the canonical bytes. */
export function commandHash(params: CanonicalParams): string {
  return createHash("sha256").update(canonicalizeCommand(params), "utf8").digest("hex");
}

/** Chain hash binding this receipt to its predecessor. */
export function receiptHash(prevReceiptHash: string, cmdHash: string): string {
  return createHash("sha256").update(prevReceiptHash + cmdHash, "utf8").digest("hex");
}

export interface ReceiptInputs {
  approvalId: string;
  params: CanonicalParams;
  resultEntityId: string;
  prevReceiptHash?: string;
  runId: string;
  turn: number;
  actionId: string;
  decidedDay: number;
  decidedTurn: number;
  chainId: string;
  programId: string;
}

/**
 * Build a receipt for a VERIFIED high-risk action. Callers must guarantee the
 * preconditions (approved + executed + verified); the builder binds, it does
 * not authorize. Rejections settle nothing.
 */
export function buildReceipt(inputs: ReceiptInputs): GovernanceReceipt {
  const prev = inputs.prevReceiptHash ?? ZERO_HASH;
  const cmdHash = commandHash(inputs.params);
  return {
    receiptVersion: RECEIPT_VERSION,
    approvalId: inputs.approvalId,
    command: inputs.params.command,
    commandHash: cmdHash,
    params: Buffer.from(canonicalizeCommand(inputs.params), "utf8").toString("base64"),
    decision: "approve",
    resultEntityId: inputs.resultEntityId,
    prevReceiptHash: prev,
    receiptHash: receiptHash(prev, cmdHash),
    runId: inputs.runId,
    turn: inputs.turn,
    actionId: inputs.actionId,
    decidedDay: inputs.decidedDay,
    decidedTurn: inputs.decidedTurn,
    chainId: inputs.chainId,
    programId: inputs.programId,
  };
}

/** Recompute a receipt's hashes from its embedded canonical bytes. */
export function verifyReceiptHashes(receipt: GovernanceReceipt): { commandOk: boolean; chainOk: boolean } {
  const canonical = Buffer.from(receipt.params, "base64").toString("utf8");
  const commandOk =
    createHash("sha256").update(canonical, "utf8").digest("hex") === receipt.commandHash;
  const chainOk = receiptHash(receipt.prevReceiptHash, receipt.commandHash) === receipt.receiptHash;
  return { commandOk: commandOk, chainOk: chainOk };
}
