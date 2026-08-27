// Canvas 2D renderer. Flat cartoon look drawn on our existing 2D x,y plane
// (no engine changes). Characters are original hooded fantasy adventurers
// (cloak + pointed hood with glowing eyes + boots + star-tipped wand — see
// character.ts), Gronk is a hulking red troll, furniture is chunky rounded
// props, and the world is a dark-fantasy interior: gradient floors with
// per-room patterns, depth-edged walls, soft lighting pools, and a subtle
// vignette.
//
// Projection: a game camera follows the local player. The view is zoomed so
// ~VIEW_VERTICAL_UNITS world units fill the viewport height (a readable player
// scale), the camera is exponentially smoothed toward the player with a small
// movement lookahead, and it clamps to the world bounds so nothing outside the
// map is ever shown. When the window is too small for that zoom we fall back to
// fitting the whole 100x60 world (the old letterbox behavior). All drawing
// happens in WORLD units on top of the camera transform so nothing depends on
// window size. Positions are exponentially smoothed toward the latest 10Hz poll
// (see step()); teleports (respawn, transform snap) jump instantly.
import type { GameState, Player } from "../engine/types";
import { ROOM_WIDTH, ROOM_HEIGHT, TICKS_PER_SECOND, TRANSFORM_RANGE } from "../engine/constants";
import {
  drawRoomProps,
  drawVisualObject,
  drawVisualObjectFront,
  isCoverKind,
  visualObjectsFor,
  type VisualLayer,
  type VisualObject,
} from "./objects";
import { drawCharacter, type CharacterRenderInfo, type Facing } from "./character";

const TEAM_COLORS = ["#4aa8e8", "#f2765b"]; // blue / coral — Among-Us-esque
const TEAM_DARK = ["#2f6fa3", "#b34a34"];
const SNAP_DIST = 8; // world units — bigger = teleport, not glide
const LERP_K = 14; // exponential smoothing constant (dt-based)

// Phase 4 hide animation: how long entering/exiting a hiding object takes.
// Purely visual — the server state is authoritative and changes instantly;
// this only makes the transition read as physical (slide in, cover fades).
const HIDE_ANIM_MS = 300;

// Where a character steps out of the furniture, relative to their facing.
const EXIT_OFFSET: Record<Facing, { x: number; y: number }> = {
  up: { x: 0, y: -0.8 },
  down: { x: 0, y: 0.8 },
  left: { x: -0.8, y: 0 },
  right: { x: 0.8, y: 0 },
};

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
const smoothstep = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// Each seat (wizard-0..3) gets its own adventurer color, independent of team.
// Order follows the design spec: Player 1 cyan, Player 2 coral, Player 3
// green, Player 4 purple. Team identity stays readable via the floor pip and
// the dark secondary material (trim/boots).
const SEAT_COLORS = ["#4aa8e8", "#f2765b", "#8ee36b", "#e072f0"]; // cyan, coral, leaf, bloom
const SEAT_DARK = ["#2f6fa3", "#b04b36", "#5ba83f", "#a843bd"];

// ---- camera --------------------------------------------------------------
const VIEW_VERTICAL_UNITS = 36; // zoom: this many world units fill the viewport height
const CAM_SMOOTH = 7; // exponential follow rate (1/s): k = 1 - exp(-dt * CAM_SMOOTH)
const CAM_SNAP_DIST = 60; // bigger = teleport (match start, respawn)
const CAM_LOOKAHEAD = 3; // world units of lead-in toward the movement direction

// Cosmetic, client-side "rooms" painted on the floor. The engine only knows one
// open 100x60 plane — these zones are visual theming that group the fixed
// furniture clusters. Purely decorative; never lets the engine's secret leak.
// `kind` selects the floor pattern (tile / plank / panel / slab), `tint` drives
// the room's ambient light color, `accent` colors the floor label.
const ROOMS: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  kind: "tile" | "plank" | "panel" | "slab";
  tint: string;
  accent: string;
}[] = [
  { x: 4, y: 4, w: 92, h: 22, label: "CAFETERIA", kind: "tile", tint: "#ffd9a0", accent: "#ffd166" }, // top: fridge/barrel/chest/armory
  { x: 14, y: 28, w: 72, h: 14, label: "LIBRARY", kind: "plank", tint: "#9fd8ff", accent: "#4fc3f7" }, // center: bookshelf/couch/tapestry
  { x: 4, y: 42, w: 46, h: 14, label: "REACTOR", kind: "panel", tint: "#ff9d7a", accent: "#ff7b72" }, // bottom-left: brazier/statue
  { x: 52, y: 42, w: 44, h: 14, label: "STORAGE", kind: "slab", tint: "#8ee36b", accent: "#8ee36b" }, // bottom-right: cauldron
];

// Ambient decor, purely cosmetic: floor vents, floor hatches, wall-mounted
// pipes, poster decals, and flickering ceiling lights with floor glow pools.
// Positions avoid furniture, pedestals, and closets (see engine layout).
const DECOR = {
  vents: [
    { x: 62, y: 8 },
    { x: 12, y: 8 },
    { x: 30, y: 38 },
    { x: 66, y: 38 },
    { x: 9, y: 44 },
    { x: 91, y: 44 },
    { x: 55, y: 13 },
  ],
  hatches: [
    { x: 38, y: 14 },
    { x: 62, y: 38 },
    { x: 30, y: 50 },
  ],
  pipes: [
    { x1: 30, y1: 6.5, x2: 88, y2: 6.5 }, // top run
    { x1: 8, y1: 54.5, x2: 92, y2: 54.5 }, // bottom run
    { x1: 6.5, y1: 8, x2: 6.5, y2: 50 }, // left riser
    { x1: 93.5, y1: 8, x2: 93.5, y2: 50 }, // right riser
  ],
  posters: [
    { x: 24, y: 1.4, c: "#4fc3f7" },
    { x: 54, y: 1.4, c: "#ffd166" },
    { x: 84, y: 1.4, c: "#8ee36b" },
    { x: 18, y: 25, c: "#ff7b72" },
    { x: 82, y: 25, c: "#e072f0" },
    { x: 50, y: 46, c: "#4fc3f7" },
  ],
  lights: [
    { x: 14, y: 4.8, phase: 0.2, tint: "#ffd9a0" },
    { x: 40, y: 4.8, phase: 1.1, tint: "#ffd9a0" },
    { x: 66, y: 4.8, phase: 2.3, tint: "#ffd9a0" },
    { x: 88, y: 4.8, phase: 3.4, tint: "#ffd9a0" },
    { x: 30, y: 28.8, phase: 0.7, tint: "#9fd8ff" },
    { x: 60, y: 28.8, phase: 1.9, tint: "#9fd8ff" },
    { x: 14, y: 42.8, phase: 2.8, tint: "#ff9d7a" },
    { x: 36, y: 42.8, phase: 0.4, tint: "#ff9d7a" },
    { x: 66, y: 42.8, phase: 1.6, tint: "#8ee36b" },
    { x: 88, y: 42.8, phase: 2.9, tint: "#8ee36b" },
  ],
};

