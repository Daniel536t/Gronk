// P1 tool-grounding protection: the steward prompt must enumerate the real
// ASTrix tools, forbid protocol/meta tools, and demand real action; the
// decision parser must tolerate model output noise without inventing content.
import { describe, it, expect } from "vitest";
import { buildStewardPrompt, parseAstrixStewardDecision } from "../src/server/trueforge";

const ASTRIX_TOOLS = [
  "inspect_world",
  "inspect_island",
  "inspect_resources",
  "inspect_buildings",
  "gather",
  "build",
  "plant",
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
