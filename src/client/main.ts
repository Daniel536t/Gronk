// Gronk's Hoard — browser client. Five screens (title / multiplayer / lobby /
// game / result), no routing lib. The game screen polls GET /state every 100ms
// (10Hz = engine tick rate) and the renderer lerps between polls at 60fps.
import "./style.css";
import * as api from "./api";
import { InputManager } from "./input";
import { Renderer } from "./render";
import type { GameState } from "../engine/types";
import {
  ACTION_RANGE,
  BANK_COOLDOWN,
  TRANSFORM_RANGE,
  PEDESTAL_RANGE,
  TICKS_PER_SECOND,
  MOVE_SPEED,
  CARRY_SPEED_MULT,
} from "../engine/constants";

type Screen = "title" | "multi" | "lobby" | "game" | "result";

const POLL_MS = 100; // 10Hz — matches the engine tick rate

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const screenEls: Record<Screen, HTMLElement> = {
  title: $("screen-title"),
  multi: $("screen-multi"),
  lobby: $("screen-lobby"),
  game: $("screen-game"),
  result: $("screen-result"),
};

function show(screen: Screen): void {
  for (const [name, el] of Object.entries(screenEls)) {
    el.classList.toggle("hidden", name !== screen);
  }
}

let session: api.Session | null = api.loadSession();
let lastState: GameState | null = null;
let inputDir = { x: 0, y: 0 };

// ---- context helpers -----------------------------------------------------

function myPlayer(state: GameState) {
  return state.players.find((p) => p.id === session?.playerId);
}

function nearestFurniture(state: GameState, range: number, x: number, y: number) {
  let best: { id: string; d: number } | null = null;
  for (const f of state.furniture) {
    const d = Math.hypot(f.x - x, f.y - y);
    if (d <= range && (!best || d < best.d)) best = { id: f.id, d };
  }
  return best;
}

function atOwnPedestal(state: GameState, x: number, y: number, team: number): boolean {
  const ped = state.pedestals[team];
  return Math.hypot(ped.x - x, ped.y - y) <= PEDESTAL_RANGE;
}

// ---- buttons (context-labeled — this is the whole tutorial) --------------
const btnAction = $<HTMLButtonElement>("btn-action");
const btnTransform = $<HTMLButtonElement>("btn-transform");

function updateButtons(state: GameState): void {
  const me = myPlayer(state);
  if (!me) return;
  if (me.carrying) {
    const atHome = atOwnPedestal(state, me.x, me.y, me.team);
    const cooldownUntil = state.bankCooldownUntilTick[me.team];
    const cooldown = Math.ceil((cooldownUntil - state.tick) / TICKS_PER_SECOND);
    if (atHome && state.tick < cooldownUntil) {
      btnAction.textContent = `BANK (${cooldown}s)`;
      btnAction.disabled = true;
    } else {
      btnAction.textContent = "BANK";
      btnAction.disabled = !atHome;
    }
    btnTransform.textContent = "TRANSFORM";
    btnTransform.disabled = true;
  } else if (me.state === "transformed") {
    btnAction.textContent = "HIDING";
    btnAction.disabled = true;
    btnTransform.textContent = "UNTRANSFORM";
    btnTransform.disabled = false;
  } else {
    const near = nearestFurniture(state, ACTION_RANGE, me.x, me.y);
    btnAction.textContent = near ? "SEARCH" : "ACTION";
    btnAction.disabled = !near;
    const nearT = nearestFurniture(state, TRANSFORM_RANGE, me.x, me.y);
    btnTransform.textContent = "TRANSFORM";
    btnTransform.disabled = !nearT;
  }
}

// ---- approval modal detection (M5) ---------------------------------------
function updateApprovalModal(state: GameState): void {
  if (state.pendingBank) {
    if (modalTeam !== state.pendingBank.team) {
      modalTeam = state.pendingBank.team;
      approvalTitle.textContent = `TEAM ${state.pendingBank.team + 1} IS BANKING THE TREASURE!`;
    }
    approvalModal.classList.remove("hidden");
  } else if (!approvalModal.classList.contains("hidden")) {
    approvalModal.classList.add("hidden");
    modalTeam = null;
  }
}

// ---- confetti (M5 demo climax) -------------------------------------------
function spawnConfetti(): void {
  const colors = ["#ffd700", "#ff6b6b", "#4ecdc4", "#ffe66d", "#a29bfe", "#55efc4"];
  for (let i = 0; i < 80; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti";
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.background = colors[i % colors.length];
    piece.style.animationDelay = `${Math.random() * 0.6}s`;
    piece.style.animationDuration = `${2.2 + Math.random() * 2}s`;
    piece.style.width = `${6 + Math.random() * 6}px`;
    piece.style.height = `${8 + Math.random() * 8}px`;
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 5000);
  }
}

