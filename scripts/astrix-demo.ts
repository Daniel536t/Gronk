// ASTrix live steward evaluation driver.
//
// Drives the REAL system end-to-end against a running server:
//   - records the authoritative world state BEFORE
//   - starts the steward loop with the canonical objective
//   - keeps the steward alive across loop runs until Day 30 or collapse
//   - pauses at the REAL approval boundary and asks the HUMAN to decide
//     (approve / reject / quit) — approvals are NEVER auto-granted unless
//     ASTRIX_DEMO_APPROVAL_MODE=auto is explicitly set
//   - records the complete event timeline + state timeline to a record dir
//   - stops the loop cleanly at the end
//
// Nothing is faked: the steward is the real TrueForge agent, the loop is the
// real AstrixStewardLoop, and the gate is the real command-bus approval.
//
// Usage:
//   ASTRIX_URL=http://127.0.0.1:8787 npx tsx scripts/astrix-demo.ts
//   ASTRIX_DEMO_APPROVAL_MODE=interactive|auto|manual
//   ASTRIX_DEMO_RECORD_DIR=/tmp/astrix-eval
//   ASTRIX_OBJECTIVE="..." ASTRIX_DEMO_DEADLINE_MS=3600000
import { appendFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";

const base = (process.env.ASTRIX_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const objective = process.env.ASTRIX_OBJECTIVE ?? "Keep the village alive for 30 days";
const pollMs = Number(process.env.ASTRIX_POLL_MS ?? 3000);
const deadlineMs = Number(process.env.ASTRIX_DEMO_DEADLINE_MS ?? 90 * 60_000);
const approvalMode = (process.env.ASTRIX_DEMO_APPROVAL_MODE ?? "interactive") as "interactive" | "auto" | "manual";
const recordDir = process.env.ASTRIX_DEMO_RECORD_DIR ?? "/tmp/astrix-eval";

const statePath = join(recordDir, "state.jsonl");
const eventsPath = join(recordDir, "events.jsonl");
const seenEvents = new Set<string>();
const approvals: any[] = [];

async function getJson(path: string): Promise<any> {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

async function postJson(path: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  return { status: res.status, ...parsed };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function record(path: string, obj: any): void {
  appendFileSync(path, JSON.stringify(obj) + "\n");
}

/** Drain the server event log into the record dir (dedupe by event identity). */
function drainEvents(log: any): void {
  for (const event of log?.events ?? []) {
    const sig = JSON.stringify(event);
    if (!seenEvents.has(sig)) {
      seenEvents.add(sig);
      record(eventsPath, event);
    }
  }
}

/** Ask the human for an approval decision. Returns "approve" | "reject" | "quit" | null (pause). */
async function promptApproval(approvalId: string, tool: string): Promise<"approve" | "reject" | "quit" | null> {
  if (approvalMode === "auto") return "approve";
  if (approvalMode === "manual") return null; // human decides out-of-band (API / Godot UI)
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    let settled = false;
    const finish = (value: "approve" | "reject" | "quit" | null) => {
      if (settled) return;
      settled = true;
      rl.close();
      resolve(value);
    };
    rl.question(
      `\n⚠ HUMAN APPROVAL REQUIRED (${approvalId}, ${tool})\nType [a]pprove, [r]eject, [q]uit, or leave blank to pause: `,
      (answer) => {
        const a = answer.trim().toLowerCase();
        if (a.startsWith("a")) finish("approve");
        else if (a.startsWith("r")) finish("reject");
        else if (a.startsWith("q")) finish("quit");
        else finish(null); // pause — keep waiting without deciding
      },
    );
    rl.on("close", () => finish(null));
  });
}

function summarizeWorld(label: string, state: any): void {
  console.log(`[demo] ${label}:`, JSON.stringify({
    day: state.day,
    time: state.time,
    season: state.season,
    daysUntilWinter: state.daysUntilWinter,
    population: state.population,
    food: state.food,
    foodSecurity: state.foodSecurity,
    foodPerDay: state.foodPerDay,
    daysOfFoodRemaining: state.daysOfFoodRemaining,
    harvestableFood: state.harvestableFood,
    growingFood: state.growingFood,
    projectedFoodAtWinter: state.projectedFoodAtWinter,
    foodPressureLevel: state.foodPressureLevel,
    resources: state.resources,
    farmland: state.farmland,
    crops: state.crops?.map((c: any) => ({ id: c.id, farmPlotId: c.farmPlotId, growth: Math.round(c.growthStage * 100), harvestable: c.harvestable })),
    buildings: state.buildings?.map((b: any) => ({ id: b.id, type: b.type, islandId: b.islandId })),
    buildingCount: state.buildings?.length,
    resourceNodes: state.resourceNodes?.map((n: any) => ({ id: n.id, type: n.type, quantity: n.quantity })),
    nodeCount: state.resourceNodes?.length,
    biomeHealth: state.biomeHealth,
    bridges: state.bridges,
  }, null, 2));
}

async function main(): Promise<void> {
  mkdirSync(recordDir, { recursive: true });
  console.log(`[demo] ASTRIX_URL=${base}  objective="${objective}"  deadline=${deadlineMs}ms  approval_mode=${approvalMode}  record_dir=${recordDir}`);
  // Clean slate: if a previous run is still going, stop it.
  try {
    await postJson("/astrix/agent/stop", {});
  } catch {
    /* not running — fine */
  }

  const before = await getJson("/astrix/state");
  summarizeWorld("BEFORE", before);
  record(join(recordDir, "before.json"), before);

  const start = await postJson("/astrix/agent/start", { objective });
  console.log("[demo] agent/start:", JSON.stringify(start));
  if (start.status !== 200) {
    console.error("[demo] could not start the steward loop:", JSON.stringify(start));
    process.exitCode = 1;
    return;
  }

  const startedAt = Date.now();
  const decidedIds = new Set<string>();
  const promptedIds = new Set<string>();
  let collapsed = false;
  let finished30Days = false;
  let quit = false;

  while (Date.now() - startedAt < deadlineMs) {
    const status = await getJson("/astrix/agent/status");
    const loopState = status.state as string;
    const world = await getJson("/astrix/state");

    record(statePath, { ts: Date.now(), day: world.day, season: world.season, population: world.population, food: world.food, foodPerDay: world.foodPerDay, daysOfFoodRemaining: world.daysOfFoodRemaining, harvestableFood: world.harvestableFood, growingFood: world.growingFood, projectedFoodAtWinter: world.projectedFoodAtWinter, foodPressureLevel: world.foodPressureLevel, farmland: world.farmland, crops: world.crops?.map((c: any) => ({ id: c.id, growth: Math.round(c.growthStage * 100), ready: c.harvestable })), farms: world.buildings?.filter((b: any) => b.type === "farm").length, loopState, turn: status.turn });
    drainEvents(await getJson("/astrix/log").catch(() => ({ events: [] })));

    if (loopState === "AWAITING_APPROVAL" && status.pendingApproval) {
      const approvalId = status.pendingApproval.approvalId as string;
      const tool = status.pendingApproval.action?.tool ?? "unknown";
      if (!decidedIds.has(approvalId)) {
        if (!promptedIds.has(approvalId)) {
          promptedIds.add(approvalId);
          approvals.push(status.pendingApproval);
          writeFileSync(join(recordDir, `approval-${approvalId}.json`), JSON.stringify(status.pendingApproval, null, 2));
          console.log("[demo] APPROVAL REQUIRED — payload:");
          console.log(JSON.stringify(status.pendingApproval, null, 2));
        }
        const decision = await promptApproval(approvalId, tool);
        if (decision === null) {
          console.log(`[demo] ${approvalMode === "manual" ? "manual mode" : "paused"} — approval ${approvalId} stays pending (resolve via /astrix/approval/respond or the Godot UI).`);
        } else if (decision === "quit") {
          quit = true;
          console.log("[demo] quit requested — stopping.");
          break;
        } else {
          const respond = await postJson("/astrix/approval/respond", { approval_id: approvalId, decision });
          console.log(`[demo] approval response (${decision}):`, JSON.stringify(respond));
          decidedIds.add(approvalId);
        }
      }
    }

    if (world.population <= 0) {
      collapsed = true;
      console.log("[demo] VILLAGE COLLAPSED — population reached 0.");
      break;
    }
    if (world.day >= 30) {
      finished30Days = true;
      console.log("[demo] 30 days reached — objective window complete.");
      break;
    }
    if (["COMPLETED", "FAILED", "STOPPED"].includes(loopState)) {
      if (loopState === "FAILED") {
        console.log(`[demo] loop FAILED: ${status.error ?? "unknown error"} — restarting the steward.`);
      }
      const restart = await postJson("/astrix/agent/start", { objective });
      if (restart.status !== 200) {
        console.error("[demo] could not restart the steward loop:", JSON.stringify(restart));
        break;
      }
    }
    await sleep(pollMs);
  }

  // Stop cleanly.
  try {
    await postJson("/astrix/agent/stop", {});
  } catch {
    /* fine */
  }

  const log = await getJson("/astrix/log");
  drainEvents(log);
  writeFileSync(join(recordDir, "final-log.json"), JSON.stringify(log, null, 2));
  const after = await getJson("/astrix/state");
  record(join(recordDir, "after.json"), after);

  const outcome = quit ? "quit" : collapsed ? "village collapsed" : finished30Days ? "survived 30 days" : "deadline reached";
  console.log(`[demo] OUTCOME: ${outcome}  (approvals decided: ${decidedIds.size}, pending: ${approvals.filter((a) => !decidedIds.has(a.approvalId)).length})`);
  console.log(`[demo] event log (${log.events.length} events) — full copy at ${eventsPath}`);
  for (const event of log.events) {
    const data = event.data ?? {};
    console.log(`  ${String(event.type).padEnd(24)} turn=${event.turn} ${JSON.stringify(data).slice(0, 160)}`);
  }
  summarizeWorld("AFTER", after);

  const beforeNodes = before.resourceNodes ?? [];
  const afterNodes = after.resourceNodes ?? [];
  console.log("[demo] SUMMARY");
  console.log(`  day:         ${before.day} -> ${after.day} (${after.season})`);
  console.log(`  population:  ${before.population} -> ${after.population}`);
  console.log(`  food:        ${before.food} -> ${after.food}`);
  console.log(`  food pressure: ${after.foodPressureLevel} (${after.daysOfFoodRemaining} days left, ${after.foodPerDay}/day)`);
  console.log(`  wood:        ${before.resources?.wood} -> ${after.resources?.wood}`);
  console.log(`  stone:       ${before.resources?.stone} -> ${after.resources?.stone}`);
  console.log(`  buildings:   ${before.buildings?.length ?? 0} -> ${after.buildings?.length ?? 0}`);
  console.log(`  farms:       ${(before.buildings ?? []).filter((b: any) => b.type === "farm").length} -> ${(after.buildings ?? []).filter((b: any) => b.type === "farm").length}`);
  console.log(`  crops:       ${(before.crops ?? []).length} -> ${(after.crops ?? []).length}`);
  console.log(`  farmland:    ${JSON.stringify(after.farmland)}`);
  console.log(`  resourceNodes: ${beforeNodes.length} -> ${afterNodes.length}`);
  console.log(`  approvals:   ${decidedIds.size} decided, ${approvals.length} requested (details in ${recordDir})`);
  console.log(`  evidence:    ${recordDir}`);
}

main().catch((error) => {
  console.error("[demo] failed:", error);
  process.exitCode = 1;
});
