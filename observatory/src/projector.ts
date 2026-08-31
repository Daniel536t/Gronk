// ASTrix Observatory — deterministic projector.
//
// Converts an authoritative WorldSnapshot into an SVG document string. This is
// a PURE function of state: the same snapshot always produces the same scene.
// It performs NO simulation — it only reflects what the authoritative server
// (live) or the recorded replay timeline says. Trees appear iff authoritative
// resourceNodes contain them; farms match farmland.used; crop growth stage maps
// to a visual stage; bridges appear only when authoritative bridges exist;
// season drives the palette/atmosphere.
import type { BiomeId, Season, WorldSnapshot } from "./types";

// Canonical world geometry (from the recorded evaluation's before/after
// snapshots and the authoritative state model — a 100x60 x/z world).
interface Vec { x: number; z: number }

// Island centres in world space (x, z) and a radius for the terrain blob.
const ISLANDS: Record<BiomeId, { c: Vec; r: number }> = {
  meadow: { c: { x: 24, z: 30 }, r: 16 },
  frost: { c: { x: 50, z: 12 }, r: 13 },
  dusk: { c: { x: 72, z: 34 }, r: 12 },
};

export const WORLD_X0 = 0;
export const WORLD_X1 = 100;
export const WORLD_Z0 = 0;
export const WORLD_Z1 = 60;

// Common tree position when authoritative node data is absent (fallback that
// only paints canonical decoration; authoritative trees override this below).
const CANONICAL_TREES: Record<BiomeId, Vec[]> = {
  meadow: [
    { x: 14, z: 22 }, { x: 34, z: 20 }, { x: 18, z: 40 }, { x: 32, z: 42 }, { x: 12, z: 32 },
  ],
  frost: [{ x: 44, z: 8 }, { x: 57, z: 16 }],
  dusk: [{ x: 66, z: 30 }, { x: 80, z: 40 }],
};

const SEASON_BG: Record<Season, string> = {
  spring: "#d9e6ff",
  summer: "#cfe5ff",
  autumn: "#f4e3c8",
  winter: "#dfe7f2",
};

const ISLAND_FILL: Record<Season, string> = {
  spring: "#7fbf5a",
  summer: "#74b74f",
  autumn: "#c9a35c",
  winter: "#e7ecf2",
};

const ISLAND_EDGE: Record<Season, string> = {
  spring: "#5d9a41",
  summer: "#55983b",
  autumn: "#9c7c40",
  winter: "#c7ceda",
};

function iso(x: number, z: number): { sx: number; sy: number } {
  // Simple dimetric projection. sx grows right, sy grows down as z shrinks.
  return { sx: x * 3 - z * 3, sy: (60 - z) * 1.9 + x * 0.55 };
}

// ---- deterministic helpers -------------------------------------------------

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Tree: chunky conifer silhouette (ASErix art direction).
function treeSvg(x: number, z: number, stage: "alive" | "removed", scale = 1): string {
  if (stage === "removed") return "";
  const { sx, sy } = iso(x, z);
  return (
    `<g transform="translate(${sx.toFixed(1)} ${sy.toFixed(1)}) scale(${scale})">` +
    `<ellipse cx="0" cy="0" rx="1.5" ry="0.6" class="shadow"/>` +
    `<path d="M0 -11 L3.2 -5 Q3 -4.5 3 -4 L-3 -4 Q-3 -4.5 -3.2 -5 Z" class="trunk"/>` +
    `<path d="M0 -16 L4.5 -9 L2.6 -9 L5.5 -4 L-5.5 -4 L-2.6 -9 L-4.5 -9 Z" class="conifer"/>` +
    `</g>`
  );
}

// Farm: a plot bed with capacity crops; each plot shows crop stage or empty.
function farmSvg(x: number, z: number, crops: number[], season: Season): string {
  const { sx, sy } = iso(x, z);
  const plots = crops.map((stage, i) => {
    const px = sx + (i - 1) * 3.0;
    const py = sy;
    return plotSvg(px, py, stage, season);
  });
  return `<g transform="translate(${(sx).toFixed(1)} ${(sy + 1).toFixed(1)})"><g class="farm">${plots.join("")}</g></g>`;
}

