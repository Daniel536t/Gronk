// ASTrix canonical 30-day run — deterministic Core evidence generator.
//
// Runs the REAL ASTrix Core lifecycle with NO TrueForge:
//
//   LocalStewardProvider -> AstrixStewardLoop -> tool registry -> command bus
//     -> structural approval gate -> execution -> verification
//     -> authoritative world state -> event log -> next observation
//
// Nothing is faked. The world is the real AstrixWorldState, mutations travel the
// real AstrixGameCommandBus, and irreversible actions genuinely stop at the gate
// until this driver's human policy decides. The only thing this file adds on top
// of production behaviour is (a) a deterministic clock (days are advanced
// explicitly instead of by wall time) and (b) a deterministic HUMAN policy so the
// approve/reject decisions are reproducible.
//
// Usage:
//   npx tsx scripts/astrix-canonical-run.ts
//   ASTRIX_RUN_DAYS=30 ASTRIX_RUN_SEED=astrix-canonical-v1 npx tsx scripts/astrix-canonical-run.ts
//   ASTRIX_RUN_OUT=artifacts npx tsx scripts/astrix-canonical-run.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  runCanonicalScenario,
  renderCanonicalMarkdown,
  DEFAULT_CANONICAL_OPTIONS,
} from "../src/astrix/canonicalRun";

const days = Number(process.env.ASTRIX_RUN_DAYS ?? DEFAULT_CANONICAL_OPTIONS.days);
const seed = process.env.ASTRIX_RUN_SEED ?? DEFAULT_CANONICAL_OPTIONS.seed;
const outDir = process.env.ASTRIX_RUN_OUT ?? "artifacts";

const artifact = await runCanonicalScenario({ days, seed });

mkdirSync(outDir, { recursive: true });
const jsonPath = join(outDir, "astrix-canonical-run.json");
const mdPath = join(outDir, "astrix-canonical-run.md");
writeFileSync(jsonPath, JSON.stringify(artifact, null, 2));
writeFileSync(mdPath, renderCanonicalMarkdown(artifact));

const s = artifact.summary;
console.log(`ASTrix canonical run ${artifact.runId} (seed=${artifact.seed}, provider=${artifact.provider})`);
console.log(`  days              : ${artifact.startState.day} -> ${artifact.finalState.day}`);
console.log(`  population        : ${artifact.startState.population} -> ${artifact.finalState.population}`);
console.log(`  food              : ${artifact.startState.food} -> ${artifact.finalState.food}`);
console.log(`  farms / bridges   : ${s.farmsBuilt} / ${s.bridgesBuilt}`);
console.log(`  decisions         : ${s.decisions}`);
console.log(`  proposals         : ${s.proposals} (high-risk ${s.highRiskProposals})`);
console.log(`  approvals         : ${s.approvalsGranted} granted / ${s.approvalsRejected} rejected`);
console.log(`  executed/verified : ${s.actionsExecuted} / ${s.actionsVerified}`);
console.log(`  adaptations       : ${s.adaptations}`);
console.log(`  events            : ${artifact.events.length}`);
console.log(`  outcome           : ${s.outcome}`);
console.log(`  artifacts         : ${jsonPath}, ${mdPath}`);

if (!s.trueforgeUsed) console.log("  TrueForge         : NOT USED (local runtime only)");
else {
  console.error("  TrueForge         : USED — canonical run must be TrueForge-free");
  process.exit(1);
}
