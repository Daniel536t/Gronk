// Match lobby. In-memory map roomCode -> Lobby. No database, no PDA — the
// engine is the authoritative state and everything here is a thin wrapper.
//
// The engine pre-creates 4 fixed seats (wizard-0..3, teams 0,1,0,1). Humans
// claim seats in join order; remaining seats are filled with agents at
// start_match. Which kind of agent depends on BOTS=scripted|trueforge: the
// scripted FSM is the permanent fallback, TrueForge agents are the M4 path.
// Both are driven by the AgentRuntime orchestrator behind a BackendFactory.
import { GameEngine, TICK_MS, type GameState, type TeamId } from "../engine";
import { IntentExecutor, type AgentIntent, type AgentIntentType } from "./intents";
import type { AgentBackend } from "./agent";
import { ScriptedBackend } from "./bots";
import { AgentRuntime } from "./orchestrator";

export type LobbyMode = "multi" | "solo";
export type LobbyStatus = "lobby" | "playing" | "finished";
export type BotMode = "scripted" | "trueforge";

const SEAT_COUNT = 4;
const SEAT_PLAYER_IDS = ["wizard-0", "wizard-1", "wizard-2", "wizard-3"];

// 4-letter words for short, memorable room codes like "WAND-42".
const CODE_WORDS = [
  "WAND", "LOOT", "GRIM", "FROG", "MAGE", "RUNE", "HALL", "DARK",
  "COVE", "LAMP", "HOAX", "GNAR", "TOMB", "CASK", "HELM", "PIXI",
];

export function makeRoomCode(rng: () => number): string {
  const word = CODE_WORDS[Math.floor(rng() * CODE_WORDS.length)];
  const digits = 10 + Math.floor(rng() * 90); // 10..99
  return `${word}-${digits}`;
}

/** Builds the agent backends for a lobby's empty seats. */
export interface BackendFactory {
  /** A wizard backend for one of the four seats. */
  wizard(seatId: string): AgentBackend;
  /** Gronk's backend, or null to leave Gronk to the engine's built-in FSM. */
  gronk(): AgentBackend | null;
}

/** Default BOTS=scripted factory: FSM wizards, engine-owned Gronk. */
export function scriptedBackendFactory(rng: () => number): BackendFactory {
  return {
    wizard: (seatId) => new ScriptedBackend(seatId, "wizard", rng),
    gronk: () => null,
  };
}

export interface LobbyRuntimeOptions {
  decisionTimeoutMs?: number;
  capturePayloads?: boolean;
}

export class Lobby {
  readonly roomCode: string;
  readonly mode: LobbyMode;
  readonly engine: GameEngine;
  readonly intentExec = new IntentExecutor();
  readonly runtime: AgentRuntime;

