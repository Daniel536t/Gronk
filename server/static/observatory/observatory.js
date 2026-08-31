var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// observatory/src/projector.ts
function iso(x, z) {
  const sx = (x - z) * 2;
  const sy = (x + z) * 1;
  return { sx, sy };
}
var ISLANDS = {
  meadow: { c: { x: 24, z: 30 }, r: 15 },
  frost: { c: { x: 50, z: 16 }, r: 12 },
  dusk: { c: { x: 76, z: 34 }, r: 12 }
};
var CANONICAL_TREES = {
  meadow: [
    { x: 14, z: 22 },
    { x: 34, z: 20 },
    { x: 18, z: 40 },
    { x: 32, z: 42 },
    { x: 12, z: 33 }
  ],
  frost: [{ x: 44, z: 10 }, { x: 57, z: 20 }],
  dusk: [{ x: 70, z: 28 }, { x: 84, z: 40 }]
};
var WATER_A = {
  spring: "#4aa6d6",
  summer: "#3f9fd6",
  autumn: "#4a9cc9",
  winter: "#7fa7c9"
};
var WATER_B = {
  spring: "#2e7fB8",
  summer: "#2a79b5",
  autumn: "#3379a8",
  winter: "#5e8ab5"
};
var ISLAND_FILL = {
  spring: "#8ecb63",
  summer: "#83c457",
  autumn: "#d3a860",
  winter: "#eef2f6"
};
var ISLAND_EDGE = {
  spring: "#5d9a41",
  summer: "#55983b",
  autumn: "#9c7c40",
  winter: "#c2ccd6"
};
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round((n >> 16 & 255) * k));
  const g = Math.min(255, Math.round((n >> 8 & 255) * k));
  const b = Math.min(255, Math.round((n & 255) * k));
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, "0")}`;
}
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
var Bounds = class {
  constructor() {
    __publicField(this, "minX", Infinity);
    __publicField(this, "minY", Infinity);
    __publicField(this, "maxX", -Infinity);
    __publicField(this, "maxY", -Infinity);
  }
  add(x, y) {
    if (x < this.minX) this.minX = x;
    if (y < this.minY) this.minY = y;
    if (x > this.maxX) this.maxX = x;
    if (y > this.maxY) this.maxY = y;
    return this;
  }
  grow(dx, dy) {
    this.add(this.minX - dx, this.minY - dy);
    this.add(this.maxX + dx, this.maxY + dy);
    return this;
  }
};
function treeSvg(x, z, stage, bounds, scale = 1) {
  if (stage === "removed") return "";
  const { sx, sy } = iso(x, z);
  bounds.add(sx - 6 * scale, sy - 17 * scale).add(sx + 6 * scale, sy);
  return `<g transform="translate(${sx.toFixed(1)} ${sy.toFixed(1)}) scale(${scale})" class="tree-group"><g class="tree-sway" style="animation-delay:${((sx * 0.1 + sy * 0.05) % 1).toFixed(2)}s"><ellipse cx="0" cy="0" rx="2.6" ry="1.0" fill="rgba(20,40,25,0.30)" class="shadow"/><rect x="-0.9" y="-5" width="1.8" height="5" rx="0.6" fill="#79603a" class="trunk"/><path d="M0 -18 L5 -11 L3 -11 L5.8 -5 L-5.8 -5 L-3 -11 L-5 -11 Z" fill="#3f8f3f"/><path d="M0 -18 L4.6 -12 L-4.6 -12 Z" fill="#55a14e" class="conifer"/></g></g>`;
}
function buildingSvg(x, z, label, season, bounds, hasSmoke = false) {
  const { sx, sy } = iso(x, z);
  const roof = season === "winter" ? "#eef2f7" : "#d9822e";
  bounds.add(sx - 7, sy - 8).add(sx + 7, sy + 3);
  const smoke = hasSmoke ? `<g class="smoke" transform="translate(0 -5.5)"><g class="smoke-p1" style="animation-delay:0s"><circle r="1.1" fill="rgba(240,240,245,0.5)"/></g><g class="smoke-p2" style="animation-delay:1.3s"><circle r="1.25" fill="rgba(240,240,245,0.42)"/></g><g class="smoke-p3" style="animation-delay:2.6s"><circle r="1.4" fill="rgba(240,240,245,0.34)"/></g></g>` : "";
  return `<g transform="translate(${sx.toFixed(1)} ${sy.toFixed(1)})" class="building"><ellipse cx="0" cy="1.5" rx="5" ry="1.8" fill="rgba(20,30,25,0.28)"/><rect x="-4.4" y="-4.6" width="8.8" height="5.6" rx="0.6" fill="#f3d9a8" stroke="#c8a05e" stroke-width="1" class="wall"/><path d="M-5.1 -4.4 L0 -8.5 L5.1 -4.4 Z" fill="${roof}" stroke="#b96a1f" stroke-width="1" class="roof"/><rect x="-0.9" y="-2.9" width="1.8" height="3.9" rx="0.5" fill="#7a4a21"/><rect x="1.6" y="-3.6" width="1.4" height="1.4" rx="0.3" fill="#cfe4ff"/>` + (label ? `<title>${esc(label)}</title>` : "") + smoke + `</g>`;
}
function plotSvg(cx, cy, stage, season) {
  const dark = season === "winter";
  const soil = dark ? "#dcd7cf" : "#8a5a2b";
  const cropColor = dark ? "#c9d4bf" : season === "autumn" ? "#e7cf7a" : "#6fbf3f";
  let inner = "";
  if (stage > 0) {
    const h = 2.4 + stage * 3.2;
    inner = `<rect x="${(cx - 0.9).toFixed(1)}" y="${(cy - h).toFixed(1)}" width="1.8" height="${h.toFixed(1)}" rx="0.5" fill="${cropColor}" class="crop"/>`;
    if (stage >= 0.8) {
      inner += `<circle cx="${cx.toFixed(1)}" cy="${(cy - h - 0.4).toFixed(1)}" r="0.55" fill="#ffd98a" class="crop-gold" opacity="0.9"/>`;
    }
  } else {
    inner = `<rect x="${(cx - 0.9).toFixed(1)}" y="${(cy - 0.6).toFixed(1)}" width="1.8" height="1" rx="0.5" fill="#6e4a24" class="furrow"/>`;
  }
  const swayDelay = (cx * 0.7 % 1).toFixed(2);
  return `<g class="crop-clump" style="animation-delay:${swayDelay}s"><rect x="${(cx - 1.9).toFixed(1)}" y="${(cy - 1.3).toFixed(1)}" width="3.8" height="2.6" rx="0.8" fill="${soil}" class="plot"/>${inner}</g>`;
}
function farmSvg(x, z, crops, season, bounds) {
  const { sx, sy } = iso(x, z);
  bounds.add(sx - 8, sy - 6).add(sx + 8, sy + 6);
  const plots = crops.map((stage, i) => plotSvg(sx + (i - 1) * 4.4, sy, stage, season));
  return `<g>${plots.join("")}</g>`;
}
function bridgeSvg(x, z, season, bounds) {
  const { sx, sy } = iso(x, z);
  const plank = season === "winter" ? "#cfd6e0" : "#a9713a";
  bounds.add(sx - 10, sy - 3).add(sx + 10, sy + 3);
  const angle = -30;
  return `<g transform="translate(${sx.toFixed(1)} ${sy.toFixed(1)}) rotate(${angle})" class="bridge-g"><rect x="-9" y="-0.6" width="18" height="1.6" rx="0.8" fill="${plank}" stroke="#7a5226" stroke-width="0.7" class="bridge"/><rect x="-8" y="-1.9" width="0.5" height="3.2" fill="#6b4a22" class="rail"/><rect x="7.5" y="-1.9" width="0.5" height="3.2" fill="#6b4a22" class="rail"/></g>`;
}
function villagerSvg(x, z, i, islandId, bounds) {
  const { sx, sy } = iso(x, z);
  bounds.add(sx - 2, sy - 4).add(sx + 2, sy + 0.5);
  const tone = islandId === "frost" ? "#aebfe0" : islandId === "dusk" ? "#b9a0e0" : "#5fb8a8";
  const head = islandId === "frost" ? "#e8ecf4" : islandId === "dusk" ? "#ece0f2" : "#f2d3c0";
  const delay = (i * 1.7 % 3).toFixed(2);
  return `<g transform="translate(${sx.toFixed(1)} ${sy.toFixed(1)})" class="villager" data-villager="${i}"><g class="villager-bob" style="animation-delay:${delay}s"><ellipse cx="0" cy="0" rx="1.5" ry="0.5" fill="rgba(20,30,25,0.3)"/><rect x="-0.8" y="-2.6" width="1.6" height="2.6" rx="0.8" fill="${tone}"/><circle cx="0" cy="-3.4" r="1.0" fill="${head}"/><circle cx="-0.3" cy="-3.4" r="0.14" fill="#3a3f4a"/><circle cx="0.35" cy="-3.4" r="0.14" fill="#3a3f4a"/></g></g>`;
}
function snowSvg(bounds, over) {
  const flakes = [];
  for (let i = 0; i < 34; i++) {
    const xf = -140 + i * 47 % 400 - 40;
    const yf = -90 + i * 31 % 340 - 60;
    const r = 0.9 + i % 3 * 0.5;
    flakes.push(`<circle cx="${xf}" cy="${yf}" r="${r}" fill="#f6faff" opacity="0.75" class="flake" style="animation-delay:${(i % 8 * 0.6).toFixed(2)}s"/>`);
  }
  return `<g class="snow-layer" opacity="0.9">${flakes.join("")}</g>`;
}
function islandSvg(id, season, health) {
  const { c, r } = ISLANDS[id];
  const { sx, sy } = iso(c.x, c.z);
  const rx = r * 1.35;
  const ry = r * 0.95;
  const n = 8;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = Math.PI * 2 * i / n + 0.4;
    const rad = rx * (i % 2 === 0 ? 1 : 0.6);
    const vx = sx + Math.cos(a) * rad;
    const vy = sy + Math.sin(a) * rad * (ry / rx);
    pts.push(`${vx.toFixed(1)},${vy.toFixed(1)}`);
  }
  const f = shade(ISLAND_FILL[season], 0.62 + health * 0.4);
  const light = shade(ISLAND_FILL[season], Math.min(1, 0.7 + health * 0.5));
  const xMin = sx - rx, yMin = sy - ry, xMax = sx + rx, yMax = sy + ry;
  return {
    svg: `<g class="island island-${id}" data-island="${id}"><path d="M${pts.join("L")}Z" fill="${f}" stroke="${ISLAND_EDGE[season]}" stroke-width="1.6"/><ellipse cx="${sx}" cy="${sy}" rx="${rx * 0.72}" ry="${ry * 0.55}" fill="${light}" opacity="0.5"/><text x="${sx.toFixed(1)}" y="${(sy - ry).toFixed(1)}" text-anchor="middle" class="island-label">${esc(id.toUpperCase())}</text></g>`,
    minX: xMin,
    minY: yMin,
    maxX: xMax,
    maxY: yMax
  };
}
function renderWorld(snapshot, removedTrees) {
  const season = snapshot.season ?? "spring";
  const entities = [];
  let trees = 0, farms = 0, bridges = 0;
  const bounds = new Bounds();
  const parts = [];
  const waterGrad = `<linearGradient id="wg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${WATER_A[season]}"/><stop offset="1" stop-color="${WATER_B[season]}"/></linearGradient>`;
  parts.push(`<defs>${waterGrad}</defs>`);
  parts.push(`<rect x="-220" y="-160" width="900" height="600" fill="url(#wg)"/>`);
  parts.push(`<g class="waterfx" opacity="0.5"><path d="M-80 40 Q-40 30 -0 40 Q40 50 80 40" stroke="#d9f4ff" stroke-width="2" fill="none"/><path d="M-40 90 Q0 78 40 90 Q80 102 120 90" stroke="#d9f4ff" stroke-width="2" fill="none"/><path d="M-70 140 Q-30 130 10 140" stroke="#bfe9ff" stroke-width="2" fill="none"/></g>`);
  parts.push(`<rect x="-220" y="-160" width="900" height="600" fill="#fff" opacity="${season === "winter" ? 0.22 : 0.06}" class="season-tint"/>`);
  for (const id of ["frost", "meadow", "dusk"]) {
    const island = snapshot.islands.find((i) => i.id === id);
    const r = islandSvg(id, season, island?.health ?? 1);
    parts.push(r.svg);
    bounds.add(r.minX, r.minY).add(r.maxX, r.maxY);
  }
  for (const node of snapshot.resourceNodes ?? []) {
    if (node.type !== "wood") continue;
    if (removedTrees?.has(node.id)) continue;
    const { sx, sy } = iso(node.position.x, node.position.z);
    entities.push({ kind: "tree", id: node.id, sx, sy, label: `${node.id} (wood ${node.quantity})` });
    parts.push(treeSvg(node.position.x, node.position.z, "alive", bounds));
    trees++;
  }
  if ((snapshot.resourceNodes ?? []).filter((n) => n.type === "wood").length === 0) {
    for (const id of ["meadow", "frost", "dusk"]) {
      for (const t of CANONICAL_TREES[id]) parts.push(treeSvg(t.x, t.z, "alive", bounds, 0.85));
    }
  }
  let villageAnchor = null;
  for (const b of snapshot.buildings ?? []) {
    const { sx, sy } = iso(b.position.x, b.position.z);
    if (b.type === "house") {
      if (villageAnchor === null) {
        villageAnchor = { x: b.position.x, z: b.position.z, island: b.islandId ?? "meadow" };
      }
      entities.push({ kind: "building", id: b.id, sx, sy, label: b.id });
      parts.push(buildingSvg(b.position.x, b.position.z, b.id, season, bounds, true));
    } else if (b.type === "farm") {
      farms++;
      const stages = new Array(3).fill(0);
      for (const c of snapshot.crops ?? []) {
        if (c.farmPlotId !== b.id) continue;
        const slot = stages.findIndex((s) => s === 0);
        if (slot >= 0) stages[slot] = c.growthStage;
      }
      entities.push({ kind: "farm", id: b.id, sx, sy, label: b.id });
      parts.push(farmSvg(b.position.x, b.position.z, stages, season, bounds));
    }
  }
  const pop = Math.max(0, Math.min(12, Number(snapshot.population ?? 0)));
  const anchor = villageAnchor ?? { x: 22, z: 30, island: "meadow" };
  for (let i = 0; i < pop; i++) {
    const ang = i / Math.max(1, pop) * Math.PI * 2;
    const rad = 4.2 + i % 3 * 1.4;
    parts.push(villagerSvg(anchor.x + Math.cos(ang) * rad, anchor.z + Math.sin(ang) * rad * 0.7, i, anchor.island, bounds));
  }
  if (season === "winter") parts.push(snowSvg(bounds));
  const bridgeSpans = {
    "frost-meadow": { x: 40, z: 24 },
    "dusk-meadow": { x: 52, z: 34 }
  };
  const seen = /* @__PURE__ */ new Set();
  for (const br of snapshot.bridges ?? []) {
    const key = [br.islandA, br.islandB].sort().join("-");
    if (seen.has(key)) continue;
    seen.add(key);
    const span = bridgeSpans[["frost-meadow", "dusk-meadow"].includes(key) ? key : "frost-meadow"];
    if (!span) continue;
    bridges++;
    const { sx, sy } = iso(span.x, span.z);
    entities.push({ kind: "bridge", id: br.id, sx, sy, label: `${br.islandA} \u2194 ${br.islandB}` });
    parts.push(bridgeSvg(span.x, span.z, season, bounds));
  }
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
    villagers: pop
  };
}
function hudLine(s) {
  return [
    `DAY ${s.day} / 30`,
    s.season.toUpperCase(),
    `POP ${s.population}`,
    `FOOD ${s.food}`,
    s.daysUntilWinter > 0 ? `WINTER IN ${s.daysUntilWinter}` : "\u2744 WINTER"
  ].join("   ");
}

// observatory/src/replay.ts
var loadedBundle = null;
async function loadReplayBundle(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("replay bundle " + url + " -> " + res.status);
  loadedBundle = await res.json();
  return loadedBundle;
}
function getBundle() {
  return loadedBundle;
}
function eventLabel(ev) {
  const d = ev.data ?? {};
  switch (ev.type) {
    case "WORLD_OBSERVED":
      return `Observed world (day ${d.day})`;
    case "PLAN_CREATED":
      return `Plan: ${String(d.decision ?? "\u2026")}`;
    case "ACTION_PROPOSED":
      return `Proposed ${String(d.tool ?? "")}`;
    case "ACTION_EXECUTING":
      return `Executing ${String(d.tool ?? "")}`;
    case "ACTION_SUCCEEDED":
      return `\u2713 ${String(d.tool ?? "action")} executed`;
    case "ACTION_FAILED":
      return `\u2717 ${String(d.tool ?? "action")} failed${d.error ? ` (${String(d.error).slice(0, 60)})` : ""}`;
    case "VERIFICATION_SUCCEEDED":
      return `\u2713 ${String(d.tool ?? "")} verified`;
    case "VERIFICATION_FAILED":
      return `\u2717 verification failed`;
    case "APPROVAL_REQUIRED":
      return `\u26A0 HUMAN APPROVAL REQUIRED`;
    case "APPROVAL_GRANTED":
      return `Approval GRANTED`;
    case "APPROVAL_REJECTED":
      return `Approval REJECTED`;
    case "SEASON_CHANGED":
      return `\u2744 ${String(d.season ?? "").toUpperCase()} begins`;
    case "TURN_STARTED":
      return `Turn ${ev.turn} started`;
    case "TURN_COMPLETED":
      return `Turn ${ev.turn} completed`;
    case "TURN_FAILED":
      return `Turn ${ev.turn} failed`;
    case "DECISION_COMPLETED":
      return d.ok ? `Decision (${d.durationMs}ms)` : `Decision failed: ${String(d.failureKind ?? "")}`;
    case "DECISION_RETRY":
      return `Retrying decision`;
    default:
      return ev.type.replace(/_/g, " ").toLowerCase();
  }
}
var EMPHATIC = {
  APPROVAL_REQUIRED: 0,
  // pause until human
  SEASON_CHANGED: 0.35,
  // slow so a season (esp. winter) lands visibly
  ACTION_FAILED: 0.6,
  TURN_FAILED: 0.6,
  APPROVAL_GRANTED: 0.55,
  APPROVAL_REJECTED: 0.55
};
function consequential(ev) {
  const tool = ev.data?.tool;
  if (tool === "harvest" && (ev.type === "ACTION_SUCCEEDED" || ev.type === "VERIFICATION_SUCCEEDED" || ev.type === "ACTION_EXECUTING")) {
    return 0.45;
  }
  return void 0;
}
function emphasisFor(ev) {
  if (ev.type === "APPROVAL_REQUIRED") return 0;
  const conc = consequential(ev);
  if (conc !== void 0) return conc;
  const mult = EMPHATIC[ev.type];
  return mult ?? 1;
}
function buildSteps(b) {
  const steps2 = [];
  let lastPop = null;
  for (const event of b.events) {
    const frame = b.frames.find((f) => f.ts >= event.at) ?? b.frames[b.frames.length - 1] ?? null;
    const snapshot = frame ? frame.snapshot : null;
    let emphasis = emphasisFor(event);
    let starvation;
    if (snapshot) {
      const pop = Number(snapshot.population ?? 0);
      if (lastPop !== null && pop < lastPop && pop >= 0) {
        starvation = lastPop - pop;
        emphasis = Math.min(emphasis, 0.3);
      }
      lastPop = pop;
    }
    steps2.push({ event, emphasis, snapshot, starvation });
  }
  return steps2;
}

// observatory/src/main.ts
var $ = (sel) => {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
var BASE = "/astrix";
async function getJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}
async function postJson(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
var mode = "home";
var liveConnected = false;
var currentSnapshot = null;
var liveSimRunning = false;
var svg = $("#world");
function paint(snapshot, removedTrees) {
  currentSnapshot = snapshot;
  const world = renderWorld(snapshot, removedTrees);
  const parser = new DOMParser();
  const doc = parser.parseFromString(
    '<svg xmlns="http://www.w3.org/2000/svg">' + world.svg + "</svg>",
    "image/svg+xml"
  );
  const root = doc.documentElement;
  svg.replaceChildren(...Array.from(root.childNodes));
  svg.setAttribute("viewBox", world.viewBox);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  const parts = hudLine(snapshot).split(/\s{3,}/);
  $("#hud-values").innerHTML = parts.map((p) => `<span>${p}</span>`).join("");
  const pct = snapshot.daysOfFoodRemaining >= 10 ? 100 : Math.max(2, Math.min(100, snapshot.daysOfFoodRemaining / 10 * 100));
  $("#pressure-fill").style.width = `${pct}%`;
  const level = snapshot.foodPressureLevel ?? "ok";
  $("#pressure-text").textContent = level.toUpperCase();
  $("#pressure-fill").style.background = level === "critical" ? "var(--danger)" : level === "high" ? "var(--warn)" : "var(--ok)";
}
var livePollTimer = null;
var sseSource = null;
function setLiveDot(on) {
  const dot = $("#live-dot");
  dot.classList.remove("on", "off");
  dot.classList.add(on && liveConnected ? "on" : on ? "off" : "off");
}
function setConnBanner(msg) {
  const b = $("#conn-banner");
  if (msg) {
    b.textContent = msg;
    b.classList.remove("hidden");
  } else b.classList.add("hidden");
}
async function livePoll() {
  try {
    const snap = await getJson(`${BASE}/state`);
    paint(snap);
    liveConnected = true;
    setLiveDot(liveConnected);
    setConnBanner(null);
    const status = await getJson(`${BASE}/agent/status`).catch(() => null);
    if (status) {
      liveSimRunning = status.state === "RUNNING" || status.state === "AWAITING_APPROVAL";
      updateAgentPanel(status);
      if (status.state === "AWAITING_APPROVAL" && status.pendingApproval) {
        const act = status.pendingApproval.action ?? {};
        showApproval("live", status.pendingApproval.approvalId, {
          tool: act.tool ?? "unknown",
          command: String(act.tool ?? "").toUpperCase(),
          reason: "The steward proposes an irreversible change; it will not execute until you decide.",
          impact: act.args && typeof act.args === "object" ? act.args : {}
        }, snap);
      } else {
        hideApproval();
      }
    }
  } catch (err) {
    liveConnected = false;
    setLiveDot(false);
    setConnBanner("LIVE CONNECTION LOST \u2014 Reconnecting\u2026");
  }
}
function startLive() {
  mode = "live";
  $("#mode-label").textContent = "LIVE";
  showScreen("#observatory");
  $("#replay-controls").classList.add("hidden");
  $("#evidence-toggle").classList.remove("hidden");
  hideFinal();
  livePoll();
  if (livePollTimer) clearInterval(livePollTimer);
  livePollTimer = setInterval(livePoll, 3e3);
  try {
    if (sseSource) sseSource.close();
    sseSource = new EventSource(`${BASE}/events`);
    sseSource.onmessage = () => {
    };
  } catch {
  }
}
async function liveApprove(approvalId, decision) {
  const res = await postJson(`${BASE}/approval/respond`, { approval_id: approvalId, decision });
  if (res.status === 200) {
    hideApproval();
    setTimeout(livePoll, 400);
  } else {
    setConnBanner(`Approval failed (${res.status})`);
  }
}
function setPhase(phase) {
  const p = $("#phase");
  p.textContent = `\u25CF ${phase}`;
}
function updateAgentPanel(status) {
  $("#agent-objective").textContent = status.objective ? `Objective: ${status.objective}` : "";
  const ampState = {
    RUNNING: "Acting\u2026",
    AWAITING_APPROVAL: "Waiting on human\u2026",
    COMPLETED: "Stopped",
    STOPPED: "Stopped",
    FAILED: "Failed",
    IDLE: "Idle"
  };
  $("#agent-current").textContent = ampState[status.state] ?? status.state;
  const actions = (status.actions ?? []).slice(-6);
  const activity = $("#agent-activity");
  activity.innerHTML = "";
  for (const a of actions) {
    const ok = a.executionState === "SUCCEEDED";
    const bad = a.executionState === "FAILED";
    const line = document.createElement("div");
    line.className = ok ? "ok" : bad ? "bad" : "";
    line.textContent = `${ok ? "\u2713" : bad ? "\u2717" : "\u25CF"} ${a.tool} ${a.verificationState === "VERIFIED" ? "(verified)" : ""}`;
    activity.appendChild(line);
  }
}
function showApproval(_mode, approvalId, action, snapshot) {
  const panel = $("#approval-panel");
  panel.classList.remove("hidden");
  const raw = action && typeof action === "object" ? action : {};
  const tool = String(raw.tool ?? raw.command ?? "unknown").toUpperCase();
  const impact = raw.impact && typeof raw.impact === "object" ? raw.impact : {};
  const impactRows = Object.entries(impact).map(([k, v]) => `<div class="impact-row"><span>${k}</span><b>${String(v)}</b></div>`).join("");
  $("#approval-action").textContent = tool;
  $("#approval-reason").textContent = String(raw.reason ?? "");
  $("#approval-impact").innerHTML = impactRows || `<div class="impact-row muted">No impact data</div>`;
  if (snapshot) {
    const farms = (snapshot.farmland ?? []).map((f) => f.islandId.charAt(0).toUpperCase() + f.used + "/" + f.capacity).join(" ");
    const trees = countTrees(snapshot);
    $("#approval-proof").innerHTML = "<b>WORLD (FROZEN):</b><br/>DAY " + snapshot.day + " \xB7 TREES " + trees + " \xB7 FARMLAND " + (farms || "?");
  }
  panel.dataset.approvalId = approvalId;
  void _mode;
}
function hideApproval() {
  $("#approval-panel").classList.add("hidden");
  $("#approval-panel").dataset.approvalId = "";
}
function countTrees(s) {
  return (s.resourceNodes ?? []).filter((n) => n.type === "wood").length;
}
function setTimeline(items) {
  const track = $("#timeline-track");
  track.innerHTML = "";
  for (const item of items) {
    const span = document.createElement("span");
    span.className = `tl-item ${item.kind ?? ""}${item.current ? " current" : ""}`;
    span.textContent = item.text;
    track.appendChild(span);
  }
}
var steps = [];
var stepIndex = 0;
var playbackActive = false;
var playbackTimer = null;
var speed = 5;
var replayStarted = false;
var speedTable = [1, 2, 5, 10];
var decidedApprovals = /* @__PURE__ */ new Map();
function playStep() {
  const step = steps[stepIndex];
  if (!step) return;
  if (step.snapshot) paint(step.snapshot);
  const day = step.snapshot?.day ?? step.event.data?.day ?? "?";
  $("#rc-pos").textContent = `DAY ${day}`;
  setPhase(labelForPhase(step.event));
  updateReplayTimeline(step.event);
  updateReplayActivityText(step.event);
  if (step.event.type === "APPROVAL_REQUIRED") onReplayApproval(step.event);
  if (step.event.type === "SEASON_CHANGED") setSeasonFlash(String(step.event.data?.season ?? ""));
  if (step.starvation && step.starvation > 0) flash(`FOOD SHORTAGE \u2014 ${step.starvation} villager${step.starvation > 1 ? "s" : ""} starved`, true);
  if (isHarvestSuccess(step.event)) harvestFlash();
  stepIndex += 1;
  if (stepIndex >= steps.length) {
    playbackActive = false;
    $("#rc-play").textContent = "\u25B6";
    showFinal();
    return;
  }
  const delay = 150 / speed;
  const emph = step.emphasis ?? 1;
  const wait = emph === 0 ? 0 : delay / Math.max(0.2, emph);
  if (playbackActive) {
    playbackTimer = setTimeout(playStep, Math.max(40, wait));
  }
}
function labelForPhase(ev) {
  if (ev.type.startsWith("APPROVAL")) return "HUMAN CONTROL";
  if (ev.type === "WORLD_OBSERVED") return "OBSERVE";
  if (ev.type === "PLAN_CREATED" || ev.type.startsWith("DECISION")) return "PLAN";
  if (ev.type.startsWith("ACTION_")) return "ACT";
  if (ev.type.startsWith("VERIFICATION_")) return "VERIFY";
  return "OBSERVE";
}
function updateReplayTimeline(ev) {
  const data = ev.data ?? {};
  const items = [];
  const push = (text, kind, cur = false) => items.push({ text, kind, current: cur });
  if (data.day) push(`DAY ${data.day}`, "day", ev.type === "WORLD_OBSERVED");
  push(eventLabel(ev), kindOf(ev), false);
  setTimeline(items.slice(-18));
}
function kindOf(ev) {
  if (ev.type === "APPROVAL_REQUIRED") return "approval";
  if (ev.type === "SEASON_CHANGED") return "season";
  if (ev.type.includes("HARVEST") || ev.data?.tool === "harvest") return "harvest";
  return void 0;
}
function updateReplayActivityText(ev) {
  const box = $("#agent-activity");
  const line = document.createElement("div");
  line.className = ev.type === "ACTION_FAILED" ? "bad" : ev.type.includes("SUCCEEDED") ? "ok" : ev.type.includes("APPROVAL") ? "warn" : "";
  line.textContent = `\xB7 ${eventLabel(ev)}`;
  box.prepend(line);
  while (box.children.length > 8) box.lastChild?.remove();
}
var flashSeq = 0;
function flash(msg, warn = false) {
  const overlay = $("#world-overlay");
  overlay.textContent = msg;
  overlay.classList.toggle("warn", warn);
  overlay.classList.remove("hidden");
  const seq = ++flashSeq;
  setTimeout(() => {
    if (seq === flashSeq) overlay.classList.add("hidden");
  }, 2e3);
}
function setSeasonFlash(season) {
  flash(`${season.toUpperCase()} BEGINS`);
  focusWorld();
}
function focusWorld() {
  svg.classList.remove("world-focus");
  void svg.getBoundingClientRect();
  svg.classList.add("world-focus");
}
function isHarvestSuccess(ev) {
  return (ev.type === "ACTION_SUCCEEDED" || ev.type === "VERIFICATION_SUCCEEDED") && ev.data?.tool === "harvest";
}
var lastHarvestDay = -1;
function harvestFlash() {
  const day = currentSnapshot?.day ?? -1;
  if (day === lastHarvestDay) return;
  lastHarvestDay = day;
  flash(`HARVEST COMPLETE \u2014 ${currentSnapshot?.food ?? "?"} food`);
}
function onReplayApproval(ev) {
  const d = ev.data ?? {};
  const id = String(d.approval?.id ?? d.approvalId ?? "");
  if (id && decidedApprovals.has(id)) {
    skipPastDecision(id, decidedApprovals.get(id));
    return;
  }
  const action = {
    tool: d.tool ?? d.approval?.command ?? "unknown",
    command: d.approval?.command ?? "",
    reason: d.approval?.reason ?? "",
    impact: d.approval?.impact ?? {}
  };
  showApproval("replay", id, action, currentSnapshot);
  playbackActive = false;
  $("#rc-play").textContent = "\u25B6";
  window.__replayDecide = (decision) => {
    hideApproval();
    skipPastDecision(id, decision);
    resumePlayback();
  };
}
function skipPastDecision(id, decision) {
  if (id) decidedApprovals.set(id, decision);
  const want = decision === "approve" ? "APPROVAL_GRANTED" : "APPROVAL_REJECTED";
  let painted = false;
  while (stepIndex < steps.length) {
    const s = steps[stepIndex];
    stepIndex += 1;
    if (s.event.type === want) {
      if (s.snapshot) {
        paint(s.snapshot);
        painted = true;
      }
      break;
    }
    if (!painted && s.snapshot) {
      paint(s.snapshot);
      painted = true;
    }
  }
}
function resumePlayback() {
  if (stepIndex >= steps.length) {
    showFinal();
    return;
  }
  playbackActive = true;
  $("#rc-play").textContent = "\u23F8";
  playStep();
}
function togglePlayback() {
  if (playbackActive) {
    playbackActive = false;
    if (playbackTimer) clearTimeout(playbackTimer);
    $("#rc-play").textContent = "\u25B6";
  } else {
    resumePlayback();
  }
}
function stepForward() {
  if (stepIndex < steps.length) {
    playStep();
  }
}
function stepBackward() {
  stepIndex = Math.max(0, stepIndex - 2);
  playStep();
}
async function beginReplay(demo) {
  mode = demo ? "demo" : "replay";
  $("#mode-label").textContent = demo ? "DEMO" : "REPLAY";
  showScreen("#observatory");
  $("#replay-controls").classList.remove("hidden");
  $("#evidence-toggle").classList.remove("hidden");
  hideFinal();
  hideApproval();
  if (livePollTimer) clearInterval(livePollTimer);
  if (sseSource) sseSource.close();
  setLiveDot(false);
  let bundle;
  try {
    bundle = await loadReplayBundle("/observatory/replay/canonical.json");
  } catch {
    showScreen("#home");
    $("#home-status").textContent = "Replay bundle not found \u2014 run `npm run observatory:replay` first.";
    return;
  }
  steps = buildSteps(bundle);
  stepIndex = 0;
  drawDayMarkers(bundle);
  const first = steps.find((s) => s.snapshot);
  if (first?.snapshot) paint(first.snapshot);
  $("#rc-play").textContent = "\u25B6";
  replayStarted = true;
  if (demo) {
    speed = 5;
    updateSpeedLabel();
    resumePlayback();
  }
}
function drawDayMarkers(b) {
  const seen = /* @__PURE__ */ new Set();
  const items = [];
  for (const ev of b.events) {
    const day = Number(ev.data?.day ?? 0);
    if (day && !seen.has(day)) {
      seen.add(day);
      items.push({ text: `DAY ${day}`, kind: "day" });
    }
    if (ev.type === "APPROVAL_REQUIRED") items.push({ text: "\u26A0", kind: "approval" });
    if (ev.type === "SEASON_CHANGED") items.push({ text: String(ev.data?.season ?? "").toUpperCase(), kind: "season" });
  }
  setTimeline(items);
}
function showFinal() {
  const bundled = getBundle();
  const finalDiv = $("#final");
  if (!bundled) {
    finalDiv.classList.remove("hidden");
    finalDiv.innerHTML = "<div class='final-card'>End of replay.</div>";
    return;
  }
  const m = bundled.meta;
  const approved = Object.keys(bundled.approvals).length;
  const rejected = 0;
  finalDiv.classList.remove("hidden");
  finalDiv.innerHTML = `
    <div class="final-card">
      <div class="final-day">DAY ${m.dayEnd} / ${m.dayEnd} \xB7 ${String(m.seasonEnd).toUpperCase()}</div>
      <div class="final-title">${m.populationEnd > 0 ? "VILLAGE SURVIVED" : "VILLAGE COLLAPSED"}</div>
      <div class="final-grid">
        <div class="cell"><span>Population</span><b>${m.populationStart} \u2192 ${m.populationEnd}</b></div>
        <div class="cell"><span>Food</span><b>${m.foodStart} \u2192 ${m.foodEnd}</b></div>
        <div class="cell"><span>Farms</span><b>${m.farmsEnd ?? "?"}</b></div>
        <div class="cell"><span>Bridges</span><b>${m.bridgesEnd ?? "?"}</b></div>
        <div class="cell"><span>Approvals</span><b>${approved}</b></div>
        <div class="cell"><span>Decisions</span><b>${(getBundle()?.events ?? []).filter((e) => e.type.includes("DECISION")).length}</b></div>
      </div>
      <div class="final-callout">\u2713 HUMAN CONTROL MAINTAINED</div>
      <div class="final-replay">
        <button class="btn" id="final-replay">REPLAY</button>
        <button class="btn" id="final-home">HOME</button>
      </div>
    </div>
  `;
  $("#final-replay").onclick = () => {
    hideFinal();
    stepIndex = 0;
    resumePlayback();
  };
  $("#final-home").onclick = () => showScreen("#home");
}
function hideFinal() {
  $("#final").classList.add("hidden");
  $("#final").innerHTML = "";
}
function showScreen(sel) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  $(sel).classList.remove("hidden");
  if (sel === "#home") {
    hideApproval();
    hideFinal();
  }
}
$("#approve-btn").addEventListener("click", () => {
  const id = $("#approval-panel").dataset.approvalId;
  if (!id) return;
  if (mode === "live") {
    void liveApprove(id, "approve");
  } else if (window.__replayDecide) {
    window.__replayDecide("approve");
  }
});
$("#reject-btn").addEventListener("click", () => {
  const id = $("#approval-panel").dataset.approvalId;
  if (!id) return;
  if (mode === "live") {
    void liveApprove(id, "reject");
  } else if (window.__replayDecide) {
    window.__replayDecide("reject");
  }
});
$("#rc-play").addEventListener("click", togglePlayback);
$("#rc-next").addEventListener("click", stepForward);
$("#rc-prev").addEventListener("click", stepBackward);
$("#rc-speed-btn").addEventListener("click", () => {
  speed = speedTable[(speedTable.indexOf(speed) + 1) % speedTable.length];
  updateSpeedLabel();
});
function updateSpeedLabel() {
  const label = $("#rc-speed");
  label.textContent = speed === 10 ? "10\xD7" : `${speed}\xD7`;
  if (speed >= 5) label.style.color = "var(--accent)";
  else label.style.color = "";
}
updateSpeedLabel();
$("#evidence-toggle").addEventListener("click", () => {
  const drawer = $("#evidence");
  const body = $("#evidence-body");
  drawer.classList.toggle("hidden");
  if (!drawer.classList.contains("hidden")) {
    const b = getBundle();
    if (b) {
      const summary = b.events.filter((e) => ["APPROVAL_REQUIRED", "APPROVAL_GRANTED", "APPROVAL_REJECTED", "ACTION_SUCCEEDED", "VERIFICATION_SUCCEEDED", "ACTION_FAILED", "TURN_FAILED"].includes(e.type));
      body.textContent = summary.map((e) => `${String(e.type).padEnd(24)} day=${String(e.data?.day ?? "?")} ${JSON.stringify(e.data ?? {})}`.slice(0, 160)).join("\n");
    } else {
      body.textContent = "No bundle loaded.";
    }
  }
});
$("#evidence-close").addEventListener("click", () => $("#evidence").classList.add("hidden"));
$("#btn-live").addEventListener("click", () => {
  startLive();
});
$("#btn-replay").addEventListener("click", () => {
  void beginReplay(false);
});
$("#btn-demo").addEventListener("click", () => {
  void beginReplay(true);
});
showScreen("#home");
void livePoll().catch(() => {
});
