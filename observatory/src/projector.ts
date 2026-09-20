// ASTrix Observatory — deterministic projector.
//
// Converts an authoritative WorldSnapshot into an SVG document string and a
// computed viewBox. This is a PURE function of state: the same snapshot always
// produces the same scene, and it performs NO simulation — it only reflects
// what the authoritative server (live) or the recorded replay timeline says.
//
// FIX (this pass): the previous renderer produced coordinates in an unbounded
// user space (world x/z projected via a hand-tuned iso() with island centres
// landing at NEGATIVE screen coords) and never set an SVG viewBox, so the world
// was CLIPPED entirely off-canvas — the "dark/empty world" bug. Now the projector
// returns a viewBox computed from the actual content bounds (with margin), the
// iso transform spreads the three islands left→right, and water is a full
// background layer. The Observatory UI then sets viewBox + preserveAspectRatio
// so the miniature world is centered and visible at any aspect ratio.
import type { BiomeId, Season, WorldSnapshot } from "./types";

// ---- projection -------------------------------------------------------------
// Isometric: sx grows with (x-z), sy grows with (x+z). Both world coords are in
// [0,100]x[0,60], so sx ranges roughly -120..200 and sy 0..160 in user units.
// Island centres are chosen so Meadow/Frost/Dusk spread out across the frame.
function iso(x: number, z: number): { sx: number; sy: number } {
  const sx = (x - z) * 2;
  const sy = (x + z) * 1;
  return { sx, sy };
}

export const WORLD_X0 = 0;
export const WORLD_X1 = 100;
export const WORLD_Z0 = 0;
export const WORLD_Z1 = 60;

// Island centres in world space and a terrain radius.
export const ISLANDS: Record<BiomeId, { c: { x: number; z: number }; r: number }> = {
  meadow: { c: { x: 24, z: 30 }, r: 15 },
  frost: { c: { x: 50, z: 16 }, r: 12 },
  dusk: { c: { x: 76, z: 34 }, r: 12 },
};

// Decoration trees used only when the authoritative node list has no wood nodes
// (canonical dressing for a fresh/empty world; authoritative nodes override).
const CANONICAL_TREES: Record<BiomeId, { x: number; z: number }[]> = {
  meadow: [
    { x: 14, z: 22 }, { x: 34, z: 20 }, { x: 18, z: 40 }, { x: 32, z: 42 }, { x: 12, z: 33 },
  ],
  frost: [{ x: 44, z: 10 }, { x: 57, z: 20 }],
  dusk: [{ x: 70, z: 28 }, { x: 84, z: 40 }],
};

const SEASON_BG: Record<Season, string> = {
  spring: "#aee0c8",
  summer: "#a9d8b4",
  autumn: "#ecd9b8",
  winter: "#dce7f2",
};
const WATER_A: Record<Season, string> = {
  spring: "#4aa6d6",
  summer: "#3f9fd6",
  autumn: "#4a9cc9",
  winter: "#7fa7c9",
};
const WATER_B: Record<Season, string> = {
  spring: "#2e7fB8",
  summer: "#2a79b5",
  autumn: "#3379a8",
  winter: "#5e8ab5",
};
const ISLAND_FILL: Record<Season, string> = {
  spring: "#8ecb63",
  summer: "#83c457",
  autumn: "#d3a860",
  winter: "#eef2f6",
};
const ISLAND_EDGE: Record<Season, string> = {
  spring: "#5d9a41",
  summer: "#55983b",
  autumn: "#9c7c40",
  winter: "#c2ccd6",
};

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * k));
  const b = Math.min(255, Math.round((n & 255) * k));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---- content bound tracker ---------------------------------------------------
class Bounds {
  minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
  add(x: number, y: number): this {
    if (x < this.minX) this.minX = x;
    if (y < this.minY) this.minY = y;
    if (x > this.maxX) this.maxX = x;
    if (y > this.maxY) this.maxY = y;
    return this;
  }
  grow(dx: number, dy: number): this { this.add(this.minX - dx, this.minY - dy); this.add(this.maxX + dx, this.maxY + dy); return this; }
}

