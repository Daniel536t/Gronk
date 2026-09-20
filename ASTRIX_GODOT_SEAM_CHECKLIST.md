# Godot seam coverage checklist (Three.js Observatory vs retired Godot path)

Source rows: ASTRIX_GODOT_SEAM_AUDIT.md §4 (23 snapshot fields) + agent-status feed.

| # | Responsibility | Godot then | Three.js now | Status |
|---|---|---|---|---|
| 1 | World visualization (farms/crops/bridges/nodes) | procedural GDScript | ASTX GLBs + reconcile | COVERED (farms/crops/bridges/nodes→markers pending; decor trees remain dressing) |
| 2 | State hydration | 0.5s poll /astrix/state | 2s poll + load hydration | COVERED (proven by reconnect test) |
| 3 | Dynamic reconciliation | _materialize_sim | reconcileDynamic + crops + NPC=pop | COVERED for buildings/bridges/crops/pop; biome tint NOT |
| 4 | Governance UI | ApprovalGate modal | APPROVE/REJECT → real endpoint | COVERED (witnessed) |
| 5 | Event visibility | 8-event console feed | live feed (agent events or honest fallback text) | PARTIAL (loop IDLE → fallback text; SSE typing pending) |
| 6 | Camera | ortho gameplay cam | iso overview + orbit/inspect | COVERED |
| 7 | World animation | day/dusk lerp (wall-clock!) | water/bob/sway (presentation only, no fake clock) | COVERED honestly |
| 8 | Deployment | Godot export | static page + existing server | COVERED (2026-09-17: root serves Three.js Observatory; Godot web export removed from `server/static`, backup in `artifacts/godot-export-backup/`) |
| 9 | Mobile/browser | Godot web export | responsive HUD + touch orbit | COVERED (layout+controls; on-device test NOT done) |
| 10 | Screenshots/proof | probe_*.gd | playwright shots + __astrix | COVERED |
| 11 | Observability | AgentConsole | WORLD/STEWARD/GOV/EVENTS/CHAIN/PERF HUD | COVERED |
| 12 | Survival dimension (pop/food/season/health in 3D, not text) | TEXT ONLY (audit verdict) | NPC=pop + crop stages + farm/store structures; season/lighting + biome tint NOT | PARTIAL |

Deletion rule: Godot leaves the repo only when rows 1–11 are COVERED and row 12 is
no worse than Godot's. Today that bar is met except row 5-partial/12-partial and
unmeasured on-device mobile — so Godot stays retired-in-place. This file is the
removal gate; do not delete Godot without updating it.
