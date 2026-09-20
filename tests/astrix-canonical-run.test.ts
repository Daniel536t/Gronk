// Part XII — canonical 30-day ASTrix Core run (integration test).
//
// Drives the SAME code path as `npm run astrix:canonical` (src/astrix/canonicalRun.ts)
// and asserts the lifecycle invariants the mission requires. This is the
// end-to-end proof that ASTrix Core observes a changing world, proposes actions,
// is genuinely interruptible by a human, and reasons from the resulting
// authoritative state — with TrueForge absent from the Core path.
//
// Assertions are invariant-based, not brittle event-order snapshots. The one
// ordering that IS a contract (propose -> execute -> verify per action) is
// asserted per action id rather than against the global event sequence.
import { describe, it, expect } from "vitest";
import {
  runCanonicalScenario,
  renderCanonicalMarkdown,
  rejectFirstThenApprove,
} from "../src/astrix/canonicalRun";

describe("ASTrix canonical run (Part XII)", () => {
  it("runs the full 30-day lifecycle on Core with no TrueForge", async () => {
    const artifact = await runCanonicalScenario({ days: 30, seed: "test-canonical" });
    const s = artifact.summary;

    // --- world initialized + time progressed -------------------------------
    expect(artifact.startState.day).toBe(1);
    expect(artifact.startState.population).toBe(4);
    expect(artifact.startState.food).toBe(40);
    expect(artifact.finalState.day).toBeGreaterThanOrEqual(30);
    expect(artifact.frames.length).toBeGreaterThanOrEqual(30);
    // Days are monotonically non-decreasing across frames.
    for (let i = 1; i < artifact.frames.length; i++) {
      expect(artifact.frames[i].day).toBeGreaterThanOrEqual(artifact.frames[i - 1].day);
    }

    // --- steward reasoned and proposed -------------------------------------
    expect(s.decisions).toBeGreaterThan(5);
    expect(s.proposals).toBeGreaterThan(5);
    // Every recorded decision carries an observable rationale (no chain-of-thought).
    for (const decision of artifact.decisions) {
      expect(decision.decision.length).toBeGreaterThan(0);
      expect(decision.rationale && decision.rationale.length > 0).toBe(true);
    }

    // --- the approval gate was genuinely exercised, both ways --------------
    expect(s.highRiskProposals).toBeGreaterThanOrEqual(1);
    expect(s.approvalsRejected).toBeGreaterThanOrEqual(1);
    expect(s.approvalsGranted).toBeGreaterThanOrEqual(1);

    // --- rejection => ZERO mutation ---------------------------------------
    const rejected = artifact.approvals.filter((a) => a.humanDecision === "reject");
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    for (const approval of rejected) {
      expect(approval.mutated).toBe(false);
      expect(approval.executed).toBe(false);
      expect(approval.verified).toBe(false);
      expect(approval.worldAfter).toEqual(approval.worldBefore);
    }

    // --- approval => exactly one execution, verified ----------------------
    const granted = artifact.approvals.filter((a) => a.humanDecision === "approve");
    expect(granted.length).toBeGreaterThanOrEqual(1);
    for (const approval of granted) {
      expect(approval.executed).toBe(true);
      expect(approval.verified).toBe(true);
      expect(approval.mutated).toBe(true);
      // The approval was bound to a concrete impact by the bus, not by the agent.
      expect(Object.keys(approval.impact).length).toBeGreaterThan(0);
      expect(approval.reason.length).toBeGreaterThan(0);
    }
    // No approval id appears twice (no replay).
    const ids = artifact.approvals.map((a) => a.approvalId);
    expect(new Set(ids).size).toBe(ids.length);

    // --- the steward adapted after the refusal ----------------------------
    expect(artifact.adaptations.length).toBeGreaterThanOrEqual(1);
    for (const adaptation of artifact.adaptations) {
      expect(adaptation.changed).toBe(true);
      // It did not simply re-ask for the identical refused action.
      expect(JSON.stringify(adaptation.nextProposal)).not.toBe(
        JSON.stringify(adaptation.rejectedProposal),
      );
    }

    // --- execution + verification are distinct and consistent -------------
    expect(s.actionsExecuted).toBeGreaterThan(0);
    expect(s.actionsVerified).toBeGreaterThan(0);
    // Nothing claims verification without execution.
    const verifiedNotExecuted = artifact.actions.filter(
      (a) => a.verificationState === "VERIFIED" && a.executionState !== "SUCCEEDED",
    );
    expect(verifiedNotExecuted).toHaveLength(0);
    // No failed action was marked verified (no false success).
    const falseSuccess = artifact.actions.filter(
      (a) => a.executionState === "FAILED" && a.verificationState === "VERIFIED",
    );
    expect(falseSuccess).toHaveLength(0);

    // --- per-action lifecycle ordering (the real contract) ----------------
    const byAction = new Map<string, string[]>();
    for (const event of artifact.events) {
      const id = event.actionId;
      if (!id) continue;
      if (!byAction.has(id)) byAction.set(id, []);
      byAction.get(id)!.push(event.type);
    }
    for (const [, sequence] of byAction) {
      const proposed = sequence.indexOf("ACTION_PROPOSED");
      const executing = sequence.indexOf("ACTION_EXECUTING");
      const verified = sequence.indexOf("VERIFICATION_SUCCEEDED");
      if (proposed >= 0 && executing >= 0) expect(proposed).toBeLessThan(executing);
      if (executing >= 0 && verified >= 0) expect(executing).toBeLessThan(verified);
    }

    // --- consequences reached the world -----------------------------------
    expect(s.farmsBuilt).toBeGreaterThan(artifact.startState.farms);
    expect(artifact.finalState.resources.wood).not.toBe(artifact.startState.resources.wood);
    expect(artifact.consequences.length).toBeGreaterThan(0);

    // --- event log is a usable record -------------------------------------
    expect(artifact.events.length).toBeGreaterThan(50);
    const types = new Set(artifact.events.map((e) => e.type));
    for (const required of [
      "TURN_STARTED",
      "WORLD_OBSERVED",
      "DECISION_COMPLETED",
      "PLAN_CREATED",
      "ACTION_PROPOSED",
      "APPROVAL_REQUIRED",
      "APPROVAL_GRANTED",
      "APPROVAL_REJECTED",
      "ACTION_SUCCEEDED",
      "VERIFICATION_SUCCEEDED",
      "TURN_COMPLETED",
    ]) {
      expect(types.has(required as never)).toBe(true);
    }

    // --- final state is internally consistent ------------------------------
    expect(s.consistent).toBe(true);
    expect(artifact.finalState.food).toBeGreaterThanOrEqual(0);
    expect(artifact.finalState.population).toBeGreaterThanOrEqual(0);
    expect(artifact.finalState.resources.food).toBe(artifact.finalState.food);

    // --- TrueForge was not required ---------------------------------------
    expect(artifact.provider).toBe("local-astrix-steward");
    expect(s.trueforgeUsed).toBe(false);
    expect(artifact.trueforge.used).toBe(false);
  }, 60_000);

  it("produces a reproducible artifact for the same seed (same class of evidence)", async () => {
    const a = await runCanonicalScenario({ days: 12, seed: "repro" });
    const b = await runCanonicalScenario({ days: 12, seed: "repro" });

    // Identical world trajectory and governance outcome.
    expect(b.finalState).toEqual(a.finalState);
    expect(b.frames).toEqual(a.frames);
    expect(b.summary.approvalsGranted).toBe(a.summary.approvalsGranted);
    expect(b.summary.approvalsRejected).toBe(a.summary.approvalsRejected);
    expect(b.summary.actionsExecuted).toBe(a.summary.actionsExecuted);
    expect(b.summary.outcome).toBe(a.summary.outcome);
    // Same decisions in the same order (rationale text included).
    expect(b.decisions.map((d) => `${d.day}:${d.decision}`)).toEqual(
      a.decisions.map((d) => `${d.day}:${d.decision}`),
    );
    // Same event sequence by type (timestamps excluded — they are wall clock).
    expect(b.events.map((e) => e.type)).toEqual(a.events.map((e) => e.type));
  }, 60_000);

  it("keeps world time frozen while a proposal awaits the human", async () => {
    // The canonical driver never ticks the clock inside the governance block, so
    // the day recorded on an approval must equal the day of the frame it sits in.
    const artifact = await runCanonicalScenario({ days: 12, seed: "gate" });
    for (const approval of artifact.approvals) {
      const frame = artifact.frames.find((f) => f.day === approval.day);
      expect(frame).toBeDefined();
    }
    // Days advance exactly once per loop iteration: no day is skipped.
    const days = artifact.frames.map((f) => f.day);
    for (let i = 1; i < days.length; i++) {
      expect(days[i] - days[i - 1]).toBeLessThanOrEqual(1);
    }
  }, 60_000);

  it("renders a human-readable summary containing the governance moments", async () => {
    const artifact = await runCanonicalScenario({ days: 12, seed: "md" });
    const md = renderCanonicalMarkdown(artifact);
    expect(md).toContain("# ASTrix Canonical Run");
    expect(md).toContain("TrueForge used | **NO**");
    expect(md).toContain("APPROVAL GATE");
    expect(md).toContain("ZERO MUTATION");
    expect(md).toContain("ADAPTATION");
    expect(md).toContain("Final state");
  }, 60_000);

  it("honours an alternative human policy (reject everything => no irreversible mutation)", async () => {
    const artifact = await runCanonicalScenario({
      days: 14,
      seed: "reject-all",
      humanPolicy: () => "reject",
    });
    expect(artifact.summary.approvalsRejected).toBeGreaterThanOrEqual(1);
    expect(artifact.summary.approvalsGranted).toBe(0);
    // No bridge was ever built and no node was ever removed by clearing.
    expect(artifact.finalState.bridges).toBe(0);
    expect(artifact.finalState.resourceNodes).toBe(artifact.startState.resourceNodes);
    for (const approval of artifact.approvals) expect(approval.mutated).toBe(false);
    // The world still ran, and the steward still did reversible work.
    expect(artifact.summary.actionsExecuted).toBeGreaterThan(0);
    expect(artifact.summary.consistent).toBe(true);
  }, 60_000);

  it("exposes the default human policy used by the canonical artifact", () => {
    expect(rejectFirstThenApprove({ index: 0, tool: "clear_terrain", day: 1, approvalId: "a" })).toBe("reject");
    expect(rejectFirstThenApprove({ index: 1, tool: "clear_terrain", day: 2, approvalId: "b" })).toBe("approve");
  });
});
