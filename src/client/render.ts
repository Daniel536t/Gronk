// Canvas 2D renderer. Shapes only — flat "Among Us" cartoon look drawn on our
// existing 2D x,y plane (no engine changes). Characters are bean-shaped
// astronaut wizards (rounded body + dome visor + backpack + stubby legs),
// Gronk is a hulking red troll, furniture is chunky rounded props, and the
// floor is a tiled, wall-topped spaceship interior.
//
// Projection: the 100x60 world is letterboxed into the viewport at a fixed
// DPR-correct scale. All drawing happens in WORLD units on top of the letterbox
// transform so nothing depends on window size. Positions are exponentially
// smoothed toward the latest 10Hz poll (see step()). Teleports (respawn,
// transform snap) jump instantly when the gap is large.
import type { GameState, Player } from "../engine/types";
import { ROOM_WIDTH, ROOM_HEIGHT, TICKS_PER_SECOND } from "../engine/constants";

const TEAM_COLORS = ["#4aa8e8", "#f2765b"]; // blue / coral — Among-Us-esque
const TEAM_DARK = ["#2f6fa3", "#b34a34"];
const SNAP_DIST = 8; // world units — bigger = teleport, not glide
const LERP_K = 14; // exponential smoothing constant (dt-based)

// Each seat (wizard-0..3) gets its own distinct crewmate color (Among-Us
// palette), independent of team. Team identity is still readable via the hat
// (team-dark) and a small team pip under the feet.
const SEAT_COLORS = ["#f2765b", "#4aa8e8", "#8ee36b", "#e072f0"]; // coral, sky, leaf, bloom
const SEAT_DARK = ["#b04b36", "#2f6fa3", "#5ba83f", "#a843bd"];

