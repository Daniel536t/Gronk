// Crop temporal causality proof — uses the REAL authoritative Core classes
// (same AstrixWorldState + AstrixGameCommandBus the server runs).
// plant -> tick 8 real days -> mature -> harvest. No visual timers anywhere.
import { AstrixWorldState, DAY_SECONDS } from "../src/astrix/state";
import { AstrixGameCommandBus } from "../src/astrix/commandBus";
import fs from "node:fs";

const state = new AstrixWorldState();
const bus = new AstrixGameCommandBus(state);
const log: any[] = [];
const snap = () => {
  const s = state.snapshot();
  return { day: s.day, season: s.season, crops: s.crops.map((c) => ({ id: c.id, stage: c.growthStage, harvestable: c.harvestable })), food: s.food };
};

const farm = bus.execute({ command: "PLACE_BUILDING", buildingType: "farm", islandId: "meadow", position: { x: 22, y: 0, z: 30 } });
if (!farm.success) throw new Error("farm build failed: " + farm.error);
const farmId = farm.buildingId as string;
const plant = bus.execute({ command: "PLANT_CROP", farmPlotId: farmId, cropType: "wheat" });
if (!plant.success) throw new Error("plant failed: " + plant.error);
const cropId = plant.cropId as string;
log.push({ event: "planted", ...snap() });

// Advance one authoritative day at a time (DAY_SECONDS each, as the server tick does).
for (let i = 0; i < 10; i++) {
  state.tick(DAY_SECONDS);
  const s = snap();
  log.push({ event: "day-advanced", ...s });
  if ((s.crops[0] as any)?.harvestable) break;
}

const mature = (snap().crops[0] as any)?.harvestable === true;
const foodBefore = snap().food;
let harvest: any = null;
if (mature) harvest = bus.execute({ command: "HARVEST_CROP", cropId });
log.push({ event: "harvest", result: harvest, ...snap() });

const out = {
  maturationDaysAuthoritative: 8,
  matured: mature,
  harvested: harvest?.success === true,
  foodDelta: snap().food - foodBefore,
  timeline: log,
};
fs.mkdirSync("artifacts/crop-temporal-proof", { recursive: true });
fs.writeFileSync("artifacts/crop-temporal-proof/timeline.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify({ matured: out.matured, harvested: out.harvested, foodDelta: out.foodDelta, days: log.length }));
if (!mature || !harvest?.success) throw new Error("TEMPORAL PROOF FAILED");
