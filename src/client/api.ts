// Thin fetch wrappers around the game server's HTTP API. By default the browser
// talks same-origin (single-port prod mode on the game server, or the Vite proxy
// in dev). For a split deployment (static frontend on Vercel, game server
// elsewhere) set VITE_API_URL at build time to the game server's origin, e.g.
//   VITE_API_URL="https://game.your-domain.com" npm run build
import type { GameState } from "../engine/types";

// Trim a single trailing slash so URLs join cleanly.
const BASE: string = ((import.meta.env.VITE_API_URL as string | undefined) || "").replace(/\/$/, "");

export interface Session {
  roomCode: string;
  playerId: string;
  team: number;
  host: boolean;
}

const SESSION_KEY = "gh-session";
// Hard cap on a state fetch. Far beyond any plausible round trip; exists only
// to convert a hung request into a completable failure so client-side
// reconciliation evidence stays bounded.
const STATE_FETCH_TIMEOUT_MS = 8000;

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (!s.roomCode || !s.playerId) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveSession(s: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T;
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data;
}

export async function getState(roomCode: string, playerId: string): Promise<GameState> {
  // Explicit timeout so a hung fetch cannot pend forever: the game loop treats
  // completion (any completion) as evidence, and an unbounded request would
  // leave client-side reconciliation without a bound (Qodo PR #11).
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), STATE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${BASE}/state?room=${encodeURIComponent(roomCode)}&player=${encodeURIComponent(playerId)}`,
      { signal: ac.signal },
    );
    if (!res.ok) throw new Error(`state HTTP ${res.status}`);
    return (await res.json()) as GameState;
  } finally {
    clearTimeout(timer);
  }
}

export interface CreateResult extends Session {
  roomCode: string;
}

export function createRoom(mode: "multi" | "solo"): Promise<CreateResult> {
  return post<CreateResult>("/api/create", { mode });
}

export function joinRoom(roomCode: string): Promise<{ playerId: string; team: number }> {
  return post("/api/join", { roomCode });
}

export function startMatch(roomCode: string, playerId: string): Promise<{ ok: boolean }> {
  return post("/api/start", { roomCode, playerId });
}

export function move(roomCode: string, playerId: string, dirX: number, dirY: number): Promise<unknown> {
  return post("/api/move", { roomCode, playerId, dirX, dirY });
}

export function transform(roomCode: string, playerId: string, furnitureId: string): Promise<unknown> {
  return post("/api/transform", { roomCode, playerId, furnitureId });
}

export function action(roomCode: string, playerId: string): Promise<unknown> {
  return post("/api/action", { roomCode, playerId });
}

export function approveBank(roomCode: string, playerId: string): Promise<unknown> {
  return post("/api/approve-bank", { roomCode, playerId });
}

export function rejectBank(roomCode: string, playerId: string): Promise<unknown> {
  return post("/api/reject-bank", { roomCode, playerId });
}

export interface LobbyInfo {
  roomCode: string;
  status: "lobby" | "playing" | "finished";
  hostId: string | null;
  humans: { playerId: string; name: string; team: number }[];
  bots: number;
}

export async function getLobby(roomCode: string): Promise<LobbyInfo> {
  const res = await fetch(`${BASE}/api/lobby?room=${encodeURIComponent(roomCode)}`);
  if (!res.ok) throw new Error(`lobby HTTP ${res.status}`);
  return (await res.json()) as LobbyInfo;
}
