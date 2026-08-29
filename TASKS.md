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

## Guardrails

- The existing TypeScript browser client remains the reference client and must not be modified for ASTrix work.
- Godot presentation code must not invent authoritative gameplay state.
- Do not add physics colliders that imply rules not enforced by the existing server.
- Keep future world systems modular under `godot/scripts/` and `godot/scenes/`.
