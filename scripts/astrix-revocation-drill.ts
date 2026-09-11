// ASTrix revocation drill — "REVOCABLE HANDS" evidence generator.
//
// Deterministic: scripted decisions against REAL Core (demo-scenarios
// standing), real stop("authority-revoked") mid-gate-park, real human approve
// of the surviving approval. Prints the fail-closed proof and writes the
// machine-readable artifact.
//
// Usage:
//   npx tsx scripts/astrix-revocation-drill.ts
//   ASTRIX_DRILL_OUT=artifacts npx tsx scripts/astrix-revocation-drill.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runRevocationDrill } from "../src/astrix/revocationDrill";

const outDir = process.env.ASTRIX_DRILL_OUT ?? "artifacts";

const artifact = await runRevocationDrill({});

mkdirSync(outDir, { recursive: true });
const jsonPath = join(outDir, "astrix-revocation-drill.json");
writeFileSync(jsonPath, JSON.stringify(artifact, null, 2));

console.log(`ASTrix revocation drill ${artifact.runId} (provider=${artifact.provider})`);
for (const p of artifact.phases) console.log(`  phase ${p.phase.padEnd(10)} ${p.note}`);
console.log(`  loop: ${artifact.loopState} (stopReason=${artifact.stopReason})`);
for (const m of artifact.mutations) console.log(`  mutation [${m.actor}]: ${m.what} (day ${m.day})`);
for (const c of artifact.consequences) console.log(`  ${c}`);
console.log(`  score: ${artifact.score.pass ? "PASS" : "FAIL"} — ${artifact.score.rule}`);
console.log(`  artifact: ${jsonPath}`);
console.log("  TrueForge: NOT USED (scripted decisions over real Core)");

if (!artifact.score.pass) process.exit(2);
