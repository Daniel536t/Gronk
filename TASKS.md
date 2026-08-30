# ASTrix Tasks

## Current milestone — 3D world foundation

- [x] Create a Godot 4 project under `godot/`.
- [x] Add a modular `GameClient` autoload for the existing HTTP API.
- [x] Add a `Main` 3D scene and `World3D` presentation layer.
- [x] Add an isometric-style orthographic camera with smooth follow.
- [x] Add a small pastel low-poly island with water, grass, dirt, stone, and height variation.
- [x] Add a placeholder `CharacterBody3D` player with smooth local keyboard movement.
- [x] Add a separate `AstrixInput` autoload with a virtual-direction seam for future mobile controls.
- [x] Preserve the existing browser client, server, engine, TrueForge, MCP, API, and game rules.

## Intentionally deferred

- [ ] Authoritative movement integration and prediction/reconciliation.
- [ ] Furniture, buildings, resources, farming, crafting, and inventory.
- [ ] NPCs, quests, combat, multiplayer presentation, and agent systems.
- [ ] HUD, menus, onboarding, and mobile touch controls.
- [ ] Final character art, animation, camera bounds, and world streaming.
- [x] Install and verify Godot 4.7.2 locally (`godot --version` equivalent binary check).
- [x] Run the project headlessly and under Xvfb/software rendering.
- [x] Capture a real 1280×720 Godot render frame (`/tmp/astrix-qa/world00000000.png`).
- [x] Confirm startup has no Godot parse, scene, dependency, or runtime errors.
- [ ] Add a repository-wide Godot launcher/CI check (Godot is currently provisioned in `.tools/`, which is gitignored).

## Prompt 2 — ASTrix world and visual identity

- [x] Replace the technical placeholder island with a low-poly/isometric diorama.
- [x] Add distinct pastel grass, dirt, stone, and animated water materials.
- [x] Add gentle terrain elevation and a rocky shoreline silhouette.
- [x] Add readable multi-tier trees, rock clusters, and vegetation tufts.
- [x] Add winding path sections, a starting clearing, river segments, and a wooden bridge.
- [x] Add warm directional lighting, ambient environment, and contact-shadow-friendly rendering.
- [x] Add subtle water movement and tree sway.
- [x] Capture Prompt 2 Xvfb/software-rendered frames at 1280×720 (`/tmp/astrix-qa/prompt200000000.png` and later frame).
- [x] Re-run Godot headless after resolving the unsupported Environment ambient-occlusion property.

### Prompt 2 verification

- Godot 4.7.2 headless editor validation: passed.
- Godot 4.7.2 headless runtime: passed with no script/scene startup errors.
- Xvfb + Mesa llvmpipe runtime: passed; real 1280×720 frames captured.
- Existing API/server was not changed; the scaffold still uses the existing `GameClient`.
- Subjective art quality remains a human visual-review concern; the captured PNGs are available for review.


## Prompt 3 — ASTrix steward-ready living world foundation

- [x] Add three named islands: Meadow, Frost, and Dusk.
- [x] Add stepped voxel-inspired elevation with grass, dirt, stone, snow, sand, and water materials.
- [x] Add purple-teal water presentation, animated water surface, and sparkle-capable water seam.
- [x] Add bridges connecting islands, biome paths, crystals, ice, rocks, trees, and vegetation.
- [x] Add smooth orthographic diorama camera and soft warm directional lighting.
- [x] Add CharacterBody3D player movement with walk/run input, swim presentation, inventory dictionary, and resource interaction hook.
- [x] Add lightweight companion follower placeholder.
- [x] Add typed GameCommandBus mutation boundary and grid-snapped BuildingSystem preview.
- [x] Add WorldState, MCPToolRegistry, AgentConsole, and ApprovalGate scaffolds for the future Steward.
- [x] Preserve browser client, server, engine, TrueForge, MCP/API implementation, and gameplay authority.

### Prompt 3 verification

- Godot 4.7.2 editor parse validation: passed.
- Godot 4.7.2 headless/Xvfb runtime launch: passed.
- No script parse or startup errors after correcting runtime node base types and camera up vector.
- A software-rendered movie frame was captured at 1280×720: `/tmp/astrix-phase1/world.ogv`.
- Visual screenshot inspection remains a human gate; this environment can verify runtime output but cannot judge artistic quality.