function plotSvg(cx: number, cy: number, stage: number, season: Season): string {
  const dark = season === "winter";
  const soil = dark ? "#dcd7cf" : "#8a5a2b";
  const cropColor = dark ? "#c9d4bf" : season === "autumn" ? "#e7cf7a" : "#7bc443";
  let inner = "";
  if (stage > 0) {
    const h = 2.2 + stage * 3.4; // taller as it matures
    inner = `<rect x="${(cx - 0.9).toFixed(1)}" y="${(cy - h).toFixed(1)}" width="1.8" height="${h.toFixed(1)}" rx="0.5" class="crop" fill="${cropColor}"/>`;
  } else {
    // empty plot furrow
    inner = `<rect x="${(cx - 0.9).toFixed(1)}" y="${(cy - 0.5).toFixed(1)}" width="1.8" height="0.9" rx="0.4" class="furrow"/>`;
  }
  return `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) scale(1)"><rect x="-1.7" y="-1.2" width="3.4" height="2.4" rx="0.7" fill="${soil}" class="plot"/>${inner}</g>`;
}

// A house / building.
function buildingSvg(x: number, z: number, label: string, season: Season): string {
  const { sx, sy } = iso(x, z);
  const roof = season === "winter" ? "#eef2f7" : "#d98a4e";
  const wall = "#f3d9a8";
  return (
    `<g transform="translate(${sx.toFixed(1)} ${sy.toFixed(1)}) scale(1)">` +
    `<ellipse cx="0" cy="0.6" rx="3" ry="1.2" class="shadow"/>` +
    `<rect x="-2.6" y="-2.6" width="5.2" height="3.4" fill="${wall}" rx="0.4" class="wall"/>` +
    `<path d="M-3.2 -2.2 L0 -5.2 L3.2 -2.2 Z" fill="${roof}" class="roof"/>` +
    `<rect x="-0.5" y="-1.6" width="1" height="2.4" fill="#7a4a21" class="door"/>` +
    (label ? `<title>${escapeXml(label)}</title>` : "") +
    `</g>`
  );
}

// A bridge span between two island edges.
function bridgeSvg(x: number, z: number, season: Season): string {
  const { sx, sy } = iso(x, z);
  const plank = season === "winter" ? "#cfd6e0" : "#a9713a";
  return (
    `<g transform="translate(${sx.toFixed(1)} ${sy.toFixed(1)})">` +
    `<rect x="-1.7" y="-0.35" width="3.4" height="1" rx="0.3" fill="${plank}" class="bridge"/>` +
    `<rect x="-1.7" y="-1.3" width="0.35" height="1.6" class="rail"/>` +
    `<rect x="1.35" y="-1.3" width="0.35" height="1.6" class="rail"/>` +
    `</g>`
  );
}

// Water: an animated band. Given two screen points (span) render a wavy strip.
function waterBand(): string {
  return (
    `<g class="water">` +
    `<path class="water-shape"  d="M0 120 L120 40 L240 120 L120 200 Z" fill="#5bb8d6" opacity="0.9"/>` +
    `<path class="water-ripple" d="M20 96 L40 114 L60 96 L80 114 L100 96" fill="none" stroke="#cdeef7" stroke-width="1.2" opacity="0.7"/>` +
    `<path class="water-ripple2" d="M35 118 L60 100 L85 118 L110 100" fill="none" stroke="#a8dff0" stroke-width="1.1" opacity="0.6"/>` +
    `</g>`
  );
}

function islandSvg(id: BiomeId, season: Season, health: number): string {
  const { c, r } = ISLANDS[id];
  const { sx, sy } = iso(c.x, c.z);
  // A soft hexagonal terrain tile.
  const pts = 6;
  const verts: string[] = [];
  for (let i = 0; i < pts; i++) {
    // alternate angle so the top edge is flat-ish
    const a = (Math.PI / pts) * 2 * i - Math.PI / 2 - Math.PI / 6;
    const rx = r * 2.6;
    const ry = r * 2.0;
    const vx = sx + Math.cos(a) * rx;
    const vy = sy + Math.sin(a) * ry;
    verts.push(`${vx.toFixed(1)},${vy.toFixed(1)}`);
  }
  const fillScale = 0.55 + health * 0.45;
  const f = shade(ISLAND_FILL[season], fillScale);
  return (
    `<g class="island island-${id}" data-island="${id}">` +
    `<path d="M${verts.join("L")}Z" fill="${f}" stroke="${ISLAND_EDGE[season]}" stroke-width="1.4" class="terrain"/>` +
    `<text x="${(sx).toFixed(1)}" y="${(sy + r * 1.9).toFixed(1)}" text-anchor="middle" class="island-label">${escapeXml(id.toUpperCase())}</text>` +
    `</g>`
  );
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * k));
  const b = Math.min(255, Math.round((n & 255) * k));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// ---- public projector -----------------------------------------------------

