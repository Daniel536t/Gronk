// ASTrix chain catch-up — Slice 2 of the living world.
//
// Reads the on-chain day from the astrix_world program (devnet) and advances
// a REAL Core to match it, one tick per crossed day boundary. Every
// consequence (consumption, growth, starvation) is Core's own tick() — the
// chain said WHEN, Core decides WHAT. No steward runs anywhere in this
// script: it proves the world progresses (and suffers) with zero AI present.
//
// Writes the caught-up snapshot for the storyboard renderer and prints the
// world-level consequences.
//
// Usage:
//   WORLD_PDA=GBFT6mQew5g1BBpWjHSYfe9tNN1a3KykjuDun862S29P \
//   ASTRIX_CATCHUP_OUT=artifacts npx tsx scripts/astrix-chain-catchup.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AstrixWorldState, DAY_SECONDS } from "../src/astrix/state";
import { AstrixGameCommandBus } from "../src/astrix/commandBus";

const RPC = process.env.ASTRIX_RPC ?? "https://api.devnet.solana.com";
const WORLD_PDA = process.env.WORLD_PDA ?? "GBFT6mQew5g1BBpWjHSYfe9tNN1a3KykjuDun862S29P";
const outDir = process.env.ASTRIX_CATCHUP_OUT ?? "artifacts";

async function rpc(method: string, params: unknown[] = []) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = (await r.json()) as { error?: unknown; result?: any };
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error).slice(0, 160)}`);
  return j.result;
}

function b64ToBytes(b64: string): Buffer {
  return Buffer.from(b64, "base64");
}

const info = await rpc("getAccountInfo", [WORLD_PDA, { encoding: "base64" }]);
if (!info?.value) throw new Error("world account not found on chain");
const data = b64ToBytes(info.value.data[0]);
const version = data[0];
const chainDay = Number(data.readBigUInt64LE(1 + 32));
console.log(`chain world: version=${version} day=${chainDay} (slot ${info.context.slot})`);

// A lived-in world to catch up (governor-seeded, like the drills).
const state = new AstrixWorldState();
const bus = new AstrixGameCommandBus(state);
const farm = bus.execute({
  command: "PLACE_BUILDING", buildingType: "farm",
  position: { x: 14, y: 0, z: 10 }, islandId: "meadow",
});
const farmId = (farm as { buildingId?: string }).buildingId ?? "";
for (let i = 0; i < 3; i++) {
  bus.execute({ command: "PLANT_CROP", farmPlotId: farmId, cropType: "wheat" });
}

const coreDayBefore = state.day;
const popBefore = state.population;
const foodBefore = state.food;
// Catch-up: one tick per crossed day, exactly as a live observer would.
// No steward, no decisions, no actions — pure consequence of elapsed time.
while (state.day < chainDay) state.tick(DAY_SECONDS);
const snap = state.snapshot();

console.log(`core caught up: day ${coreDayBefore} -> ${snap.day} (chain day ${chainDay})`);
console.log(`  population: ${popBefore} -> ${snap.population}`);
console.log(`  food: ${foodBefore} -> ${snap.food}`);
console.log(`  crops: ${snap.crops.length} (stages: ${snap.crops.map((c) => c.growthStage.toFixed(2)).join(",")})`);
console.log(`  steward actions taken: 0 (no loop exists in this script)`);

mkdirSync(outDir, { recursive: true });
const snapPath = join(outDir, "astrix-chain-catchup.snapshot.json");
writeFileSync(snapPath, JSON.stringify({ day: snap.day, snapshot: snap }, null, 2));
console.log(`  snapshot: ${snapPath}`);