## Prompt 3 intentionally deferred to Phase 2

- TrueForge Steward agent loop and autonomous decisions.
- External MCP transport into the Godot command bus.
- Subagent delegation and sandbox Python execution.
- Authoritative server persistence/replication for the new ASTrix world state.
- Production water shader with depth-based shoreline foam and vertex displacement.
- Full voxel GridMap tile library and authored voxel assets.
- Complete mobile touch UI, combat, farming progression, NPCs, quests, buildings UX, and multiplayer presentation.

## Phase 2 — parallel ASTrix server + Godot sync

- [x] Commit the existing ASTrix foundation on `feat/astrix-world` (`3c65a6b`).
- [x] Add authoritative server-side ASTrix state and command bus under `src/astrix/`.
- [x] Add parallel `/astrix/state`, `/astrix/command`, `/astrix/mcp/tools/list`, `/astrix/mcp/tools/call`, and `/astrix/events` routes.
- [x] Add `/astrix/approval/respond` and server-side approval resolution.
- [x] Wire Godot command requests and authoritative state polling to `/astrix/*`.
- [x] Validate ASTrix state, command, MCP listing/call, and legacy route preservation on a local server.
- [x] Add `scripts/provision-astrix-agents.ts` using the existing TrueForge provisioning function.
- [x] Inspect the live TrueForge MCP-server listing; existing connector is `gronks-hoard-mcp` at `http://localhost:8787/mcp`.
- [x] Update provisioning to register/reference a separate `astrix` connector using the existing TrueForge API pattern.
- [ ] Complete live connector registration: current TrueForge host returns HTTP 409 for the existing connector registration attempt and still rejects ASTrix agent manifests until `astrix` is configured.
- [ ] Provision ASTrix agents and run a live steward turn after the connector is configured.
- [x] Godot 4.7.2 editor parse validation after ASTrix sync changes.
- [x] Godot 4.7.2 Xvfb/software runtime launch and 1280×720 capture (`/tmp/astrix-phase2/world.ogv`).

## Phase 2.5 — Godot HTML5 export + browser deployment

- [x] Install the Godot 4.7.2 Web export template (`~/.local/share/godot/export_templates/4.7.2.stable/`).
- [x] Add the Web export preset in `godot/export_presets.cfg` (export_path `../server/static/index.html`, canvas_resize_policy=2, threads off).
- [x] Export ASTrix to `server/static/` (`index.html`, `index.js`, `index.wasm`, `index.pck`).
- [x] Serve `server/static/` at the server root (preferred over the old Vite `dist/`) with correct MIME types: `.wasm → application/wasm`, `.pck → application/octet-stream`, `.ogg → audio/ogg`.
- [x] API routes (`/astrix/*`, `/api/*`, `/mcp`) run before static serving so nothing is shadowed.
- [x] Godot client resolves its API origin from `window.location.origin` in browser builds (native keeps `127.0.0.1:8787`).
- [x] Verified live: `GET /` serves the Godot index.html, `.wasm`/`.pck` MIME headers correct, `/astrix/state` 200, legacy `/api/*` intact, old Vite assets no longer served.
- [x] Playwright/Chromium browser check: ASTrix boots with zero console errors and renders the 3D world (see `scripts/capture-web.ts`).

### Rendering/startup bugs fixed during export validation

- [x] `World3D.gd` `_add_island_slabs()` and `_build_paths()` created terrain meshes but never added them to the scene tree — the islands, paths and water were invisible in every build. Added the missing `add_child()` calls.
- [x] `WorldState.gd` `apply_snapshot()` assigned an untyped JSON `Array` to `Array[Dictionary]`, crashing at runtime in the exported build. Rebuild the typed array explicitly.
- [x] `window/stretch/mode="canvas_items"` produced a transparent/empty 3D viewport; set to `disabled` (correct for a 3D game; HUD CanvasLayers still scale).
- [x] Removed the duplicate `WorldEnvironment` from `scenes/Main.tscn` so `World3D._build_environment()`'s lighting (ambient + background) actually applies.
- [x] Headless `--export-release` produced a corrupt pck (`project.binary` size 0); export via the GUI editor under Xvfb produces a valid pck.

