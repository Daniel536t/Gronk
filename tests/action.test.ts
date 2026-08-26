import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { makeEngine, neutralize, place, player } from "./helpers";

describe("search (the one verb)", () => {
  it("picks up the treasure when searching the furniture that holds it", () => {
    const eng = makeEngine();
    eng.treasureFurnitureId = "furn-0";
    neutralize(eng, ["wizard-0", "wizard-1"], "furn-2"); // hide the rest somewhere unsearched
    place(eng, "wizard-0", 20, 12); // furn-0 (Fridge)
    const res = eng.action("wizard-0");
    assert.equal(res.type, "treasure_found");
    assert.equal(player(eng, "wizard-0").carrying, true);

    // Treasure is gone from the furniture: another search finds nothing.
    place(eng, "wizard-1", 20, 12);
    const res2 = eng.action("wizard-1");
    assert.equal(res2.type, "empty");
  });

  it("reveals and stuns an enemy hiding in the searched furniture", () => {
    const eng = makeEngine();
    eng.treasureFurnitureId = "furn-0";
    neutralize(eng, ["wizard-0", "wizard-2"]);
    place(eng, "wizard-0", 45, 10); // furn-1 (Barrel)
    const b = player(eng, "wizard-2");
    b.state = "transformed";
    b.transformedAs = "furn-1";
    place(eng, "wizard-2", 45, 10);

    const res = eng.action("wizard-0");
    assert.equal(res.type, "enemy_revealed");
    assert.equal(b.state, "stunned");
    assert.equal(b.transformedAs, null);
    assert.equal(b.stunnedUntilTick, 30); // stunned for 3s = 30 ticks
  });

  it("does not reveal your own teammate hiding in the furniture", () => {
    const eng = makeEngine();
    eng.treasureFurnitureId = "furn-0";
    neutralize(eng, ["wizard-0", "wizard-1"]);
    place(eng, "wizard-0", 70, 15); // furn-2 (Chest)
    const mate = player(eng, "wizard-1");
    mate.state = "transformed";
    mate.transformedAs = "furn-2";
    place(eng, "wizard-1", 70, 15);

    const res = eng.action("wizard-0");
    assert.equal(res.type, "empty");
    assert.equal(mate.state, "transformed");
  });

  it("returns empty for a plain furniture piece", () => {
    const eng = makeEngine();
    eng.treasureFurnitureId = "furn-0";
    neutralize(eng, ["wizard-0"]);
    place(eng, "wizard-0", 25, 30); // furn-3 (Bookshelf)
    assert.equal(eng.action("wizard-0").type, "empty");
  });

  it("fails with no furniture in range", () => {
    const eng = makeEngine();
    neutralize(eng, ["wizard-0"]);
    place(eng, "wizard-0", 5, 5); // far from any furniture
    const res = eng.action("wizard-0");
    assert.equal(res.ok, false);
    assert.equal((res as { type: string }).type, "no_furniture");
  });

  it("cannot act while stunned, transformed, or in the closet", () => {
    const eng = makeEngine();
    neutralize(eng, ["wizard-0"]);
    place(eng, "wizard-0", 25, 30);
    const p0 = player(eng, "wizard-0");

    p0.state = "stunned";
    p0.stunnedUntilTick = 100;
    assert.equal(eng.action("wizard-0").ok, false);

    p0.state = "in_closet";
    p0.closetUntilTick = 100;
    assert.equal(eng.action("wizard-0").ok, false);

    p0.state = "transformed";
    p0.transformedAs = "furn-3";
    assert.equal(eng.action("wizard-0").ok, false);
  });
});

describe("noise", () => {
  it("every search emits a noise event", () => {
    const eng = makeEngine();
    eng.treasureFurnitureId = "furn-0";
    neutralize(eng, ["wizard-0"]);
    place(eng, "wizard-0", 25, 30);
    const events: string[] = [];
    eng.onEvent((e) => events.push(e.type));
    eng.action("wizard-0");
    assert.ok(events.includes("noise"));
    assert.deepEqual(eng.lastNoise, { x: 25, y: 30, tick: 0 });
  });
});

describe("stun", () => {
  it("lasts 3 seconds and grants 2s immunity afterwards", () => {
    const eng = makeEngine();
    eng.treasureFurnitureId = "furn-0";
    neutralize(eng, ["wizard-0", "wizard-2"]);
    place(eng, "wizard-0", 45, 10);
    const b = player(eng, "wizard-2");
    b.state = "transformed";
    b.transformedAs = "furn-1";
    place(eng, "wizard-2", 45, 10);

    eng.action("wizard-0"); // stun at tick 0, immunity starts at tick 30
    assert.equal(b.stunnedUntilTick, 30);
    assert.equal(b.immunityUntilTick, 50);

    eng.tick(29);
    assert.equal(b.state, "stunned");
    eng.tick(1); // tick 30: stun wears off
    assert.equal(b.state, "active");

    // During immunity, re-hiding then being searched reveals but does NOT stun.
    eng.transform("wizard-2", "furn-1");
    eng.action("wizard-0");
    assert.equal(b.state, "active"); // revealed but not stunned

    eng.tick(20); // tick 50: immunity over
    eng.transform("wizard-2", "furn-1");
    eng.action("wizard-0");
    assert.equal(b.state, "stunned");
  });

  it("cannot move or act while stunned", () => {
    const eng = makeEngine();
    const p0 = player(eng, "wizard-0");
    p0.state = "stunned";
    p0.stunnedUntilTick = 100;
    assert.equal(eng.move("wizard-0", 1, 0).ok, false);
    assert.equal(eng.action("wizard-0").ok, false);
  });
});