  status: LobbyStatus = "lobby";
  hostId: string | null = null;
  humans: { playerId: string; name: string }[] = [];
  /** Wizard backends for empty seats (count + reference); the runtime drives them. */
  bots: AgentBackend[] = [];
  botMode: BotMode;

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    roomCode: string,
    mode: LobbyMode,
    botMode: BotMode,
    rng: () => number,
    runtimeOpts: LobbyRuntimeOptions = {},
  ) {
    this.roomCode = roomCode;
    this.mode = mode;
    this.botMode = botMode;
    // In trueforge mode Gronk's cadence is owned by the agent, so the engine
    // hands the sniff timer to forceSniff(). The approval gate is ALWAYS on
    // for production lobbies (M5) — banking needs a human Approve click.
    this.engine = new GameEngine({ rng, externalSniff: botMode === "trueforge", approvalRequired: true });
    this.runtime = new AgentRuntime({
      fallbackRng: rng,
      decisionTimeoutMs: runtimeOpts.decisionTimeoutMs,
      capturePayloads: runtimeOpts.capturePayloads,
    });
  }

  isFull(): boolean {
    return this.humans.length >= SEAT_COUNT;
  }

  /** Free seat on the team with fewer humans (ties -> team 0). Max 2v2. */
  nextSeat(): string | null {
    const taken = new Set(this.humans.map((h) => h.playerId));
    const counts = [0, 1].map((t) =>
      this.humans.filter((h) => this.teamOf(h.playerId) === t).length,
    );
    const targetTeam = counts[0] <= counts[1] ? 0 : 1;
    for (const id of SEAT_PLAYER_IDS) {
      if (!taken.has(id) && this.teamOf(id) === targetTeam) return id;
    }
    return null;
  }

  teamOf(playerId: string): TeamId {
    return this.engine.state.players.find((p) => p.id === playerId)?.team ?? 0;
  }

  startTicking(tickFn: () => void): void {
    this.stopTicking();
    this.timer = setInterval(tickFn, TICK_MS);
  }

  stopTicking(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export type LobbyResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface LobbyManagerOptions {
  rng?: () => number;
  autoTick?: boolean;
  botMode?: BotMode;
  backendFactory?: BackendFactory;
  decisionTimeoutMs?: number;
  capturePayloads?: boolean;
}

export class LobbyManager {
  private lobbies = new Map<string, Lobby>();
  private rng: () => number;
  private autoTick: boolean;
  private botMode: BotMode;
  private backendFactory: BackendFactory;
  private runtimeOpts: LobbyRuntimeOptions;

  constructor(opts: LobbyManagerOptions = {}) {
    this.rng = opts.rng ?? Math.random;
    this.autoTick = opts.autoTick ?? true;
    this.botMode = opts.botMode ?? "scripted";
    this.backendFactory = opts.backendFactory ?? scriptedBackendFactory(this.rng);
    this.runtimeOpts = {
      decisionTimeoutMs: opts.decisionTimeoutMs,
      capturePayloads: opts.capturePayloads,
    };
  }

  createLobby(mode: LobbyMode = "multi"): LobbyResult<{ roomCode: string }> {
    let code = "";
    for (let i = 0; i < 100; i++) {
      code = makeRoomCode(this.rng);
      if (!this.lobbies.has(code)) break;
    }
    if (this.lobbies.has(code)) return { ok: false, error: "could not allocate a room code" };
    const lobby = new Lobby(code, mode, this.botMode, this.rng, this.runtimeOpts);
    this.lobbies.set(code, lobby);
    return { ok: true, value: { roomCode: code } };
  }

  getLobby(roomCode: string): Lobby | undefined {
    return this.lobbies.get(roomCode);
  }

  joinLobby(
    roomCode: string,
    name = "Wizard",
  ): LobbyResult<{ playerId: string; team: TeamId }> {
    const l = this.getLobby(roomCode);
    if (!l) return { ok: false, error: "room not found" };
    if (l.status !== "lobby") return { ok: false, error: "match already started" };
    if (l.isFull()) return { ok: false, error: "lobby is full (4/4)" };
    const playerId = l.nextSeat();
    if (!playerId) return { ok: false, error: "lobby is full (4/4)" };
    l.humans.push({ playerId, name });
    if (!l.hostId) l.hostId = playerId; // host = first joiner
    return { ok: true, value: { playerId, team: l.teamOf(playerId) } };
  }

  startMatch(roomCode: string, requesterId: string): LobbyResult<{ ok: true }> {
    const l = this.getLobby(roomCode);
    if (!l) return { ok: false, error: "room not found" };
    if (l.status !== "lobby") return { ok: false, error: "match already started" };
    if (l.hostId !== requesterId) return { ok: false, error: "only the host can start the match" };

    // Fill empty seats with agents (scripted or TrueForge). Gronk gets a
    // backend only in trueforge mode; scripted mode leaves him to the engine.
    const taken = new Set(l.humans.map((h) => h.playerId));
    for (const id of SEAT_PLAYER_IDS) {
      if (!taken.has(id)) {
        const backend = this.backendFactory.wizard(id);
        l.bots.push(backend);
        l.runtime.setWizard(id, backend);
      }
    }
    const gronk = this.backendFactory.gronk();
    if (gronk) l.runtime.setGronk(gronk);

    l.engine.startMatch();

    // Seed bot seats with an immediate intent so they act while their first
    // (slow, real-LLM) decision is still computing — otherwise they stand at
    // spawn and get caught instantly. Engine public API only.
    for (const id of SEAT_PLAYER_IDS) {
      if (taken.has(id)) continue;
      const p = l.engine.state.players.find((q) => q.id === id);
      const furn = l.engine.state.furniture;
      if (p && furn.length > 0) {
        let best = furn[0];
        let bestD = Infinity;
        for (const f of furn) {
          const d = (f.x - p.x) ** 2 + (f.y - p.y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = f;
          }
        }
        l.intentExec.setIntent(id, { intent: "SEARCH_FURNITURE", targetId: best.id });
      }
    }

    l.status = "playing";
    if (this.autoTick) {
      l.startTicking(() => this.tickOnce(roomCode));
    }
    return { ok: true, value: { ok: true } };
  }

  /** Advance one engine tick: agent decisions -> intent execution -> engine.tick. */
  tickOnce(roomCode: string): void {
    const l = this.getLobby(roomCode);
    if (!l || l.status !== "playing") return;
    l.runtime.step(l);
    l.intentExec.step(l.engine);
    l.engine.tick(1);
    if (l.engine.state.status !== "playing") {
      l.status = "finished";
      l.stopTicking();
    }
  }

  getState(roomCode: string, _playerId: string): LobbyResult<{ state: GameState }> {
    const l = this.getLobby(roomCode);
    if (!l) return { ok: false, error: "room not found" };
    // engine.getPublicState() deep-clones and can never include the secret
    // treasureFurnitureId (it lives only on the engine instance).
    return { ok: true, value: { state: l.engine.getPublicState() } };
  }

  move(roomCode: string, playerId: string, dirX: number, dirY: number) {
    const l = this.getLobby(roomCode);
    if (!l) return { ok: false, error: "room not found" };
    return l.engine.move(playerId, dirX, dirY);
  }

  transform(roomCode: string, playerId: string, furnitureId: string) {
    const l = this.getLobby(roomCode);
    if (!l) return { ok: false, error: "room not found" };
    return l.engine.transform(playerId, furnitureId);
  }

  /** The one verb. Engine context-resolves search/stun/pickup/bank — targetId
   *  is accepted for interface symmetry with the MCP spec but not needed. */
  action(roomCode: string, playerId: string, _targetId?: string) {
    const l = this.getLobby(roomCode);
    if (!l) return { ok: false, error: "room not found" };
    return l.engine.action(playerId);
  }

  agentIntent(
    roomCode: string,
    agentId: string,
    intent: AgentIntentType,
    targetId?: string,
  ): LobbyResult<{ ok: true }> {
    const l = this.getLobby(roomCode);
    if (!l) return { ok: false, error: "room not found" };
    // "gronk" steers Gronk's next sniff (the Gronk agent's only lever).
    if (agentId === "gronk") {
      const pt = this.resolveGronkTarget(l, intent, targetId);
      if (pt) l.engine.steerGronk(pt.x, pt.y);
      l.engine.forceSniff();
      return { ok: true, value: { ok: true } };
    }
    if (!l.engine.state.players.some((p) => p.id === agentId)) {
      return { ok: false, error: "unknown agent" };
    }
    const ai: AgentIntent = { intent };
    if (targetId !== undefined) ai.targetId = targetId;
    l.intentExec.setIntent(agentId, ai);
    return { ok: true, value: { ok: true } };
  }

  /** Map a Gronk agent_intent to a concrete point: targetId may be a playerId,
   *  "noise"/"stunned"/"visible", or omitted (built-in priority). */
  private resolveGronkTarget(
    l: Lobby,
    intent: AgentIntentType,
    targetId?: string,
  ): { x: number; y: number } | null {
    if (intent !== "HUNT_NEAREST") return null;
    const s = l.engine.state;
    if (targetId === "noise" && s.latestNoise) {
      return { x: s.latestNoise.x, y: s.latestNoise.y };
    }
    const byId = s.players.find((p) => p.id === targetId && p.state !== "transformed");
    if (byId) return { x: byId.x, y: byId.y };
    // Fall through: let the engine's own priority (noise > stunned > visible)
    // pick the target by steering with no override.
    return null;
  }

  revealRiddle(roomCode: string, lineNumber: number): LobbyResult<{ line: number; text: string | null }> {
    const l = this.getLobby(roomCode);
    if (!l) return { ok: false, error: "room not found" };
    const s = l.engine.state;
    const line = Math.max(1, Math.min(3, Math.floor(lineNumber)));
    const text = s.visibleRiddleLines[line - 1] ?? null;
    return { ok: true, value: { line, text } };
  }

  approveBank(roomCode: string, team: TeamId) {
    const l = this.getLobby(roomCode);
    if (!l) return { ok: false, error: "room not found" };
    return l.engine.approveBank(team);
  }

  rejectBank(roomCode: string, team: TeamId) {
    const l = this.getLobby(roomCode);
    if (!l) return { ok: false, error: "room not found" };
    return l.engine.rejectBank(team);
  }

  /** Approve the pending bank request for a player's team (M5: any human
   *  player may call this — it is keyed by the requester's team, not by who
   *  is carrying). */
  approveBankByPlayer(roomCode: string, playerId: string) {
    const l = this.getLobby(roomCode);
    if (!l) return { ok: false, error: "room not found" };
    const p = l.engine.state.players.find((q) => q.id === playerId);
    if (!p) return { ok: false, error: "unknown player" };
    return l.engine.approveBank(p.team);
  }

  rejectBankByPlayer(roomCode: string, playerId: string) {
    const l = this.getLobby(roomCode);
    if (!l) return { ok: false, error: "room not found" };
    const p = l.engine.state.players.find((q) => q.id === playerId);
    if (!p) return { ok: false, error: "unknown player" };
    return l.engine.rejectBank(p.team);
  }

  /** Rooms still open (for debugging / the M3 frontend). */
  listRooms(): { roomCode: string; status: LobbyStatus; humans: number }[] {
    return [...this.lobbies.values()].map((l) => ({
      roomCode: l.roomCode,
      status: l.status,
      humans: l.humans.length,
    }));
  }
}
