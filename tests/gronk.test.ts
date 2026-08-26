import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { makeEngine, neutralize, place, player } from "./helpers";

describe("Gronk FSM", () => {
  it("wanders when nothing is visible and no noise exists", () => {
    const eng = makeEngine();
    neutralize(eng); // everyone hidden, sniffing disabled
    eng.state.gronk.x = 50;
    eng.state.gronk.y = 30;
    const x0 = eng.state.gronk.x;
    const y0 = eng.state.gronk.y;
    eng.tick(10);
    const moved = Math.hypot(eng.state.gronk.x - x0, eng.state.gronk.y - y0);
    assert.ok(moved > 0, "Gronk should move while wandering");
    assert.equal(eng.state.gronk.mode, "wander");
  });

  it("sniffs every 15s and targets the nearest visible player", () => {
    const eng = makeEngine();
    neutralize(eng, ["wizard-0", "wizard-2"]);
    place(eng, "wizard-0", 55, 30);
    place(eng, "wizard-2", 80, 30);
    eng.state.gronk.x = 50;
    eng.state.gronk.y = 30;
    eng.state.gronk.nextSniffTick = 0; // force a sniff immediately
    eng.tick(1);
    assert.deepEqual(eng.state.gronk.target, { type: "player", playerId: "wizard-0" });
    assert.equal(eng.state.gronk.mode, "chase");

    // Gronk moves toward the chased player.
    const x0 = eng.state.gronk.x;
    eng.tick(10);
    assert.ok(eng.state.gronk.x > x0, "Gronk closed in on the player");
  });

  it("prioritizes a stunned player over a nearer active player", () => {
    const eng = makeEngine();
    neutralize(eng, ["wizard-0", "wizard-2"]);
    place(eng, "wizard-0", 55, 30); // active, close
    place(eng, "wizard-2", 80, 30); // stunned, farther
    player(eng, "wizard-2").state = "stunned";
    player(eng, "wizard-2").stunnedUntilTick = 1e9;
    eng.state.gronk.x = 50;
    eng.state.gronk.y = 30;
    eng.state.gronk.nextSniffTick = 0;
    eng.tick(1);
    assert.deepEqual(eng.state.gronk.target, { type: "player", playerId: "wizard-2" });
  });

  it("prioritizes the latest noise over a stunned player", () => {
    const eng = makeEngine();
    eng.treasureFurnitureId = "furn-0";
    neutralize(eng, ["wizard-0"]);
    place(eng, "wizard-0", 25, 30);
    eng.action("wizard-0"); // search -> noise at (25,30)

    // A stunned player exists but is farther than the noise.
    player(eng, "wizard-2").state = "stunned";
    player(eng, "wizard-2").stunnedUntilTick = 1e9;
    place(eng, "wizard-2", 90, 50);

    eng.state.gronk.x = 50;
    eng.state.gronk.y = 30;
    eng.state.gronk.nextSniffTick = 0;
    eng.tick(1);
    assert.deepEqual(eng.state.gronk.target, { type: "noise", x: 25, y: 30 });
  });

  it("falls back to the latest noise when no player is visible", () => {
    const eng = makeEngine();
    eng.treasureFurnitureId = "furn-0";
    neutralize(eng, ["wizard-0"]);
    place(eng, "wizard-0", 25, 30);
    eng.action("wizard-0"); // search -> noise at (25,30)

    // Now everyone hides: only the noise remains as a target.
    for (const p of eng.state.players) {
      p.state = "transformed";
      p.transformedAs = "furn-0";
    }
    eng.state.gronk.x = 50;
    eng.state.gronk.y = 30;
    eng.state.gronk.nextSniffTick = 0;
    eng.tick(1);
    assert.deepEqual(eng.state.gronk.target, { type: "noise", x: 25, y: 30 });

    const d0 = Math.hypot(25 - eng.state.gronk.x, 30 - eng.state.gronk.y);
    eng.tick(10);
    const d1 = Math.hypot(25 - eng.state.gronk.x, 30 - eng.state.gronk.y);
    assert.ok(d1 < d0, "Gronk moved toward the noise");
  });

  it("does not target or catch transformed (hidden) players", () => {
    const eng = makeEngine();
    neutralize(eng, ["wizard-0"]);
    place(eng, "wizard-0", 50, 32); // furn-4 spot
    player(eng, "wizard-0").state = "transformed";
    player(eng, "wizard-0").transformedAs = "furn-4";
    eng.state.gronk.x = 50;
    eng.state.gronk.y = 30; // right next to the hiding spot
    eng.state.gronk.nextSniffTick = 0;
    eng.tick(5);
    assert.equal(player(eng, "wizard-0").state, "transformed"); // never caught
    assert.equal(eng.state.gronk.mode, "wander"); // and never targeted
  });
});