## Phase 2.6 — HTTPS deployment via Caddy + DuckDNS

- [x] Install Caddy v2.11.4 via official apt repo.
- [x] DuckDNS: `astrixx.duckdns.org` updated → `A 44.197.181.77` (replaces stale `172.105.83.142` entry).
- [x] Caddy reverse proxy: `https://astrixx.duckdns.org` → `http://127.0.0.1:8787`.
- [x] HTTP → HTTPS redirect (308) working; Let's Encrypt cert issued (CN=astrixx.duckdns.org, valid 90 days, auto-renews).
- [x] App rebind: added `HOST` env in `src/server/index.ts`; pm2 `gronks-hoard` now binds `127.0.0.1:8787` only.
- [x] Public `44.197.181.77:8787` refused (no longer exposed).
- [x] All API routes, `.wasm`, `.pck` MIME served correctly through the proxy.
- [x] Browser acceptance: Chromium → `https://astrixx.duckdns.org` → `window.isSecureContext === true` → game boots + renders, zero console errors.

Caddy config: `/etc/caddy/Caddyfile` (see deployment report). Backup at `/etc/caddy/Caddyfile.bak`.

## Milestone — first playable mobile build

- [x] Fix massive overexposure: toned sun to `light_energy 0.5`, ambient `0.5` with `TONE_MAPPER_FILMIC` + `tonemap_exposure 0.78`, removed duplicate Environment in `Main.tscn`. Verified via render frames (blowout dropped from ~9.6% to ~0.4–1%).
- [x] Make water readable: raised to a clearly-teal, near-opaque surface (`Color("53c0cd")`, alpha 0.98) with gentle vertex bob, distinct from the meadow/foam so the shoreline transition reads.
- [x] Fix terrain misalignment root cause: every ground prop/path/bridge now aligns to a computed `_surface_of(biome)` walkable height instead of hardcoded Y, so nothing floats or is buried.
- [x] Tighten camera: isometric ortho with constant offset, fixed non-rolling yaw, smooth-follow, and look-ahead so the player stays prominent and the clearing→path→shoreline→bridge→magic-landmark composition fits one frame on mobile.
- [x] Build a curated starting clearing (hut, signpost, lantern, bench, crate, trees, rocks, shrubs, dirt path, shoreline, bridge, magic landmark) that guides the player.
- [x] Collision pass: `StaticBody3D` floor per biome (player rests/froze correctly) plus obstacle collisions on trees, rocks, hut, bench, crate, signpost, lantern.
- [x] Player: procedural idle/walk/run animation, facing direction, contact shadow, swim presentation, small scale bump, zero-input→idle / input→walk / full-input→run.
- [x] Mobile controls: virtual joystick (lower-left) + action/interact button (lower-right) in `MobileHUD.gd`, feeding the unified `AstrixInput` autoload; keyboard (WASD/arrows + E) still works through the same InputMap.
- [x] Minimal HUD: ASTRIX label + top area; joystick + action button; pastel miniature styling; no permanent crosshair.
- [x] Re-exported Godot Web (GUI/Xvfb) to `server/static/`; main scene + exported pck boot with zero script errors.
- [x] Mobile-sized Chromium acceptance (390×844, touch): `isSecureContext true`, zero console errors, joystick drag produced a changed frame (player moves), world readable, no overexposure.
- [x] Regression: typecheck passes, 80/80 tests pass.

### Mobile build notes / limitations
- Portrait framing leaves sky at the top of the frame (acceptable exploration framing; player stays in the lower 2/3).
- Collision uses simple boxes (walk-in-space prevention), not bespoke per-mesh hulls.
- Actual game logic authority remains the ASTrix server; Godot collision is presentation-only.
- Gronk is not yet a separate chaser in this Godot build — recast as the companion follow placeholder pending the agent/Gronk scope.

## Milestone — mobile-first gameplay camera + visible touch controls

