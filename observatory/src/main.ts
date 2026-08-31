// ASTrix Observatory — main controller.
// Wires the projector + replay engine + live polling into the DOM UI.
import { renderWorld, hudLine } from "./projector";
import {
  loadReplayBundle,
  getBundle,
  buildSteps,
  eventLabel,
  type DerivedReplayBundle,
} from "./replay";
import type { AgentEvent, WorldSnapshot } from "./types";

// ---- tiny DOM helpers -----------------------------------------------------
const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

const BASE = "/astrix";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

async function postJson(path: string, body: unknown): Promise<any> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function el(html: string): HTMLElement {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

// ---- mode + shared state --------------------------------------------------
type Mode = "home" | "live" | "replay" | "demo";
let mode: Mode = "home";
let liveConnected = false;
let currentSnapshot: WorldSnapshot | null = null;
let liveSimRunning = false; // whether any ASTrix agent loop exists

// EXPERIENCE (immersive living world) vs EVIDENCE (structured data panel).
let theme: "experience" | "evidence" = "experience";
const evidenceLog: string[] = [];
let lastLiveKey = ""; // de-dupe live OBSERVE lines so polling doesn't spam the log

const svg = $("#world") as unknown as SVGSVGElement;

// ---- world rendering ------------------------------------------------------
function paint(snapshot: WorldSnapshot, removedTrees?: Set<string>): void {
  currentSnapshot = snapshot;
  const world = renderWorld(snapshot, removedTrees);
  // SVG elements do not support setting innerHTML directly; parse the markup
  // into an SVG document and adopt its children into the live <svg>.
  const parser = new DOMParser();
  const doc = parser.parseFromString(
    '<svg xmlns="http://www.w3.org/2000/svg">' + world.svg + "</svg>",
    "image/svg+xml",
  );
  const root = doc.documentElement;
  svg.replaceChildren(...Array.from(root.childNodes));
  // Apply the computed viewBox so the projected world is framed and centered
  // in the visible canvas instead of being clipped off-screen (the root cause
  // of the previous dark/empty world). preserveAspectRatio keeps it centered.
  svg.setAttribute("viewBox", world.viewBox);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  // HUD
  const parts = hudLine(snapshot).split(/\s{3,}/);
  $("#hud-values").innerHTML = parts.map((p) => `<span>${p}</span>`).join("");
  // pressure
  const pct = snapshot.daysOfFoodRemaining >= 10 ? 100 : Math.max(2, Math.min(100, (snapshot.daysOfFoodRemaining / 10) * 100));
  $("#pressure-fill").style.width = `${pct}%`;
  const level = snapshot.foodPressureLevel ?? "ok";
  $("#pressure-text").textContent = level.toUpperCase();
  $("#pressure-fill").style.background = level === "critical" ? "var(--danger)" : level === "high" ? "var(--warn)" : "var(--ok)";
  // EVIDENCE theme live-updates its tables with the latest authoritative state;
  // LIVE mode also streams concise OBSERVE lines into the event log.
  if (theme === "evidence") paintEvidence(snapshot);
  if (mode === "live") liveObserve(snapshot);
}

// ---- live mode ------------------------------------------------------------
let livePollTimer: ReturnType<typeof setInterval> | null = null;
let sseSource: EventSource | null = null;

function setLiveDot(on: boolean): void {
  const dot = $("#live-dot");
  dot.classList.remove("on", "off");
  dot.classList.add(on && liveConnected ? "on" : on ? "off" : "off");
}

function setConnBanner(msg: string | null): void {
  const b = $("#conn-banner");
  if (msg) { b.textContent = msg; b.classList.remove("hidden"); }
  else b.classList.add("hidden");
}

async function livePoll(): Promise<void> {
  try {
    const snap = await getJson<WorldSnapshot>(`${BASE}/state`);
    paint(snap);
    liveConnected = true;
    setLiveDot(liveConnected);
    setConnBanner(null);
    // Live agent status
    const status = await getJson<any>(`${BASE}/agent/status`).catch(() => null);
    if (status) {
      liveSimRunning = status.state === "RUNNING" || status.state === "AWAITING_APPROVAL";
      updateAgentPanel(status);
      if (status.state === "AWAITING_APPROVAL" && status.pendingApproval) {
        const act = (status.pendingApproval.action ?? {}) as any;
        showApproval("live", status.pendingApproval.approvalId, {
          tool: act.tool ?? "unknown",
          command: String(act.tool ?? "").toUpperCase(),
          reason: "The steward proposes an irreversible change; it will not execute until you decide.",
          impact: act.args && typeof act.args === "object" ? act.args : {},
        }, snap);
      } else {
        hideApproval();
      }
    }
  } catch (err) {
    liveConnected = false;
    setLiveDot(false);
    setConnBanner("LIVE CONNECTION LOST — Reconnecting…");
  }
}

function startLive(): void {
  mode = "live";
  $("#mode-label").textContent = "LIVE";
  showScreen("#observatory");
  $("#replay-controls").classList.add("hidden");
  $("#evidence-toggle").classList.remove("hidden");
  hideFinal();
  livePoll();
  if (livePollTimer) clearInterval(livePollTimer);
  livePollTimer = setInterval(livePoll, 3000);
  // SSE for live agent events (state + agent channels).
  try {
    if (sseSource) sseSource.close();
    sseSource = new EventSource(`${BASE}/events`);
    sseSource.onmessage = () => {};
  } catch { /* fallback to polling */ }
  void 0;
}

// ---- permission: live approval is real ------------------------------------
async function liveApprove(approvalId: string, decision: "approve" | "reject"): Promise<void> {
  const res = await postJson(`${BASE}/approval/respond`, { approval_id: approvalId, decision });
  if (res.status === 200) {
    hideApproval();
    // Re-render after a short delay so the authoritative post-mutation state shows.
    setTimeout(livePoll, 400);
  } else {
    setConnBanner(`Approval failed (${res.status})`);
  }
}

// ---- agent panel ----------------------------------------------------------
function setPhase(phase: string): void {
  const p = $("#phase");
  p.textContent = `● ${phase}`;
}

function updateAgentPanel(status: any): void {
  $("#agent-objective").textContent = status.objective ? `Objective: ${status.objective}` : "";
  const ampState: Record<string, string> = {
    RUNNING: "Acting…",
    AWAITING_APPROVAL: "Waiting on human…",
    COMPLETED: "Stopped",
    STOPPED: "Stopped",
    FAILED: "Failed",
    IDLE: "Idle",
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
    line.textContent = `${ok ? "✓" : bad ? "✗" : "●"} ${a.tool} ${a.verificationState === "VERIFIED" ? "(verified)" : ""}`;
    activity.appendChild(line);
  }
}

// ---- approval UI ----------------------------------------------------------
interface ApprovalView {
  approval: { id: string; action: any };
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}
function showApproval(_mode: string, approvalId: string, action: any, snapshot: WorldSnapshot | null): void {
  const panel = $("#approval-panel");
  panel.classList.remove("hidden");
  // action may be { tool, command, reason, impact } (replay) or the raw
  // agent/action status shape (live). Normalize defensively.
  const raw = action && typeof action === "object" ? action : {};
  const tool = String(raw.tool ?? raw.command ?? "unknown").toUpperCase();
  const impact = raw.impact && typeof raw.impact === "object" ? raw.impact : {};
  const impactRows = Object.entries(impact as Record<string, unknown>)
    .map(([k, v]) => `<div class="impact-row"><span>${k}</span><b>${String(v)}</b></div>`)
    .join("");
  $("#approval-action").textContent = tool;
  $("#approval-reason").textContent = String(raw.reason ?? "");
  $("#approval-impact").innerHTML = impactRows || `<div class="impact-row muted">No impact data</div>`;
  // World-time proof: show the frozen snapshot.
  if (snapshot) {
    const farms = (snapshot.farmland ?? [])
      .map((f: any) => f.islandId.charAt(0).toUpperCase() + f.used + "/" + f.capacity)
      .join(" ");
    const trees = countTrees(snapshot);
    $("#approval-proof").innerHTML =
      "<b>WORLD (FROZEN):</b><br/>DAY " + snapshot.day + " · TREES " + trees + " · FARMLAND " + (farms || "?");
  }
  panel.dataset.approvalId = approvalId;
  void _mode;
}
function hideApproval(): void {
  $("#approval-panel").classList.add("hidden");
  $("#approval-panel").dataset.approvalId = "";
}
function countTrees(s: WorldSnapshot): number {
  return (s.resourceNodes ?? []).filter((n) => n.type === "wood").length;
}

// ---- timeline -------------------------------------------------------------
function setTimeline(items: { text: string; kind?: string; current?: boolean }[]): void {
  const track = $("#timeline-track");
  track.innerHTML = "";
  for (const item of items) {
    const span = document.createElement("span");
    span.className = `tl-item ${item.kind ?? ""}${item.current ? " current" : ""}`;
    span.textContent = item.text;
    track.appendChild(span);
  }
}

// ---- replay / demo --------------------------------------------------------
let steps: ReturnType<typeof buildSteps> = [];
let stepIndex = 0;
let playbackActive = false;
let playbackTimer: ReturnType<typeof setTimeout> | null = null;
let speed = 5;
let replayStarted = false;
const speedTable = [1, 2, 5, 10];
// Maps an approval id -> the decision already made during this replay load, so
// we never re-present the same gate and never re-consume its events.
const decidedApprovals = new Map<string, "approve" | "reject">();

function playStep(): void {
  const step = steps[stepIndex];
  if (!step) return;
  if (step.snapshot) paint(step.snapshot);
  // Timeline/tooltips for the event.
  const day = step.snapshot?.day ?? step.event.data?.day ?? "?";
  $("#rc-pos").textContent = `DAY ${day}`;
  setPhase(labelForPhase(step.event));
  updateReplayTimeline(step.event);
  updateReplayActivityText(step.event);
  if (step.event.type === "APPROVAL_REQUIRED") onReplayApproval(step.event);
  if (step.event.type === "SEASON_CHANGED") setSeasonFlash(String(step.event.data?.season ?? ""));
  if (step.starvation && step.starvation > 0) flash(`FOOD SHORTAGE — ${step.starvation} villager${step.starvation > 1 ? "s" : ""} starved`, true);
  if (isHarvestSuccess(step.event)) harvestFlash();
  // Stream each replayed step into the evidence event log
  appendLog(`${eventLabel(step.event)} · day ${step.snapshot?.day ?? String(step.event.data?.day ?? "?")}`);
  stepIndex += 1;
  if (stepIndex >= steps.length) {
    playbackActive = false;
    $("#rc-play").textContent = "▶";
    showFinal();
    return;
  }
  const delay = 150 / speed;                  // base per-event pacing
  const emph = step.emphasis ?? 1;            // em >1 slower; approval handled above
  const wait = emph === 0 ? 0 : delay / Math.max(0.2, emph);
  if (playbackActive) {
    playbackTimer = setTimeout(playStep, Math.max(40, wait));
  }
}

function labelForPhase(ev: AgentEvent): string {
  if (ev.type.startsWith("APPROVAL")) return "HUMAN CONTROL";
  if (ev.type === "WORLD_OBSERVED") return "OBSERVE";
  if (ev.type === "PLAN_CREATED" || ev.type.startsWith("DECISION")) return "PLAN";
  if (ev.type.startsWith("ACTION_")) return "ACT";
  if (ev.type.startsWith("VERIFICATION_")) return "VERIFY";
  return "OBSERVE";
}

function updateReplayTimeline(ev: AgentEvent): void {
  const data = ev.data ?? {};
  const items: { text: string; kind?: string; current?: boolean }[] = [];
  const push = (text: string, kind?: string, cur = false) => items.push({ text, kind, current: cur });
  if (data.day) push(`DAY ${data.day}`, "day", ev.type === "WORLD_OBSERVED");
  push(eventLabel(ev), kindOf(ev), false);
  setTimeline(items.slice(-18));
}
function kindOf(ev: AgentEvent): string | undefined {
  if (ev.type === "APPROVAL_REQUIRED") return "approval";
  if (ev.type === "SEASON_CHANGED") return "season";
  if (ev.type.includes("HARVEST") || (ev.data?.tool === "harvest")) return "harvest";
  return undefined;
}
function updateReplayActivityText(ev: AgentEvent): void {
  const box = $("#agent-activity");
  const line = document.createElement("div");
  line.className = ev.type === "ACTION_FAILED" ? "bad" : ev.type.includes("SUCCEEDED") ? "ok" : ev.type.includes("APPROVAL") ? "warn" : "";
  line.textContent = `· ${eventLabel(ev)}`;
  box.prepend(line);
  while (box.children.length > 8) box.lastChild?.remove();
}
let flashSeq = 0;
function flash(msg: string, warn = false): void {
  const overlay = $("#world-overlay");
  overlay.textContent = msg;
  overlay.classList.toggle("warn", warn);
  overlay.classList.remove("hidden");
  const seq = ++flashSeq;
  setTimeout(() => { if (seq === flashSeq) overlay.classList.add("hidden"); }, 2000);
}
function setSeasonFlash(season: string): void {
  flash(`${season.toUpperCase()} BEGINS`);
  focusWorld(); // camera leans in so the season change lands visibly
}
// Camera focus: a gentle zoom-settle on the world. Presentation only.
function focusWorld(): void {
  svg.classList.remove("world-focus");
  void svg.getBoundingClientRect(); // restart the transition
  svg.classList.add("world-focus");
}
// Starvation + harvest flashes are derived from authoritative recorded data
// (population drop between snapshots; harvest action milestones).
function isHarvestSuccess(ev: AgentEvent): boolean {
  return (ev.type === "ACTION_SUCCEEDED" || ev.type === "VERIFICATION_SUCCEEDED") && (ev.data as any)?.tool === "harvest";
}
let lastHarvestDay = -1;
function harvestFlash(): void {
  const day = currentSnapshot?.day ?? -1;
  if (day === lastHarvestDay) return; // one clear moment per day, not spam
  lastHarvestDay = day;
  flash(`HARVEST COMPLETE — ${currentSnapshot?.food ?? "?"} food`);
}

// Replay approval: in replay, the human decides which recorded outcome to
// fast-forward to (approve or reject). This drives a PROJECTION of the real
// run — it never calls the live API and never changes the canonical data.
function onReplayApproval(ev: AgentEvent): void {
  const d = (ev.data ?? {}) as Record<string, any>;
  const id = String(d.approval?.id ?? d.approvalId ?? "");
  // A decision was already made for this gate in this load -> skip past it now.
  if (id && decidedApprovals.has(id)) {
    skipPastDecision(id, decidedApprovals.get(id)!);
    return;
  }
  const action = {
    tool: d.tool ?? d.approval?.command ?? "unknown",
    command: d.approval?.command ?? "",
    reason: d.approval?.reason ?? "",
    impact: d.approval?.impact ?? {},
  };
  showApproval("replay", id, action, currentSnapshot);
  playbackActive = false;
  $("#rc-play").textContent = "▶";
  window.__replayDecide = (decision: "approve" | "reject") => {
    hideApproval();
    skipPastDecision(id, decision);
    resumePlayback();
  };
}

/** Consume all events up to and including the recorded APPROVAL_GRANTED/
 *  APPROVAL_REJECTED for this gate, then paint the post-decision state. */
function skipPastDecision(id: string, decision: "approve" | "reject"): void {
  if (id) decidedApprovals.set(id, decision);
  const want = decision === "approve" ? "APPROVAL_GRANTED" : "APPROVAL_REJECTED";
  let painted = false;
  while (stepIndex < steps.length) {
    const s = steps[stepIndex];
    stepIndex += 1;
    if (s.event.type === want) {
      if (s.snapshot) { paint(s.snapshot); painted = true; }
      break;
    }
    if (!painted && s.snapshot) { paint(s.snapshot); painted = true; }
  }
}

function resumePlayback(): void {
  if (stepIndex >= steps.length) { showFinal(); return; }
  playbackActive = true;
  $("#rc-play").textContent = "⏸";
  playStep();
}
function togglePlayback(): void {
  if (playbackActive) {
    playbackActive = false;
    if (playbackTimer) clearTimeout(playbackTimer);
    $("#rc-play").textContent = "▶";
  } else {
    resumePlayback();
  }
}
function stepForward(): void {
  if (stepIndex < steps.length) { playStep(); }
}
function stepBackward(): void {
  stepIndex = Math.max(0, stepIndex - 2);
  playStep();
}

async function beginReplay(demo: boolean): Promise<void> {
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

  let bundle: DerivedReplayBundle;
  try {
    bundle = await loadReplayBundle("/observatory/replay/canonical.json");
  } catch {
    showScreen("#home");
    $("#home-status").textContent = "Replay bundle not found — run `npm run observatory:replay` first.";
    return;
  }
  steps = buildSteps(bundle);
  stepIndex = 0;
  // Draw the day markers in the timeline.
  drawDayMarkers(bundle);
  // Start paused ready for ▶.
  // Pre-paint first frame.
  const first = steps.find((s) => s.snapshot);
  if (first?.snapshot) paint(first.snapshot);
  $("#rc-play").textContent = "▶";
  replayStarted = true;
  // In demo mode auto-play.
  if (demo) { speed = 5; updateSpeedLabel(); resumePlayback(); }
}

function drawDayMarkers(b: DerivedReplayBundle): void {
  const seen = new Set<number>();
  const items: { text: string; kind?: string }[] = [];
  for (const ev of b.events) {
    const day = Number(ev.data?.day ?? 0);
    if (day && !seen.has(day)) {
      seen.add(day);
      items.push({ text: `DAY ${day}`, kind: "day" });
    }
    if (ev.type === "APPROVAL_REQUIRED") items.push({ text: "⚠", kind: "approval" });
    if (ev.type === "SEASON_CHANGED") items.push({ text: String(ev.data?.season ?? "").toUpperCase(), kind: "season" });
  }
  setTimeline(items);
}

// ---- final screen -----------------------------------------------------
function showFinal(): void {
  const bundled = getBundle();
  const finalDiv = $("#final");
  if (!bundled) { finalDiv.classList.remove("hidden"); finalDiv.innerHTML = "<div class='final-card'>End of replay.</div>"; return; }
  const m = bundled.meta;
  const approved = Object.keys(bundled.approvals).length;
  const rejected = 0;
  finalDiv.classList.remove("hidden");
  finalDiv.innerHTML = `
    <div class="final-card">
      <div class="final-day">DAY ${m.dayEnd} / ${m.dayEnd} · ${String(m.seasonEnd).toUpperCase()}</div>
      <div class="final-title">${m.populationEnd > 0 ? "VILLAGE SURVIVED" : "VILLAGE COLLAPSED"}</div>
      <div class="final-grid">
        <div class="cell"><span>Population</span><b>${m.populationStart} → ${m.populationEnd}</b></div>
        <div class="cell"><span>Food</span><b>${m.foodStart} → ${m.foodEnd}</b></div>
        <div class="cell"><span>Farms</span><b>${m.farmsEnd ?? "?"}</b></div>
        <div class="cell"><span>Bridges</span><b>${m.bridgesEnd ?? "?"}</b></div>
        <div class="cell"><span>Approvals</span><b>${approved}</b></div>
        <div class="cell"><span>Decisions</span><b>${(getBundle()?.events ?? []).filter((e) => e.type.includes("DECISION")).length}</b></div>
      </div>
      <div class="final-callout">✓ HUMAN CONTROL MAINTAINED</div>
      <div class="final-replay">
        <button class="btn" id="final-replay">REPLAY</button>
        <button class="btn" id="final-home">HOME</button>
      </div>
    </div>
  `;
  $("#final-replay").onclick = () => { hideFinal(); stepIndex = 0; resumePlayback(); };
  $("#final-home").onclick = () => showScreen("#home");
}
function hideFinal(): void { $("#final").classList.add("hidden"); $("#final").innerHTML = ""; }

// ---- bottom wiring -----------------------------------------------------
function showScreen(sel: string): void {
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  $(sel).classList.remove("hidden");
  if (sel === "#home") { hideApproval(); hideFinal(); }
}

// ---- events: approval buttons ---------------------------------------------
$("#approve-btn").addEventListener("click", () => {
  const id = $("#approval-panel").dataset.approvalId;
  if (!id) return;
  if (mode === "live") { void liveApprove(id, "approve"); }
  else if (window.__replayDecide) { window.__replayDecide("approve"); }
});
$("#reject-btn").addEventListener("click", () => {
  const id = $("#approval-panel").dataset.approvalId;
  if (!id) return;
  if (mode === "live") { void liveApprove(id, "reject"); }
  else if (window.__replayDecide) { window.__replayDecide("reject"); }
});
$("#rc-play").addEventListener("click", togglePlayback);
$("#rc-next").addEventListener("click", stepForward);
$("#rc-prev").addEventListener("click", stepBackward);
$("#rc-speed-btn").addEventListener("click", () => {
  speed = speedTable[(speedTable.indexOf(speed) + 1) % speedTable.length];
  updateSpeedLabel();
});
function updateSpeedLabel(): void {
  const label = $("#rc-speed");
  label.textContent = speed === 10 ? "10×" : `${speed}×`;
  if (speed >= 5) label.style.color = "var(--accent)";
  else label.style.color = "";
}
updateSpeedLabel();

// ---- EXPERIENCE / EVIDENCE theme ----------------------------------------
function setTheme(next: "experience" | "evidence"): void {
  theme = next;
  $("#observatory").dataset.obsTheme = next;
  $("#theme-experience").classList.toggle("active", next === "experience");
  $("#theme-evidence").classList.toggle("active", next === "evidence");
  $("#theme-experience").setAttribute("aria-selected", String(next === "experience"));
  $("#theme-evidence").setAttribute("aria-selected", String(next === "evidence"));
  if (next === "evidence") {
    $("#evidence").classList.remove("hidden");
    if (currentSnapshot) paintEvidence(currentSnapshot);
    renderLog();
  } else {
    $("#evidence").classList.add("hidden");
  }
}

function appendLog(line: string): void {
  evidenceLog.push(line);
  if (evidenceLog.length > 250) evidenceLog.shift();
  if (theme !== "evidence") return;
  renderLog();
}
function renderLog(): void {
  const el = $("#evidence-log");
  if (el.classList.contains("hidden")) return;
  el.textContent = evidenceLog.join("\n");
  el.scrollTop = el.scrollHeight;
}
function liveObserve(ss: WorldSnapshot): void {
  const key = `${ss.day}|${ss.food}|${ss.population}|${ss.season}`;
  if (key === lastLiveKey) return;
  lastLiveKey = key;
  appendLog(`OBSERVE · day ${ss.day} ${String(ss.season).toUpperCase()} food ${ss.food} food/day ${ss.foodPerDay} pop ${ss.population} pressure ${ss.foodPressureLevel}`);
}

// Rebuild the EVIDENCE STATE tables purely from an authoritative snapshot.
function paintEvidence(ss: WorldSnapshot): void {
  const row = (k: string, v: unknown) => `<div class="ev-row"><span>${k}</span><b>${v ?? ""}</b></div>`;
  const sec = (t: string) => `<div class="ev-sec">${t}</div>`;
  const r = (ss.resources ?? {}) as Record<string, number | undefined>;
  let h = sec("WORLD");
  h += row("Day", ss.day);
  h += row("Season", String(ss.season ?? "").toUpperCase());
  h += row("Days until winter", ss.daysUntilWinter);
  h += row("Population", ss.population);
  h += row("Food", ss.food);
  h += row("Food / day", ss.foodPerDay);
  h += row("Days of food remaining", ss.daysOfFoodRemaining);
  h += row("Harvestable food", ss.harvestableFood);
  h += row("Food pressure", ss.foodPressureLevel);
  h += sec("RESOURCES");
  for (const k of ["wood", "stone", "food", "water", "crystal"] as const) h += row(k, r[k] ?? 0);
  h += sec("WORLD OBJECTS");
  h += row("Trees", countTrees(ss));
  h += row("Farms", farmlandUsed(ss));
  h += row("Bridges", (ss.bridges ?? []).length);
  h += sec("FARMLAND");
  for (const plot of ss.farmland ?? []) h += row(plot.islandId, `${plot.used}/${plot.capacity} used`);
  h += sec("CROPS");
  const crops = (ss.crops ?? []).map((c) => `${c.cropType} @ ${(c.growthStage * 100).toFixed(0)}%`).join(" · ");
  h += row("In ground", crops || "none");
  h += sec("CONNECTIVITY");
  h += row("Bridges", (ss.bridges ?? []).map((b) => `${b.islandA}↔${b.islandB}`).join(" · ") || "none");
  $("#evidence-state").innerHTML = h;
}
function farmlandUsed(ss: WorldSnapshot): string {
  const plots = ss.farmland ?? [];
  const used = plots.reduce((a, p) => a + (p.used ?? 0), 0);
  const cap = plots.reduce((a, p) => a + (p.capacity ?? 0), 0);
  return `${used}/${cap}`;
}

$("#theme-experience").addEventListener("click", () => setTheme("experience"));
$("#theme-evidence").addEventListener("click", () => setTheme("evidence"));
$("#evidence-toggle").addEventListener("click", () => setTheme("evidence"));
$("#evidence-close").addEventListener("click", () => setTheme("experience"));
$("#evidence-tab-state").addEventListener("click", () => {
  $("#evidence-tab-state").classList.add("active");
  $("#evidence-tab-events").classList.remove("active");
  $("#evidence-state").classList.remove("hidden");
  $("#evidence-log").classList.add("hidden");
});
$("#evidence-tab-events").addEventListener("click", () => {
  $("#evidence-tab-events").classList.add("active");
  $("#evidence-tab-state").classList.remove("active");
  $("#evidence-state").classList.add("hidden");
  $("#evidence-log").classList.remove("hidden");
  renderLog();
});

// ---- mode buttons ---------------------------------------------------------
$("#btn-live").addEventListener("click", () => { startLive(); });
$("#btn-replay").addEventListener("click", () => { void beginReplay(false); });
$("#btn-demo").addEventListener("click", () => { void beginReplay(true); });

declare global {
  interface Window { __replayDecide?: (decision: "approve" | "reject") => void }
}

// boot: show home.
showScreen("#home");
void livePoll().catch(() => {});