// Cosmetic, client-side "rooms" painted on the floor. The engine only knows one
// open 100x60 plane — these zones are visual theming that group the fixed
// furniture clusters. Purely decorative; never lets the engine's secret leak.
const ROOMS: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}[] = [
  { x: 4, y: 4, w: 92, h: 22, label: "CAFETERIA" }, // top: fridge/barrel/chest/armory
  { x: 14, y: 28, w: 72, h: 14, label: "LIBRARY" }, // center: bookshelf/couch/tapestry
  { x: 4, y: 42, w: 46, h: 14, label: "REACTOR" }, // bottom-left: brazier/statue
  { x: 52, y: 42, w: 44, h: 14, label: "STORAGE" }, // bottom-right: cauldron
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

// World->screen projection, recomputed on resize. Everything is drawn in world
// units through this transform, so DPR and window size only affect scale/offset.
export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private smooth = new Map<string, { x: number; y: number }>();
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private margin = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.floor(window.innerWidth * dpr);
    const chh = Math.floor(window.innerHeight * dpr);
    // Match the CSS box exactly so the backing store == displayed pixels.
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.canvas.width = cw;
    this.canvas.height = chh;

    // Letterbox the room into the viewport with a small margin, in CSS px.
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    this.margin = Math.max(12, Math.min(48, vw * 0.04, vh * 0.04));
    this.scale = Math.min(
      (vw - this.margin * 2) / ROOM_WIDTH,
      (vh - this.margin * 2) / ROOM_HEIGHT,
    );
    this.ox = (vw - ROOM_WIDTH * this.scale) / 2;
    this.oy = (vh - ROOM_HEIGHT * this.scale) / 2;
  }

  // Build the DPR-correct transform: cssPx -> backing pixels via dpr, then world
  // -> cssPx via (scale, ox, oy).
  private setProjection(): void {
    const dpr = window.devicePixelRatio || 1;
    const ctx = this.ctx;
    ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, dpr * this.ox, dpr * this.oy);
  }

  clear(): void {
    const dpr = window.devicePixelRatio || 1;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0b0e14";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
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
    this.clear();
    const ctx = this.ctx;
    const lw = 0.5; // world-unit line width

    this.drawFloor(ctx);
    this.drawTiles(ctx, ROOM_WIDTH, ROOM_HEIGHT);
    this.drawDecor(ctx, timeMs);

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

    this.drawFurniture(ctx, state);

    // Pedestals: team-colored glow platform at the corners.
    state.pedestals.forEach((ped, team) => this.drawPedestal(ctx, ped.x, ped.y, team));

    // Players: smoothed bean-shaped wizards. My own wizard is rendered at the
    // locally predicted position (see setLocalPrediction) so it moves at 60fps
    // instead of the choppy 10Hz poll rate.
    for (const p of state.players) {
      const pos = this.step(p.id, p.x, p.y, dt);
      let dx = pos.x;
      let dy = pos.y;
      if (p.id === this.myPlayerId && this.localOverride != null) {
        dx = this.localOverride.x;
        dy = this.localOverride.y;
      }
      this.drawPlayer(ctx, p, dx, dy, timeMs, state);
    }

    // Gronk: the big red troll.
    const g = state.gronk;
    const gpos = this.step("gronk", g.x, g.y, dt);
    this.drawGronk(ctx, state, gpos.x, gpos.y, timeMs);

    // Enrage: screen-edge pulse.
    if (state.enraged) {
      const a = 0.18 + 0.12 * Math.sin(timeMs / 180);
      ctx.strokeStyle = `rgba(255, 40, 40, ${a})`;
      ctx.lineWidth = 3 * lw;
      ctx.strokeRect(1, 1, ROOM_WIDTH - 2, ROOM_HEIGHT - 2);
      ctx.lineWidth = 6 * lw;
      ctx.strokeRect(3, 3, ROOM_WIDTH - 6, ROOM_HEIGHT - 6);
    }
  }

  // ---- floor + walls -----------------------------------------------------

  private drawFloor(ctx: CanvasRenderingContext2D): void {
    // Outer space.
    ctx.fillStyle = "#05060a";
    ctx.fillRect(-40, -40, ROOM_WIDTH + 80, ROOM_HEIGHT + 80);
    // Room floor slab.
    ctx.fillStyle = "#1a2130";
    ctx.fillRect(-3, -3, ROOM_WIDTH + 6, ROOM_HEIGHT + 6);
  }

  private roomTint(label: string): { fill: string; alt: string; accent: string } {
    switch (label) {
      case "CAFETERIA": return { fill: "#222b3d", alt: "#202836", accent: "#ffd166" };
      case "LIBRARY": return { fill: "#252c3e", alt: "#22293a", accent: "#4fc3f7" };
      case "REACTOR": return { fill: "#2a2535", alt: "#272131", accent: "#ff7b72" };
      case "STORAGE": return { fill: "#20302c", alt: "#1d2b28", accent: "#8ee36b" };
      default: return { fill: "#232c3e", alt: "#212938", accent: "#9aa7bd" };
    }
  }

  private drawTiles(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const T = 10; // tile size
    ctx.fillStyle = "#191f2d";
    ctx.fillRect(0, 0, w, h);

    // --- paint each named room with its own tile tint ---
    for (const room of ROOMS) {
      const { fill, alt } = this.roomTint(room.label);
      for (let y = room.y; y < room.y + room.h; y += T) {
        for (let x = room.x; x < room.x + room.w; x += T) {
          const even = ((x / T) + (y / T)) % 2 === 0;
          ctx.fillStyle = even ? fill : alt;
          ctx.fillRect(x + 0.6, y + 0.6, T - 1.2, T - 1.2);
        }
      }
    }

    // --- interior room walls (with door gaps) ---
    ctx.strokeStyle = "#3a4660";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "butt";
    // Wall separating the cafeteria band (top) from the lower zones.
    this.wallGap(ctx, 4, 26, w - 8, 10);
    // Corridor divider between the two lower rooms.
    this.wallGapV(ctx, 50, 42, 14, 6);

    // --- floor-painted room labels ---
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.font = `800 3.6px 'Segoe UI', system-ui, sans-serif`;
    for (const room of ROOMS) {
      // Room label sits at the top of its zone so occupants aren't hidden.
      const { accent } = this.roomTint(room.label);
      ctx.fillStyle = accent;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(room.label, room.x + room.w / 2, room.y + 1.2);
    }
    ctx.restore();

    // --- outer walls ---
    ctx.strokeStyle = "#222a3d";
    ctx.lineWidth = 0.4;
    ctx.fillStyle = "#39435c";
    ctx.fillRect(-2, 0, w + 4, 2); // top
    ctx.fillRect(-2, h - 2, w + 4, 3); // bottom
    ctx.fillRect(-2, 0, 3, h); // left
    ctx.fillRect(w - 1, 0, 3, h); // right
  }

  // Horizontal interior wall with a centered door gap.
  private wallGap(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    len: number,
    gap: number,
  ): void {
    const mid = x + len / 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(mid - gap / 2, y);
    ctx.moveTo(mid + gap / 2, y);
    ctx.lineTo(x + len, y);
    ctx.stroke();
  }

  // Vertical interior wall with a centered door gap (door offset kept simple).
  private wallGapV(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    len: number,
    gap: number,
  ): void {
    const mid = y + len / 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, mid - gap / 2);
    ctx.moveTo(x, mid + gap / 2);
    ctx.lineTo(x, y + len);
    ctx.stroke();
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

    // Flickering ceiling lights: fixture bar + warm/cool floor glow pool.
    for (const L of DECOR.lights) {
      // Deterministic per-light flicker dip.
      const on = Math.sin(timeMs / 700 + L.phase * 17) > 0.92 ? 0.35 : 1;
      const [r, g, b] = this.hexRgb(L.tint);

      ctx.fillStyle = `rgba(${r},${g},${b},${0.1 * on})`;
      ctx.beginPath();
      ctx.ellipse(L.x, L.y + 3.4, 4.2, 2.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${r},${g},${b},${0.14 * on})`;
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

  // ---- furniture ---------------------------------------------------------

  private drawFurniture(ctx: CanvasRenderingContext2D, state: GameState): void {
    for (const f of state.furniture) {
      const col = "#4d5871";
      const dark = "#333b52";
      // Base slab + slight relief.
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.roundRect(f.x - f.w / 2 + 0.4, f.y - f.h / 2 + 0.6, f.w, f.h, 1.2);
      ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.roundRect(f.x - f.w / 2, f.y - f.h / 2, f.w, f.h, 1.2);
      ctx.fill();
      ctx.strokeStyle = "#222a3d";
      ctx.lineWidth = 0.5;
      ctx.stroke();
      // Label in a little plaque.
      ctx.fillStyle = "rgba(10,14,22,0.6)";
      const tw = f.name.length * 0.7 + 1;
      ctx.beginPath();
      ctx.roundRect(f.x - tw / 2, f.y - 0.7, tw, 1.4, 0.6);
      ctx.fill();
      ctx.fillStyle = "#dfe6f2";
      ctx.font = `700 1.1px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(f.name.toUpperCase(), f.x, f.y + 0.1);
    }
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

  // ---- players (Among-Us bean crewmates) ---------------------------------

  private drawPlayer(
    ctx: CanvasRenderingContext2D,
    p: Player,
    x: number,
    y: number,
    timeMs: number,
    state: GameState,
  ): void {
    // Per-player crewmate color (distinct per seat) + team-dark hat.
    const seat = this.seatIndexOf(p.id);
    const col = SEAT_COLORS[seat] ?? TEAM_COLORS[p.team];
    const dark = SEAT_DARK[seat] ?? TEAM_DARK[p.team];
    const moving = Math.abs(p.moveDx) > 0.01 || Math.abs(p.moveDy) > 0.01;
    const waddle = moving ? Math.sin(timeMs / 90) * 0.25 : 0;
    const bob = moving ? Math.abs(Math.sin(timeMs / 90)) * 0.15 : 0;

    // Team ring under the feet (identity stays readable despite per-player colors).
    ctx.beginPath();
    ctx.ellipse(x, y + bob + 1.1, 1.0, 0.32, 0, 0, Math.PI * 2);
    ctx.fillStyle = rgba(TEAM_COLORS[p.team], 0.85);
    ctx.fill();

    // Soft drop shadow.
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(x + 0.2, y + 1.6 + bob, 1.5, 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Carrier glow (gold) behind the wizard.
    if (p.carrying) {
      const pulse = 1 + 0.15 * Math.sin(timeMs / 120);
      ctx.beginPath();
      ctx.arc(x, y, 2.4 * pulse, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 209, 102, 0.25)";
      ctx.fill();
    }

    // Stunned flash.
    const flashing = p.state === "stunned" && Math.floor(timeMs / 90) % 2 === 0;
    const closeted = p.state === "in_closet";
    const bodyCol = flashing ? "#ffffff" : closeted ? "#6b7688" : col;
    const visorCol = "#8fd8f2";

    const h = 2.6; // body height (world units)
    const wBody = 1.8;
    const tilt = flashing || closeted ? 0 : waddle * 0.15;

    ctx.save();
    ctx.translate(x, y + bob);
    ctx.rotate(tilt);

    // --- body: rounded rectangle "bean" ---
    ctx.fillStyle = flashing ? "#ffffff" : bodyCol;
    ctx.strokeStyle = rgba(bodyCol, 0.35);
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.roundRect(-wBody / 2, -h, wBody, h + 0.4, 0.9);
    ctx.fill();
    ctx.stroke();

    // --- backpack: rounded square on the left (always same side = simple) ---
    ctx.fillStyle = rgba(flashing ? "#ffffff" : bodyCol, 0.25);
    ctx.strokeStyle = rgba(flashing ? "#ffffff" : bodyCol, 0.4);
    ctx.lineWidth = 0.3;
    ctx.beginPath();
    ctx.roundRect(-wBody / 2 - 0.7, -h + 0.7, 0.9, 1.1, 0.3);
    ctx.fill();
    ctx.stroke();

    // --- dome visor (glass look with glare) ---
    ctx.beginPath();
    ctx.ellipse(wBody * 0.18, -h + 1.05, 0.9, 0.62, 0, 0, Math.PI * 2);
    ctx.fillStyle = visorCol;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 0.25;
    ctx.stroke();
    // glare band
    ctx.beginPath();
    ctx.ellipse(wBody * 0.32, -h + 0.82, 0.45, 0.28, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fill();

    // --- legs (two stubby feet) ---
    const stepL = moving ? (Math.sin(timeMs / 90) > 0 ? 0.25 : -0.35) : -0.05;
    const stepR = moving ? (Math.sin(timeMs / 90) > 0 ? -0.35 : 0.25) : -0.05;
    this.leg(ctx, -0.45, h + stepL * 0.3, flashing ? "#ffffff" : bodyCol);
    this.leg(ctx, 0.45, h + stepR * 0.3, flashing ? "#ffffff" : bodyCol);

    // --- team hat (a little wizard cap, team-dark) ---
    if (!flashing && !closeted) {
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.moveTo(-wBody * 0.35, -h + 0.7);
      ctx.quadraticCurveTo(0, -h - 1.2 + waddle * 0.2, wBody * 0.35, -h + 0.7);
      ctx.lineTo(-wBody * 0.35, -h + 0.7);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();

    // Own wizard: white ring.
    if (p.id === this.myPlayerId) {
      ctx.beginPath();
      ctx.arc(x, y + bob, 1.9, 0, Math.PI * 2);
      ctx.lineWidth = 0.3;
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.stroke();
    }

    // Name tag.
    ctx.fillStyle = "#cfd8e8";
    ctx.font = `600 0.85px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(p.name, x, y - h - 1.1);
  }

  private leg(ctx: CanvasRenderingContext2D, cx: number, y: number, color: string): void {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(cx - 0.3, y, 0.6, 0.45, 0.2);
    ctx.fill();
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