// Mock TrueForge harness for headless Mode A verification.
//
// TrueForgeBackend (src/server/trueforge.ts) drives agents over this exact
// HTTP contract:
//   POST /api/v1/sessions                       {agent:{name}} -> {data:{id}}
//   POST /api/v1/sessions/:sid/turns            {input:[{type:"user.message",content}], previousTurnId:"auto"} -> {data:{id}}
//   GET  /api/v1/sessions/:sid/turns/:tid       -> {data:{state:{status:"done"|"running", output?}}}
//   POST /api/v1/agents                         (provisioning; answered for parity)
//
// The brain parses the AgentView out of the turn prompt (the same JSON a real
// LLM would see), runs a small strategy, and returns a decision as plain text
// — exercising parseDecision's text-scan path, exactly like a real agent's
// final answer. A fixed ~250ms latency simulates LLM think time so the
// verifier reports realistic per-decision numbers.
//
// Run standalone:   npx tsx scripts/mock-trueforge.ts [port]
// Used by:          scripts/verify-mode-a.ts (spins one up when TRUEFORGE_URL is unset)
import http from "node:http";
import type { AgentDecision, AgentView } from "../src/server/agent";

export interface MockTrueForge {
  server: http.Server;
  url: string;
  close(): Promise<void>;
}

interface Turn {
  status: "running" | "done";
  output: unknown;
}

/** Pick a decision for one named agent from the public view. */
function decide(agentName: string, view: AgentView, cycle: number): AgentDecision {
  if (agentName === "gronk") {
    // Spec priority: noise > stunned > visible (non-transformed).
    if (view.latestNoise) return { intent: "HUNT_NEAREST", targetId: "noise" };
    const stunned = view.players.filter((p) => p.state === "stunned");
    if (stunned.length > 0) return { intent: "HUNT_NEAREST", targetId: stunned[0].id };
    const visible = view.players.filter((p) => p.state === "active");
    if (visible.length > 0) {
      let best = visible[0];
      let bestD = Infinity;
      for (const p of visible) {
        const d = (p.x - view.gronk.x) ** 2 + (p.y - view.gronk.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      return { intent: "HUNT_NEAREST", targetId: best.id };
    }
    return { intent: "HUNT_NEAREST" };
  }

  // Bot wizards: seat wizard-1..3 -> botwizard-a/b/c (lowercase resource names).
  const seat = { "botwizard-a": 1, "botwizard-b": 2, "botwizard-c": 3 }[agentName] ?? 1;
  const self = view.players.find((p) => p.id === `wizard-${seat}`);
  if (self) {
    if (self.carrying) return { intent: "GO_TO_PEDESTAL" };
    if (view.groundTreasure) {
      const d = Math.hypot(view.groundTreasure.x - self.x, view.groundTreasure.y - self.y);
      if (d < 15) return { intent: "GRAB" };
    }
    if (Math.hypot(view.gronk.x - self.x, view.gronk.y - self.y) < 15) return { intent: "FLEE" };
  }
  // Cycle through furniture (each wizard starts at a different offset so the
  // treasure is covered quickly). SEARCH_FURNITURE walks + searches on arrival.
  const furn = view.furniture;
  if (furn.length === 0) return { intent: "SEARCH_FURNITURE" };
  return { intent: "SEARCH_FURNITURE", targetId: furn[(cycle + seat) % furn.length].id };
}

/** Extract the AgentView JSON from the turn prompt text. */
function parseView(content: unknown): AgentView | null {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as AgentView;
  } catch {
    return null;
  }
}

export function startMockTrueForge(port = 0, latencyMs = 250): Promise<MockTrueForge> {
  const sessions = new Map<string, string>(); // sessionId -> agent name
  const turns = new Map<string, Turn>();
  const cycles = new Map<string, number>(); // sessionId -> furniture cycle counter
  let sessSeq = 0;
  let turnSeq = 0;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (code: number, body: unknown) => {
      const buf = JSON.stringify(body);
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(buf);
    };
    const readBody = (cb: (raw: string) => void) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => cb(Buffer.concat(chunks).toString("utf8")));
    };

    // POST /api/v1/sessions — create a session for a named agent.
    if (req.method === "POST" && url.pathname === "/api/v1/sessions") {
      readBody((raw) => {
        let agentName = "unknown";
        try {
          agentName = (JSON.parse(raw) as { agent?: { name?: string } }).agent?.name ?? agentName;
        } catch {
          /* keep default */
        }
        const id = `sess-${++sessSeq}`;
        sessions.set(id, agentName);
        cycles.set(id, 0);
        send(200, { data: { id } });
      });
      return;
    }

    // POST /api/v1/agents — provisioning parity (not used by the game server).
    if (req.method === "POST" && url.pathname === "/api/v1/agents") {
      readBody(() => send(200, { data: { ok: true } }));
      return;
    }

    // POST /api/v1/sessions/:sid/turns — run one decision.
    const turnMatch = url.pathname.match(/^\/api\/v1\/sessions\/([^/]+)\/turns$/);
    if (req.method === "POST" && turnMatch) {
      const sid = turnMatch[1];
      readBody((raw) => {
        const id = `turn-${++turnSeq}`;
        let output: Turn["output"] = null;
        try {
          const body = JSON.parse(raw) as { input?: { content?: unknown }[] };
          const view = parseView(body.input?.[0]?.content);
          if (view) {
            const cycle = cycles.get(sid) ?? 0;
            cycles.set(sid, cycle + 1);
            const d = decide(sessions.get(sid) ?? "unknown", view, cycle);
            output = { content: `Decision: ${JSON.stringify(d)}` };
          }
        } catch {
          /* leave output null -> unparseable, exercises fallback */
        }
        const turn: Turn = { status: "running", output };
        turns.set(id, turn);
        setTimeout(() => {
          turn.status = "done";
        }, latencyMs);
        send(200, { data: { id } });
      });
      return;
    }

    // GET /api/v1/sessions/:sid/turns/:tid — poll until done.
    const getMatch = url.pathname.match(/^\/api\/v1\/sessions\/([^/]+)\/turns\/([^/]+)$/);
    if (req.method === "GET" && getMatch) {
      const turn = turns.get(getMatch[2]);
      if (!turn) {
        send(404, { data: null });
        return;
      }
      send(200, {
        data: {
          state: {
            status: turn.status,
            ...(turn.status === "done" ? { output: turn.output } : {}),
          },
        },
      });
      return;
    }

    send(404, { data: null });
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      const addr = server.address();
      const p = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        server,
        url: `http://localhost:${p}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

// Standalone run: npx tsx scripts/mock-trueforge.ts [port]
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 8790);
  const mock = await startMockTrueForge(port, 250);
  console.error(`[mock-trueforge] listening on ${mock.url} (latency 250ms)`);
}
