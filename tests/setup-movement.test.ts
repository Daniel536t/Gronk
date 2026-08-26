import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { GameEngine, ROOM_HEIGHT, ROOM_WIDTH } from "../src/engine";
import { RIDDLE_SETS } from "../src/engine";
import { assertNear, makeEngine, neutralize, place, player, seededRng } from "./helpers";

describe("match setup", () => {
  it("creates exactly 4 players in 2 teams, spawned at their pedestals", () => {
    const eng = makeEngine();
    assert.equal(eng.state.players.length, 4);
    const teams = [...new Set(eng.state.players.map((p) => p.team))].sort();
    assert.deepEqual(teams, [0, 1]);
    assert.equal(eng.state.players.filter((p) => p.team === 0).length, 2);
    assert.equal(eng.state.players.filter((p) => p.team === 1).length, 2);
    for (const p of eng.state.players) {
      assert.equal(p.state, "active");
      assertNear(p.x, p.spawnX);
      assertNear(p.y, p.spawnY);
      const ped = eng.state.pedestals[p.team];
      assertNear(p.x, ped.x, 2.5);
      assertNear(p.y, ped.y, 2.5);
    }
  });

  it("lays out 10 fixed furniture pieces in the room", () => {
    const eng = makeEngine();
    assert.equal(eng.state.furniture.length, 10);
    for (const f of eng.state.furniture) {
      assert.ok(f.x >= 0 && f.x <= ROOM_WIDTH && f.y >= 0 && f.y <= ROOM_HEIGHT);
    }
  });

  it("rejects commands before the match starts", () => {
    const eng = new GameEngine({ rng: seededRng(1) });
    assert.equal(eng.state.status, "lobby");
    assert.equal(eng.action("wizard-0").ok, false);
    assert.equal(eng.move("wizard-0", 1, 0).ok, false);
    assert.equal(eng.transform("wizard-0", "furn-0").ok, false);
    eng.startMatch();
    assert.equal(eng.state.status, "playing");
    assert.equal(eng.move("wizard-0", 1, 0).ok, true);
  });
});

describe("movement", () => {
  it("moves 4 units/sec along a straight line (10 ticks = 1s)", () => {
    const eng = makeEngine();
    neutralize(eng, ["wizard-0"]);
    place(eng, "wizard-0", 9, 54);
    eng.move("wizard-0", 1, 0);
    eng.tick(10);
    assertNear(player(eng, "wizard-0").x, 13);
    assertNear(player(eng, "wizard-0").y, 54);
  });

  it("diagonal movement keeps the same speed (normalized)", () => {
    const eng = makeEngine();
    neutralize(eng, ["wizard-0"]);
    place(eng, "wizard-0", 9, 54);
    eng.move("wizard-0", 1, 1);
    eng.tick(10);
    const p = player(eng, "wizard-0");
    assertNear(Math.hypot(p.x - 9, p.y - 54), 4);
  });

  it("is clamped to the room bounds", () => {
    const eng = makeEngine();
    neutralize(eng, ["wizard-0"]);
    place(eng, "wizard-0", 98, 30);
    eng.move("wizard-0", 1, 0);
    eng.tick(100);
    assertNear(player(eng, "wizard-0").x, ROOM_WIDTH - 1); // player radius 1
    assertNear(player(eng, "wizard-0").y, 30);
  });

  it("a carrier moves 30% slower", () => {
    const eng = makeEngine();
    neutralize(eng, ["wizard-0"]);
    place(eng, "wizard-0", 9, 54);
    player(eng, "wizard-0").carrying = true;
    eng.move("wizard-0", 1, 0);
    eng.tick(10);
    assertNear(player(eng, "wizard-0").x, 9 + 2.8); // 4 * 0.7
  });

  it("cannot move while stunned or in the closet", () => {
    const eng = makeEngine();
    const p0 = player(eng, "wizard-0");
    p0.state = "stunned";
    p0.stunnedUntilTick = 100;
    assert.equal(eng.move("wizard-0", 1, 0).ok, false);
    p0.state = "in_closet";
    p0.closetUntilTick = 100;
    assert.equal(eng.move("wizard-0", 1, 0).ok, false);
  });
});

