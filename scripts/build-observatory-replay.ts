// ASTrix Observatory — derive a replay bundle from the canonical evaluation.
//
// Reads the immutable evidence at /tmp/astrix-final-eval (events.jsonl,
// state.jsonl, approval-*.json, before/after.json) and writes a single derived
// JSON bundle to server/static/observatory/replay/canonical.json. The original
// evidence is NEVER modified (it is treated as immutable). The bundle is a
// copy in a normalized form for the browser.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SRC = process.env.ASTRIX_EVAL_DIR ?? "/tmp/astrix-final-eval";
const OUT = join(process.cwd(), "server", "static", "observatory", "replay");

function readJsonLines(path: string): unknown[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

if (!existsSync(join(SRC, "events.jsonl"))) {
  console.error(`[observe] canonical evidence not found at ${SRC}`);
  process.exit(1);
}
if (!existsSync(join(SRC, "before.json")) || !existsSync(join(SRC, "after.json"))) {
  console.error(`[observe] missing before/after snapshots in ${SRC}`);
  process.exit(1);
}

const events = readJsonLines(join(SRC, "events.jsonl")) as Record<string, any>[];
const stateFrames = readJsonLines(join(SRC, "state.jsonl")) as Record<string, any>[];
const before = JSON.parse(readFileSync(join(SRC, "before.json"), "utf8"));
const after = JSON.parse(readFileSync(join(SRC, "after.json"), "utf8"));

// Approval payloads: approval-<id>.json files. The `tool` on the action is the
// proposed tool; approved/rejected counts come from the actual event stream so
// the bundle reflects the recorded outcome (not a guess).
const approvals: Record<string, any> = {};
for (const f of readdirSync(SRC)) {
  if (!/^approval-.*\.json$/.test(f)) continue;
  let p: any;
  try {
    p = JSON.parse(readFileSync(join(SRC, f), "utf8"));
  } catch { continue; }
  const action = p?.action ?? {};
  const approvalId = String(p?.approvalId ?? "");
  if (!approvalId) continue;
  approvals[approvalId] = {
    tool: action.tool ?? "unknown",
    command: (p?.command ?? "") as string,
    reason: (p?.reason ?? action.tool ?? "") as string,
    impact: (p?.impact ?? {}) as Record<string, unknown>,
  };
}
// Count granted vs rejected from the real events.
const approvalOutcomes: Record<string, "granted" | "rejected"> = {};
for (const e of events) {
  const id = String((e.data as any)?.approvalId ?? "");
  if (!id) continue;
  if (e.type === "APPROVAL_GRANTED") approvalOutcomes[id] = "granted";
  else if (e.type === "APPROVAL_REJECTED") approvalOutcomes[id] = "rejected";
}
const granted = Object.values(approvalOutcomes).filter((o) => o === "granted").length;
const rejected = Object.values(approvalOutcomes).filter((o) => o === "rejected").length;

// Reduce state.jsonl to the distinct corner points (dedupe identical frames).
const distinct: typeof stateFrames = [];
for (const f of stateFrames) {
  const last = distinct[distinct.length - 1];
  const sig = JSON.stringify([f.day, f.food, f.population, f.harvestableFood, f.crops?.map((c: any) => round(c.growthStage)) ?? []]);
  if (!last || JSON.stringify([last.day, last.food, last.population, last.harvestableFood, last.crops?.map((c: any) => round(c.growthStage)) ?? []]) !== sig) {
    distinct.push(f);
  }
}
function round(n: number | undefined): number {
  return Math.round((n ?? 0) * 100) / 100;
}

// World snapshot reconstruction: take before.json as the base world and advance
// day/season/population/food/crops/farmland/bridges per recorded frame. This is
// a faithful projection; buildings/nodes copy from before then after where
// authoritative.
const BASE_SNAPSHOT = {
  day: before.day ?? 1,
  season: before.season ?? "spring",
  time: before.time ?? "00:00",
  population: before.population ?? 4,
  food: before.food ?? 40,
  daysUntilWinter: before.daysUntilWinter ?? 0,
  foodPerDay: before.foodPerDay ?? 0,
  daysOfFoodRemaining: before.daysOfFoodRemaining ?? 0,
  harvestableFood: before.harvestableFood ?? 0,
  growingFood: before.growingFood ?? 0,
  projectedFoodAtWinter: before.projectedFoodAtWinter ?? 0,
  foodPressureLevel: before.foodPressureLevel ?? "ok",
  resources: { ...(before.resources ?? {}) },
  biomeHealth: { ...(before.biomeHealth ?? {}) },
  crops: (before.crops ?? []).map((c: any) => ({ ...c })),
  farmland: (before.farmland ?? []).map((f: any) => ({ ...f })),
  bridges: (before.bridges ?? []).map((b: any) => ({ ...b })),
  buildings: (before.buildings ?? []).map((b: any) => ({ ...b })),
  resourceNodes: (before.resourceNodes ?? []).map((n: any) => ({ ...n })),
  islands: (before.islands ?? []).map((i: any) => ({ ...i })),
  pendingApprovals: [],
};

function framesFor(frames: typeof distinct): { ts: number; day: number; snapshot: any }[] {
  const result: { ts: number; day: number; snapshot: any }[] = [];
  // Terminate at the recorded events for exact times.
  for (const f of frames) {
    const snap = {
      ...BASE_SNAPSHOT,
      day: f.day ?? BASE_SNAPSHOT.day,
      season: f.season ?? BASE_SNAPSHOT.season,
      population: f.population ?? BASE_SNAPSHOT.population,
      food: f.food ?? BASE_SNAPSHOT.food,
      crops: (f.crops ?? BASE_SNAPSHOT.crops).map((c: any) => ({
        id: c.id,
        farmPlotId: c.farmPlotId ?? "",
        cropType: c.cropType ?? "wheat",
        growthStage: typeof c.growthStage === "number" ? c.growthStage : round(typeof c.growth === "number" ? c.growth / 100 : c.growthStage),
        harvestable: !!c.harvestable,
      })),
      farmland: (f.farmland ?? BASE_SNAPSHOT.farmland).map((plot: any) => ({
        islandId: plot.islandId,
        capacity: plot.capacity ?? 0,
        used: plot.used ?? 0,
        available: (plot.available ?? plot.capacity ?? 0) - (plot.used ?? 0),
      })),
      harvestableFood: f.harvestableFood ?? 0,
      growingFood: f.growingFood ?? 0,
      daysOfFoodRemaining: f.daysOfFoodRemaining ?? 0,
      projectedFoodAtWinter: f.projectedFoodAtWinter ?? 0,
      foodPressureLevel: f.foodPressureLevel ?? "ok",
      foodPerDay: f.foodPerDay ?? 0,
      daysUntilWinter: f.daysUntilWinter ?? 0,
    };
    // After the run, the final authoritative state is the "after" snapshot —
    // swap in its bridges/buildings/nodes so the world matches the recorded end.
    if (f.day >= (after.day ?? 99) - 0) {
      snap.bridges = (after.bridges ?? []).map((b: any) => ({ ...b }));
      snap.buildings = (after.buildings ?? []).map((b: any) => ({ ...b }));
      snap.resourceNodes = (after.resourceNodes ?? []).map((n: any) => ({ ...n }));
      snap.farmland = (after.farmland ?? snap.farmland).map((plot: any) => ({
        islandId: plot.islandId, capacity: plot.capacity ?? 0, used: plot.used ?? 0, available: (plot.available ?? plot.capacity ?? 0) - (plot.used ?? 0),
      }));
      snap.islands = (after.islands ?? snap.islands).map((i: any) => ({ ...i }));
      snap.biomeHealth = { ...(after.biomeHealth ?? snap.biomeHealth) };
    }
    result.push({ ts: f.ts ?? Date.now(), day: snap.day, snapshot: snap });
  }
  return result;
}

// Build frames in day order from the distinct reduced frames; each frame's ts
// is anchored to the first event whose recorded day matches.
const DAY_MS = 80; // presentation: ~all days compressed within the bundle time
const eventsByDay: Record<number, number> = {};
let cursor = 0;
for (const e of events) {
  const day = e.data?.day !== undefined ? Number(e.data.day) : undefined;
  if (typeof day === "number" && eventsByDay[day] === undefined) {
    eventsByDay[day] = cursor;
  }
  cursor += 1;
}
const frames = distinct.map((f, i) => {
  const day = f.day ?? 1;
  const anchor = eventsByDay[day] ?? (day - 1) * 3;
  return { f, ts: anchor * DAY_MS + i * 20, day };
});

const bundle = {
  meta: {
    name: "ASTrix Canonical Evaluation",
    generatedAt: new Date().toISOString(),
    source: SRC,
    dayStart: before.day ?? 1,
    dayEnd: after.day ?? 30,
    seasonEnd: after.season ?? "winter",
    populationStart: before.population ?? 4,
    populationEnd: after.population ?? 0,
    foodStart: before.food ?? 40,
    foodEnd: after.food ?? 0,
    farmsEnd: (after.buildings ?? []).filter((b: any) => b.type === "farm").length,
    bridgesEnd: (after.bridges ?? []).length,
    approvals: Object.keys(approvals).length,
    approved: granted,
    rejected,
  },
  events: events.map((e) => ({ type: e.type, turn: e.turn ?? 0, data: e.data ?? {}, at: e.at ?? Date.now() })),
  frames: framesFor(distinct.map((f) => f)),
  approvals,
};

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "canonical.json"), JSON.stringify(bundle));
console.log(`[observe] wrote ${join(OUT, "canonical.json")}`);
console.log(`  events=${bundle.events.length}  frames=${bundle.frames.length}  approvals=${Object.keys(approvals).length}  dayEnd=${bundle.meta.dayEnd}`);