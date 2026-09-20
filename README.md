# ASTrix

ASTrix is a living world where a steward agent manages a village across three islands (Meadow, Frost, Dusk). The world has deterministic state, an authoritative command bus, and human approval for irreversible actions.

## Quick Start

```bash
npm install
npm run prod  # serves on http://localhost:8787
```

Open http://localhost:8787 — Three.js observatory (live island mirror).

## World API

- `GET /astrix/state`
- `POST /astrix/command`
- `GET /astrix/events` (SSE)
- `POST /astrix/approval/respond`
- `GET /astrix/chain` — Solana world-clock observability (public)
- `POST /astrix/agent/start` — start steward run

## Development

```bash
npm run build
PORT=8787 npm run server
```

Godot and Three.js clients poll `/astrix/state` and `/astrix/chain`.

## Tests

```bash
npm test
npm run typecheck
```