describe("transform", () => {
  it("fails when too far from the furniture", () => {
    const eng = makeEngine();
    const res = eng.transform("wizard-0", "furn-3"); // player at (9,54), furn at (25,30)
    assert.equal(res.ok, false);
    assert.match((res as { error: string }).error, /too far/);
  });

  it("locks the player to the furniture position while transformed", () => {
    const eng = makeEngine();
    neutralize(eng, ["wizard-0"]);
    place(eng, "wizard-0", 25, 30); // furn-3
    const res = eng.transform("wizard-0", "furn-3");
    assert.deepEqual(res, { ok: true, action: "transform" });
    const p0 = player(eng, "wizard-0");
    assert.equal(p0.state, "transformed");
    assert.equal(p0.transformedAs, "furn-3");
    assertNear(p0.x, 25);
    assertNear(p0.y, 30);
    eng.tick(10); // ticks pass, position does not change
    assertNear(p0.x, 25);
    assertNear(p0.y, 30);
  });

  it("untransforms when pressed again, or when trying to move", () => {
    const eng = makeEngine();
    neutralize(eng, ["wizard-0"]);
    place(eng, "wizard-0", 25, 30);
    eng.transform("wizard-0", "furn-3");
    const again = eng.transform("wizard-0", "furn-3");
    assert.deepEqual(again, { ok: true, action: "untransform" });
    assert.equal(player(eng, "wizard-0").state, "active");

    eng.transform("wizard-0", "furn-3");
    const moved = eng.move("wizard-0", 1, 0);
    assert.equal(moved.ok, true);
    assert.equal(player(eng, "wizard-0").state, "active");
    assert.equal(player(eng, "wizard-0").transformedAs, null);
  });

  it("cannot transform while carrying the treasure or while stunned", () => {
    const eng = makeEngine();
    neutralize(eng, ["wizard-0"]);
    place(eng, "wizard-0", 25, 30);
    player(eng, "wizard-0").carrying = true;
    assert.equal(eng.transform("wizard-0", "furn-3").ok, false);

    player(eng, "wizard-0").carrying = false;
    player(eng, "wizard-0").state = "stunned";
    player(eng, "wizard-0").stunnedUntilTick = 100;
    assert.equal(eng.transform("wizard-0", "furn-3").ok, false);
  });
});

describe("riddles", () => {
  it("picks one of 3 riddle sets and reveals lines at 0s / 90s / 180s", () => {
    const eng = makeEngine();
    neutralize(eng);
    assert.ok(eng.state.riddleSet >= 0 && eng.state.riddleSet <= 2);
    assert.deepEqual(eng.state.visibleRiddleLines, [RIDDLE_SETS[eng.state.riddleSet][0]]);

    eng.tick(899); // 89.9s
    assert.equal(eng.state.visibleRiddleLines.length, 1);
    eng.tick(1); // 90s
    assert.equal(eng.state.visibleRiddleLines.length, 2);
    eng.tick(900); // 180s
    assert.equal(eng.state.visibleRiddleLines.length, 3);
    assert.deepEqual(eng.state.visibleRiddleLines, RIDDLE_SETS[eng.state.riddleSet]);
  });
});

describe("public state", () => {
  it("never leaks treasure_furniture_id", () => {
    const eng = makeEngine();
    eng.treasureFurnitureId = "furn-5";
    const pub = eng.getPublicState();
    const json = JSON.stringify(pub);
    assert.ok(!json.includes("treasureFurnitureId"));
    assert.ok(!json.includes("treasureId"));
  });

  it("returns a deep copy — mutating it cannot corrupt the engine", () => {
    const eng = makeEngine();
    const pub = eng.getPublicState();
    pub.players[0].x = 999;
    assert.notEqual(eng.state.players[0].x, 999);
    pub.gronk.x = 999;
    assert.notEqual(eng.state.gronk.x, 999);
  });

  it("keeps players a fixed-size array of 4", () => {
    const eng = makeEngine();
    eng.tick(50);
    assert.equal(eng.getPublicState().players.length, 4);
  });
});
