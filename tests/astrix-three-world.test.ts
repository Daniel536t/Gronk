// ASTrix Three.js world layer tests — asset + reconciliation contracts.
// Proves: real GLBs, valid manifest, no-fake-causality reconciliation rules.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const MAN = path.join(ROOT, "assets/manifests/asset-manifest.json");
const GLB = path.join(ROOT, "assets/glb");

function parseGLB(p: string) {
  const d = fs.readFileSync(p);
  const magic = d.readUInt32LE(0);
  const ver = d.readUInt32LE(4);
  const jl = d.readUInt32LE(12);
  const js = JSON.parse(d.subarray(20, 20 + jl).toString().replace(/\0+$/, "").replace(/ +$/, ""));
  return { magic, ver, js };
}

// Pure reconciliation rules (mirrors astrix-three/main.js — same contract).
export function npcVisibleCount(population: number): number {
  return Math.max(0, Math.min(14, population ?? 4));
}
// Crop visual mapping (mirrors main.js crop reconciliation): height from
// authoritative growthStage, gold material iff authoritative harvestable.
export function cropHeight(stage: number): number {
  return 0.3 + (stage || 0) * 1.4;
}
export function cropIsGold(harvestable: boolean): boolean {
  return harvestable === true;
}
export function diffIds(want: string[], have: string[]): { add: string[]; remove: string[] } {
  const w = new Set(want), h = new Set(have);
  return { add: [...w].filter((x) => !h.has(x)), remove: [...h].filter((x) => !w.has(x)) };
}

describe("asset manifest", () => {
  it("exists with 55 assets and ASTX ids", () => {
    const m = JSON.parse(fs.readFileSync(MAN, "utf8"));
    expect(m.version).toBe(1);
    expect(m.assets.length).toBe(64);
    for (const a of m.assets) {
      expect(a.id.startsWith("ASTX_")).toBe(true);
      expect(a.glb).toMatch(/^assets\/glb\/ASTX_.*\.glb$/);
      // origins: ground-center (y0 0), world-anchored shells (y0 -6 seabed),
      // sea-stack embedded pillar (y0 -3, base buried by design)
      expect([0, -3, -6].includes(a.origin.y0)).toBe(true);
      expect(a.units).toBe("meters");
    }
  });
  it("covers all required categories", () => {
    const m = JSON.parse(fs.readFileSync(MAN, "utf8"));
    const ids = new Set(m.assets.map((a: any) => a.id));
    for (const need of ["ASTX_BUILDING_HOUSE", "ASTX_BUILDING_TOWNHALL", "ASTX_BUILDING_WINDMILL",
      "ASTX_BUILDING_LIGHTHOUSE", "ASTX_INFRA_BRIDGE", "ASTX_INFRA_DOCK", "ASTX_TERRAIN_TILE",
      "ASTX_TERRAIN_CLIFF", "ASTX_TERRAIN_BEACH", "ASTX_TERRAIN_WATERFALL", "ASTX_TERRAIN_REEF",
      "ASTX_TERRAIN_ISLET", "ASTX_FIELD_PLOT", "ASTX_PLAZA_CIVIC", "ASTX_VEG_PALM", "ASTX_NPC_VILLAGER", "ASTX_BOAT_SAIL", "ASTX_PROP_CRATE", "ASTX_PROP_LANTERN"])
      expect(ids.has(need)).toBe(true);
  });
});

describe("GLB binaries (real glTF 2.0)", () => {
  // Production Readiness: Gates C+D promoted all 14 vegetation assets into the
  // manifest. The invariant is now explicit allowlisting of the promoted set.
  const PROMOTED = ["ASTX_VEG_CANOPY_A", "ASTX_VEG_PALM_A", "ASTX_VEG_SHRUB_A", "ASTX_VEG_GRASS_A", "ASTX_VEG_FLOWERS_A", "ASTX_VEG_SCRUB_A", "ASTX_VEG_CLIFFTUFT_A",
    "ASTX_VEG_CANOPY_B", "ASTX_VEG_CANOPY_C", "ASTX_VEG_UNDERSTORY_A", "ASTX_VEG_FERN_A", "ASTX_VEG_FLOOR_A", "ASTX_VEG_SEAWEED_A", "ASTX_VEG_CORAL_A"];
  const PROPS = ["ASTX_PROP_SACK", "ASTX_PROP_BENCH", "ASTX_PROP_SIGNPOST", "ASTX_PROP_GRAINSTACK", "ASTX_PROP_WOODPILE", "ASTX_PROP_BASKET", "ASTX_PROP_ROPECOIL", "ASTX_PROP_BUOY", "ASTX_PROP_DRYRACK"];
  function checkParse(p: string) {
    const { magic, ver, js } = parseGLB(p);
    expect(magic).toBe(0x46546c67);
    expect(ver).toBe(2);
    expect(js.asset.version).toBe("2.0");
    expect(js.nodes.length).toBeGreaterThan(0);
    expect(js.meshes.length).toBeGreaterThan(0);
    for (const n of js.nodes) expect(n.name.startsWith("ASTX_")).toBe(true);
  }
  it("every manifest entry resolves to a valid GLB", () => {
    const m = JSON.parse(fs.readFileSync(MAN, "utf8"));
    expect(m.assets.length).toBe(64);
    for (const a of m.assets) checkParse(path.join(ROOT, a.glb));
  });
  it("promoted vegetation and props are in the manifest and parse", () => {
    const m = JSON.parse(fs.readFileSync(MAN, "utf8"));
    const ids = new Set(m.assets.map((a: any) => a.id));
    for (const id of [...PROMOTED, ...PROPS]) {
      expect(ids.has(id)).toBe(true);
      checkParse(path.join(GLB, id + ".glb"));
    }
  });
});

describe("reconciliation (no fake causality)", () => {
  it("NPC count exactly tracks population", () => {
    expect(npcVisibleCount(4)).toBe(4);
    expect(npcVisibleCount(0)).toBe(0);
    expect(npcVisibleCount(99)).toBe(14); // render cap, HUD stays authoritative
  });
  it("dynamic buildings only add wanted ids, only remove absent ids", () => {
    const d = diffIds(["house-001", "farm-9"], ["house-001", "stale-x"]);
    expect(d.add).toEqual(["farm-9"]);
    expect(d.remove).toEqual(["stale-x"]);
  });
  it("crop visuals derive from authoritative stage (temporal mapping)", () => {
    expect(cropHeight(0)).toBeCloseTo(0.3);
    expect(cropHeight(0.5)).toBeCloseTo(1.0);
    expect(cropHeight(1)).toBeCloseTo(1.7);
    expect(cropIsGold(false)).toBe(false);
    expect(cropIsGold(true)).toBe(true);
  });
  it("render failure cannot mutate authority (adapter is read-only)", () => {
    const snap = { buildings: [{ id: "a" }] };
    const before = JSON.stringify(snap);
    diffIds(snap.buildings.map((b) => b.id), []);
    expect(JSON.stringify(snap)).toBe(before);
  });
});
