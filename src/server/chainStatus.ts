// ASTrix chain-status feed — read-only observability for the Solana side.
//
// Reports the on-chain world clock (program/world PDA day, delegation owner)
// plus the recorded heartbeat history. PUBLIC read surface like /astrix/state:
// it proves nothing by itself; it exposes verifiable facts (program ID, PDA,
// slot, signatures) any visitor can re-check via stock Solana RPC.
//
// Design constraints:
// - NEVER blocks or mutates the simulation: polling runs on its own interval,
//   failures degrade to {error} with the last good reading kept (stale, shown
//   as stale — never fabricated).
// - No credentials, no writes, no chain SDK: plain JSON-RPC over fetch.
// - Heartbeat history comes from the committed evidence file
//   (server/static/astrix-evidence/ in production images,
//   artifacts/ in a dev checkout); absence of the file yields an empty list,
//   never an error.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CHAIN_PROGRAM_ID = "qWpJE9ePjD8YnzW2AA6UdpFodF7LS7w5Y5CUmHArWK3";
export const CHAIN_WORLD_PDA = "GBFT6mQew5g1BBpWjHSYfe9tNN1a3KykjuDun862S29P";
export const CHAIN_RPC_URL = process.env.ASTRIX_RPC ?? "https://api.devnet.solana.com";
const POLL_MS = 30_000;

export interface ChainHeartbeat {
  t: string;
  heartbeat: number;
  advanceSig: string;
  erMs: number;
  commitSig: string;
  baseDayBefore: string;
  baseDay: string;
}

export interface ChainStatus {
  configured: boolean;
  programId: string;
  worldPDA: string;
  rpc: string;
  /** On-chain day (null until first successful poll — never guessed). */
  chainDay: string | null;
  /** Current owner short tag (e.g. delegation program) or null. */
  owner: string | null;
  slot: number | null;
  updatedAt: number | null;
  error: string | null;
  heartbeats: ChainHeartbeat[];
}

const status: ChainStatus = {
  configured: true,
  programId: CHAIN_PROGRAM_ID,
  worldPDA: CHAIN_WORLD_PDA,
  rpc: CHAIN_RPC_URL,
  chainDay: null,
  owner: null,
  slot: null,
  updatedAt: null,
  error: null,
  heartbeats: [],
};

function evidencePaths(): string[] {
  const here = dirname(fileURLToPath(import.meta.url)); // src/server
  return [
    join(here, "..", "..", "server", "static", "astrix-evidence", "astrix-heartbeat.jsonl"),
    join(here, "..", "..", "artifacts", "astrix-heartbeat.jsonl"),
  ];
}

function loadHeartbeats(): ChainHeartbeat[] {
  for (const path of evidencePaths()) {
    try {
      if (!existsSync(path)) continue;
      return readFileSync(path, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as ChainHeartbeat);
    } catch {
      continue;
    }
  }
  return [];
}

function b64ToBytes(b64: string): Buffer {
  return Buffer.from(b64, "base64");
}

async function pollOnce(): Promise<void> {
  try {
    const res = await fetch(CHAIN_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [CHAIN_WORLD_PDA, { encoding: "base64", commitment: "confirmed" }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json()) as {
      result?: { context?: { slot?: number }; value?: { data?: [string, string]; owner?: string } | null };
    };
    const value = body.result?.value;
    if (!value || !value.data) throw new Error("world account missing on chain");
    const data = b64ToBytes(value.data[0]);
    status.chainDay = data.readBigUInt64LE(1 + 32).toString();
    status.owner = value.owner ?? null;
    status.slot = body.result?.context?.slot ?? null;
    status.updatedAt = Date.now();
    status.error = null;
  } catch (error) {
    // Keep the last good reading; report staleness honestly.
    status.error = error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160);
  }
}

let poller: ReturnType<typeof setInterval> | null = null;

/** Idempotent: safe to call per request and at boot. */
export function startChainPoller(): void {
  status.heartbeats = loadHeartbeats();
  if (poller) return;
  void pollOnce();
  poller = setInterval(() => void pollOnce(), POLL_MS);
  if (typeof poller === "object" && "unref" in poller) (poller as { unref(): void }).unref();
}

export function getChainStatus(): ChainStatus {
  startChainPoller();
  return {
    ...status,
    heartbeats: status.heartbeats.map((h) => ({ ...h })),
  };
}