describe("carrying", () => {
  it("stunned carrier drops the treasure at their position; walking over it grabs it", () => {
    const eng = makeEngine();
    eng.treasureFurnitureId = "furn-0";
    neutralize(eng, ["wizard-0", "wizard-1", "wizard-2"]);
    place(eng, "wizard-0", 45, 10);
    place(eng, "wizard-2", 45, 10);
    const b = player(eng, "wizard-2");
    // Force the (normally impossible) case: a carrier caught hiding.
    b.carrying = true;
    b.state = "transformed";
    b.transformedAs = "furn-1";

    eng.action("wizard-0");
    assert.equal(b.state, "stunned");
    assert.equal(b.carrying, false);
    assert.deepEqual(eng.state.groundTreasure, { x: 45, y: 10 });

    // Move the searcher away so they don't grab it themselves, then a
    // teammate walks over and grabs.
    place(eng, "wizard-0", 90, 50);
    place(eng, "wizard-1", 45.5, 10);
    eng.tick(1);
    assert.equal(player(eng, "wizard-1").carrying, true);
    assert.equal(eng.state.groundTreasure, null);
  });
});

describe("bank", () => {
  it("banking at your own pedestal ends the match (no approval gate in M1)", () => {
    const eng = makeEngine();
    const p0 = player(eng, "wizard-0");
    p0.carrying = true;
    // wizard-0 spawns at (9,54), within PEDESTAL_RANGE of pedestal (10,54).
    const res = eng.action("wizard-0");
    assert.equal(res.type, "bank_requested");
    assert.equal(eng.state.status, "finished");
    assert.equal(eng.state.winnerTeam, 0);
    assert.equal(eng.state.winReason, "bank");
  });

  it("cannot bank away from your own pedestal", () => {
    const eng = makeEngine();
    neutralize(eng, ["wizard-0"]);
    place(eng, "wizard-0", 30, 30);
    player(eng, "wizard-0").carrying = true;
    const res = eng.action("wizard-0");
    assert.equal(res.ok, false);
    assert.equal((res as { type: string }).type, "not_at_pedestal");
    assert.equal(eng.state.status, "playing");
  });

  it("with the approval gate on, banking waits for approveBank", () => {
    const eng = makeEngine({ approvalRequired: true });
    player(eng, "wizard-0").carrying = true;
    const res = eng.action("wizard-0");
    assert.equal(res.type, "bank_requested");
    assert.deepEqual(eng.state.pendingBank, { team: 0, playerId: "wizard-0", tick: 0 });
    assert.equal(eng.state.status, "playing"); // match keeps running
    assert.equal(eng.state.winnerTeam, null);

    assert.equal(eng.approveBank(0).ok, true);
    assert.equal(eng.state.status, "finished");
    assert.equal(eng.state.winnerTeam, 0);
    assert.equal(eng.state.winReason, "bank");
  });

  it("rejecting a bank request lets the match continue", () => {
    const eng = makeEngine({ approvalRequired: true });
    player(eng, "wizard-0").carrying = true;
    eng.action("wizard-0");
    assert.equal(eng.rejectBank(0).ok, true);
    assert.equal(eng.state.pendingBank, null);
    assert.equal(eng.state.status, "playing");
    // Cooldown: the same team can't re-request for 10s.
    const blocked = eng.action("wizard-0");
    assert.equal(blocked.ok, false);
    assert.equal((blocked as { type: string }).type, "cooldown");
    assert.equal(eng.state.bankCooldownUntilTick[0], 100);
    // After 10s (100 ticks), the request is allowed again.
    eng.tick(100);
    assert.equal(eng.action("wizard-0").type, "bank_requested");
  });

  it("full flow: find the treasure, carry it home, bank for the win", () => {
    const eng = makeEngine();
    eng.treasureFurnitureId = "furn-0";
    neutralize(eng, ["wizard-0"]);
    place(eng, "wizard-0", 20, 12);
    assert.equal(eng.action("wizard-0").type, "treasure_found");
    assert.equal(player(eng, "wizard-0").carrying, true);

    place(eng, "wizard-0", 10, 54); // home pedestal
    assert.equal(eng.action("wizard-0").type, "bank_requested");
    assert.equal(eng.state.status, "finished");
    assert.equal(eng.state.winnerTeam, 0);
  });
});