// ---- shape helpers -----------------------------------------------------------
function treeSvg(x: number, z: number, stage: "alive" | "removed", bounds: Bounds, scale = 1): string {
  if (stage === "removed") return "";
  const { sx, sy } = iso(x, z);
  bounds.add(sx - 6 * scale, sy - 17 * scale).add(sx + 6 * scale, sy);
  return (
    `<g transform="translate(${sx.toFixed(1)} ${sy.toFixed(1)}) scale(${scale})" class="tree-group">` +
    `<g class="tree-sway" style="animation-delay:${((sx * 0.1 + sy * 0.05) % 1).toFixed(2)}s">` +
    `<ellipse cx="0" cy="0" rx="2.6" ry="1.0" fill="rgba(20,40,25,0.30)" class="shadow"/>` +
    `<rect x="-0.9" y="-5" width="1.8" height="5" rx="0.6" fill="#79603a" class="trunk"/>` +
    `<path d="M0 -18 L5 -11 L3 -11 L5.8 -5 L-5.8 -5 L-3 -11 L-5 -11 Z" fill="#3f8f3f"/>` +
    `<path d="M0 -18 L4.6 -12 L-4.6 -12 Z" fill="#55a14e" class="conifer"/>` +
    `</g></g>`
  );
}

function buildingSvg(x: number, z: number, label: string, season: Season, bounds: Bounds, hasSmoke = false): string {
  const { sx, sy } = iso(x, z);
  const roof = season === "winter" ? "#eef2f7" : "#d9822e";
  bounds.add(sx - 7, sy - 8).add(sx + 7, sy + 3);
  const smoke = hasSmoke
    ? `<g class="smoke" transform="translate(0 -5.5)">` +
      `<g class="smoke-p1" style="animation-delay:0s"><circle r="1.1" fill="rgba(240,240,245,0.5)"/></g>` +
      `<g class="smoke-p2" style="animation-delay:1.3s"><circle r="1.25" fill="rgba(240,240,245,0.42)"/></g>` +
      `<g class="smoke-p3" style="animation-delay:2.6s"><circle r="1.4" fill="rgba(240,240,245,0.34)"/></g>` +
      `</g>`
    : "";
  return (
    `<g transform="translate(${sx.toFixed(1)} ${sy.toFixed(1)})" class="building">` +
    `<ellipse cx="0" cy="1.5" rx="5" ry="1.8" fill="rgba(20,30,25,0.28)"/>` +
    `<rect x="-4.4" y="-4.6" width="8.8" height="5.6" rx="0.6" fill="#f3d9a8" stroke="#c8a05e" stroke-width="1" class="wall"/>` +
    `<path d="M-5.1 -4.4 L0 -8.5 L5.1 -4.4 Z" fill="${roof}" stroke="#b96a1f" stroke-width="1" class="roof"/>` +
    `<rect x="-0.9" y="-2.9" width="1.8" height="3.9" rx="0.5" fill="#7a4a21"/>` +
    `<rect x="1.6" y="-3.6" width="1.4" height="1.4" rx="0.3" fill="#cfe4ff"/>` +
    (label ? `<title>${esc(label)}</title>` : "") +
    smoke +
    `</g>`
  );
}

function plotSvg(cx: number, cy: number, stage: number, season: Season): string {
  const dark = season === "winter";
  const soil = dark ? "#dcd7cf" : "#8a5a2b";
  const cropColor = dark ? "#c9d4bf" : season === "autumn" ? "#e7cf7a" : "#6fbf3f";
  let inner = "";
  if (stage > 0) {
    const h = 2.4 + stage * 3.2;
    inner = `<rect x="${(cx - 0.9).toFixed(1)}" y="${(cy - h).toFixed(1)}" width="1.8" height="${h.toFixed(1)}" rx="0.5" fill="${cropColor}" class="crop"/>`;
    if (stage >= 0.8) {
      // Mature/harvestable crops get a small golden tip + gentle shimmer cue.
      inner += `<circle cx="${cx.toFixed(1)}" cy="${(cy - h - 0.4).toFixed(1)}" r="0.55" fill="#ffd98a" class="crop-gold" opacity="0.9"/>`;
    }
  } else {
    inner = `<rect x="${(cx - 0.9).toFixed(1)}" y="${(cy - 0.6).toFixed(1)}" width="1.8" height="1" rx="0.5" fill="#6e4a24" class="furrow"/>`;
  }
  const swayDelay = ((cx * 0.7) % 1).toFixed(2);
  return `<g class="crop-clump" style="animation-delay:${swayDelay}s"><rect x="${(cx - 1.9).toFixed(1)}" y="${(cy - 1.3).toFixed(1)}" width="3.8" height="2.6" rx="0.8" fill="${soil}" class="plot"/>${inner}</g>`;
}

