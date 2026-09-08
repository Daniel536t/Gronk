// P1 tool-grounding protection: the steward prompt must enumerate the real
// ASTrix tools, forbid protocol/meta tools, and demand real action; the
// decision parser must tolerate model output noise without inventing content.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  buildStewardPrompt,
  extractJsonObject,
  extractJsonObjectDetailed,
  parseAstrixStewardDecision,
  parseAstrixStewardDecisionDetailed,
  repairStrayEscapes,
  stewardTurnFailureMessage,
} from "../src/server/trueforge";
import { AstrixWorldState } from "../src/astrix/state";
import { AstrixGameCommandBus } from "../src/astrix/commandBus";
import { createAstrixToolRegistry } from "../src/astrix/mcpTools";
import { AstrixEventLog } from "../src/astrix/events";
import { AstrixStewardLoop, type StewardDecision, type StewardDecisionProvider } from "../src/astrix/orchestrator";

/**
 * The VERBATIM text nvidia/gpt-oss-20b returned on live turn 2, captured during
 * the forensic investigation of the stalled run. It is a valid decision whose
 * tool-call array is separated by literal `\n` escapes emitted OUTSIDE any
 * string ("}},\n{"), which JSON.parse rejects. Using the real capture (not a
 * hand-written imitation) is the point: it is the exact input that lost a
 * 15-call plan and 227 seconds of world time.
 */
const LIVE_TURN2_TEXT = readFileSync("artifacts/forensics/turn2-attempt1-model-text.txt", "utf8");

const ASTRIX_TOOLS = [
  "inspect_world",
  "inspect_island",
  "inspect_resources",
  "inspect_buildings",
  "gather",
  "build",
  "plant",
  "harvest",
  "clear_terrain",
  "build_bridge",
  "simulate_plan",
];

describe("ASTrix steward prompt grounding", () => {
  it("enumerates every real ASTrix tool in the prompt", () => {
    const prompt = buildStewardPrompt({ day: 1, food: 12 });
    for (const tool of ASTRIX_TOOLS) {
      expect(prompt).toContain(tool);
    }
  });

  it("explicitly forbids protocol/meta tools", () => {
    const prompt = buildStewardPrompt({});
    expect(prompt).toMatch(/list_tools/);
    expect(prompt).toMatch(/get_tool_info/);
    expect(prompt).toMatch(/REJECTED/);
  });

  it("demands real action, not observation-only turns", () => {
    const prompt = buildStewardPrompt({});
    expect(prompt).toMatch(/ACT, do not merely observe/);
  });

  it("carries the objective and the execution/memory context", () => {
    const prompt = buildStewardPrompt({ day: 1 }, { objective: "survive 30 days", memory: "- attempted build -> FAILED" });
    expect(prompt).toContain("survive 30 days");
    expect(prompt).toContain("attempted build -> FAILED");
    expect(prompt).toContain("AUTOMATICALLY pause for HUMAN approval");
  });
});

describe("ASTrix steward decision parsing", () => {
  it("extracts a decision JSON embedded in model text with fences", () => {
    const output = {
      content: [
        'Here is my decision:\n```json\n{"decision":"gather wood","reasoning":"need wood","toolCalls":[{"tool":"gather","args":{"resource_type":"wood"}}]}\n```',
      ],
    };
    const decision = parseAstrixStewardDecision(output);
    expect(decision).not.toBeNull();
    expect(decision!.decision).toBe("gather wood");
    expect(decision!.toolCalls).toEqual([{ tool: "gather", args: { resource_type: "wood" } }]);
  });

  it("passes through a decision that names a meta tool (the loop rejects it)", () => {
    const output = {
      content: [
        '{"decision":"list tools","toolCalls":[{"tool":"list_tools","args":{}}]}',
      ],
    };
    const decision = parseAstrixStewardDecision(output);
    expect(decision).not.toBeNull();
    expect(decision!.toolCalls).toHaveLength(1);
    expect(decision!.toolCalls[0].tool).toBe("list_tools");
  });

  it("prefers an explicit astrix_decision tool call over text", () => {
    const output = {
      content: ["not a decision"],
      tool_calls: [
        {
          function: {
            name: "astrix_decision",
            arguments: '{"decision":"build farm","toolCalls":[{"tool":"build","args":{"building_type":"farm","position":{"x":5,"y":0,"z":5},"island_id":"meadow"}}]}',
          },
        },
      ],
    };
    const decision = parseAstrixStewardDecision(output);
    expect(decision).not.toBeNull();
    expect(decision!.toolCalls[0].tool).toBe("build");
  });

  it("returns null for unparseable output (never guesses)", () => {
    expect(parseAstrixStewardDecision({ content: ["I think therefore I am."] })).toBeNull();
    expect(parseAstrixStewardDecision(null)).toBeNull();
    expect(parseAstrixStewardDecision(undefined)).toBeNull();
  });
});

