// ASTrix absence drill — "THE WORLD DOESN'T WAIT" evidence generator.
//
// Runs the REAL ASTrix Core with NO TrueForge: a governor prepares a farm,
// the local steward manages briefly, the loop is STOPPED (the steward
// disappears), the world ticks on alone, then the loop restarts and the
// steward gets a fixed recovery window. Scoring is mechanical (see
// src/astrix/absenceDrill.ts), the artifact is machine-readable.
//
// Usage:
//   npx tsx scripts/astrix-absence-drill.ts
//   ASTRIX_DRILL_OUT=artifacts npx tsx scripts/astrix-absence-drill.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAbsenceDrill } from "../src/astrix/absenceDrill";

const outDir = process.env.ASTRIX_DRILL_OUT ?? "artifacts";

const artifact = await runAbsenceDrill({});

mkdirSync(outDir, { recursive: true });
const jsonPath = join(outDir, "astrix-absence-drill.json");
writeFileSync(jsonPath, JSON.stringify(artifact, null, 2));

const s = artifact.summary;
const sc = artifact.score;
console.log(`ASTrix absence drill ${artifact.runId} (provider=${artifact.provider})`);
for (const p of artifact.phases) {
  console.log(`  phase ${p.phase.padEnd(7)} days ${p.startDay} -> ${p.endDay}  ${p.note}`);
}
console.log(`  disconnect : day ${artifact.stateAtDisconnect.day} pop ${artifact.stateAtDisconnect.population} food ${artifact.stateAtDisconnect.food}`);
console.log(`  reconnect  : day ${artifact.stateAtReconnect.day} pop ${artifact.stateAtReconnect.population} food ${artifact.stateAtReconnect.food}`);
console.log(`  final      : day ${artifact.finalState.day} pop ${artifact.finalState.population} food ${artifact.finalState.food}`);
console.log(`  starved    : ${s.villagersStarvedTotal} total (${s.villagersStarvedDuringAbsence} during absence)`);
console.log(`  harvested  : ${s.cropsHarvested} crops`);
console.log(`  decisions/actions during absence: ${s.decisionsDuringAbsence} / ${s.actionsDuringAbsence}`);
console.log(`  score      : ${sc.pass ? "PASS" : "FAIL"} — ${sc.rule}`);
console.log(`  artifact   : ${jsonPath}`);
console.log("  TrueForge  : NOT USED (local runtime only)");

if (!sc.pass) process.exit(2);
