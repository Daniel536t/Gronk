// The world clock is bound to stewardship. These tests pin the POLICY (which
// LoopStates let time pass) and the CONSEQUENCE the policy exists for: an idle
// deployment must not starve its settlement unattended.
//
// The bug: the clock was a bare `setInterval(() => astrix.tick(1), 1000)` armed
// at boot, while the steward only runs on POST /astrix/agent/start. The live
// world reached day 237 with population 0, food 0, no crops and no bridges.
import { describe, it, expect } from "vitest";
import { clockShouldTick, worldClockMode } from "../src/server/worldClock";
import { AstrixWorldState } from "../src/astrix/state";
import type { LoopState } from "../src/astrix/orchestrator";

describe("ASTrix world clock — mode selection", () => {
  it("defaults to managed when unset or empty", () => {
    expect(worldClockMode(undefined)).toBe("managed");
    expect(worldClockMode("")).toBe("managed");
    expect(worldClockMode("   ")).toBe("managed");
  });

  it("accepts ASTRIX_CLOCK=always as the ops escape hatch, case-insensitively", () => {
    expect(worldClockMode("always")).toBe("always");
    expect(worldClockMode(" ALWAYS ")).toBe("always");
  });

  it("treats any unrecognised value as managed rather than silently ungating time", () => {
    expect(worldClockMode("yes")).toBe("managed");
    expect(worldClockMode("on")).toBe("managed");
  });
});

describe("ASTrix world clock — managed mode advances only under a live steward", () => {
  const live: LoopState[] = ["RUNNING", "AWAITING_APPROVAL"];
  const notLive: LoopState[] = ["IDLE", "COMPLETED", "STOPPED", "FAILED"];

  for (const state of live) {
    it(`ticks while the steward is ${state}`, () => {
      expect(clockShouldTick("managed", state)).toBe(true);
    });
  }

  for (const state of notLive) {
    it(`holds while the steward is ${state}`, () => {
      expect(clockShouldTick("managed", state)).toBe(false);
    });
  }

  it("holds on an unknown state rather than assuming a run is live", () => {
    expect(clockShouldTick("managed", "SOMETHING_NEW")).toBe(false);
  });

  it("always mode ticks in every state, including no steward at all", () => {
    for (const state of [...live, ...notLive]) {
      expect(clockShouldTick("always", state)).toBe(true);
    }
  });
});

describe("ASTrix world clock — the starvation this prevents", () => {
  /** Drive `seconds` of wall time through the gate exactly as the interval does. */
  function runUngated(state: AstrixWorldState, seconds: number): void {
    for (let i = 0; i < seconds; i += 1) {
      if (clockShouldTick("always", "IDLE")) state.tick(1);
    }
  }

  function runManaged(state: AstrixWorldState, seconds: number, loop: LoopState): void {
    for (let i = 0; i < seconds; i += 1) {
      if (clockShouldTick("managed", loop)) state.tick(1);
    }
  }

  it("an unmanaged world starves when the clock is ungated (the reported day-237 corpse)", () => {
    const state = new AstrixWorldState();
    const startDay = state.snapshot().day;
    // ~9.5 hours of real time, which is what the deployment had actually run.
    runUngated(state, 9.5 * 3600);
    const after = state.snapshot();
    expect(after.day).toBeGreaterThan(startDay + 200);
    expect(after.population).toBe(0);
    expect(after.food).toBe(0);
  });

  it("an unmanaged world HOLDS under the managed clock: same day, same population", () => {
    const state = new AstrixWorldState();
    const before = state.snapshot();
    runManaged(state, 9.5 * 3600, "IDLE");
    const after = state.snapshot();
    expect(after.day).toBe(before.day);
    expect(after.population).toBe(before.population);
    expect(after.food).toBe(before.food);
  });

  it("time resumes the moment a run is live — the clock is gated, not disabled", () => {
    const state = new AstrixWorldState();
    const before = state.snapshot();
    runManaged(state, 600, "RUNNING");
    expect(state.snapshot().day).toBeGreaterThan(before.day);
  });
});
