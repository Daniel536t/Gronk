# ASTrix Asset Pipeline

ASTrix is a stylized 2.5D / isometric adventure world built in Godot 4.
This document defines how authored (GLB) assets integrate alongside the
procedural fallbacks so the game is never blocked art-wise. **No asset is
required to run the game** — every category has a procedural placeholder that
looks intentional. Authoring (GLB) assets is an *upgrade* layer, not a gate.

## Formats & conventions

- **3D models:** GLB (binary glTF 2.0). Godot imports `.glb`/`.gltf` natively;
  no FBX/OBJ needed. Keep bones/animations inside the GLB.
- **Where models live:** `godot/assets/<category>/` (see layout below).
- **Wrapper scenes:** drop a GLB under the matching category, open Godot, and
  the importer produces a scene. Reference that scene from the wrapper node in
  `godot/scenes/<category>/`.
- **Materials:** `godot/assets/materials/` for shared `StandardMaterial3D`
  resources (the palette lives here so all assets share one art direction).

### Asset layout

```
godot/assets/
  characters/   player hooded-adventurer, Gronk, companion fox
  environment/  trees, rocks, bridges, buildings (house/barn), props
  props/        lanterns, signs, crates, barrels, benches, wells
  terrain/      terrain chunks, path tiles, shoreline, elevation pieces
  materials/    shared pastel materials (palette)
```

### Category ownership

| Category | Wrapper scene | Procedural fallback | GLB upgrade |
|---|---|---|---|
| Player | `scenes/characters/Player3D` | procedural silhouette in `Player3D.gd` | rigged hooded adventurer, idle/walk/run/interact/hide/emerge/stun |
| Gronk | `scenes/characters/Gronk` | procedural creature | rigged creature, same anim set |
| Trees | `scenes/environment/Tree` | tiered cones in `World3D.gd` | low-poly tree, 2–3 variants |
| Rocks | `scenes/environment/Rock` | prism cluster in `World3D.gd` | round rock, 2–3 variants |
| Bridge | `scenes/environment/Bridge` | planks+rails in `World3D.gd` | wooden bridge w/ collision |
| Buildings | `scenes/environment/Building` | hut in `World3D.gd` | cozy hut/barn |
| Props | `scenes/props/` per prop | box/cone props | lantern, sign, well, crates, barrels |

### Scale & orientation convention (CRITICAL)

- **Up = +Y.** Models must face **+Z** (toward the camera's forward) when idle.
- **1.0 unit = 1 metre-ish** gameplay scale. ASTrix player target height is
  **~2.0 units** (capsule radius 0.58, hood to ~2.6). Everything else scales
  relative to that so proportions match the handcrafted-miniature look.
- **GLB root pivot** must sit at the character's **feet** (y = 0 on the ground),
  so positioning on terrain never requires magic offsets.
- Trees/rocks: pivot at **ground contact** (y = 0 at the base center).
- Buildings/props: pivot at **floor center**, y = 0.

### Required skeleton animation names (Player & Gronk)

```
idle, walk, run, interact, hide, emerge, stun
```

The presentation layer (`Player3D.gd`) already exposes a `play_state(state)`
interface that maps these names to procedural motion, **and** to playback of a
matching animation if a rigged GLB supplies them. Adding a rig swaps the visual
without touching `GameClient`, `WorldState`, or the server.

## What to author first (by priority)

1. **Player** hooded adventurer (idle/walk/run) — the visual anchor.
2. **Gronk** creature (idle/chase/stun) — the antagonist.
3. **Trees** (2 variants) + **Rocks** (2 variants) — terrain dressing.
4. **Bridge** + **House/Hut** — structural landmarks.
5. **Props**: lantern, signpost, well, crates, barrels, bench.
6. **Terrain**: edge/chunk pieces that snap to the existing island slabs.

Keep every asset **pastel, low-poly, chunky-silhouette, warm-sun** — no
photorealism, no Minecraft noise texture. All assets must read as one game.