function farmSvg(x: number, z: number, crops: number[], season: Season, bounds: Bounds): string {
  const { sx, sy } = iso(x, z);
  bounds.add(sx - 8, sy - 6).add(sx + 8, sy + 6);
  const plots = crops.map((stage, i) => plotSvg(sx + (i - 1) * 4.4, sy, stage, season));
  return `<g>${plots.join("")}</g>`;
}

function bridgeSvg(x: number, z: number, season: Season, bounds: Bounds): string {
  const { sx, sy } = iso(x, z);
  const plank = season === "winter" ? "#cfd6e0" : "#a9713a";
  bounds.add(sx - 10, sy - 3).add(sx + 10, sy + 3);
  const angle = -30; // span runs along the iso x-axis
  return (
    `<g transform="translate(${sx.toFixed(1)} ${sy.toFixed(1)}) rotate(${angle})" class="bridge-g">` +
    `<rect x="-9" y="-0.6" width="18" height="1.6" rx="0.8" fill="${plank}" stroke="#7a5226" stroke-width="0.7" class="bridge"/>` +
    `<rect x="-8" y="-1.9" width="0.5" height="3.2" fill="#6b4a22" class="rail"/><rect x="7.5" y="-1.9" width="0.5" height="3.2" fill="#6b4a22" class="rail"/>` +
    `</g>`
  );
}

// A tiny villager: a china-doll capsule + head, tinted by home island. Purely
// derived from authoritative population count — no independent sim.
function villagerSvg(x: number, z: number, i: number, islandId: BiomeId, bounds: Bounds): string {
  const { sx, sy } = iso(x, z);
  bounds.add(sx - 2, sy - 4).add(sx + 2, sy + 0.5);
  const tone = islandId === "frost" ? "#aebfe0" : islandId === "dusk" ? "#b9a0e0" : "#5fb8a8";
  const head = islandId === "frost" ? "#e8ecf4" : islandId === "dusk" ? "#ece0f2" : "#f2d3c0";
  const delay = ((i * 1.7) % 3).toFixed(2);
  return (
    `<g transform="translate(${sx.toFixed(1)} ${sy.toFixed(1)})" class="villager" data-villager="${i}">` +
    `<g class="villager-bob" style="animation-delay:${delay}s">` +
    `<ellipse cx="0" cy="0" rx="1.5" ry="0.5" fill="rgba(20,30,25,0.3)"/>` +
    `<rect x="-0.8" y="-2.6" width="1.6" height="2.6" rx="0.8" fill="${tone}"/>` +
    `<circle cx="0" cy="-3.4" r="1.0" fill="${head}"/>` +
    `<circle cx="-0.3" cy="-3.4" r="0.14" fill="#3a3f4a"/><circle cx="0.35" cy="-3.4" r="0.14" fill="#3a3f4a"/>` +
    `</g></g>`
  );
}

// Light snow in winter: scattered drifting flakes across the ocean + islands.
// Season-driven, deterministic count.
function snowSvg(bounds: Bounds, over?: string): string {
  const flakes: string[] = [];
  for (let i = 0; i < 34; i++) {
    const xf = -140 + ((i * 47) % 400) - 40;
    const yf = -90 + ((i * 31) % 340) - 60;
    const r = 0.9 + (i % 3) * 0.5;
    flakes.push(`<circle cx="${xf}" cy="${yf}" r="${r}" fill="#f6faff" opacity="0.75" class="flake" style="animation-delay:${((i % 8) * 0.6).toFixed(2)}s"/>`);
  }
  return `<g class="snow-layer" opacity="0.9">${flakes.join("")}</g>`;
}