/**
 * Rendering result: the full scene SVG inner markup + a list of entity records
 * (for hit testing / tooltips) + derived metrics.
 */
export interface RenderedWorld {
  svg: string;
  entities: { kind: string; id: string; sx: number; sy: number; label: string }[];
  trees: number;
  farms: number;
  bridges: number;
}

/**
 * Build the world scene purely from an authoritative snapshot. `removedTrees`
 * is an optional set of node ids the authoritative record marks removed (e.g.
 * clear_terrain). When absent, we trust resourceNodes themselves.
 */
export function renderWorld(snapshot: WorldSnapshot, removedTrees?: Set<string>): RenderedWorld {
  const season: Season = snapshot.season ?? "spring";
  const entities: { kind: string; id: string; sx: number; sy: number; label: string }[] = [];
  let trees = 0;

  const parts: string[] = [];
  parts.push(`<rect x="-30" y="-30" width="320" height="220" class="bg" fill="${SEASON_BG[season]}"/>`);
  parts.push(waterBand());

  // Islands (in draw order: frost back, meadow mid, dusk frontmost-ish).
  for (const id of ["frost", "meadow", "dusk"] as BiomeId[]) {
    const island = snapshot.islands.find((i) => i.id === id);
    parts.push(islandSvg(id, season, island?.health ?? 1));
  }

  // Resource nodes -> trees (authoritative). removedTrees filters cleared ones.
  for (const node of snapshot.resourceNodes ?? []) {
    if (node.type !== "wood") continue;
    if (removedTrees?.has(node.id)) continue;
    const { sx, sy } = iso(node.position.x, node.position.z);
    entities.push({ kind: "tree", id: node.id, sx, sy, label: `${node.id} (wood ${node.quantity})` });
    parts.push(treeSvg(node.position.x, node.position.z, "alive"));
    trees++;
  }
  // Canonical decoration trees if authoritative node list is empty but the
  // island is known (only fills obvious empty worlds; authoritative wins).
  if ((snapshot.resourceNodes ?? []).filter((n) => n.type === "wood").length === 0) {
    for (const id of ["meadow", "frost", "dusk"] as BiomeId[]) {
      for (const t of CANONICAL_TREES[id]) {
        parts.push(treeSvg(t.x, t.z, "alive", 0.8));
      }
    }
  }

  // Buildings: houses + farms (with crops). Farms map crops by farmPlotId.
  let farms = 0;
  for (const b of snapshot.buildings ?? []) {
    if (b.type === "house") {
      entities.push({ kind: "building", id: b.id, sx: iso(b.position.x, b.position.z).sx, sy: iso(b.position.x, b.position.z).sy, label: b.id });
      parts.push(buildingSvg(b.position.x, b.position.z, b.id, season));
    } else if (b.type === "farm") {
      farms++;
      const stages = new Array<number>(3).fill(0); // up to FARM_CROP_CAPACITY=3
      for (const c of snapshot.crops ?? []) {
        if (c.farmPlotId !== b.id) continue;
        const slot = stages.findIndex((s) => s === 0);
        if (slot >= 0) stages[slot] = c.growthStage;
      }
      entities.push({ kind: "farm", id: b.id, sx: iso(b.position.x, b.position.z).sx, sy: iso(b.position.x, b.position.z).sy, label: b.id });
      parts.push(farmSvg(b.position.x, b.position.z, stages, season));
    }
  }

  // Bridges: rendered where authoritative connectivity says islands are joined.
  let bridges = 0;
  const bridgeSpans: Record<string, Vec> = {
    "meadow-frost": { x: 39, z: 22 },
    "frost-meadow": { x: 39, z: 22 },
    "meadow-dusk": { x: 50, z: 34 },
    "dusk-meadow": { x: 50, z: 34 },
  };
  const seenPairs = new Set<string>();
  for (const br of snapshot.bridges ?? []) {
    const key = [br.islandA, br.islandB].sort().join("-");
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    const span = bridgeSpans[key];
    if (!span) continue;
    bridges++;
    entities.push({ kind: "bridge", id: br.id, sx: iso(span.x, span.z).sx, sy: iso(span.x, span.z).sy, label: `${br.islandA} ↔ ${br.islandB}` });
    parts.push(bridgeSvg(span.x, span.z, season));
  }

  return { svg: parts.join(""), entities, trees, farms, bridges };
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