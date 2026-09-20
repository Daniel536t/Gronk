# ASTRIX_THREE_MIGRATION.md — Godot → Blender + Three.js (living document)

> Status: vertical slice IMPLEMENTED + PROVEN (live render). Full world PARTIAL.
> Core untouched. Every claim below traces to a file or a test.

## 0. Non-negotiables (preserved structurally, not by convention)

- `src/astrix/state.ts` — sole authority. No Three.js import, no write path.
- `src/astrix/commandBus.ts` — SOLE mutation boundary; HIGH-risk gate in-bus.
- `src/astrix/mcpTools.ts` — 1 tool = 1 backing command; agent approval ids stripped.
- `src/astrix/orchestrator.ts` — propose → execute → verify; EXECUTED ≠ VERIFIED.
- `src/astrix/events.ts` — audit log (ring 500), not event sourcing.
- Boundaries: Decision≠Authority, Visualization≠Authority, Proposal≠Execution,
  Execution≠Verification, AI approval≠Human approval, Event≠evidence without transition.

## 1. What changed

```
BEFORE: Core → Godot (poll /astrix/state 0.5s, SVG not relevant) → screen
AFTER:  Core → Three.js Observatory (poll /astrix/state + /astrix/agent/status 2s, SSE-ready)
        Blender → assets/glb (ASTX_*) → Three.js scene graph (mirror only)
Godot: retired from production path. Not deleted yet (evidence + fallback),
       but receives NO new functionality. Final path: Core → Three.js.
```

## 2. Data flow (implemented)

```
AUTHORITATIVE SNAPSHOT (Core)
  │  GET /astrix/state + GET /astrix/agent/status
  ▼
astrix-three/main.js poll()           — read-only fetch; fallback snapshot if offline
  │  reconcileDynamic(): buildings[] mirror — add ONLY wanted ids, remove ONLY absent ids
  │  reconcile(): NPC visible count == population (cap 14 render, HUD authoritative)
  │  crops/bridges/approvals/food/day → HUD + scene (no invention)
  ▼
SCENE GRAPH (world Group = authority-bound, decor Group = dressing, never counted)
```

```
STEWARD → proposal → HUMAN (Approve/Reject buttons POST /astrix/approval/respond)
  → COMMAND BUS → EXECUTE → VERIFY → snapshot → Three.js re-mirror
Frontend NEVER mutates locally. Buttons invoke the legitimate control surface only.
```

## 3. Asset pipeline (implemented)

- Factory: `assets/blender/*.py` (Blender-runnable, bpy) — headless equivalent
  `tools/build_glbs.py` + `tools/astx_glb.py` (stdlib-only real binary glTF 2.0).
- Library: `assets/glb/ASTX_*.glb` (26 assets), origins bottom-anchored y=0,
  meters, +Y up, `M_*` shared materials.
- Manifest: `assets/manifests/asset-manifest.json` (machine-readable, no hard-coded paths).
- Naming: `ASTX_{TERRAIN,BUILDING,INFRA,VEG,PROP,NPC,BOAT}_*`; pivots (`*_PIVOT`)
  for windmill blades/hub, lighthouse lamp, boat masts.
- JSON chunk space-padded (glTFLoader-compatible), BIN null-padded.

## 4. Three.js Observatory (implemented, vertical slice)

`astrix-three/index.html` + `main.js` (three@0.160.0 via importmap):
ocean + seabed + shallow ring, tile-composed island, civic core, farms,
windmill/lighthouse/dock/bridge, constrained vegetation (island ellipse),
props, 3 boats (bob), 4 NPCs (population-bound), warm key + cool fill,
iso camera preset (45° yaw / ~38° pitch), HUD (WORLD/STEWARD/GOVERNANCE/
EVENTS/MAGICBLOCK/SOLANA/PERF), `window.__astrix` introspection.

## 5. MagicBlock / Solana (honest)

- `solana/astrix-world` program present (receipt registry design per
  ASTRIX_MAGICBLOCK_ARCHITECTURE.md: settlement of governance receipts only).
- Proven here: program source exists; ER crank/scheduler NOT verified in this
  slice. Observatory labels it as such — no relayer-called-crank fiction.
- Property preserved: Steward can disappear, observer can disappear, Node can
  disappear — world state + execution substrate remain conceptually separate.

## 6. Status ledger (updated: witnessed run + optimization)

