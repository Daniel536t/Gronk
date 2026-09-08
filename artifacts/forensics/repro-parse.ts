// FORENSIC REPRO — read-only. Feeds the exact turn-2 model text recovered from
// the TrueForge SQLite record through the PRODUCTION parser, unmodified.
import { readFileSync } from "node:fs";
import { extractJsonObject, parseAstrixStewardDecision } from "../../src/server/trueforge";

const text = readFileSync("artifacts/forensics/turn2-attempt1-model-text.txt", "utf8");
console.log("model text length:", text.length);

const viaExtract = extractJsonObject(text);
console.log("extractJsonObject ->", viaExtract === null ? "null  <-- PARSE FAILURE" : "object");

const viaDecision = parseAstrixStewardDecision({ content: text, tool_calls: [] });
console.log("parseAstrixStewardDecision ->", viaDecision === null ? "null  <-- 'no parseable decision in output'" : "decision");

// Exact JSON.parse error at the failure point, for the record.
const start = text.indexOf("{"), end = text.lastIndexOf("}");
try { JSON.parse(text.slice(start, end + 1)); } catch (e) { console.log("JSON.parse error:", (e as Error).message); }
const bad = text.indexOf('}},\\n{');
console.log("first stray escape at index", bad, "->", JSON.stringify(text.slice(bad, bad + 12)));
