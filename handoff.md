# Handoff — Gronk's Hoard (current state)

> Read this first when picking up the project: what's on disk, what's in
> flight, what was just done, and exactly what to do next. Last updated:
> **August 28, 2026** (session where the visual transformation pass was
> implemented but not yet committed).

## 1. Repository facts

- Repo: `Daniel536t/Gronk` (GitHub, public). Local clone at `~/ba`.
- Branch: `main` at **`83bcccf`** ("Phase 6B: align game UI and HUD with design
  system (#14)").
- Live deployment: pm2 on the VPS — game `:8787`, TrueForge harness `:8790`.
  Both confirmed online in the previous session; game returns HTTP 200.
- Working tree: **3 modified files + 1 untracked** (see below).

## 2. What was JUST done (this session — UNCOMMITTED)

A **visual transformation pass** was implemented per `VISUAL_TRANSFORMATION_PLAN.md`
(created in the prior step), targeting the brief: "make it visibly read as a
polished stylized 2.5D fantasy stealth/adventure game, not flat Canvas
primitives." Scope: characters, Gronk, furniture/environment, lighting/depth
only. **No engine/server/API/networking/TrueForge changes.**

Modified files (all pure presentation):

- `src/client/character.ts`
  - Dark silhouette outlines on every part (cloak, hem, belt, arms, boots, hood).
  - Form shading: warm-west / cool-east gradient re-fill over cloak + hood
    (path re-fill trick), cloth drape folds, boot top highlights.
  - Warm rim light on the west edge of cloak + hood (intensifies while
    carrying); gold rim around the face opening so eyes pop.
  - Carried treasure now casts a warm gold ground pool.
- `src/client/render.ts`
  - **Gronk:** horns + tusks (creature silhouette), dark body/head outlines,
    warm/cool form shading, belly wrinkles + lit highlight, brow highlight,
    grounded two-layer contact shadow. Preserved nose-flare, stomp, chase
    lean, catch lunge, enrage.
  - **Global light:** new `drawGlobalLight()` — world-anchored warm key pool
    from the upper-left + cool falloff toward the lower-right, drawn right
    after the room floors (one coherent light as the camera moves).
  - **Room tint strengthened** (wash 0.10→0.14, ambient glow 0.10→0.12).
  - **Vignette deepened** (edge 0.45→0.55) + subtle screen-space warm key
    hint from the upper-left.
  - `faceShade()` applied per object in the back pass.
- `src/client/objects.ts`
  - Contact shadows: every furniture `shadow()` now three stacked ellipses
    (soft → mid → tight dark core), offset lower-right (consistent with the
    upper-left light).
  - New exported `faceShade(ctx, x, y, w, h)`: clipped warm-light-west /
    cool-shadow-east gradient + lit west-edge highlight.
- `VISUAL_TRANSFORMATION_PLAN.md` — the plan doc (untracked).

## 3. Verification results (this session)

- `npm run typecheck` ✅ (both tsconfigs)
- `npm test` ✅ **64/64**
- `npm run build` ✅
- `npm run qa:visual` ✅ for all rendering/UI checks across 5 runs; long
  desktop gameplay fixtures flake intermittently (Gronk interference —
  **verified pre-existing**: stashed the changes, ran clean `main` → same
  failure class, 118/120).
- Before/after screenshots: `qa/screenshots-before/` + `qa/screenshots-after/`
  (28 shots each; 25 freshly recaptured). Pixel audit: 3–15% pixels changed,
  cold% down everywhere (warm light shift), dark% up slightly (deeper vignette
  + contact shadows). `desktop-stunned`, `desktop-group`, `p6b-modal` are
  stale captures (best-effort / unaffected) — noted in the report.

## 4. What to do NEXT (in order)

1. **Commit the visual pass on a branch and Qodo-review it** (the established
   workflow). Suggested branch name: `visual-transformation-pass`. Include
   `VISUAL_TRANSFORMATION_PLAN.md` in the PR. Do NOT include the
   `qa/screenshots-before|after/` dirs (analysis artifacts; `qa/` is
   gitignored anyway — verify).
2. **Fix any genuine Qodo findings; count every finding before merging**
   (see memory.md rule #4).
3. **Merge, deploy:** `git pull && npm install && npm run build && pm2 restart
   gronks-hoard` on the VPS; confirm HTTP 200 on `:8787`.
4. **Human visual gate:** the pixel audit proves the changes render — it does
   not prove they look good. Ask the human to play the live build and check:
   character outline weight at gameplay zoom, Gronk's horns/tusks proportions,
   rim-light intensity, room-tint strength, gold-pool subtlety. Tune from
   feedback (constants are the `RIM_*`/`OUTLINE_*` values in character.ts, the
   `drawGlobalLight` alphas and `rgba(room.tint, 0.14)` in render.ts, the
   `faceShade`/`shadow` alphas in objects.ts).
5. **Update this handoff + README Qodo evidence** after the PR merges.

## 5. Things deliberately NOT done (scope boundary honored)

- No Phase 6 UI work, no new gameplay, no HUD changes, no engine/server/API/
  network/TrueForge changes, no asset pipeline, no renderer replacement.
- The next planned phase after this pass is Phase 6 (UI/HUD per DESIGN.md) —
  or TrueForge analyst/commentator work if the demo needs it.

## 6. Quick reference (where things live)

| Need | Go to |
|---|---|
| Game rules / product | `prd.md`, `skills/gronks-hoard/SKILL.md` |
| How it fits together | `architecture.md` |
| Roadmap / phase history | `project-plan.md` |
| Gotchas / lessons | `memory.md` |
| Visual source of truth | `DESIGN.md` |
| Deployment + Qodo evidence | `README.md` |
| Run everything | `npm run prod` · `npm test` · `npm run typecheck` · `npm run build` · `npm run qa:visual` · `npm run verify:mode-a` |
| Live boxes | game `:8787`, TrueForge `:8790` (pm2: `gronks-hoard`, `trueforge-harness`) |