| Area | Status | Evidence |
|---|---|---|
| Core authority/gate/verify | PROVEN (unchanged) | 270 tests pass; typecheck clean |
| 26 GLBs real glTF 2.0 + manifest | PROVEN | `tests/astrix-three-world.test.ts` (6) |
| Witnessed governance run | PROVEN | `artifacts/witnessed-run/` (12 files) + `witness-gate.png` + `witness-bridge.png` |
| reject→no-mutation | PROVEN | approval-001 rejected → bridges [] == before, wood/stone untouched |
| approve→mutation→verify→render | PROVEN | bridge-003 in `bridges[]` (verification rule) → rendered at berth, HUD lists pair |
| Crop state→render | PROVEN | farm-004 + crop-005 (growthStage 0) → tuft rendered; `witness-farm-crop.png` |
| Approval buttons → real endpoint | PROVEN | gate screenshot shows live approval-006 with working buttons (used in run) |
| Perf | PROVEN (target) | 422 → 301 → **153–177 draws / ~8.4–9.7k tris** full view via InstancedMesh veg+tiles; focus views 114–149 (all <200) |
| Crop temporal causality | PROVEN | `scripts/crop-temporal-proof.ts`: plant → 8 real days (0→0.125/day→1.0) → harvest +6 food; `artifacts/crop-temporal-proof/timeline.json` |
| Reconnect convergence | PROVEN | `artifacts/reconnect-proof.txt`: disconnect → storage-007 built → reload hydrates 4 buildings, CONVERGED:true (snapshot hydration, honestly not event replay) |
| Mobile | IMPLEMENTED | touch OrbitControls + responsive HUD + 44px targets; on-device test NOT done |
| Blender sources | PARTIAL | 2 full bpy scripts + headless parity; 24 assets bpy-pending |
| Terrain variety (cliff/beach/falls/reef) | NOT | tiles only; seams reduced (15.9 overlap) |
| Godot removal | NOT (retired-in-place) | out of prod path, still in repo |
| MagicBlock crank | NOT PROVEN | labeled honestly in HUD + docs; heartbeat never called a crank |

## 7. File map

| Path | Role |
|---|---|
| `tools/astx_glb.py`, `tools/build_glbs.py` | headless Blender-equivalent GLB factory |
| `assets/blender/` | bpy factory sources + README |
| `assets/glb/ASTX_*.glb` | real asset library (26) |
| `assets/manifests/asset-manifest.json` | loader manifest |
| `astrix-three/index.html`, `main.js` | Observatory world + adapter + governance UI |
| `tests/astrix-three-world.test.ts` | layer contracts (6 tests) |
| `artifacts/astrix-three-vertical-slice.png` | live proof screenshot |

## 9. Deployment record (2026-09-17)

- `scripts/build-three-observatory.sh` vendors three@0.160.0 (full jsm tree) +
  stages Observatory + 32 GLBs into `server/static/` (production root).
- Godot web export removed from the served path; restorable backup:
  `artifacts/godot-export-backup/godot-web-export.tar.gz` (11 MB).
  `godot/` sources untouched in-repo.
- **No server restart, no Core change: the live world (bridge-003, farm-004,
  crop-005, storage-007) survived deployment untouched.**
- Live proof: `artifacts/site-live.png` — https://astrixx.duckdns.org/ boots
  with zero console/network errors, hydrates 4 buildings + bridge-003.
- Initial deploy bug (fixed): vendored only loaders/+controls, missing
  `utils/BufferGeometryUtils.js` → boot timeout; fixed by vendoring full jsm.
- Operator writes from browsers need `#astrix_key=` (same model as GameClient.gd);
  otherwise 401 is surfaced honestly in the feed. `.glb` MIME pending in
  `http.ts` (harmless: served as octet-stream, GLTFLoader unaffected).

## 8. Next (in order)

1. Witnessed gate run (steward proposes CLEAR/BUILD → human clicks → world changes on camera).
2. Terrain kit (cliff/beach/waterfall/reef) + farm/crop growth visuals from `crops[]`.
3. InstancedMesh veg/props/tiles + LOD → measure <200 draws on real GPU.
4. Bpy scripts for remaining 24 assets; KTX2 atlas pass.
5. Godot deletion once Observatory covers its seam rows (see ASTRIX_GODOT_SEAM_AUDIT).
