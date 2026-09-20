// R1/R2 security regression tests.
//
// These pin the authorization policy for CONSEQUENTIAL ASTrix operations and the
// Godot credential path. They exist because the previous behaviour
// (`if (!authToken) return true`) left POST /astrix/approval/respond open to the
// public internet, which let an anonymous caller supply the HUMAN approval
// decision — defeating the project's central control property.
//
// Policy under test (src/astrix/server.ts authorizeWrite):
//   token configured -> require exact `Authorization: Bearer <token>`
//   no token         -> allow DIRECT loopback only; any proxy-forwarding header
//                       marks the request remote and it is refused
//
// Read-only routes stay public by design; that is asserted too, so a future
// change that silently locks the Observatory out will fail here.
import assert from "node:assert/strict";
import { describe, it, afterEach, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { createHttpServer } from "../src/server/http";
import { createAstrixService, ASTRIX_WRITE_ROUTES } from "../src/astrix/server";

const servers: Server[] = [];
const TOKEN = "test-operator-key-9f3c";

async function start(opts: { authToken?: string } = {}): Promise<{ base: string; astrix: ReturnType<typeof createAstrixService> }> {
  const astrix = createAstrixService({ authToken: opts.authToken, maxTurnsPerRun: 2, maxActionsPerTurn: 3 });
  const server = createHttpServer(0, { astrix });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return { base: `http://127.0.0.1:${port}`, astrix };
}

/** POST helper. `proxied` simulates arriving through Caddy (X-Forwarded-For). */
async function post(
  base: string,
  path: string,
  body: unknown,
  opts: { token?: string; proxied?: boolean } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.proxied) headers["X-Forwarded-For"] = "203.0.113.7";
  const res = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function settle(astrix: Awaited<ReturnType<typeof start>>["astrix"], timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (["COMPLETED", "STOPPED", "FAILED", "AWAITING_APPROVAL"].includes(astrix.loop.state)) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`loop did not settle (state=${astrix.loop.state})`);
}

/** Drive the loop to a real pending approval using authoritative state only. */
async function reachApprovalGate(astrix: Awaited<ReturnType<typeof start>>["astrix"]): Promise<string> {
  astrix.state.farmlandCapacity.meadow = 0; // forces the irreversible expansion path
  astrix.loop.start("Keep the village alive for 30 days");
  await settle(astrix);
  expect(astrix.loop.state).toBe("AWAITING_APPROVAL");
  const approval = astrix.state.pendingApprovals[0];
  assert.ok(approval, "expected a real pending approval");
  return approval.id;
}

function fingerprint(astrix: Awaited<ReturnType<typeof start>>["astrix"]) {
  const s = astrix.state.snapshot();
  return {
    nodes: s.resourceNodes.length,
    wood: s.resources.wood,
    meadowHealth: s.biomeHealth.meadow,
    bridges: s.bridges.length,
    farmlandMeadow: s.farmland.find((f) => f.islandId === "meadow")!.capacity,
  };
}

