// ASTrix live-agent demo driver (P1).
//
// Drives the REAL system end-to-end against a running server:
//   - records the authoritative world state BEFORE
//   - starts the steward loop with the canonical objective
//   - watches for the real approval boundary (AWAITING_APPROVAL)
//   - approves through the real /astrix/approval/respond API
//   - waits for the loop to finish
//   - dumps the full event log + AFTER state
//
// Nothing is faked: the steward is the real TrueForge agent, the loop is the
// real AstrixStewardLoop, and the gate is the real command-bus approval. If
// the agent never reaches a mutation or approval, this script reports exactly
// what happened instead of inventing success.
//
// Usage:
//   ASTRIX_URL=http://127.0.0.1:8787 npx tsx scripts/astrix-demo.ts
//   ASTRIX_OBJECTIVE="..." ASTRIX_DEMO_DEADLINE_MS=480000 npx tsx scripts/astrix-demo.ts
const base = (process.env.ASTRIX_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const objective = process.env.ASTRIX_OBJECTIVE ?? "Keep the village alive for 30 days";
const pollMs = Number(process.env.ASTRIX_POLL_MS ?? 2000);
const deadlineMs = Number(process.env.ASTRIX_DEMO_DEADLINE_MS ?? 8 * 60_000);

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

function summarizeWorld(label: string, state: any): void {
  console.log(`[demo] ${label}:`, JSON.stringify({
    day: state.day,
    time: state.time,
    season: state.season,
    daysUntilWinter: state.daysUntilWinter,
    population: state.population,
    food: state.food,
    foodSecurity: state.foodSecurity,
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
  console.log(`[demo] ASTRIX_URL=${base}  objective="${objective}"  deadline=${deadlineMs}ms`);
  // Clean slate: if a previous run is still going, stop it.
  try {
    await postJson("/astrix/agent/stop", {});
  } catch {
    /* not running — fine */
  }

  const before = await getJson("/astrix/state");
  summarizeWorld("BEFORE", before);

  const start = await postJson("/astrix/agent/start", { objective });
  console.log("[demo] agent/start:", JSON.stringify(start));
  if (start.status !== 200) {
    console.error("[demo] could not start the steward loop:", JSON.stringify(start));
    process.exitCode = 1;
    return;
  }

  const startedAt = Date.now();
  const approvedIds = new Set<string>();
  let approvalPayload: any = null;
  let collapsed = false;
  let finished30Days = false;

  // Keep the governor alive across loop runs until the objective is met:
  // restart on COMPLETED while the village is alive and the day < 30.
  while (Date.now() - startedAt < deadlineMs) {
    const status = await getJson("/astrix/agent/status");
    const loopState = status.state as string;
    const world = await getJson("/astrix/state");

    if (loopState === "AWAITING_APPROVAL" && status.pendingApproval) {
      const approvalId = status.pendingApproval.approvalId as string;
      if (!approvedIds.has(approvalId)) {
        approvalPayload = status.pendingApproval;
        console.log("[demo] APPROVAL REQUIRED — payload:");
        console.log(JSON.stringify(approvalPayload, null, 2));
        const respond = await postJson("/astrix/approval/respond", {
          approval_id: approvalId,
          decision: "approve",
        });
        console.log("[demo] approval response:", JSON.stringify(respond));
        approvedIds.add(approvalId);
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

  console.log(`[demo] approvals granted: ${approvedIds.size}  (${collapsed ? "village collapsed" : finished30Days ? "survived 30 days" : "deadline reached"})`);

  const log = await getJson("/astrix/log");
  console.log(`[demo] event log (${log.events.length} events):`);
  for (const event of log.events) {
    const data = event.data ?? {};
    console.log(`  ${String(event.type).padEnd(24)} turn=${event.turn} ${JSON.stringify(data).slice(0, 160)}`);
  }

  const after = await getJson("/astrix/state");
  summarizeWorld("AFTER", after);

  const beforeNodes = before.resourceNodes ?? [];
  const afterNodes = after.resourceNodes ?? [];
  console.log("[demo] SUMMARY");
  console.log(`  day:         ${before.day} -> ${after.day} (${after.season})`);
  console.log(`  population:  ${before.population} -> ${after.population}`);
  console.log(`  food:        ${before.food} -> ${after.food}`);
  console.log(`  wood:        ${before.resources?.wood} -> ${after.resources?.wood}`);
  console.log(`  stone:       ${before.resources?.stone} -> ${after.resources?.stone}`);
  console.log(`  buildings:   ${before.buildings?.length ?? 0} -> ${after.buildings?.length ?? 0}`);
  console.log(`  farms:       ${(before.buildings ?? []).filter((b: any) => b.type === "farm").length} -> ${(after.buildings ?? []).filter((b: any) => b.type === "farm").length}`);
  console.log(`  crops:       ${(before.crops ?? []).length} -> ${(after.crops ?? []).length}`);
  console.log(`  farmland:    ${JSON.stringify(after.farmland)}`);
  console.log(`  resourceNodes: ${beforeNodes.length} -> ${afterNodes.length}`);
  console.log(`  approvals:   ${approvedIds.size} granted${approvalPayload ? ` (last: ${approvalPayload.approvalId})` : ""}`);
}

main().catch((error) => {
  console.error("[demo] failed:", error);
  process.exitCode = 1;
});