function islandSvg(id: BiomeId, season: Season, health: number): { svg: string; minX: number; minY: number; maxX: number; maxY: number } {
  const { c, r } = ISLANDS[id];
  const { sx, sy } = iso(c.x, c.z);
  const rx = r * 1.35; // multipled for the flattened diamond look
  const ry = r * 0.95;
  // rough organic blob by drawing a rounded hexagon
  const n = 8;
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + 0.4;
    const rad = rx * (i % 2 === 0 ? 1 : 0.6);
    const vx = sx + Math.cos(a) * rad;
    const vy = sy + Math.sin(a) * rad * (ry / rx);
    pts.push(`${vx.toFixed(1)},${vy.toFixed(1)}`);
  }
  const f = shade(ISLAND_FILL[season], 0.62 + health * 0.4);
  // inner slope highlight
  const light = shade(ISLAND_FILL[season], Math.min(1, 0.7 + health * 0.5));
  const xMin = sx - rx, yMin = sy - ry, xMax = sx + rx, yMax = sy + ry;
  return {
    svg:
      `<g class="island island-${id}" data-island="${id}">` +
      `<path d="M${pts.join("L")}Z" fill="${f}" stroke="${ISLAND_EDGE[season]}" stroke-width="1.6"/>` +
      `<ellipse cx="${sx}" cy="${sy}" rx="${rx * 0.72}" ry="${ry * 0.55}" fill="${light}" opacity="0.5"/>` +
      `<text x="${sx.toFixed(1)}" y="${(sy - ry).toFixed(1)}" text-anchor="middle" class="island-label">${esc(id.toUpperCase())}</text>` +
      `</g>`,
    minX: xMin, minY: yMin, maxX: xMax, maxY: yMax,
  };
}

// ---- public projector --------------------------------------------------------
export interface RenderedWorld {
  svg: string;
  viewBox: string;
  entities: { kind: string; id: string; sx: number; sy: number; label: string }[];
  trees: number;
  farms: number;
  bridges: number;
  villagers: number;
}