// ---- HUD: riddle banner, timer, toasts -----------------------------------
const banner = $("riddle-banner");
let bannerLineCount = 0;

function updateRiddle(state: GameState): void {
  const lines = state.visibleRiddleLines;
  if (lines.length === bannerLineCount) return;
  bannerLineCount = lines.length;
  const text = lines[lines.length - 1];
  banner.classList.remove("show");
  setTimeout(() => {
    banner.textContent = text;
    banner.classList.add("show");
  }, 300);
}

const timerEl = $("timer-hud");

function updateTimer(state: GameState): void {
  const secs = Math.max(0, Math.floor(state.elapsed));
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  timerEl.textContent = `${mm}:${ss} / ${formatDuration(state.matchDuration)}`;
  timerEl.classList.toggle("sudden-death", state.suddenDeath);
}

function formatDuration(secs: number): string {
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

// Same per-seat crewmate palette as the renderer (wizard-0..3).
const SEAT_COLORS_HUD = ["#f2765b", "#4aa8e8", "#8ee36b", "#e072f0"];
const playersHudEl = $("players-hud");

function seatColor(playerId: string): string {
  const m = /-(\d)$/.exec(playerId);
  return m ? SEAT_COLORS_HUD[parseInt(m[1], 10) % 4] : "#9aa7bd";
}

function updatePlayersHud(state: GameState): void {
  if (screenEls.game.classList.contains("hidden")) return;
  const me = session?.playerId;
  const prev = playersHudEl.dataset.fingerprint ?? "";
  const fp = state.players
    .map((p) => `${p.id}:${p.state}:${p.carrying ? 1 : 0}`)
    .join("|");
  if (fp === prev) return; // no visual change — skip DOM churn
  playersHudEl.dataset.fingerprint = fp;
  playersHudEl.innerHTML = "";
  for (const p of state.players) {
    const chip = document.createElement("div");
    chip.className = "player-chip";
    if (p.id === me) chip.classList.add("you");
    if (p.carrying) chip.classList.add("carrying");
    if (p.state === "in_closet") chip.classList.add("closeted");
    if (p.state === "stunned") chip.classList.add("stunned");
    const bean = document.createElement("div");
    bean.className = "bean";
    bean.style.setProperty("--pc", seatColor(p.id));
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = p.id === me ? `${p.name} (you)` : p.name;
    const dot = document.createElement("span");
    dot.className = "state-dot";
    chip.append(bean, name, dot);
    playersHudEl.appendChild(chip);
  }
}

const toastsEl = $("toasts");
const prevPlayerState = new Map<string, string>();

function updateToasts(state: GameState): void {
  for (const p of state.players) {
    const prev = prevPlayerState.get(p.id);
    if (prev && prev !== "in_closet" && p.state === "in_closet") {
      addToast(`Gronk got ${p.name}!`);
    }
    prevPlayerState.set(p.id, p.state);
  }
}

function addToast(text: string): void {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  toastsEl.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ---- approval modal (M5) -------------------------------------------------
const approvalModal = $("approval-modal");
const approvalTitle = $("approval-title");
let modalTeam: number | null = null;

$("btn-approve").addEventListener("click", async () => {
  if (!session || modalTeam === null) return;
  await api.approveBank(session.roomCode, session.playerId).catch(() => {});
  approvalModal.classList.add("hidden");
  addToast("Bank approved!");
  modalTeam = null;
});

$("btn-reject").addEventListener("click", async () => {
  if (!session || modalTeam === null) return;
  await api.rejectBank(session.roomCode, session.playerId).catch(() => {});
  approvalModal.classList.add("hidden");
  addToast(`Bank rejected — ${BANK_COOLDOWN}s cooldown.`);
  modalTeam = null;
});

// ---- verbs (shared by keyboard, buttons) --------------------------------
function doAction(): void {
  if (!btnAction.disabled && session) {
    void api.action(session.roomCode, session.playerId).catch(() => {});
  }
}

function doTransform(): void {
  if (btnTransform.disabled || !session || !lastState) return;
  const me = myPlayer(lastState);
  if (!me) return;
  if (me.state === "transformed") {
    void api
      .transform(session.roomCode, session.playerId, me.transformedAs ?? "furn-0")
      .catch(() => {});
  } else {
    const near = nearestFurniture(lastState, TRANSFORM_RANGE, me.x, me.y);
    if (near) void api.transform(session.roomCode, session.playerId, near.id).catch(() => {});
  }
}

// ---- game loop -----------------------------------------------------------
const canvas = $<HTMLCanvasElement>("game-canvas");
const renderer = new Renderer(canvas);
let pollToken = 0;

async function enterGame(): Promise<void> {
  show("game");
  if (!session) return;
  const sess = session; // stable for the closures below
  renderer.myPlayerId = sess.playerId;
  prevPlayerState.clear();
  bannerLineCount = 0;
  banner.classList.remove("show");  const token = ++pollToken;

  // 10Hz poll: pull state, update HUD/buttons, detect events.
  let failStreak = 0;
  const poll = async (): Promise<void> => {
    while (pollToken === token && screenEls.game && !screenEls.game.classList.contains("hidden")) {
      try {
        const s = await api.getState(sess.roomCode, sess.playerId);
        if (pollToken !== token) return;
        lastState = s;
        failStreak = 0;
        hideReconnect();
        updateRiddle(s);
        updateTimer(s);
        updateToasts(s);
        updateButtons(s);
        updatePlayersHud(s);
        updateApprovalModal(s);
        if (s.status === "finished") {
          showResult(s);
          return;
        }
      } catch (e) {
        // Server restart / network blip: show the reconnect overlay (M5).
        failStreak++;
        const is404 = (e as { message?: string })?.message?.includes("404");
        showReconnect(is404 && failStreak > 2 ? "gone" : "retry");
      }

      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  };

  // 10Hz move sender: push the current input vector (0,0 when idle). Skipped
  // while transformed/stunned/in closet — move() would break a disguise.
  const sender = setInterval(() => {
    if (pollToken !== token) {
      clearInterval(sender);
      return;
    }
    const s = lastState;
    const me = s ? myPlayer(s) : undefined;
    if (me?.state === "active") {
      void api.move(sess.roomCode, sess.playerId, inputDir.x, inputDir.y).catch(() => {});
    }
  }, POLL_MS);

  // 60fps render: local-predict my own avatar, smooth everyone else.
  let lastT = performance.now();
  const frame = (now: number): void => {
    if (pollToken !== token) return;
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    if (lastState) {
      const me = myPlayer(lastState);
      const moving = me?.state === "active";
      const speed = MOVE_SPEED * (me?.carrying ? CARRY_SPEED_MULT : 1);
      renderer.setLocalPrediction(
        me ? { x: me.x, y: me.y } : null,
        me && moving ? inputDir : null,
        speed,
        !!moving,
      );
      renderer.draw(lastState, dt, now);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  poll();
}

// ---- result --------------------------------------------------------------
const resultTitle = $("result-title");
const resultSub = $("result-sub");

function showResult(s: GameState): void {
  pollToken++; // stop loops
  approvalModal.classList.add("hidden");
  hideReconnect();
  const team = s.winnerTeam;
  if (team === null) {
    resultTitle.textContent = "Draw?";
    resultSub.textContent = "Nobody banked the treasure.";
  } else {
    resultTitle.textContent = `Team ${team + 1} wins!`;
    resultSub.textContent =
      s.winReason === "bank"
        ? "Treasure banked with approval." // M5: every bank needs a human Approve
        : "The other team got closeted.";
    if (s.winReason === "bank") spawnConfetti();
  }
  show("result");
}

// ---- reconnect overlay (M5) ----------------------------------------------
const reconnectOverlay = $("reconnect-overlay");
const reconnectTitle = $("reconnect-title");
const reconnectSub = $("reconnect-sub");
const btnReconnectTitle = $<HTMLButtonElement>("btn-reconnect-title");

function showReconnect(kind: "retry" | "gone"): void {
  reconnectOverlay.classList.remove("hidden");
  if (kind === "gone") {
    reconnectTitle.textContent = "Room no longer exists";
    reconnectSub.textContent = "The game server restarted and lost the room.";
    btnReconnectTitle.classList.remove("hidden");
  } else {
    reconnectTitle.textContent = "Reconnecting…";
    reconnectSub.textContent = "Connection lost — retrying…";
    btnReconnectTitle.classList.add("hidden");
  }
}

function hideReconnect(): void {
  reconnectOverlay.classList.add("hidden");
}

btnReconnectTitle.addEventListener("click", () => {
  api.clearSession();
  session = null;
  hideReconnect();
  show("title");
});

$("btn-again").addEventListener("click", () => {
  api.clearSession();
  session = null;
  show("title");
});

// ---- title / multiplayer / lobby -----------------------------------------
$("btn-single").addEventListener("click", async () => {
  try {
    const r = await api.createRoom("solo");
    session = r;
    api.saveSession(session);
    await api.startMatch(r.roomCode, r.playerId);
    void enterGame();
  } catch (e) {
    showError("multi", (e as Error).message);
    show("multi");
  }
});

$("btn-multi").addEventListener("click", () => show("multi"));

$("btn-create").addEventListener("click", async () => {
  try {
    const r = await api.createRoom("multi");
    session = r;
    api.saveSession(session);
    showLobby();
  } catch (e) {
    showError("multi", (e as Error).message);
  }
});

$("btn-join").addEventListener("click", async () => {
  const code = ($("join-code") as HTMLInputElement).value.trim().toUpperCase();
  if (!code) return;
  try {
    const r = await api.joinRoom(code);
    session = { roomCode: code, playerId: r.playerId, team: r.team, host: false };
    api.saveSession(session);
    showLobby();
  } catch (e) {
    showError("multi", (e as Error).message);
  }
});

$("btn-back-title").addEventListener("click", () => show("title"));

function showError(screen: Screen, msg: string): void {
  const el = $(`${screen === "multi" ? "multi" : "lobby"}-error`) as HTMLElement;
  el.textContent = msg;
  el.classList.remove("hidden");
}

// ---- lobby screen --------------------------------------------------------
let lobbyToken = 0;

function showLobby(): void {
  show("lobby");
  if (!session) return;
  const sess = session; // stable for the closures below
  const token = ++lobbyToken;
  const codeEl = $("lobby-code");
  codeEl.textContent = sess.roomCode;
  ($("multi-error") as HTMLElement).classList.add("hidden");
  ($("lobby-error") as HTMLElement).classList.add("hidden");

  const startBtn = $<HTMLButtonElement>("btn-start");
  startBtn.classList.toggle("hidden", !session.host);
  startBtn.onclick = async () => {
    try {
      await api.startMatch(session!.roomCode, session!.playerId);
      void enterGame();
    } catch (e) {
      showError("lobby", (e as Error).message);
    }
  };

  const poll = async (): Promise<void> => {
    while (lobbyToken === token) {
      try {
        const info = await api.getLobby(sess.roomCode);
        if (lobbyToken !== token) return;
        renderLobbySeats(info.humans);
        if (info.status === "playing") {
          void enterGame();
          return;
        }
      } catch {
        // room gone — go back to title
        api.clearSession();
        session = null;
        show("title");
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  };
  poll();
}

function renderLobbySeats(
  humans: { playerId: string; name: string; team: number }[],
): void {
  const teamsEl = $("lobby-teams");
  // Engine seats are fixed: wizard-0..3 on teams 0,0,1,1.
  const seats = [
    { id: "wizard-0", team: 0 },
    { id: "wizard-1", team: 0 },
    { id: "wizard-2", team: 1 },
    { id: "wizard-3", team: 1 },
  ];
  teamsEl.innerHTML = "";
  for (const team of [0, 1]) {
    const col = document.createElement("div");
    col.className = `team-col team-${team}`;
    const h = document.createElement("h3");
    h.textContent = `Team ${team + 1}`;
    col.appendChild(h);
    for (const seat of seats.filter((s) => s.team === team)) {
      const div = document.createElement("div");
      div.className = "seat";
      const human = humans.find((x) => x.playerId === seat.id);
      if (human) {
        div.textContent = human.name;
        if (human.playerId === session?.playerId) div.classList.add("you");
      } else {
        div.textContent = "Empty";
        div.classList.add("empty");
      }
      col.appendChild(div);
    }
    teamsEl.appendChild(col);
  }
}

// ---- resume a saved session on load --------------------------------------
async function resumeSession(): Promise<void> {
  if (!session) return;
  try {
    const info = await api.getLobby(session.roomCode);
    if (info.status === "playing" || info.status === "finished") {
      void enterGame();
      return;
    }
    showLobby();
  } catch {
    // Server restarted and lost the in-memory room: explain instead of
    // silently kicking the player back to the title screen (M5 reconnect).
    reconnectTitle.textContent = "Room no longer exists";
    reconnectSub.textContent = "The game server restarted and lost the room.";
    btnReconnectTitle.classList.remove("hidden");
    reconnectOverlay.classList.remove("hidden");
  }
}

// ---- input wiring --------------------------------------------------------
const input = new InputManager({
  onMove: (x, y) => {
    inputDir = { x, y };
    // Immediate push for responsiveness; the 10Hz sender keeps it alive.
    const s = lastState;
    const me = s ? myPlayer(s) : undefined;
    if (me?.state === "active" && session) {
      void api.move(session.roomCode, session.playerId, x, y).catch(() => {});
    }
  },
  onAction: doAction,
  onTransform: doTransform,
});

btnAction.addEventListener("click", doAction);
btnTransform.addEventListener("click", doTransform);

show("title");
void resumeSession();