describe("stray-escape repair (P0: the live turn-2 parse failure)", () => {
  it("1: recovers the real model output whose toolCalls are separated by broken \\n escapes", () => {
    // Ground truth about the capture, so this test fails loudly if the fixture changes.
    expect(LIVE_TURN2_TEXT).toContain('}},\\n{');
    expect(JSON.parse.bind(null, LIVE_TURN2_TEXT)).toThrow(); // unrepaired, it is invalid JSON

    const detailed = extractJsonObjectDetailed(LIVE_TURN2_TEXT);
    expect(detailed.value).not.toBeNull();
    expect(detailed.repaired).toBe(true); // normal parsing was tried FIRST and failed
    expect(detailed.error).toBeNull();
    expect(Object.keys(detailed.value!)).toEqual(["decision", "recommendation", "reasoning", "toolCalls"]);
  });

  it("2: the recovered decision carries every tool call the model actually proposed", () => {
    const parsed = parseAstrixStewardDecisionDetailed({ content: [LIVE_TURN2_TEXT] });
    expect(parsed.parseError).toBeNull();
    expect(parsed.repaired).toBe(true);
    const decision = parsed.decision!;
    expect(decision.decision).toContain("bridge");
    // 1 build_bridge + 2 build + 12 plant = the 15 calls that were discarded live.
    expect(decision.toolCalls).toHaveLength(15);
    expect(decision.toolCalls.map((call) => call.tool)).toEqual([
      "build_bridge", "build", "build",
      "plant", "plant", "plant", "plant", "plant", "plant",
      "plant", "plant", "plant", "plant", "plant", "plant",
    ]);
    expect(decision.toolCalls[0].args).toEqual({ island_a: "meadow", island_b: "frost" });
    // Args survive intact -- the repair must not rewrite payload values.
    expect(decision.toolCalls[3].args).toMatchObject({ crop_type: "wheat" });
  });

  it("3: escaped characters INSIDE strings are preserved (data is never rewritten)", () => {
    const text = '{"decision":"line one\\nline two\\ttabbed","toolCalls":[{"tool":"gather","args":{"resource_type":"wood"}}]}';
    const value = extractJsonObject(text)!;
    expect(value.decision).toBe("line one\nline two\ttabbed"); // real newline + tab, decoded from the escapes
    expect(repairStrayEscapes(text)).toBe(text); // nothing outside a string, so nothing to repair

    // The live capture also carries in-string escapes in its prose fields: the
    // repair removed the 14 separator escapes and left those 6 untouched.
    const strayCount = (LIVE_TURN2_TEXT.match(/\\n/g) ?? []).length;
    const survivors = (repairStrayEscapes(LIVE_TURN2_TEXT).match(/\\n/g) ?? []).length;
    expect(strayCount).toBe(20);
    expect(survivors).toBe(6);
    const reasoning = String(extractJsonObject(LIVE_TURN2_TEXT)!.reasoning);
    expect(reasoning).toContain("\n"); // decoded from a PRESERVED in-string escape
  });

  it("4: genuinely malformed JSON still fails -- this is not a general sanitizer", () => {
    for (const bad of [
      '{"a":1,}',                              // trailing comma
      '{"a":}',                                // missing value
      '{"a" 1}',                               // missing colon
      '{"toolCalls":[{"tool":"gather"}',       // unterminated
      '{"decision":"unterminated string}',     // unterminated string
      "I think therefore I am.",               // no JSON at all
      '{"a":1,\\n"b":}',                        // stray escape AND broken structure
      "[1,2,3]",                               // valid JSON, but not an object
    ]) {
      const detailed = extractJsonObjectDetailed(bad);
      expect(detailed.value, `must not accept ${bad}`).toBeNull();
      expect(detailed.error, `must explain ${bad}`).toBeTruthy();
      expect(extractJsonObject(bad)).toBeNull();
    }
    expect(parseAstrixStewardDecision({ content: ['{"a":1,}'] })).toBeNull();
  });

  it("5: the parse error text reaches the DECISION_COMPLETED diagnostic event", async () => {
    const broken = '{"decision":"do it","toolCalls":[{"tool":"gather"},}]}';
    const detailed = parseAstrixStewardDecisionDetailed({ content: [broken] });
    expect(detailed.decision).toBeNull();
    expect(detailed.parseError).toBeTruthy();

    // The provider builds its throw message from the same helper production uses,
    // so this asserts the real string the loop will classify and log.
    const message = stewardTurnFailureMessage({ status: "done", decision: null, parseError: detailed.parseError });
    expect(message).toContain("no parseable decision"); // the phrase the loop matches for failureKind=parse
    expect(message).toContain(detailed.parseError!);    // and the actual JSON.parse cause

    const state = new AstrixWorldState();
    const bus = new AstrixGameCommandBus(state);
    const events = new AstrixEventLog();
    const provider: StewardDecisionProvider = {
      id: "unparseable",
      async decide(): Promise<StewardDecision> {
        throw new Error(message);
      },
    };
    const loop = new AstrixStewardLoop({ state, bus, tools: createAstrixToolRegistry(state, bus), events, provider });
    loop.start();
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && !["COMPLETED", "STOPPED", "FAILED"].includes(loop.state)) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const failures = events.all().filter((event) => event.type === "DECISION_COMPLETED" && event.data?.ok === false);
    expect(failures.length).toBeGreaterThan(0);
    for (const failure of failures) {
      expect(failure.data?.failureKind).toBe("parse"); // classified, not mistaken for a provider outage
      expect(String(failure.data?.error)).toContain(detailed.parseError!);
    }
    expect(state.resources.wood).toBe(30); // an unparseable decision mutates nothing
  });
});
