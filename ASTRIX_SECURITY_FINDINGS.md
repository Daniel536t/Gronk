# ASTRIX_SECURITY_FINDINGS.md

> **Scope:** exposure of the ASTrix HTTP surface as deployed at
> `https://astrixx.duckdns.org` (Caddy → `127.0.0.1:8787`, pm2 app
> `gronks-hoard`). Findings are observational: each was confirmed against the
> live host or the source, and the confirming action is stated. **No remediation
> was applied** — per the current milestone instruction, this document records
> the finding rather than fixing it.
>
> **Posture change that motivates this document:** ASTrix Core now reasons
> in-process via `LocalStewardProvider` (default `ASTRIX_RUNTIME=local`). The
> original justification for leaving `POST /mcp` open — "TrueForge must be able
> to reach the game's tool surface on the same host" — **no longer applies**. The
> server needs no inbound agent access at all in the default configuration.

---

## Finding 1 — `POST /mcp` is publicly reachable with no authentication (HIGH)

**Endpoint:** `POST /mcp`, `GET /mcp` (MCP Streamable HTTP / SSE)
**Auth:** none, by design — `src/server/http.ts:130-148`, rationale at `:20-26`
**Reachability:** public over HTTPS via Caddy

**Confirmed:** an unauthenticated MCP `initialize` handshake completes over the
public URL:

```
POST https://astrixx.duckdns.org/mcp   →  HTTP 200
{"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":true}},
 "serverInfo":{"name":"gronks-hoard","version":"0.2.0"}},"jsonrpc":"2.0","id":1}
```

I verified the handshake and the missing key. I did **not** call a mutating tool
against production.

**What an unauthenticated caller can do.** `createMcpServer` registers **22
tools** (`src/server/mcp.ts:51-274`) on this transport, including the full ASTrix
mutation set:

| Tool | Effect |
|---|---|
| `inspect_world`, `inspect_island`, `inspect_resources`, `inspect_buildings`, `simulate_plan` | read authoritative state |
| `gather` | deplete a finite resource node |
| `build` | spend wood/stone, place a building |
| `plant`, `harvest` | mutate crops and food |
| `clear_terrain` | **irreversible** — requires human approval |
| `build_bridge` | **irreversible** — requires human approval |
| 11 legacy game tools (`create_lobby`, `move`, `action`, `approve_bank`, …) | drive the legacy hide-and-seek engine |

**Mitigating control that genuinely holds:** the approval gate is structural, in
the command bus (`src/astrix/commandBus.ts:103-114`), not in the transport. An
anonymous caller invoking `clear_terrain` or `build_bridge` creates a
*pendingApproval* and receives `{"success":false,"error":"human approval
required"}` — it cannot execute the irreversible action. Approval ids are also
bound to their exact recorded impact (`approvalMatchesCommand`, `:271`), so a
guessed id cannot be repurposed.

**What is genuinely exposed, therefore:**

1. **Unbounded reversible mutation.** `gather`, `build`, `plant`, `harvest` are
   LOW/MEDIUM risk and execute immediately. An anonymous caller can drain
   resource nodes, exhaust farmland, and spend the settlement's wood and stone —
   permanently corrupting a demonstration run's state (nodes do not regenerate).
2. **Approval-queue flooding.** Repeated `clear_terrain` calls append to
   `state.pendingApprovals` with no rate limit and no queue cap, degrading the
   Godot/Observatory approval UI and the agent-status payload.
3. **Legacy engine control.** Lobby creation and match manipulation are reachable.
4. **Information disclosure.** Full world state including `resourceNodes`
   positions and `pendingApprovals`.

**Severity: HIGH** for a publicly deployed instance — anonymous state mutation on
an authoritative simulation. Not *critical*: no RCE, no credential exposure, no
irreversible action without a human, and the blast radius is one in-memory world
that a restart resets.

---

## Finding 2 — `ASTRIX_API_KEY` is not set on the live process, so the ASTrix auth gate fails open (HIGH)

**Endpoints intended to be gated** (`src/astrix/server.ts`):
`POST /astrix/command` (`:97`), `POST /astrix/approval/respond` (`:112`),
`POST /astrix/agent/start` (`:129`), `POST /astrix/agent/stop` (`:139`),
`POST /astrix/mcp` (`:160`), `POST /astrix/mcp/tools/call` (`:174`).

**The gate:**

```ts
function authorized(req, authToken) {            // src/astrix/server.ts:200
  if (!authToken) return true;                   // :201  no token configured -> OPEN
  return req.headers.authorization === `Bearer ${authToken}`;
}
```

**Confirmed:** the live pm2 environment for app `gronks-hoard` contains **no
`ASTRIX_API_KEY`** (checked via `pm2 env`; zero matches). `src/server/index.ts:43`
passes `process.env.ASTRIX_API_KEY?.trim() || undefined`, so `authToken` is
`undefined` and every gated route returns `true` from `authorized()`.

**Consequence:** the six routes above are effectively public. Most significant is
**`POST /astrix/approval/respond`** — an anonymous caller can *answer the human's
approval gate*, granting an irreversible `clear_terrain` or `build_bridge` that
the steward requested. That is a direct compromise of the human-control property
the whole project exists to demonstrate, and it is not mitigated by the bus,
because the bus's job is to execute a *resolved* approval.