describe("R1 — consequential operations require authority", () => {
  afterEach(() => {
    for (const s of servers.splice(0)) s.close();
  });

  it("1. rejects unauthenticated consequential requests (token configured)", async () => {
    const { base } = await start({ authToken: TOKEN });
    for (const route of ASTRIX_WRITE_ROUTES) {
      const res = await post(base, route, {});
      assert.equal(res.status, 401, `${route} should be 401 without a credential`);
      assert.match(String(res.body.error), /unauthorized/);
    }
  });

  it("2. accepts authenticated consequential requests", async () => {
    const { base } = await start({ authToken: TOKEN });
    const res = await post(
      base,
      "/astrix/command",
      { command: "gather", params: { resource_id: "tree-meadow-001" } },
      { token: TOKEN },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
  });

  it("3. rejects invalid, malformed, and near-miss credentials", async () => {
    const { base } = await start({ authToken: TOKEN });
    const bad = ["wrong-key", TOKEN + "x", TOKEN.slice(0, -1), TOKEN.toUpperCase(), ""];
    for (const key of bad) {
      const res = await post(base, "/astrix/approval/respond", { approval_id: "x", decision: "approve" }, { token: key });
      assert.equal(res.status, 401, `token '${key}' must be rejected`);
    }
    // Raw header shapes that are not "Bearer <token>".
    for (const header of [TOKEN, `bearer ${TOKEN}`, `Basic ${TOKEN}`, `Bearer  ${TOKEN}`]) {
      const res = await fetch(`${base}/astrix/agent/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: header },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 401, `header '${header}' must be rejected`);
    }
  });

  it("4. approval cannot be supplied anonymously — the gate holds and the world is untouched", async () => {
    const { base, astrix } = await start({ authToken: TOKEN });
    const approvalId = await reachApprovalGate(astrix);
    const before = fingerprint(astrix);

    // Anonymous approve attempt.
    const anon = await post(base, "/astrix/approval/respond", { approval_id: approvalId, decision: "approve" });
    assert.equal(anon.status, 401);
    // Wrong-key approve attempt.
    const wrong = await post(base, "/astrix/approval/respond", { approval_id: approvalId, decision: "approve" }, { token: "nope" });
    assert.equal(wrong.status, 401);

    // Still parked at the gate, approval still pending, ZERO mutation.
    expect(astrix.loop.state).toBe("AWAITING_APPROVAL");
    expect(astrix.state.pendingApprovals.map((a) => a.id)).toContain(approvalId);
    assert.deepEqual(fingerprint(astrix), before);
    astrix.loop.stop();
  });

  it("5. authenticated REJECTION still causes zero mutation", async () => {
    const { base, astrix } = await start({ authToken: TOKEN });
    const approvalId = await reachApprovalGate(astrix);
    const before = fingerprint(astrix);

    const res = await post(base, "/astrix/approval/respond", { approval_id: approvalId, decision: "reject" }, { token: TOKEN });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, false);
    assert.match(String(res.body.error), /approval rejected/);
    await settle(astrix);

    assert.deepEqual(fingerprint(astrix), before);
    expect(astrix.state.pendingApprovals.find((a) => a.id === approvalId)).toBeUndefined();
  });

  it("6. authenticated APPROVAL causes exactly the intended mutation, once", async () => {
    const { base, astrix } = await start({ authToken: TOKEN });
    const approvalId = await reachApprovalGate(astrix);
    const before = fingerprint(astrix);

    const res = await post(base, "/astrix/approval/respond", { approval_id: approvalId, decision: "approve" }, { token: TOKEN });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    await settle(astrix);

    const after = fingerprint(astrix);
    // The approved clear_terrain executed exactly once. Assert on the facts it
    // owns and that later legitimate actions cannot undo: a node is permanently
    // gone, farmland was created, biome health dropped. (Wood is deliberately
    // NOT asserted here — the loop resumes after approval and may legitimately
    // spend the gained wood on a farm, so it is a confounded signal.)
    expect(after.nodes).toBeLessThan(before.nodes);
    expect(after.farmlandMeadow).toBeGreaterThan(before.farmlandMeadow);
    expect(after.meadowHealth).toBeLessThan(before.meadowHealth);
    // The command's own result reports the wood it produced.
    assert.equal(res.body.command, "CLEAR_TERRAIN");
    assert.equal(res.body.permanent, true);
    expect(res.body.woodGained).toBeGreaterThan(0);

    // Replay of the consumed approval changes nothing further.
    const replay = await post(base, "/astrix/approval/respond", { approval_id: approvalId, decision: "approve" }, { token: TOKEN });
    assert.equal(replay.status, 404);
    const nodesAfterReplay = astrix.state.snapshot().resourceNodes.length;
    assert.equal(nodesAfterReplay, after.nodes);
    assert.equal(astrix.state.snapshot().biomeHealth.meadow, after.meadowHealth);
  });

  it("7. read-only endpoints remain public per the documented policy", async () => {
    const { base } = await start({ authToken: TOKEN });
    for (const path of ["/astrix/state", "/astrix/agent/status", "/astrix/log", "/astrix/mcp/tools/list", "/astrix/mcp"]) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 200, `${path} must stay public`);
    }
  });

  it("8. loopback writes work with NO token (local dev ergonomics preserved)", async () => {
    const { base } = await start(); // no token
    const res = await post(base, "/astrix/command", { command: "gather", params: { resource_id: "tree-meadow-001" } });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
  });

  it("9. a PROXIED request with no token is refused (closes the Caddy bypass)", async () => {
    const { base, astrix } = await start(); // no token
    const before = fingerprint(astrix);
    for (const route of ASTRIX_WRITE_ROUTES) {
      const res = await post(base, route, {}, { proxied: true });
      assert.equal(res.status, 401, `${route} must refuse proxied anonymous writes`);
    }
    assert.deepEqual(fingerprint(astrix), before);
  });

});

describe("R2 — Godot credential path", () => {
  const source = readFileSync("godot/scripts/GameClient.gd", "utf8");

  it("contains no placeholder credential and no baked secret", () => {
    // The original defect: a header string with no format placeholder, so the
    // key was silently dropped.
    const headerLines = source.split("\n").filter((l) => l.includes("Authorization:") && !l.trim().startsWith("#"));
    expect(headerLines.length).toBeGreaterThan(0);
    for (const line of headerLines) {
      expect(line).toContain("Bearer %s");
      expect(line).not.toContain("Bearer ***");
    }
    // No committed literal that looks like a key.
    expect(source).not.toMatch(/astrix_api_key\s*(:\s*String)?\s*=\s*"[^"]{8,}"/);
    // The credential var must start empty (resolved at runtime).
    expect(source).toMatch(/var astrix_api_key: String = ""/);
    // And must not be an @export (which would persist a value into the scene).
    expect(source).not.toMatch(/@export var astrix_api_key/);
  });

  it("resolves the credential at runtime and exposes write authority to the UI", () => {
    expect(source).toContain("func _resolve_credential()");
    expect(source).toContain("func has_write_authority()");
    expect(source).toContain('OS.get_environment("ASTRIX_API_KEY")');
    expect(source).toContain("localStorage.getItem('astrix_api_key')");
    // Observer mode: writes refuse locally instead of firing a doomed request.
    expect(source).toMatch(/if not has_write_authority\(\)/);
  });

  it("no secret is committed anywhere in the Godot project or repo config", () => {
    // Guard against a real key being pasted into tracked config later.
    const suspicious = /(?:ASTRIX_API_KEY|astrix_api_key)\s*[:=]\s*["'][A-Za-z0-9_\-]{12,}["']/;
    for (const file of ["godot/project.godot", "godot/export_presets.cfg", ".env.example", "ecosystem.config.cjs"]) {
      let text = "";
      try { text = readFileSync(file, "utf8"); } catch { continue; }
      expect(text).not.toMatch(suspicious);
    }
  });
});

describe("R3 — Godot owns no game values and no resource ledger", () => {
  // Trust-boundary hardening: the Observatory must never maintain a competing
  // source of truth (cost tables, local inventory) that can disagree with Core
  // and — once an external settlement layer exists — get attested as fact.
  const busSource = readFileSync("godot/scripts/GameCommandBus.gd", "utf8");
  const playerSource = readFileSync("godot/scripts/Player3D.gd", "utf8");

  it("GameCommandBus defines no cost table, no affordability gate, no world bounds", () => {
    expect(busSource).not.toMatch(/BUILD_COSTS\s*:=/);
    expect(busSource).not.toMatch(/func _can_afford/);
    expect(busSource).not.toMatch(/func _valid_location/);
    // No hardcoded island claim: the island hint derives from renderer geography.
    expect(busSource).not.toContain('"island_id": "meadow"');
    expect(busSource).toContain("func island_hint_at(");
  });

  it("GameCommandBus reads island geography live instead of copying it", () => {
    // A copied island table is the same drift vector as a copied cost table.
    expect(busSource).toContain('preload("res://scripts/World3D.gd")');
    expect(busSource).not.toMatch(/Vector3\(0\.0, 0\.0, 0\.0\), "radius"/);
  });

  it("Player3D keeps no inventory and credits nothing on gather", () => {
    expect(playerSource).not.toMatch(/var inventory/);
    expect(playerSource).not.toContain("add_resource");
    expect(playerSource).not.toContain("inventory_changed");
    // gather_nearest dispatches and reports dispatch; ownership is Core's.
    expect(playerSource).toContain("func gather_nearest(");
  });

  it("server rejections stay visible in the Observatory feed", () => {
    const consoleSource = readFileSync("godot/scripts/AgentConsole.gd", "utf8");
    expect(consoleSource).toContain("bus.command_failed.connect(_on_command_failed)");
    expect(consoleSource).toContain("func _on_command_failed(");
  });

  it("consequence language names facts, not futures", () => {
    const consoleSource = readFileSync("godot/scripts/AgentConsole.gd", "utf8");
    expect(consoleSource).not.toContain("Food production increased");
  });
});
