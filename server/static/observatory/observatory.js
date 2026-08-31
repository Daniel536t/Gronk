// observatory/src/projector.ts
var ISLANDS = {
  meadow: { c: { x: 24, z: 30 }, r: 16 },
  frost: { c: { x: 50, z: 12 }, r: 13 },
  dusk: { c: { x: 72, z: 34 }, r: 12 }
};
var CANONICAL_TREES = {
  meadow: [
    { x: 14, z: 22 },
    { x: 34, z: 20 },
    { x: 18, z: 40 },
    { x: 32, z: 42 },
    { x: 12, z: 32 }
  ],
  frost: [{ x: 44, z: 8 }, { x: 57, z: 16 }],
  dusk: [{ x: 66, z: 30 }, { x: 80, z: 40 }]
};
var SEASON_BG = {
  spring: "#d9e6ff",
  summer: "#cfe5ff",
  autumn: "#f4e3c8",
  winter: "#dfe7f2"
};
var ISLAND_FILL = {
  spring: "#7fbf5a",
  summer: "#74b74f",
  autumn: "#c9a35c",
  winter: "#e7ecf2"
};
var ISLAND_EDGE = {
  spring: "#5d9a41",
  summer: "#55983b",
  autumn: "#9c7c40",
  winter: "#c7ceda"
};
function iso(x, z) {
  return { sx: x * 3 - z * 3, sy: (60 - z) * 1.9 + x * 0.55 };
}
function escapeXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function treeSvg(x, z, stage, scale = 1) {
  if (stage === "removed") return "";
  const { sx, sy } = iso(x, z);
  return `<g transform="translate(${sx.toFixed(1)} ${sy.toFixed(1)}) scale(${scale})"><ellipse cx="0" cy="0" rx="1.5" ry="0.6" class="shadow"/><path d="M0 -11 L3.2 -5 Q3 -4.5 3 -4 L-3 -4 Q-3 -4.5 -3.2 -5 Z" class="trunk"/><path d="M0 -16 L4.5 -9 L2.6 -9 L5.5 -4 L-5.5 -4 L-2.6 -9 L-4.5 -9 Z" class="conifer"/></g>`;
}
function farmSvg(x, z, crops, season) {
  const { sx, sy } = iso(x, z);
  const plots = crops.map((stage, i) => {
    const px = sx + (i - 1) * 3;
    const py = sy;
    return plotSvg(px, py, stage, season);
  });
  return `<g transform="translate(${sx.toFixed(1)} ${(sy + 1).toFixed(1)})"><g class="farm">${plots.join("")}</g></g>`;
}
function plotSvg(cx, cy, stage, season) {
  const dark = season === "winter";
  const soil = dark ? "#dcd7cf" : "#8a5a2b";
  const cropColor = dark ? "#c9d4bf" : season === "autumn" ? "#e7cf7a" : "#7bc443";
  let inner = "";
  if (stage > 0) {
    const h = 2.2 + stage * 3.4;
    inner = `<rect x="${(cx - 0.9).toFixed(1)}" y="${(cy - h).toFixed(1)}" width="1.8" height="${h.toFixed(1)}" rx="0.5" class="crop" fill="${cropColor}"/>`;
  } else {
    inner = `<rect x="${(cx - 0.9).toFixed(1)}" y="${(cy - 0.5).toFixed(1)}" width="1.8" height="0.9" rx="0.4" class="furrow"/>`;
  }
  return `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) scale(1)"><rect x="-1.7" y="-1.2" width="3.4" height="2.4" rx="0.7" fill="${soil}" class="plot"/>${inner}</g>`;
}
function buildingSvg(x, z, label, season) {
  const { sx, sy } = iso(x, z);
  const roof = season === "winter" ? "#eef2f7" : "#d98a4e";
  const wall = "#f3d9a8";
  return `<g transform="translate(${sx.toFixed(1)} ${sy.toFixed(1)}) scale(1)"><ellipse cx="0" cy="0.6" rx="3" ry="1.2" class="shadow"/><rect x="-2.6" y="-2.6" width="5.2" height="3.4" fill="${wall}" rx="0.4" class="wall"/><path d="M-3.2 -2.2 L0 -5.2 L3.2 -2.2 Z" fill="${roof}" class="roof"/><rect x="-0.5" y="-1.6" width="1" height="2.4" fill="#7a4a21" class="door"/>` + (label ? `<title>${escapeXml(label)}</title>` : "") + `</g>`;
}
function bridgeSvg(x, z, season) {
  const { sx, sy } = iso(x, z);
  const plank = season === "winter" ? "#cfd6e0" : "#a9713a";
  return `<g transform="translate(${sx.toFixed(1)} ${sy.toFixed(1)})"><rect x="-1.7" y="-0.35" width="3.4" height="1" rx="0.3" fill="${plank}" class="bridge"/><rect x="-1.7" y="-1.3" width="0.35" height="1.6" class="rail"/><rect x="1.35" y="-1.3" width="0.35" height="1.6" class="rail"/></g>`;
}
function waterBand() {
  return `<g class="water"><path class="water-shape"  d="M0 120 L120 40 L240 120 L120 200 Z" fill="#5bb8d6" opacity="0.9"/><path class="water-ripple" d="M20 96 L40 114 L60 96 L80 114 L100 96" fill="none" stroke="#cdeef7" stroke-width="1.2" opacity="0.7"/><path class="water-ripple2" d="M35 118 L60 100 L85 118 L110 100" fill="none" stroke="#a8dff0" stroke-width="1.1" opacity="0.6"/></g>`;
}
function islandSvg(id, season, health) {
  const { c, r } = ISLANDS[id];
  const { sx, sy } = iso(c.x, c.z);
  const pts = 6;
  const verts = [];
  for (let i = 0; i < pts; i++) {
    const a = Math.PI / pts * 2 * i - Math.PI / 2 - Math.PI / 6;
    const rx = r * 2.6;
    const ry = r * 2;
    const vx = sx + Math.cos(a) * rx;
    const vy = sy + Math.sin(a) * ry;
    verts.push(`${vx.toFixed(1)},${vy.toFixed(1)}`);
  }
  const fillScale = 0.55 + health * 0.45;
  const f = shade(ISLAND_FILL[season], fillScale);
  return `<g class="island island-${id}" data-island="${id}"><path d="M${verts.join("L")}Z" fill="${f}" stroke="${ISLAND_EDGE[season]}" stroke-width="1.4" class="terrain"/><text x="${sx.toFixed(1)}" y="${(sy + r * 1.9).toFixed(1)}" text-anchor="middle" class="island-label">${escapeXml(id.toUpperCase())}</text></g>`;
}
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round((n >> 16 & 255) * k));
  const g = Math.min(255, Math.round((n >> 8 & 255) * k));
  const b = Math.min(255, Math.round((n & 255) * k));
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, "0")}`;
}
function renderWorld(snapshot, removedTrees) {
  const season = snapshot.season ?? "spring";
  const entities = [];
  let trees = 0;
  const parts = [];
  parts.push(`<rect x="-30" y="-30" width="320" height="220" class="bg" fill="${SEASON_BG[season]}"/>`);
  parts.push(waterBand());
  for (const id of ["frost", "meadow", "dusk"]) {
    const island = snapshot.islands.find((i) => i.id === id);
    parts.push(islandSvg(id, season, island?.health ?? 1));
  }
  for (const node of snapshot.resourceNodes ?? []) {
    if (node.type !== "wood") continue;
    if (removedTrees?.has(node.id)) continue;
    const { sx, sy } = iso(node.position.x, node.position.z);
    entities.push({ kind: "tree", id: node.id, sx, sy, label: `${node.id} (wood ${node.quantity})` });
    parts.push(treeSvg(node.position.x, node.position.z, "alive"));
    trees++;
  }
  if ((snapshot.resourceNodes ?? []).filter((n) => n.type === "wood").length === 0) {
    for (const id of ["meadow", "frost", "dusk"]) {
      for (const t of CANONICAL_TREES[id]) {
        parts.push(treeSvg(t.x, t.z, "alive", 0.8));
      }
    }
  }
  let farms = 0;
  for (const b of snapshot.buildings ?? []) {
    if (b.type === "house") {
      entities.push({ kind: "building", id: b.id, sx: iso(b.position.x, b.position.z).sx, sy: iso(b.position.x, b.position.z).sy, label: b.id });
      parts.push(buildingSvg(b.position.x, b.position.z, b.id, season));
    } else if (b.type === "farm") {
      farms++;
      const stages = new Array(3).fill(0);
      for (const c of snapshot.crops ?? []) {
        if (c.farmPlotId !== b.id) continue;
        const slot = stages.findIndex((s) => s === 0);
        if (slot >= 0) stages[slot] = c.growthStage;
      }
      entities.push({ kind: "farm", id: b.id, sx: iso(b.position.x, b.position.z).sx, sy: iso(b.position.x, b.position.z).sy, label: b.id });
      parts.push(farmSvg(b.position.x, b.position.z, stages, season));
    }
  }
  let bridges = 0;
  const bridgeSpans = {
    "meadow-frost": { x: 39, z: 22 },
    "frost-meadow": { x: 39, z: 22 },
    "meadow-dusk": { x: 50, z: 34 },
    "dusk-meadow": { x: 50, z: 34 }
  };
  const seenPairs = /* @__PURE__ */ new Set();
  for (const br of snapshot.bridges ?? []) {
    const key = [br.islandA, br.islandB].sort().join("-");
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    const span = bridgeSpans[key];
    if (!span) continue;
    bridges++;
    entities.push({ kind: "bridge", id: br.id, sx: iso(span.x, span.z).sx, sy: iso(span.x, span.z).sy, label: `${br.islandA} \u2194 ${br.islandB}` });
    parts.push(bridgeSvg(span.x, span.z, season));
  }
  return { svg: parts.join(""), entities, trees, farms, bridges };
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
  SEASON_CHANGED: 0.4,
  ACTION_FAILED: 0.7,
  TURN_FAILED: 0.7
};
function emphasisFor(ev) {
  if (ev.type === "APPROVAL_REQUIRED") return 0;
  const mult = EMPHATIC[ev.type];
  return mult ?? 1;
}
function buildSteps(b) {
  const steps2 = [];
  for (const event of b.events) {
    const frame = b.frames.find((f) => f.ts >= event.at) ?? b.frames[b.frames.length - 1] ?? null;
    steps2.push({ event, emphasis: emphasisFor(event), snapshot: frame ? frame.snapshot : null });
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
function setSeasonFlash(season) {
  const overlay = $("#world-overlay");
  overlay.textContent = `${season.toUpperCase()} BEGINS`;
  overlay.classList.remove("hidden");
  setTimeout(() => overlay.classList.add("hidden"), 1800);
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