describe("Gronk enrage", () => {
  it("enrages at 4:00 (final 60s) and doubles speed", () => {
    const eng = makeEngine();
    neutralize(eng, ["wizard-0"]);
    eng.state.tick = 2399;
    eng.state.elapsed = 239.9;
    place(eng, "wizard-0", 80, 30);
    eng.state.gronk.x = 20;
    eng.state.gronk.y = 30;
    eng.state.gronk.nextSniffTick = 0;
    eng.tick(1);
    assert.equal(eng.state.enraged, true);
    assert.equal(eng.state.gronk.enraged, true);

    const x0 = eng.state.gronk.x;
    eng.tick(10);
    assertNearDelta(eng.state.gronk.x - x0, 7.0); // 3.5 * 2
  });

  it("moves at base speed before enrage", () => {
    const eng = makeEngine();
    neutralize(eng, ["wizard-0"]);
    place(eng, "wizard-0", 80, 30);
    eng.state.gronk.x = 20;
    eng.state.gronk.y = 30;
    eng.state.gronk.nextSniffTick = 0;
    eng.tick(1);
    assert.equal(eng.state.enraged, false);
    const x0 = eng.state.gronk.x;
    eng.tick(10);
    assertNearDelta(eng.state.gronk.x - x0, 3.5);
  });
});

describe("touch & closet", () => {
  it("touching a player sends them to the closet for 25s, then respawns them at their pedestal", () => {
    const eng = makeEngine();
    neutralize(eng, ["wizard-0"]);
    eng.state.gronk.x = 50;
    eng.state.gronk.y = 30;
    eng.state.gronk.nextSniffTick = 1e9;
    place(eng, "wizard-0", 50, 30);

    eng.tick(1);
    const p0 = player(eng, "wizard-0");
    assert.equal(p0.state, "in_closet");
    assert.equal(p0.closetUntilTick, eng.state.tick + 250); // 25s

    eng.tick(250); // closet expires
    assert.equal(p0.state, "active");
    assertNearDelta(p0.x - p0.spawnX, 0);
    assertNearDelta(p0.y - p0.spawnY, 0);
  });
});

describe("win conditions", () => {
  it("whole team in the closet makes the other team win instantly", () => {
    const eng = makeEngine();
    neutralize(eng);
    for (const p of eng.state.players) {
      if (p.team === 1) {
        p.state = "in_closet";
        p.closetUntilTick = 1e9;
      }
    }
    eng.tick(1);
    assert.equal(eng.state.status, "finished");
    assert.equal(eng.state.winnerTeam, 0);
    assert.equal(eng.state.winReason, "closet");
  });

  it("a finished match ignores further commands", () => {
    const eng = makeEngine();
    neutralize(eng);
    for (const p of eng.state.players) {
      if (p.team === 1) {
        p.state = "in_closet";
        p.closetUntilTick = 1e9;
      }
    }
    eng.tick(1);
    assert.equal(eng.state.status, "finished");
    assert.equal(eng.move("wizard-0", 1, 0).ok, false);
    assert.equal(eng.action("wizard-0").ok, false);
  });
});

describe("sudden death", () => {
  it("starts at 5:00 if nothing is banked, pings the treasure every 10s, and keeps enrage on", () => {
    const eng = makeEngine();
    neutralize(eng); // everyone hidden so no one banks and no one gets caught
    eng.treasureFurnitureId = "furn-0"; // Fridge at (20,12)

    eng.tick(2999);
    assert.equal(eng.state.suddenDeath, false);
    assert.equal(eng.state.enraged, true); // enrage started at 4:00

    eng.tick(1); // 5:00
    assert.equal(eng.state.suddenDeath, true);
    assert.equal(eng.state.treasurePings.length, 1);
    assert.deepEqual(eng.state.treasurePings[0], { tick: 3000, x: 20, y: 12 });
    assert.equal(eng.state.enraged, true); // stays on

    eng.tick(100); // 5:10
    assert.equal(eng.state.treasurePings.length, 2);
    assert.deepEqual(eng.state.treasurePings[1], { tick: 3100, x: 20, y: 12 });
  });
});

function assertNearDelta(delta: number, expected: number, eps = 0.01): void {
  assert.ok(
    Math.abs(delta - expected) <= eps,
    `expected delta ${delta} to be near ${expected} (±${eps})`,
  );
}