Real Android tablet testing (post-HTTPs deploy) showed the build was a *viewer*, not a *game*: the camera was near-vertical (dev/bird's-eye), the player was a tiny speck, and no controls were visible in the shipped build.

- [x] Gameplay camera: retargeted to a deliberate low-pitch isometric (~32deg from horizontal) with constant offset + non-rolling yaw + smooth follow + look-ahead. Reveals object sides/cliff faces/bridge elevation (true 2.5D depth) instead of a top-down view.
- [x] Player-anchored framing: portrait/tall viewports get a smaller ortho size (more zoom) so the player is a clear anchor; fixed the reversed framing logic; re-frame on `size_changed` for tablet rotation. Player is prominent in both portrait and landscape.
- [x] Visible touch controls: rewrote `MobileHUD.gd` with a large high-contrast virtual joystick (dark base + bright ring + teal thumb) and a gold action button, safe-margin positioned (no longer off-edge), plus ASTRIX label and pause button.
- [x] Fixed the REAL reason controls were invisible: `class_name Circle` was declared inside `MobileHUD.gd` (invalid in GDScript 4.7 → the whole HUD script failed to load in the exported build with "Unexpected class_name in class body"). Moved to standalone `godot/scripts/Circle.gd` (also fixed a 3-arg `minf` misuse) and wired it by `preload`.
- [x] Unified input: joystick + action button feed the same `AstrixInput` abstraction as WASD/arrows + E; desktop keyboard unchanged.
- [x] Touch drag moves the player: Playwright/CDP emulated a 390x844 touch joystick drag against the public HTTPS URL; before/after frames show the player moving and the camera following, zero console errors.
- [x] Both viewports verified: 390x844 portrait and 1280x720 desktop render the world + all controls with zero console errors; export boots clean.
- [x] Regression: typecheck passes, 80/80 tests pass.

### Mobile-first milestone notes / limitations
- Headless Playwright cannot reproduce exact Android hardware+multi-touch behavior; the CDP-emulated drag validates the input path but true device feel needs a real-device pass.
- Title top area / camera look-ahead leave some sky at the top in portrait (acceptable exploration framing).
- Action button currently triggers `AstrixInput.request_interact()` (interact action); contextual hide prompt is a follow-up.

## Milestone — reference-driven visual pass (video + still art direction)

Applied from the user's reference clip (pastel voxel island: pale warm vista → saturated violet world → soft purple) and two stills (bright teal+orange daylight, dark violet/magenta night), extracted with an OpenCV-based analyzer (`.cv/` venv + `cv_analyze.py`).

- [x] Water: opaque light teal → saturated violet-lavender translucent (`#6b5bb8`, alpha 0.85, soft sheen + gentle motion) matching the reference's signature purple water.
- [x] Terrain palette: bright green/teal → pale parchment-lavender biomes (`#c8bfa6` meadow, `#c2c8d4` frost, `#c9ad92` dusk) with warm accents; shoreline sand, islet, bridge and magic landmark retinted warm-tan + violet accent.
- [x] Sky/lighting: flat bright sky → soft procedural gradient (pale warm blue-violet top, warm horizon) with a 90s day↔dusk cycle (violet/magenta at dusk, dimmer ambient + warm-violet sun).
- [x] Fix overexposure root cause: the old build blew the whole frame to near-white (82% near-white pixels). Fixed by shrinking the procedural sun disc (40° → 8°), dimming sky colors, lowering ambient 0.45→0.35 and tonemap exposure 0.62→0.5. Verified via render: near-white dropped to ~7–10%, day avg RGB (202,175,154) warm pale, dusk avg RGB (108,69,106) violet.
- [x] Re-exported Godot Web build to `server/static/` and re-injected the reference-upload widget (multi-file, image+video) into the exported loader page; verified live: widget present on `https://astrixx.duckdns.org/`, `.wasm` served as `application/wasm`, `.pck` as `application/octet-stream`.
- [x] Regression: typecheck passes, 80/80 tests pass.

### Visual pass notes / limitations
- Cycle verification done with a temporary 4s cycle (movie-maker capture advances game-time by rendered frames, ~2fps on llvmpipe, so a 90s cycle needs ~45 min of capture); restored to 90s after confirming the lerp.
- Still needs-authored assets to fully match references: detailed structures, realistic foliage, red-roofed buildings, polished props (GLB/CC0 packs).

## Guardrails

- The existing TypeScript browser client remains the reference client and must not be modified for ASTrix work.
- Godot presentation code must not invent authoritative gameplay state.
- Do not add physics colliders that imply rules not enforced by the existing server.
- Keep future world systems modular under `godot/scripts/` and `godot/scenes/`.
