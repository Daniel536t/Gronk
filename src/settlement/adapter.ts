// Settlement adapters — OUTSIDE ASTrix Core (never imported by src/astrix/*).
//
// The adapter witnesses verified high-risk actions and settles their receipts.
// It holds no world handle, awaits nothing in the loop, and cannot mutate the
// simulation: the worst it can do is fail to record. See
// ASTRIX_MAGICBLOCK_ARCHITECTURE.md §§12-17.
//
// Implementations: NullSettlementAdapter (journal-only, deterministic — keeps
// tests, canonical runs, and offline dev identical with no chain access).
// A Solana/MagicBlock implementation would implement the same interface in a
// later phase; Core stays untouched either way.
import { createHash } from "node:crypto";
import type { GovernanceReceipt } from "../astrix/settlement";

export type SettlementStatus =
  | "PENDING"
  | "SUBMITTED"
  | "SETTLED"
  | "FAILED_RETRYABLE"
  | "MISMATCH";

export interface ReconcileReport {
  journalEntries: number;
  settled: number;
  pending: number;
  mismatches: string[];
}

export interface SettlementAdapter {
  readonly id: string;
  submit(receipt: GovernanceReceipt): Promise<{ txSig: string }>;
  status(actionId: string): Promise<SettlementStatus>;
  reconcile(): Promise<ReconcileReport>;
}

interface JournalEntry {
  receipt: GovernanceReceipt;
  status: SettlementStatus;
  txSig: string | null;
  attempts: number;
}

/**
 * Null adapter: records receipts in a memory journal with deterministic
 * pseudo-signatures (sha256 of the receipt hash — stable across runs, never
 * touching a network). Used by tests and offline environments. Reconcile is
 * trivially consistent: without a chain there is nothing to disagree with,
 * and the journal itself is the evidence under test.
 */
export class NullSettlementAdapter implements SettlementAdapter {
  readonly id = "null";
  private readonly journal = new Map<string, JournalEntry>();

  async submit(receipt: GovernanceReceipt): Promise<{ txSig: string }> {
    const existing = this.journal.get(receipt.actionId);
    if (existing) return { txSig: existing.txSig ?? this.pseudoSig(receipt) };
    const txSig = this.pseudoSig(receipt);
    this.journal.set(receipt.actionId, { receipt, status: "SETTLED", txSig, attempts: 1 });
    return { txSig };
  }

  async status(actionId: string): Promise<SettlementStatus> {
    return this.journal.get(actionId)?.status ?? "PENDING";
  }

  async reconcile(): Promise<ReconcileReport> {
    let settled = 0;
    let pending = 0;
    for (const entry of this.journal.values()) {
      if (entry.status === "SETTLED") settled += 1;
      else pending += 1;
    }
    return { journalEntries: this.journal.size, settled, pending, mismatches: [] };
  }

  /** Journal contents for evidence/export (copies, never live references). */
  entries(): Array<{ actionId: string; receipt: GovernanceReceipt; txSig: string | null; status: SettlementStatus }> {
    return [...this.journal.entries()].map(([actionId, e]) => ({
      actionId,
      receipt: { ...e.receipt },
      txSig: e.txSig,
      status: e.status,
    }));
  }

  private pseudoSig(receipt: GovernanceReceipt): string {
    return `null-${createHash("sha256").update(receipt.receiptHash, "utf8").digest("hex").slice(0, 44)}`;
  }
}
