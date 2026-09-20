// Revocation drill properties: hands removed mid-operation, world valid,
// human keeps governing. Deterministic, real Core throughout.
import { describe, it, expect } from "vitest";
import { AstrixWorldState } from "../src/astrix/state";
import { AstrixGameCommandBus } from "../src/astrix/commandBus";
import { createAstrixToolRegistry } from "../src/astrix/mcpTools";
import { AstrixEventLog } from "../src/astrix/events";
import { AstrixStewardLoop } from "../src/astrix/orchestrator";
import { runRevocationDrill } from "../src/astrix/revocationDrill";

describe("revocation drill: revocable hands", () => {
  it("is deterministic and passes with the fail-closed narrative intact", async () => {
    const a = await runRevocationDrill({});
    const b = await runRevocationDrill({});
    expect(a.score.pass).toBe(true);
    expect(b.score.pass).toBe(true);
    expect(a.summary).toEqual(b.summary);
    expect(a.events.map((e) => e.type)).toEqual(b.events.map((e) => e.type));
    expect(a.mutations).toEqual([
      { actor: "steward", what: expect.stringContaining("built+verified"), day: expect.any(Number) },
      { actor: "human", what: expect.stringContaining("approved+executed"), day: expect.any(Number) },
    ]);
  }, 30000);

  it("records the stop reason and clears it on restart (restart is re-authorization)", async () => {
    const state = new AstrixWorldState();
    const bus = new AstrixGameCommandBus(state);
    const tools = createAstrixToolRegistry(state, bus);
    const events = new AstrixEventLog();
    const loop = new AstrixStewardLoop({
      state, bus, tools, events,
      provider: {
        id: "parker",
        decide: async () => ({
          decision: "bridge",
          toolCalls: [{ tool: "build_bridge", args: { island_a: "meadow", island_b: "frost" } }],
        }),
      },
      maxTurnsPerRun: 1, maxActionsPerTurn: 1, decideTimeoutMs: 1000,
    });
    loop.start();
    const deadline = Date.now() + 5000;
    while (loop.state !== "AWAITING_APPROVAL" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(loop.state).toBe("AWAITING_APPROVAL");
    expect(loop.stop("authority-revoked").ok).toBe(true);
    await loop.whenSettled();
    expect(loop.state).toBe("STOPPED");
    expect((loop.status() as { stopReason?: unknown }).stopReason).toBe("authority-revoked");
    // Refusing stop on a non-running loop changes nothing.
    expect(loop.stop("authority-revoked").ok).toBe(false);
    // Restarting clears the reason: a restart is a fresh explicit authorization.
    expect(loop.start("resume").ok).toBe(true);
    expect((loop.status() as { stopReason?: unknown }).stopReason).toBeNull();
    loop.stop();
    await loop.whenSettled();
  });
});
