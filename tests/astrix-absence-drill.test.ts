// Absence-drill properties: the world continues without its steward,
// consequences are real, absence is provable, recovery is scored honestly.
import { describe, it, expect } from "vitest";
import { runAbsenceDrill } from "../src/astrix/absenceDrill";

describe("absence drill: the world doesn't wait", () => {
  it("is deterministic: two runs agree on score, final state, and event order", async () => {
    const a = await runAbsenceDrill({});
    const b = await runAbsenceDrill({});
    expect(a.score).toEqual(b.score);
    expect(a.score.pass).toBe(true);
    expect(a.finalState.food).toBe(b.finalState.food);
    expect(a.finalState.population).toBe(b.finalState.population);
    expect(a.events.map((e) => e.type)).toEqual(b.events.map((e) => e.type));
    expect(a.summary.consistent).toBe(true);
  }, 30000);

  it("proves absence: zero steward decisions and actions while STOPPED", async () => {
    const drill = await runAbsenceDrill({});
    expect(drill.summary.decisionsDuringAbsence).toBe(0);
    expect(drill.summary.actionsDuringAbsence).toBe(0);
    // The world still moved: absence frames advance day by day.
    const absent = drill.frames.filter((f) => f.phase === "ABSENT");
    expect(absent.length).toBe(drill.config.absenceDays);
    for (let i = 1; i < absent.length; i++) {
      expect(absent[i].day).toBe(absent[i - 1].day + 1);
    }
    // And it consumed food with nobody managing it.
    expect(drill.stateAtReconnect.food).toBeLessThan(drill.stateAtDisconnect.food);
  }, 30000);

  it("scores extinction as FAIL, never as a vacuous pass", async () => {
    const drill = await runAbsenceDrill({ absenceDays: 9 });
    expect(drill.stateAtReconnect.population).toBe(0);
    expect(drill.score.populationSurvivedAbsence).toBe(false);
    expect(drill.score.pass).toBe(false);
    expect(drill.summary.outcome).toBe("not-recovered");
  }, 30000);

  it("recovery is real work: harvests land after reconnect, food recovers", async () => {
    const drill = await runAbsenceDrill({});
    const recoverHarvests = drill.actions.filter(
      (a) => a.phase === "RECOVER" && a.tool === "harvest" && a.executionState === "SUCCEEDED",
    );
    expect(recoverHarvests.length).toBeGreaterThan(0);
    expect(drill.finalState.food).toBeGreaterThan(0);
    expect(drill.finalState.population).toBeGreaterThanOrEqual(drill.stateAtReconnect.population);
  }, 30000);
});