// Client-side hiding transition (enter/exit a furniture object). The engine
// snaps the player to the object center instantly; this animates the visual
// slide + cover fade so hiding feels physical. Authoritative state wins — the
// anim only affects how the character is drawn.
interface HideAnim {
  id: string; // player id (for QA hooks)
  phase: "enter" | "exit";
  start: number; // rAF timestamp (ms)
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  furnitureId: string;
  // Updated every frame by advanceHideAnim:
  t: number; // 0..1 progress
  cover: number; // this anim's contribution to the object's cover alpha
  drawX: number;
  drawY: number;
  scaleMul: number;
  alphaMul: number;
  done: boolean;
}

// World->screen projection via a camera transform, recomputed every frame. All
// drawing is in world units through this transform; DPR, window size, and the
// camera only affect scale/offset.
export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private smooth = new Map<string, { x: number; y: number }>();
  private scale = 1; // px per world unit
  private ox = 0; // screen offset of world (0,0), css px
  private oy = 0;
  private camX = ROOM_WIDTH / 2;
  private camY = ROOM_HEIGHT / 2;
  private lastInputDir = { x: 0, y: 0 };
  private lastCanMove = true;
  private lastPlayerPos: { x: number; y: number } | null = null;
  // Per-player walk cycle + facing (driven by movement vectors, not engine).
  private charPhase = new Map<string, number>();
  private charFace = new Map<string, Facing>();
  private charInfos: CharacterRenderInfo[] = [];
  // ---- Phase 4 hide animation state (client-side, presentation only) ------
  private hideAnims = new Map<string, HideAnim>();
  private prevState = new Map<string, Player["state"]>();
  private prevDrawn = new Map<string, { x: number; y: number }>();
  private prevTransAs = new Map<string, string | null>();
  private lastCoverMap = new Map<string, number>();
  private lastObjects: VisualObject[] = [];
  private interactTarget: { id: string; x: number; y: number } | null = null;
  private isTouchDevice =
    typeof window !== "undefined" &&
    ("ontouchstart" in window || navigator.maxTouchPoints > 0);

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", () => this.resize());
    // Debug/QA hook: exposes camera state so automated visual tests can assert
    // framing. Read-only; not used by gameplay.
    (window as unknown as { __ghCam?: () => { x: number; y: number; scale: number } }).__ghCam = () => ({
      x: this.camX,
      y: this.camY,
      scale: this.scale,
    });
    // Debug/QA hook: per-character render info for the previous frame.
    (window as unknown as { __ghChars?: () => CharacterRenderInfo[] }).__ghChars = () =>
      this.charInfos;
    // Phase 4 QA hooks (read-only, not gameplay): the currently highlighted
    // hide object, live hide animations, and per-object cover alpha.
    (window as unknown as {
      __ghInteract?: () => { id: string; x: number; y: number } | null;
      __ghHide?: () => HideAnim[];
      __ghCover?: (fid: string) => number;
    }).__ghInteract = () => this.interactTarget;
    (window as unknown as { __ghHide?: () => HideAnim[] }).__ghHide = () =>
      Array.from(this.hideAnims.values());
    (window as unknown as { __ghCover?: (fid: string) => number }).__ghCover = (fid) =>
      this.lastCoverMap.get(fid) ?? 0;
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Match the CSS box exactly so the backing store == displayed pixels.
    this.canvas.style.width = `${vw}px`;
    this.canvas.style.height = `${vh}px`;
    this.canvas.width = Math.floor(vw * dpr);
    this.canvas.height = Math.floor(vh * dpr);

    // Zoom: keep ~VIEW_VERTICAL_UNITS world units on screen vertically so the
    // player stays readable, but never zoom past "whole world fits" (small
    // windows fall back to the old letterbox framing).
    const fitScale = Math.min(vw / ROOM_WIDTH, vh / ROOM_HEIGHT);
    const zoomScale = vh / VIEW_VERTICAL_UNITS;
    this.scale = Math.max(fitScale, zoomScale);
    this.clampCamera();
  }

  // Keep the camera inside the world. When the whole world fits in the view,
  // pin the camera to the world center (no panning at all).
  private clampCamera(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const viewW = vw / this.scale;
    const viewH = vh / this.scale;
    if (viewW >= ROOM_WIDTH) {
      this.camX = ROOM_WIDTH / 2;
    } else {
      this.camX = Math.min(ROOM_WIDTH - viewW / 2, Math.max(viewW / 2, this.camX));
    }
    if (viewH >= ROOM_HEIGHT) {
      this.camY = ROOM_HEIGHT / 2;
    } else {
      this.camY = Math.min(ROOM_HEIGHT - viewH / 2, Math.max(viewH / 2, this.camY));
    }
    this.ox = vw / 2 - this.camX * this.scale;
    this.oy = vh / 2 - this.camY * this.scale;
  }

  // Follow the local player: exponential smoothing toward (player + small
  // lookahead), snap on teleports, clamp to world bounds.
  private updateCamera(dt: number): void {
    let tx: number;
    let ty: number;
    if (this.myPlayerId && (this.localOverride || this.lastPlayerPos)) {
      const p = this.localOverride ?? this.lastPlayerPos!;
      tx = p.x + this.lastInputDir.x * CAM_LOOKAHEAD;
      ty = p.y + this.lastInputDir.y * CAM_LOOKAHEAD;
    } else {
      tx = ROOM_WIDTH / 2;
      ty = ROOM_HEIGHT / 2;
    }
    const dx = tx - this.camX;
    const dy = ty - this.camY;
    const d = Math.hypot(dx, dy);
    if (d > CAM_SNAP_DIST) {
      this.camX = tx;
      this.camY = ty;
    } else {
      const k = 1 - Math.exp(-dt * CAM_SMOOTH);
      this.camX += dx * k;
      this.camY += dy * k;
    }
    this.clampCamera();
  }

  // Build the DPR-correct transform: cssPx -> backing pixels via dpr, then world
  // -> cssPx via (scale, ox, oy).
  private setProjection(): void {
    const dpr = window.devicePixelRatio || 1;
    this.ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, dpr * this.ox, dpr * this.oy);
  }

  clear(): void {
    const dpr = window.devicePixelRatio || 1;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Deep space behind the whole viewport.
    ctx.fillStyle = "#05070d";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // Faint static stars — only visible in the margins when the whole map fits
    // (zoomed camera views are fully covered by the world).
    ctx.fillStyle = "#c8d8f2";
    for (let i = 0; i < 110; i++) {
      const x = (((i * 73) % 211) / 211) * this.canvas.width;
      const y = (((i * 151) % 179) / 179) * this.canvas.height;
      ctx.globalAlpha = 0.04 + (i % 5) * 0.035;
      ctx.beginPath();
      ctx.arc(x, y, 0.6 + (i % 3) * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, dpr * this.ox, dpr * this.oy);
  }

  /** Exponential smoothing toward the latest polled target. */
  private step(id: string, tx: number, ty: number, dt: number): { x: number; y: number } {
    let cur = this.smooth.get(id);
    if (!cur) {
      cur = { x: tx, y: ty };
      this.smooth.set(id, cur);
      return cur;
    }
    const dx = tx - cur.x;
    const dy = ty - cur.y;
    const d = Math.hypot(dx, dy);
    if (d > SNAP_DIST) {
      cur.x = tx;
      cur.y = ty; // teleport: respawn, transform snap, match start
    } else {
      const t = Math.min(1, dt * LERP_K);
      cur.x += dx * t;
      cur.y += dy * t;
    }
    return cur;
  }

  draw(state: GameState, dt: number, timeMs: number): void {
    this.updateCamera(dt);
    this.clear();
    const ctx = this.ctx;
    const lw = 0.5; // world-unit line width

    this.drawFloorBase(ctx);
    this.drawRoomFloors(ctx);
    this.drawDust(ctx, timeMs);
    this.drawInteriorWalls(ctx);
    this.drawOuterWalls(ctx);
    this.drawDecor(ctx, timeMs);
    drawRoomProps(ctx, timeMs);

    // Sudden-death treasure pings: expanding rings.
    for (const ping of state.treasurePings) {
      const age = (state.tick - ping.tick) / TICKS_PER_SECOND;
      if (age > 3) continue;
      ctx.beginPath();
      ctx.arc(ping.x, ping.y, 1 + age * 3, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 209, 102, ${0.7 * (1 - age / 3)})`;
      ctx.lineWidth = 0.35 * lw;
      ctx.stroke();
    }

    // Dropped treasure on the ground.
    if (state.groundTreasure) {
      const bob = Math.sin(timeMs / 150) * 0.4;
      this.drawDiamond(ctx, state.groundTreasure.x, state.groundTreasure.y + bob, 1.6, "#ffd166");
    }

    // Objects: computed once per frame (covers + back/front passes share it).
    const objs = visualObjectsFor(state);
    this.lastObjects = objs;

    // Furniture split into back/front passes around the players. The back pass
    // paints every object's full body (empty objects look identical to before);
    // the front pass re-paints cover objects' front geometry only when a player
    // is hidden inside, occluding them between the two passes.
    this.drawObjects(ctx, objs, timeMs, "back");

    // Pedestals: team-colored glow platform at the corners.
    state.pedestals.forEach((ped, team) => this.drawPedestal(ctx, ped.x, ped.y, team));

    // Players: smoothed hooded adventurers. My own wizard is rendered at the
    // locally predicted position (see setLocalPrediction) so it moves at 60fps
    // instead of the choppy 10Hz poll rate. Enter/exit of hiding objects runs a
    // short client-side slide + cover fade (authoritative state snaps instantly;
    // this only makes the transition read as physical).
    this.charInfos = [];
    for (const p of state.players) {
      const pos = this.step(p.id, p.x, p.y, dt);
      let dx = pos.x;
      let dy = pos.y;
      if (p.id === this.myPlayerId) {
        this.lastPlayerPos = { x: pos.x, y: pos.y };
        if (this.localOverride != null) {
          dx = this.localOverride.x;
          dy = this.localOverride.y;
        }
      }

      // Detect hide enter/exit transitions against the previous frame.
      const was = this.prevState.get(p.id);
      if (was !== p.state) {
        this.beginHideAnim(p, was, pos, state, timeMs);
      }

      let scaleMul = 1;
      let alphaMul = 1;
      const anim = this.hideAnims.get(p.id);
      if (anim && !anim.done) {
        this.advanceHideAnim(anim, timeMs);
        dx = anim.drawX;
        dy = anim.drawY;
        scaleMul = anim.scaleMul;
        alphaMul = anim.alphaMul;
      } else if (anim?.done) {
        this.hideAnims.delete(p.id);
      }

      this.prevDrawn.set(p.id, { x: dx, y: dy });
      this.prevState.set(p.id, p.state);
      this.drawPlayer(ctx, p, dx, dy, timeMs, dt, scaleMul, alphaMul);
    }

    // Cover alpha per object: steady 1 while any player is hidden inside, else
    // driven by in-flight enter/exit animations (fade in/out).
    this.lastCoverMap.clear();
    const animObjects = new Set<string>();
    for (const a of this.hideAnims.values()) {
      if (!a.done) animObjects.add(a.furnitureId);
    }
    for (const p of state.players) {
      if (p.state === "transformed" && p.transformedAs && !animObjects.has(p.transformedAs)) {
        this.lastCoverMap.set(p.transformedAs, 1);
      }
    }
    for (const a of this.hideAnims.values()) {
      if (a.done || a.cover <= 0) continue;
      const cur = this.lastCoverMap.get(a.furnitureId) ?? 0;
      if (a.cover > cur) this.lastCoverMap.set(a.furnitureId, a.cover);
    }

    this.drawObjectFronts(ctx, objs, timeMs);

    // Interaction affordance: soft highlight on the nearest hideable object.
    this.updateInteractTarget(state);
    this.drawInteractAffordance(ctx, objs, timeMs);

    // Gronk: the big red troll.
    const g = state.gronk;
    const gpos = this.step("gronk", g.x, g.y, dt);
    this.drawGronk(ctx, state, gpos.x, gpos.y, timeMs);

    // Screen-space lighting: vignette + enrage edge pulse.
    this.postLighting(ctx, state, timeMs);
  }

  // ---- floor: base slab + faint global grid -------------------------------

  private drawFloorBase(ctx: CanvasRenderingContext2D): void {
    // Vertical gradient slab (light pools toward mid-room).
    const g = ctx.createLinearGradient(0, 0, 0, ROOM_HEIGHT);
    g.addColorStop(0, "#141a27");
    g.addColorStop(0.45, "#1a2231");
    g.addColorStop(1, "#131925");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, ROOM_WIDTH, ROOM_HEIGHT);

    // Soft central light pool.
    const pool = ctx.createRadialGradient(
      ROOM_WIDTH / 2,
      ROOM_HEIGHT * 0.42,
      4,
      ROOM_WIDTH / 2,
      ROOM_HEIGHT * 0.42,
      58,
    );
    pool.addColorStop(0, "rgba(140,170,220,0.06)");
    pool.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = pool;
    ctx.fillRect(0, 0, ROOM_WIDTH, ROOM_HEIGHT);

    // Faint global grid — spatial reference, not a design element.
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 0.15;
    ctx.beginPath();
    for (let x = 0; x <= ROOM_WIDTH; x += 10) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ROOM_HEIGHT);
    }
    for (let y = 0; y <= ROOM_HEIGHT; y += 10) {
      ctx.moveTo(0, y);
      ctx.lineTo(ROOM_WIDTH, y);
    }
    ctx.stroke();
  }

  // ---- per-room floors: tint wash + pattern + ambient glow ----------------

  private drawRoomFloors(ctx: CanvasRenderingContext2D): void {
    for (const room of ROOMS) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(room.x, room.y, room.w, room.h);
      ctx.clip();

      // Tint wash (kept subtle so the base slab still reads through).
      ctx.fillStyle = rgba(room.tint, 0.05);
      ctx.fillRect(room.x, room.y, room.w, room.h);

      switch (room.kind) {
        case "tile": this.floorTiles(ctx, room); break;
        case "plank": this.floorPlanks(ctx, room); break;
        case "panel": this.floorPanels(ctx, room); break;
        case "slab": this.floorSlabs(ctx, room); break;
      }

      // Room-specific ambient glow from the room center.
      const cx = room.x + room.w / 2;
      const cy = room.y + room.h / 2;
      const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, room.w * 0.55);
      glow.addColorStop(0, rgba(room.tint, 0.055));
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(room.x, room.y, room.w, room.h);

      // Floor-painted room label (environment-first, label as reference).
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = room.accent;
      ctx.font = `800 3.2px 'Segoe UI', system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(room.label, cx, room.y + 1.2);
      ctx.globalAlpha = 1;

      ctx.restore();
    }
  }

  // Large square tiles with grout lines (cafeteria).
  private floorTiles(
    ctx: CanvasRenderingContext2D,
    room: { x: number; y: number; w: number; h: number },
  ): void {
    const s = 5;
    for (let y = room.y; y < room.y + room.h; y += s) {
      for (let x = room.x; x < room.x + room.w; x += s) {
        ctx.fillStyle = ((x / s + y / s) % 2 === 0)
          ? "rgba(255,255,255,0.028)"
          : "rgba(0,0,0,0.03)";
        ctx.fillRect(x, y, s, s);
      }
    }
    ctx.strokeStyle = "rgba(0,0,0,0.14)";
    ctx.lineWidth = 0.16;
    ctx.beginPath();
    for (let x = room.x; x <= room.x + room.w; x += s) {
      ctx.moveTo(x, room.y);
      ctx.lineTo(x, room.y + room.h);
    }
    for (let y = room.y; y <= room.y + room.h; y += s) {
      ctx.moveTo(room.x, y);
      ctx.lineTo(room.x + room.w, y);
    }
    ctx.stroke();
  }

  // Horizontal wood planks with staggered seams (library).
  private floorPlanks(
    ctx: CanvasRenderingContext2D,
    room: { x: number; y: number; w: number; h: number },
  ): void {
    const p = 2;
    let seamOff = 0;
    for (let y = room.y; y < room.y + room.h; y += p) {
      ctx.fillStyle = seamOff % 2 === 0 ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.035)";
      ctx.fillRect(room.x, y, room.w, p);
      ctx.strokeStyle = "rgba(0,0,0,0.15)";
      ctx.lineWidth = 0.14;
      ctx.beginPath();
      ctx.moveTo(room.x, y + p - 0.08);
      ctx.lineTo(room.x + room.w, y + p - 0.08);
      ctx.stroke();
      // Staggered plank joints.
      ctx.beginPath();
      for (let x = room.x + seamOff; x < room.x + room.w; x += 8) {
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + p);
      }
      ctx.stroke();
      seamOff = (seamOff + 3) % 8;
    }
  }

  // Industrial metal panels with corner rivets (reactor).
  private floorPanels(
    ctx: CanvasRenderingContext2D,
    room: { x: number; y: number; w: number; h: number },
  ): void {
    const s = 4;
    for (let y = room.y; y < room.y + room.h; y += s) {
      for (let x = room.x; x < room.x + room.w; x += s) {
        ctx.strokeStyle = "rgba(0,0,0,0.18)";
        ctx.lineWidth = 0.2;
        ctx.strokeRect(x, y, s, s);
        ctx.fillStyle = "rgba(255,255,255,0.07)";
        ctx.beginPath();
        ctx.arc(x + 0.3, y + 0.3, 0.13, 0, Math.PI * 2);
        ctx.arc(x + s - 0.3, y + 0.3, 0.13, 0, Math.PI * 2);
        ctx.arc(x + 0.3, y + s - 0.3, 0.13, 0, Math.PI * 2);
        ctx.arc(x + s - 0.3, y + s - 0.3, 0.13, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Large concrete slabs with tone variance (storage).
  private floorSlabs(
    ctx: CanvasRenderingContext2D,
    room: { x: number; y: number; w: number; h: number },
  ): void {
    const sw = 6;
    const sh = 5;
    for (let y = room.y; y < room.y + room.h; y += sh) {
      for (let x = room.x; x < room.x + room.w; x += sw) {
        ctx.fillStyle = ((x / sw + y / sh) % 2 === 0)
          ? "rgba(255,255,255,0.02)"
          : "rgba(0,0,0,0.03)";
        ctx.fillRect(x, y, sw, sh);
      }
    }
    ctx.strokeStyle = "rgba(0,0,0,0.16)";
    ctx.lineWidth = 0.18;
    ctx.beginPath();
    for (let x = room.x; x <= room.x + room.w; x += sw) {
      ctx.moveTo(x, room.y);
      ctx.lineTo(x, room.y + room.h);
    }
    for (let y = room.y; y <= room.y + room.h; y += sh) {
      ctx.moveTo(room.x, y);
      ctx.lineTo(room.x + room.w, y);
    }
    ctx.stroke();
  }

  // ---- walls: interior dividers + outer frame with depth ------------------

  private drawInteriorWalls(ctx: CanvasRenderingContext2D): void {
    // Cafeteria band (top) vs. the lower zones: horizontal wall, door gap.
    this.wallBand(ctx, 4, 26, 92, 10, "h");
    // Corridor divider between Reactor and Storage: vertical wall, door gap.
    this.wallBand(ctx, 50, 42, 14, 6, "v");
  }

  // A thick interior wall drawn in two segments around a centered door gap,
  // with door jambs at the gap edges and a faint threshold on the floor.
  private wallBand(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    len: number,
    gap: number,
    dir: "h" | "v",
  ): void {
    const t = 2.2; // wall thickness
    const mid = dir === "h" ? x + len / 2 : y + len / 2;
    const g0 = mid - gap / 2;
    const g1 = mid + gap / 2;

    if (dir === "h") {
      this.bevelBar(ctx, x, y - t / 2, g0 - x, t);
      this.bevelBar(ctx, g1, y - t / 2, x + len - g1, t);
      // Floor contact shadow (per segment, so the doorway stays clean).
      for (const seg of [
        { a: x, b: g0 - x },
        { a: g1, b: x + len - g1 },
      ]) {
        const sh = ctx.createLinearGradient(0, y + t / 2, 0, y + t / 2 + 1.6);
        sh.addColorStop(0, "rgba(0,0,0,0.28)");
        sh.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = sh;
        ctx.fillRect(seg.a, y + t / 2, seg.b, 1.6);
      }
      // Door jambs + threshold.
      ctx.fillStyle = "#39435c";
      ctx.fillRect(g0 - 0.28, y - t / 2 - 0.55, 0.56, t + 1.1);
      ctx.fillRect(g1 - 0.28, y - t / 2 - 0.55, 0.56, t + 1.1);
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 0.3;
      ctx.beginPath();
      ctx.moveTo(g0 + 0.5, y);
      ctx.lineTo(g1 - 0.5, y);
      ctx.stroke();
    } else {
      this.bevelBar(ctx, x - t / 2, y, t, g0 - y);
      this.bevelBar(ctx, x - t / 2, g1, t, y + len - g1);
      for (const seg of [
        { a: y, b: g0 - y },
        { a: g1, b: y + len - g1 },
      ]) {
        const sh = ctx.createLinearGradient(x + t / 2, 0, x + t / 2 + 1.6, 0);
        sh.addColorStop(0, "rgba(0,0,0,0.28)");
        sh.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = sh;
        ctx.fillRect(x + t / 2, seg.a, 1.6, seg.b);
      }
      ctx.fillStyle = "#39435c";
      ctx.fillRect(x - t / 2 - 0.55, g0 - 0.28, t + 1.1, 0.56);
      ctx.fillRect(x - t / 2 - 0.55, g1 - 0.28, t + 1.1, 0.56);
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 0.3;
      ctx.beginPath();
      ctx.moveTo(x, g0 + 0.5);
      ctx.lineTo(x, g1 - 0.5);
      ctx.stroke();
    }
  }

  // A rounded wall bar with a light top edge and a dark bottom edge (bevel).
  private bevelBar(ctx: CanvasRenderingContext2D, bx: number, by: number, bw: number, bh: number): void {
    ctx.fillStyle = "#2c3448";
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 0.4);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(bx + 0.2, by + 0.2, bw - 0.4, Math.min(0.45, bh * 0.3));
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(bx + 0.2, by + bh - 0.45, bw - 0.4, 0.45);
  }

  // Outer walls: a dark frame with a beveled face, corner rivets, and soft
  // floor-contact shadows along each inside edge.
  private drawOuterWalls(ctx: CanvasRenderingContext2D): void {
    const t = 3;
    // Outer dark frame.
    ctx.fillStyle = "#0a0e17";
    ctx.fillRect(-t, -t, ROOM_WIDTH + t * 2, ROOM_HEIGHT + t * 2);
    // Wall face.
    ctx.fillStyle = "#232a3c";
    ctx.fillRect(-t + 0.45, -t + 0.45, ROOM_WIDTH + t * 2 - 0.9, ROOM_HEIGHT + t * 2 - 0.9);
    // Face bevel: faint inner highlight.
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(-t + 0.7, -t + 0.7, ROOM_WIDTH + t * 2 - 1.4, ROOM_HEIGHT + t * 2 - 1.4);
    // Corner rivets.
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    for (const [cx, cy] of [
      [-t + 0.9, -t + 0.9],
      [ROOM_WIDTH + t - 0.9, -t + 0.9],
      [-t + 0.9, ROOM_HEIGHT + t - 0.9],
      [ROOM_WIDTH + t - 0.9, ROOM_HEIGHT + t - 0.9],
    ]) {
      ctx.beginPath();
      ctx.arc(cx, cy, 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
    // Floor-contact shadows along each inside edge.
    const top = ctx.createLinearGradient(0, 0, 0, 2.6);
    top.addColorStop(0, "rgba(0,0,0,0.30)");
    top.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, ROOM_WIDTH, 2.6);
    const bottom = ctx.createLinearGradient(0, ROOM_HEIGHT - 2.6, 0, ROOM_HEIGHT);
    bottom.addColorStop(0, "rgba(0,0,0,0)");
    bottom.addColorStop(1, "rgba(0,0,0,0.30)");
    ctx.fillStyle = bottom;
    ctx.fillRect(0, ROOM_HEIGHT - 2.6, ROOM_WIDTH, 2.6);
    const left = ctx.createLinearGradient(0, 0, 2.6, 0);
    left.addColorStop(0, "rgba(0,0,0,0.30)");
    left.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = left;
    ctx.fillRect(0, 0, 2.6, ROOM_HEIGHT);
    const right = ctx.createLinearGradient(ROOM_WIDTH - 2.6, 0, ROOM_WIDTH, 0);
    right.addColorStop(0, "rgba(0,0,0,0)");
    right.addColorStop(1, "rgba(0,0,0,0.30)");
    ctx.fillStyle = right;
    ctx.fillRect(ROOM_WIDTH - 2.6, 0, 2.6, ROOM_HEIGHT);
  }

  // ---- airborne dust motes (barely-there atmosphere) -----------------------

  private drawDust(ctx: CanvasRenderingContext2D, timeMs: number): void {
    for (let i = 0; i < 36; i++) {
      const x = 3 + ((i * 17) % 94);
      const y = 3 + ((i * 31) % 54);
      const a = 0.04 + 0.045 * (0.5 + 0.5 * Math.sin(timeMs / 1800 + i * 1.7));
      ctx.fillStyle = `rgba(190,205,235,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, 0.12 + (i % 3) * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- ambient decor: vents / hatches / pipes / posters / lights ---------

  private drawDecor(ctx: CanvasRenderingContext2D, timeMs: number): void {
    // Floor vents: dark grille with slats.
    for (const v of DECOR.vents) {
      ctx.fillStyle = "#10151f";
      ctx.beginPath();
      ctx.roundRect(v.x - 1.2, v.y - 0.8, 2.4, 1.6, 0.3);
      ctx.fill();
      ctx.strokeStyle = "#3a4660";
      ctx.lineWidth = 0.25;
      ctx.stroke();
      ctx.fillStyle = "#232b3c";
      for (let i = -2; i <= 2; i++) {
        ctx.fillRect(v.x + i * 0.42 - 0.1, v.y - 0.55, 0.2, 1.1);
      }
    }

    // Floor hatches: ring with a cross and center pin.
    for (const h of DECOR.hatches) {
      ctx.strokeStyle = "#3a4660";
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.arc(h.x, h.y, 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(h.x - 1.0, h.y);
      ctx.lineTo(h.x + 1.0, h.y);
      ctx.moveTo(h.x, h.y - 1.0);
      ctx.lineTo(h.x, h.y + 1.0);
      ctx.stroke();
      ctx.fillStyle = "#232b3c";
      ctx.beginPath();
      ctx.arc(h.x, h.y, 0.45, 0, Math.PI * 2);
      ctx.fill();
    }

    // Wall-mounted pipes: runs with joint plates at each end.
    ctx.strokeStyle = "#46536e";
    ctx.lineWidth = 1.1;
    ctx.lineCap = "round";
    for (const p of DECOR.pipes) {
      ctx.beginPath();
      ctx.moveTo(p.x1, p.y1);
      ctx.lineTo(p.x2, p.y2);
      ctx.stroke();
    }
    ctx.fillStyle = "#5b6a8a";
    for (const p of DECOR.pipes) {
      ctx.beginPath();
      ctx.arc(p.x1, p.y1, 0.5, 0, Math.PI * 2);
      ctx.arc(p.x2, p.y2, 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Poster decals on the walls: dark frame + colored art + emblem.
    for (const po of DECOR.posters) {
      ctx.fillStyle = "#10151f";
      ctx.beginPath();
      ctx.roundRect(po.x - 1.3, po.y - 0.9, 2.6, 1.8, 0.25);
      ctx.fill();
      ctx.fillStyle = po.c;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.roundRect(po.x - 1.1, po.y - 0.7, 2.2, 1.4, 0.15);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(10,14,22,0.55)";
      ctx.beginPath();
      ctx.arc(po.x - 0.4, po.y - 0.1, 0.18, 0, Math.PI * 2);
      ctx.arc(po.x + 0.4, po.y - 0.1, 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(po.x - 0.6, po.y + 0.3, 1.2, 0.12);
    }

    // Flickering ceiling lights: fixture bar + warm/cool floor glow pools.
    for (const L of DECOR.lights) {
      // Deterministic per-light flicker dip.
      const on = Math.sin(timeMs / 700 + L.phase * 17) > 0.92 ? 0.35 : 1;
      const [r, g, b] = this.hexRgb(L.tint);

      // Wide ambient pool + tighter core pool.
      ctx.fillStyle = `rgba(${r},${g},${b},${0.06 * on})`;
      ctx.beginPath();
      ctx.ellipse(L.x, L.y + 3.6, 6.4, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${r},${g},${b},${0.14 * on})`;
      ctx.beginPath();
      ctx.ellipse(L.x, L.y + 3.4, 4.2, 2.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${r},${g},${b},${0.2 * on})`;
      ctx.beginPath();
      ctx.ellipse(L.x, L.y + 3.4, 2.4, 1.3, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = on < 1 ? "#3a3320" : "#2b3346";
      ctx.beginPath();
      ctx.roundRect(L.x - 1.1, L.y - 0.25, 2.2, 0.5, 0.2);
      ctx.fill();
      ctx.fillStyle = `rgba(${r},${g},${b},${0.9 * on})`;
      ctx.fillRect(L.x - 0.85, L.y - 0.15, 1.7, 0.2);
    }
  }

  private hexRgb(hex: string): [number, number, number] {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // ---- screen-space lighting: vignette + enrage edge pulse ----------------

  private postLighting(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    timeMs: number,
  ): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Subtle elliptical vignette: hugs the viewport so the framing is felt on
    // the mid-edges too, while the center stays clean. A circle scaled to an
    // ellipse (unit radius 1 == each screen edge) keeps it predictable at any
    // aspect ratio; radius sqrt(2) reaches the corners (canvas gradients clamp
    // stop offsets to [0,1]).
    ctx.save();
    try {
      ctx.translate(w / 2, h / 2);
      ctx.scale(w / 2, h / 2);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.SQRT2);
      g.addColorStop(0, "rgba(3,5,10,0)");
      g.addColorStop(0.39, "rgba(3,5,10,0)");
      g.addColorStop(0.58, "rgba(3,5,10,0.10)");
      g.addColorStop(1, "rgba(3,5,10,0.45)");
      ctx.fillStyle = g;
      ctx.fillRect(-2, -2, 4, 4);
    } finally {
      ctx.restore();
    }

    // Enrage: pulsing red edge glow (screen-space, so it reads at any zoom).
    if (state.enraged) {
      const a = 0.10 + 0.08 * Math.sin(timeMs / 180);
      for (const side of ["top", "bottom", "left", "right"] as const) {
        const grad = ctx.createLinearGradient(
          side === "left" ? 0 : side === "right" ? w : 0,
          side === "top" ? 0 : side === "bottom" ? h : 0,
          side === "left" ? 46 : side === "right" ? w - 46 : 0,
          side === "top" ? 46 : side === "bottom" ? h - 46 : 0,
        );
        grad.addColorStop(0, `rgba(255,40,40,${a})`);
        grad.addColorStop(1, "rgba(255,40,40,0)");
        ctx.fillStyle = grad;
        if (side === "top" || side === "bottom") ctx.fillRect(0, side === "top" ? 0 : h - 46, w, 46);
        else ctx.fillRect(side === "left" ? 0 : w - 46, 0, 46, h);
      }
    }
  }

  // ---- furniture (visual object system, see objects.ts) --------------------

  // Draw one layer of the visual objects. Labels fade in near the local player
  // only — the environment itself carries the information, the label is a
  // secondary reference.
  private drawObjects(
    ctx: CanvasRenderingContext2D,
    objs: VisualObject[],
    timeMs: number,
    pass: VisualLayer,
  ): void {
    const me = this.localOverride ?? this.lastPlayerPos;
    for (const obj of objs) {
      if (obj.layer !== pass) continue;
      let labelAlpha = 0;
      if (me) {
        const d = Math.hypot(obj.x - me.x, obj.y - me.y);
        labelAlpha = d > 16 ? 0 : 0.18 + 0.32 * Math.max(0, 1 - d / 16);
      }
      drawVisualObject(ctx, obj, timeMs, labelAlpha);
    }
  }

  // Phase 4 front pass: cover objects re-paint their front-facing geometry over
  // the player layer with the computed cover alpha (0 when nothing is hidden).
  private drawObjectFronts(
    ctx: CanvasRenderingContext2D,
    objs: VisualObject[],
    timeMs: number,
  ): void {
    for (const obj of objs) {
      if (!isCoverKind(obj.kind)) continue;
      const alpha = this.lastCoverMap.get(obj.id) ?? 0;
      if (alpha <= 0.02) continue;
      drawVisualObjectFront(ctx, obj, timeMs, alpha);
    }
  }

  // The nearest hideable object within engine TRANSFORM_RANGE of the local
  // player (same center-to-center semantics the engine uses). Only when the
  // player could actually transform: active, not carrying, not stunned/closeted.
  private updateInteractTarget(state: GameState): void {
    this.interactTarget = null;
    const me = state.players.find((p) => p.id === this.myPlayerId);
    const mePos = this.localOverride ?? this.lastPlayerPos;
    if (!me || me.state !== "active" || me.carrying || !mePos) return;
    let best: { id: string; x: number; y: number; d: number } | null = null;
    for (const f of state.furniture) {
      const d = Math.hypot(f.x - mePos.x, f.y - mePos.y);
      if (d <= TRANSFORM_RANGE && (!best || d < best.d)) best = { id: f.id, x: f.x, y: f.y, d };
    }
    if (best) this.interactTarget = { id: best.id, x: best.x, y: best.y };
  }

  // Compact affordance on the highlighted object: pulsing soft outline + a
  // small "HIDE" chip. The environment stays clean — only this object glows.
  private drawInteractAffordance(
    ctx: CanvasRenderingContext2D,
    objs: VisualObject[],
    timeMs: number,
  ): void {
    if (!this.interactTarget) return;
    const obj = objs.find((o) => o.id === this.interactTarget!.id);
    if (!obj) return;
    const pulse = 0.5 + 0.5 * Math.sin(timeMs / 220);
    ctx.strokeStyle = `rgba(255,224,138,${(0.3 + 0.28 * pulse).toFixed(3)})`;
    ctx.lineWidth = 0.3;
    ctx.beginPath();
    ctx.roundRect(obj.x - obj.w / 2 - 0.3, obj.y - obj.h / 2 - 0.3, obj.w + 0.6, obj.h + 0.6, 0.7);
    ctx.stroke();

    const label = this.isTouchDevice ? "HIDE" : "HIDE · E";
    const cy = obj.y - obj.h / 2 - 1.15;
    ctx.font = "700 0.8px system-ui";
    const tw = ctx.measureText(label).width;
    const cw = tw + 1.0;
    ctx.fillStyle = "rgba(10,14,22,0.85)";
    ctx.beginPath();
    ctx.roundRect(obj.x - cw / 2, cy - 0.55, cw, 1.1, 0.3);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,224,138,0.5)";
    ctx.lineWidth = 0.15;
    ctx.stroke();
    ctx.fillStyle = "#ffe08a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, obj.x, cy);
  }

  // ---- Phase 4 hide enter/exit animations (presentation only) -------------

  private beginHideAnim(
    p: Player,
    was: Player["state"] | undefined,
    pos: { x: number; y: number },
    state: GameState,
    timeMs: number,
  ): void {
    if (p.state === "transformed") {
      const to = this.furnitureCenter(p.transformedAs, state) ?? pos;
      const from = this.prevDrawn.get(p.id) ?? pos;
      // Teleport-scale jumps (e.g. respawn then instantly hide) skip the slide.
      if (Math.hypot(to.x - from.x, to.y - from.y) > SNAP_DIST) {
        this.hideAnims.delete(p.id);
      } else {
        this.hideAnims.set(p.id, {
          id: p.id,
          phase: "enter",
          start: timeMs,
          fromX: from.x,
          fromY: from.y,
          toX: to.x,
          toY: to.y,
          furnitureId: p.transformedAs ?? "",
          t: 0,
          cover: 0,
          drawX: from.x,
          drawY: from.y,
          scaleMul: 1,
          alphaMul: 1,
          done: false,
        });
      }
      this.prevTransAs.set(p.id, p.transformedAs);
    } else if (was === "transformed") {
      const fid = this.prevTransAs.get(p.id);
      const from = (fid ? this.furnitureCenter(fid, state) : null) ?? pos;
      const off = EXIT_OFFSET[this.charFace.get(p.id) ?? "down"];
      this.hideAnims.set(p.id, {
        id: p.id,
        phase: "exit",
        start: timeMs,
        fromX: from.x,
        fromY: from.y,
        toX: from.x + off.x,
        toY: from.y + off.y,
        furnitureId: fid ?? "",
        t: 0,
        cover: 1,
        drawX: from.x,
        drawY: from.y,
        scaleMul: 0.85,
        alphaMul: 0.45,
        done: false,
      });
    }
  }

  private advanceHideAnim(a: HideAnim, timeMs: number): void {
    const t = Math.min(1, (timeMs - a.start) / HIDE_ANIM_MS);
    a.t = t;
    if (a.phase === "enter") {
      const e = easeInOut(t);
      a.drawX = a.fromX + (a.toX - a.fromX) * e;
      a.drawY = a.fromY + (a.toY - a.fromY) * e;
      a.scaleMul = 1 - 0.18 * Math.sin(Math.PI * t); // dip then settle
      a.alphaMul = 1 - 0.55 * e; // fade toward the absorbed ghost
      a.cover = t < 0.35 ? 0 : smoothstep((t - 0.35) / 0.5);
    } else {
      const e = easeOut(t);
      a.drawX = a.fromX + (a.toX - a.fromX) * e;
      a.drawY = a.fromY + (a.toY - a.fromY) * e;
      a.scaleMul = 0.85 + 0.15 * e;
      a.alphaMul = 0.45 + 0.55 * e;
      a.cover = t < 0.15 ? 1 : 1 - smoothstep((t - 0.15) / 0.45);
    }
    a.done = t >= 1;
  }

  private furnitureCenter(
    fid: string | null,
    state: GameState,
  ): { x: number; y: number } | null {
    if (!fid) return null;
    const f = state.furniture.find((q) => q.id === fid);
    return f ? { x: f.x, y: f.y } : null;
  }

  private drawPedestal(ctx: CanvasRenderingContext2D, x: number, y: number, team: number): void {
    const c = TEAM_COLORS[team];
    // Glow ring.
    ctx.beginPath();
    ctx.arc(x, y, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = c + "2a";
    ctx.fill();
    // Platform.
    ctx.beginPath();
    ctx.arc(x, y, 2.0, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
    ctx.strokeStyle = rgba(c, 0.2);
    ctx.lineWidth = 0.5;
    ctx.stroke();
    // Center marker.
    ctx.beginPath();
    ctx.arc(x, y, 0.7, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }

  private drawDiamond(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    color: string,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#fff8d6";
    ctx.lineWidth = 0.25;
    ctx.stroke();
  }

  // ---- players (hooded fantasy adventurers, Phase 3) ----------------------

  private drawPlayer(
    ctx: CanvasRenderingContext2D,
    p: Player,
    x: number,
    y: number,
    timeMs: number,
    dt: number,
    scaleMul = 1,
    alphaMul = 1,
  ): void {
    const seat = this.seatIndexOf(p.id);
    const col = SEAT_COLORS[seat] ?? TEAM_COLORS[p.team];
    const dark = SEAT_DARK[seat] ?? TEAM_DARK[p.team];
    const isMine = p.id === this.myPlayerId;

    // Facing + walk phase from the most recent movement vector (the local
    // player uses the 60fps input; everyone else uses the server's last move).
    const vx = isMine && this.lastCanMove ? this.lastInputDir.x : p.moveDx;
    const vy = isMine && this.lastCanMove ? this.lastInputDir.y : p.moveDy;
    const mag = Math.hypot(vx, vy);
    const face: Facing =
      mag > 0.05
        ? Math.abs(vx) >= Math.abs(vy)
          ? vx > 0
            ? "right"
            : "left"
          : vy > 0
            ? "down"
            : "up"
        : (this.charFace.get(p.id) ?? "down");
    this.charFace.set(p.id, face);
    const phase = (this.charPhase.get(p.id) ?? 0) + dt * (4 + Math.min(1, mag) * 11);
    this.charPhase.set(p.id, phase);

    this.charInfos.push({
      id: p.id,
      drawn: p.state !== "transformed" || isMine,
      x,
      y,
      w: 1.6,
      h: 3.4,
      state: p.state,
      face,
      color: col,
      animTick: Math.floor(timeMs / 16),
    });

    // Disguised opponents ARE the furniture — draw nothing (only the local
    // player sees their own "absorbed" ghost feedback).
    if (p.state === "transformed" && !isMine) return;

    drawCharacter(ctx, {
      x,
      y,
      bodyColor: col,
      darkColor: dark,
      teamColor: TEAM_COLORS[p.team],
      state: p.state,
      carrying: p.carrying,
      walkPhase: phase,
      speed: Math.min(1, mag),
      facing: face,
      timeMs,
      ghost: p.state === "transformed" && isMine,
      alphaMul,
      scaleMul,
    });

    // Own wizard: white ring (position feedback). Hidden players don't get a
    // ring or name — they are the furniture, and the marker would give them away.
    if (isMine && p.state !== "transformed") {
      ctx.beginPath();
      ctx.arc(x, y, 1.9, 0, Math.PI * 2);
      ctx.lineWidth = 0.3;
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.stroke();
    }

    // Name tag (secondary to the character itself).
    if (p.state !== "transformed") {
      ctx.fillStyle = "#cfd8e8";
      ctx.font = "600 0.85px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(p.name, x, y - 3.5);
    }
  }

  /** seat color index from a player id like "wizard-3" (fallback: team). */
  private seatIndexOf(id: string): number {
    const m = /-(\d)$/.exec(id);
    return m ? parseInt(m[1], 10) % 4 : -1;
  }

  // ---- Gronk (huge red troll) --------------------------------------------

  private drawGronk(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    x: number,
    y: number,
    timeMs: number,
  ): void {
    const g = state.gronk;
    const enraged = g.enraged;
    const moving = state.gronk.mode === "chase";
    const waddle = moving ? Math.sin(timeMs / 120) * 0.2 : 0;

    // Shadow.
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.ellipse(x + 0.3, y + 2.4 + Math.abs(Math.sin(timeMs / 120)) * 0.2, 2.4, 0.7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Nose flare: 0.5s before each sniff, Gronk pulses and glows.
    const preSniff = g.nextSniffTick - state.tick;
    const flaring = preSniff > 0 && preSniff <= 0.5 * TICKS_PER_SECOND;
    const pulse = flaring ? 1 + 0.2 * Math.abs(Math.sin(timeMs / 55)) : 1;

    const col = enraged ? "#8a1414" : "#c8322b";
    const s = 3.2 * pulse;
    const h = 4.6;

    ctx.save();
    ctx.translate(x, y + Math.abs(Math.sin(timeMs / 120)) * 0.2);
    ctx.rotate(waddle * 0.1);

    // Body: a big round troll.
    ctx.fillStyle = col;
    ctx.strokeStyle = rgba(col, 0.4);
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.ellipse(0, -h / 2, s / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Belly highlight.
    ctx.beginPath();
    ctx.ellipse(0.3, -h * 0.35, s * 0.28, h * 0.22, 0, 0, Math.PI * 2);
    ctx.fillStyle = rgba(col, 0.18);
    ctx.fill();

    // Ear/face: two glowing eyes + big nose.
    ctx.fillStyle = "#ffe08a";
    ctx.shadowColor = "#ffdd66";
    ctx.shadowBlur = 1.2;
    ctx.beginPath();
    ctx.arc(-0.7, -h * 0.75, 0.32, 0, Math.PI * 2);
    ctx.arc(0.7, -h * 0.75, 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    if (flaring) {
      ctx.strokeStyle = "rgba(255, 209, 102, 0.85)";
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.arc(0, -h * 0.45, 1.8 * pulse, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Label.
    ctx.fillStyle = "#ffcdd2";
    ctx.font = "700 0.9px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("GRONK", 0, h * 0.15);
    ctx.restore();
  }

  // ---- local prediction (own avatar moves at 60fps, not the 10Hz poll) ----
  // The engine reconciles every tick; this only makes the local feel smooth.
  private localOverride: { x: number; y: number } | null = null;
  private localX: number | null = null;
  private localY: number | null = null;
  private localT = performance.now();

  /**
   * Called each frame from the game loop. Drives a locally predicted position
   * for the active player so movement isn't choppy at the 10Hz poll rate.
   */
  setLocalPrediction(
    serverPos: { x: number; y: number } | null,
    inputDir: { x: number; y: number } | null,
    speed: number,
    canMove: boolean,
  ): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.localT) / 1000);
    this.localT = now;
    this.lastInputDir = inputDir ?? { x: 0, y: 0 };
    this.lastCanMove = canMove;
    const moving = !!inputDir && (inputDir.x !== 0 || inputDir.y !== 0) && canMove && !!serverPos;
    if (!moving) {
      // No input (or can't move): stop predicting and let server smoothing take over.
      if (serverPos) {
        this.localX = serverPos.x;
        this.localY = serverPos.y;
      }
      this.localOverride = null;
      return;
    }
    // Seed from server if we have nothing yet.
    if (this.localX == null) {
      this.localX = serverPos!.x;
      this.localY = serverPos!.y;
    }
    const len = Math.hypot(inputDir.x, inputDir.y) || 1;
    const nx = inputDir.x / len;
    const ny = inputDir.y / len;
    this.localX = Math.min(ROOM_WIDTH - 1.2, Math.max(1.2, this.localX! + nx * speed * dt));
    this.localY = Math.min(ROOM_HEIGHT - 1.2, Math.max(1.2, this.localY! + ny * speed * dt));
    this.localOverride = { x: this.localX!, y: this.localY! };
  }

  myPlayerId: string | null = null;
}

// ---- tiny color helper (hex -> rgba with alpha) ---------------------------
function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}