export function renderWorld(snapshot: WorldSnapshot, removedTrees?: Set<string>): RenderedWorld {
  const season: Season = snapshot.season ?? "spring";
  const entities: { kind: string; id: string; sx: number; sy: number; label: string }[] = [];
  let trees = 0, farms = 0, bridges = 0;
  const bounds = new Bounds();

  const parts: string[] = [];

  // Full-bleed water background (covers a generous area; viewBox clips it).
  const waterGrad =
    `<linearGradient id="wg" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${WATER_A[season]}"/><stop offset="1" stop-color="${WATER_B[season]}"/></linearGradient>`;
  parts.push(`<defs>${waterGrad}</defs>`);
  parts.push(`<rect x="-220" y="-160" width="900" height="600" fill="url(#wg)"/>`);
  // static ripple highlights
  parts.push(`<g class="waterfx" opacity="0.5">` +
    `<path d="M-80 40 Q-40 30 -0 40 Q40 50 80 40" stroke="#d9f4ff" stroke-width="2" fill="none"/>` +
    `<path d="M-40 90 Q0 78 40 90 Q80 102 120 90" stroke="#d9f4ff" stroke-width="2" fill="none"/>` +
    `<path d="M-70 140 Q-30 130 10 140" stroke="#bfe9ff" stroke-width="2" fill="none"/>` +
    `</g>`);
  // sun/season tint overlay
  parts.push(`<rect x="-220" y="-160" width="900" height="600" fill="#fff" opacity="${season === "winter" ? 0.22 : 0.06}" class="season-tint"/>`);

  // Islands (frost back, meadow mid, dusk front).
  for (const id of ["frost", "meadow", "dusk"] as BiomeId[]) {
    const island = snapshot.islands.find((i) => i.id === id);
    const r = islandSvg(id, season, island?.health ?? 1);
    parts.push(r.svg);
    bounds.add(r.minX, r.minY).add(r.maxX, r.maxY);
  }

  // Resource nodes -> trees; authoritative wins.
  for (const node of snapshot.resourceNodes ?? []) {
    if (node.type !== "wood") continue;
    if (removedTrees?.has(node.id)) continue;
    const { sx, sy } = iso(node.position.x, node.position.z);
    entities.push({ kind: "tree", id: node.id, sx, sy, label: `${node.id} (wood ${node.quantity})` });
    parts.push(treeSvg(node.position.x, node.position.z, "alive", bounds));
    trees++;
  }
  if ((snapshot.resourceNodes ?? []).filter((n) => n.type === "wood").length === 0) {
    for (const id of ["meadow", "frost", "dusk"] as BiomeId[]) {
      for (const t of CANONICAL_TREES[id]) parts.push(treeSvg(t.x, t.z, "alive", bounds, 0.85));
    }
  }

  // Buildings: houses + farms (with crops mapped by farmPlotId). The first
  // house anchors the village (smoke + where villagers gather).
  let villageAnchor: { x: number; z: number; island: BiomeId } | null = null;
  for (const b of snapshot.buildings ?? []) {
    const { sx, sy } = iso(b.position.x, b.position.z);
    if (b.type === "house") {
      if (villageAnchor === null) {
        villageAnchor = { x: b.position.x, z: b.position.z, island: (b.islandId as BiomeId) ?? "meadow" };
      }
      entities.push({ kind: "building", id: b.id, sx, sy, label: b.id });
      parts.push(buildingSvg(b.position.x, b.position.z, b.id, season, bounds, true));
    } else if (b.type === "farm") {
      farms++;
      const stages = new Array<number>(3).fill(0);
      for (const c of snapshot.crops ?? []) {
        if (c.farmPlotId !== b.id) continue;
        const slot = stages.findIndex((s) => s === 0);
        if (slot >= 0) stages[slot] = c.growthStage;
      }
      entities.push({ kind: "farm", id: b.id, sx, sy, label: b.id });
      parts.push(farmSvg(b.position.x, b.position.z, stages, season, bounds));
    }
  }

  // Villagers: one tiny figure per authoritative population, gathered near the
  // village. Purely a projection of population count; never an independent sim.
  const pop = Math.max(0, Math.min(12, Number(snapshot.population ?? 0)));
  const anchor = villageAnchor ?? { x: 22, z: 30, island: "meadow" as BiomeId };
  for (let i = 0; i < pop; i++) {
    const ang = (i / Math.max(1, pop)) * Math.PI * 2;
    const rad = 4.2 + (i % 3) * 1.4;
    parts.push(villagerSvg(anchor.x + Math.cos(ang) * rad, anchor.z + Math.sin(ang) * rad * 0.7, i, anchor.island, bounds));
  }

  // Winter: a light snow layer so the season reads from the world itself.
  if (season === "winter") parts.push(snowSvg(bounds));

  // Bridges where authoritative connectivity says islands are joined.
  const bridgeSpans: Record<string, { x: number; z: number }> = {
    "frost-meadow": { x: 40, z: 24 },
    "dusk-meadow": { x: 52, z: 34 },
  };
  const seen = new Set<string>();
  for (const br of snapshot.bridges ?? []) {
    const key = [br.islandA, br.islandB].sort().join("-");
    if (seen.has(key)) continue;
    seen.add(key);
    const span = bridgeSpans[["frost-meadow", "dusk-meadow"].includes(key) ? key : "frost-meadow"];
    if (!span) continue;
    bridges++;
    const { sx, sy } = iso(span.x, span.z);
    entities.push({ kind: "bridge", id: br.id, sx, sy, label: `${br.islandA} ↔ ${br.islandB}` });
    parts.push(bridgeSvg(span.x, span.z, season, bounds));
  }

  // Compute viewBox from content bounds with generous margin so the whole
  // miniature world is on-canvas.
  bounds.grow(26, 26);
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const viewBox = `${bounds.minX.toFixed(1)} ${bounds.minY.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`;

  return {
    svg: parts.join("\n"),
    viewBox,
    entities,
    trees,
    farms,
    bridges,
    villagers: pop,
  };
}

/** Build the footer/HUD line purely from state. */
export function hudLine(s: WorldSnapshot): string {
  return [
    `DAY ${s.day} / 30`,
    s.season.toUpperCase(),
    `POP ${s.population}`,
    `FOOD ${s.food}`,
    s.daysUntilWinter > 0 ? `WINTER IN ${s.daysUntilWinter}` : "❄ WINTER",
  ].join("   ");
}