Also public: `POST /astrix/agent/start` / `stop` — an anonymous caller can start
or halt the steward loop.

**Severity: HIGH.** This is the more serious of the two findings, because the
mitigating control that saves Finding 1 (the approval gate) is exactly what
Finding 2 defeats.

---

## Finding 3 — Godot never sends the bearer token even when one is configured (LOW, latent)

`godot/scripts/GameClient.gd:156`:

```gdscript
headers.append("Authorization: Bearer ***" % astrix_api_key)
```

`"Bearer ***"` contains no format placeholder (`%s`), so `%` interpolation
produces a literal `Bearer ***` — or errors at runtime in GDScript 4. The
configured `astrix_api_key` is never transmitted.

**Consequence:** the moment Finding 2 is remediated by setting `ASTRIX_API_KEY`,
the Godot client's mutation and approval calls will start returning **401**. The
bug is currently invisible *because* auth fails open. This must be fixed **in the
same change** as Finding 2 or the deployed client breaks.

**Severity: LOW** as an exposure (it leaks nothing), **BLOCKING** as a
remediation dependency.

---

## Finding 4 — unauthenticated read surface (INFORMATIONAL, accepted)

Open by design: `GET /astrix/state`, `GET /astrix/events` (SSE),
`GET /astrix/agent/status`, `GET /astrix/log`, `GET /astrix/mcp`,
`GET /astrix/mcp/tools/list`, `GET /state`, `GET /api/lobby`.

The Observatory (`/observatory/`) depends on these for LIVE mode. No secret is
exposed — ASTrix has no hidden state analogous to the legacy
`treasureFurnitureId`. **Accepted as intended**, subject to the note that
`/astrix/log` reveals the full agent event history.

---

## Finding 5 — no rate limiting on any endpoint (MEDIUM)

There is no rate limiter anywhere in `src/server/http.ts` or
`src/astrix/server.ts`. The per-IP limiter that once existed was removed with the
upload endpoint (commit `99117d7`).

Amplifiers: `pendingApprovals` is an unbounded array; the MCP HTTP bridge builds a
transport per request path; `POST /astrix/agent/start` can be spammed (409s once
running, so bounded); SSE clients accumulate in a `Set` with no cap
(`src/astrix/server.ts:55`).

**Severity: MEDIUM** — resource exhaustion / denial of demonstration, not data
compromise.

---

## Recommended remediation

Ordered by value, smallest blast radius first. **None applied in this milestone.**

### R1 — Set `ASTRIX_API_KEY` and fix the GDScript format string together (required)

Must ship as one change or the deployed Godot client breaks:

1. `godot/scripts/GameClient.gd:156` → `"Authorization: Bearer %s" % astrix_api_key`
2. Set `ASTRIX_API_KEY` in the pm2 env; restart `gronks-hoard`
3. Supply the key to the Godot client (export var / build-time injection)
4. Re-export the web build, re-verify approvals from the browser

Note this also affects the Observatory, which already sends an explicit
`Authorization` header for `POST /astrix/approval/respond` in LIVE mode — that
path was written correctly and will start working, not break.

### R2 — Close `POST /mcp` (now that Core needs no inbound TrueForge access)

Three options, cheapest first:

| Option | Change | Trade-off |
|---|---|---|
| **Block at Caddy** | deny `/mcp` from non-local sources in the Caddyfile | zero code change, zero test impact; TrueForge on the same host still works |
| **Bind-scoped** | serve MCP only on a loopback listener | small `src/server/index.ts` change |
| **Bearer-gate mutating tools** | restore the gate reverted in `e039894` | reintroduces the failure mode that broke steward turns on PR #15 — only safe now *because* the default runtime is local |

Recommended: **Caddy deny**. It is tiny, isolated, testable, and cannot
destabilise Core — which satisfies the milestone's constraint on unrelated
security work.

### R3 — Cap the approval queue and add coarse rate limiting (deferred)

Reject new `pendingApprovals` beyond a small cap (e.g. 8) with a clear error, and
add a per-IP token bucket on POST routes. Defer until after the adapter milestone.

---

## Is remediation required before public deployment?

**Yes — R1 and R2 are required before the instance is publicly reachable.**

The project's central claim is that *irreversible actions cannot execute without a
human*. Finding 2 makes `POST /astrix/approval/respond` anonymous, which means an
arbitrary internet caller can supply that human decision. Until R1 lands, the
human-control property is **demonstrably true in code and tests, but not
enforceable on the deployed instance.**

For a *local* or *firewalled* deployment the current configuration is acceptable,
and the structural gate plus the immutable approval binding still hold.

---

## Status summary

| # | Finding | Severity | Confirmed by | Fixed |
|---|---|---|---|---|
| 1 | `POST /mcp` unauthenticated + public | HIGH | live `initialize` handshake, HTTP 200 | no |
| 2 | `ASTRIX_API_KEY` unset → gate fails open | HIGH | `pm2 env` has no key; `server.ts:201` | no |
| 3 | Godot never sends the bearer token | LOW / blocking | `GameClient.gd:156` source | no |
| 4 | Open read surface | INFO | route table, `server.ts:86-172` | accepted |
| 5 | No rate limiting | MEDIUM | source inspection | no |

The live pm2 process has **not** been restarted and still runs the pre-Core-extraction
wiring; none of the above changed during this milestone.
