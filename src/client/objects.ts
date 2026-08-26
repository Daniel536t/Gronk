// Gronk's Hoard — client-side visual object system (Phase 2).
//
// A RENDERING abstraction only. The engine stays authoritative for positions,
// dimensions, and gameplay; this module turns the engine's furniture entries
// into recognizable environmental objects. Each object is a typed
// `VisualObject` with a layer concept ("back" = drawn behind players, "front"
// = drawn in front) so Phase 4's hiding/occlusion can later render
//   floor -> back objects -> player -> front objects
// without rewriting the draw pipeline. No gameplay, no collision, no
// occupancy — purely how the world looks.
//
// Style guide: chunky dark-fantasy props, muted materials, soft shadows that
// follow each silhouette, subtle highlights. Silhouette + details carry the
// meaning; labels are small, dim, and only appear near the local player.
import type { GameState } from "../engine/types";

export type VisualLayer = "back" | "front";

export type FurnitureKind =
  | "fridge"
  | "barrel"
  | "chest"
  | "throne"
  | "bookshelf"
  | "couch"
  | "tapestry"
  | "brazier"
  | "statue"
  | "cauldron";

export interface VisualObject {
  id: string;
  kind: FurnitureKind | "generic";
  x: number;
  y: number;
  w: number;
  h: number;
  layer: VisualLayer;
  name: string;
}

// Engine FURNITURE_LAYOUT order (furn-0..furn-9). id -> kind is stable and
// layout-authoritative; name is only a fallback.
const KIND_BY_INDEX: FurnitureKind[] = [
  "fridge", "barrel", "chest", "bookshelf", "couch",
  "tapestry", "brazier", "statue", "cauldron", "throne",
];

const KIND_BY_NAME: Record<string, FurnitureKind> = {
  fridge: "fridge",
  barrel: "barrel",
  chest: "chest",
  throne: "throne",
  bookshelf: "bookshelf",
  couch: "couch",
  tapestry: "tapestry",
  brazier: "brazier",
  statue: "statue",
  cauldron: "cauldron",
};

export function furnitureKindOf(f: { id: string; name: string }): FurnitureKind | "generic" {
  const m = /-(\d)$/.exec(f.id);
  if (m) {
    const kind = KIND_BY_INDEX[parseInt(m[1], 10)];
    if (kind) return kind;
  }
  return KIND_BY_NAME[f.name.toLowerCase()] ?? "generic";
}

/** Build the visual layer for each engine furniture entry. */
export function visualObjectsFor(state: GameState): VisualObject[] {
  return state.furniture.map((f) => ({
    id: f.id,
    kind: furnitureKindOf(f),
    x: f.x,
    y: f.y,
    w: f.w,
    h: f.h,
    // Phase 4 will flip cover-objects to "front" based on Y-sorting; for now
    // everything renders behind the players (they walk "in front of" props).
    layer: "back",
    name: f.name,
  }));
}

// ---- canvas helpers -------------------------------------------------------

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Soft drop shadow sized to the object's silhouette (stacked ellipses).
function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.beginPath();
  ctx.ellipse(x + 0.25, y + 0.3, w * 0.55, h * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.10)";
  ctx.beginPath();
  ctx.ellipse(x + 0.25, y + 0.3, w * 0.78, h * 0.68, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ---- furniture renderers ---------------------------------------------------

function drawFridge(ctx: CanvasRenderingContext2D, o: VisualObject): void {
  const { x, y } = o;
  shadow(ctx, x, y, 5.4, 3.4);
  const bw = 5.4;
  const bh = 5.6;
  const bx = x - bw / 2;
  const by = y - bh + 0.4;
  // Body (tall steel box).
  ctx.fillStyle = "#5d6d80";
  ctx.strokeStyle = "#2b3444";
  ctx.lineWidth = 0.4;
  rr(ctx, bx, by, bw, bh, 1.0);
  ctx.fill();
  ctx.stroke();
  // Top highlight.
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  rr(ctx, bx + 0.5, by + 0.5, bw - 1.0, 1.1, 0.8);
  ctx.fill();
  // Door inset.
  ctx.fillStyle = "#4e5d70";
  rr(ctx, bx + 0.6, by + 0.9, bw - 1.2, bh - 1.6, 0.7);
  ctx.fill();
  // Freezer seam + door split.
  ctx.strokeStyle = "#3a4654";
  ctx.lineWidth = 0.28;
  line(ctx, bx + 1.0, by + 2.9, bx + bw - 1.0, by + 2.9);
  line(ctx, x - 0.1, by + 0.9, x - 0.1, by + bh - 0.7);
  // Handles.
  ctx.fillStyle = "#9fb2c4";
  rr(ctx, x + 1.55, by + 1.3, 0.42, 1.2, 0.2);
  ctx.fill();
  rr(ctx, x + 1.55, by + 3.2, 0.42, 1.6, 0.2);
  ctx.fill();
  // Feet.
  ctx.fillStyle = "#2b3444";
  rr(ctx, bx + 0.7, by + bh - 0.35, 0.8, 0.4, 0.15);
  ctx.fill();
  rr(ctx, bx + bw - 1.5, by + bh - 0.35, 0.8, 0.4, 0.15);
  ctx.fill();
  // Magnet note on the door.
  ctx.fillStyle = "#ffd166";
  rr(ctx, x - 1.6, by + 3.3, 1.5, 1.0, 0.2);
  ctx.fill();
  ctx.fillStyle = "rgba(60,42,0,0.8)";
  ctx.fillRect(x - 1.45, by + 3.55, 1.2, 0.16);
}

function drawBarrel(ctx: CanvasRenderingContext2D, o: VisualObject): void {
  const { x, y } = o;
  shadow(ctx, x, y, 3.6, 3.2);
  const bw = 3.6;
  const bh = 3.0;
  const bx = x - bw / 2;
  const by = y - bh + 0.1;
  // Body.
  ctx.fillStyle = "#8a6743";
  ctx.strokeStyle = "#3d2c1a";
  ctx.lineWidth = 0.35;
  rr(ctx, bx, by + 0.5, bw, bh - 0.5, 0.9);
  ctx.fill();
  ctx.stroke();
  // Staves.
  ctx.strokeStyle = "rgba(61,44,26,0.35)";
  ctx.lineWidth = 0.16;
  for (let i = 1; i <= 3; i++) line(ctx, bx + i * (bw / 4), by + 0.8, bx + i * (bw / 4), by + bh - 0.2);
  // Horizontal bands.
  ctx.fillStyle = "#4a3523";
  rr(ctx, bx - 0.15, by + 1.15, bw + 0.3, 0.5, 0.25);
  ctx.fill();
  rr(ctx, bx - 0.15, by + 2.15, bw + 0.3, 0.5, 0.25);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  rr(ctx, bx - 0.15, by + 1.15, bw + 0.3, 0.16, 0.1);
  ctx.fill();
  // Open top (visible ellipse).
  ctx.fillStyle = "#6e5130";
  ctx.beginPath();
  ctx.ellipse(x, by + 0.55, bw * 0.5, 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#3d2c1a";
  ctx.lineWidth = 0.3;
  ctx.stroke();
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(x, by + 0.62, bw * 0.38, 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawChest(ctx: CanvasRenderingContext2D, o: VisualObject): void {
  const { x, y } = o;
  shadow(ctx, x, y, 4.6, 3.2);
  const bw = 4.8;
  const bh = 3.2;
  const bx = x - bw / 2;
  const by = y - bh + 0.3;
  // Base box.
  ctx.fillStyle = "#6a4c2c";
  ctx.strokeStyle = "#33250f";
  ctx.lineWidth = 0.35;
  rr(ctx, bx, by + 1.4, bw, bh - 1.4, 0.5);
  ctx.fill();
  ctx.stroke();
  // Curved lid.
  ctx.fillStyle = "#7a5a36";
  ctx.beginPath();
  ctx.moveTo(bx, by + 1.5);
  ctx.quadraticCurveTo(bx, by + 0.1, bx + bw / 2, by - 0.15);
  ctx.quadraticCurveTo(bx + bw, by + 0.1, bx + bw, by + 1.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Metal bands.
  ctx.fillStyle = "#8a6a2f";
  ctx.fillRect(bx - 0.1, by + 1.45, 0.55, bh - 1.4);
  ctx.fillRect(bx + bw - 0.45, by + 1.45, 0.55, bh - 1.4);
  // Lock plate + keyhole.
  ctx.fillStyle = "#c9a34a";
  rr(ctx, x - 0.55, by + 0.5, 1.1, 1.2, 0.3);
  ctx.fill();
  ctx.fillStyle = "#3a2c12";
  ctx.beginPath();
  ctx.arc(x, by + 1.1, 0.22, 0, Math.PI * 2);
  ctx.fill();
  // Lid sheen.
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.ellipse(x - 0.5, by + 0.5, 1.2, 0.4, -0.3, 0, Math.PI * 2);
  ctx.fill();
}

function drawThrone(ctx: CanvasRenderingContext2D, o: VisualObject): void {
  const { x, y } = o;
  shadow(ctx, x, y, 5.2, 3.6);
  const bw = 5.4;
  const bx = x - bw / 2;
  // Tall arched back.
  ctx.fillStyle = "#4a4356";
  ctx.strokeStyle = "#241f2e";
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  ctx.moveTo(bx + 0.4, y - 1.2);
  ctx.lineTo(bx + 0.6, y - 4.4);
  ctx.quadraticCurveTo(x, y - 5.4, bx + bw - 0.6, y - 4.4);
  ctx.lineTo(bx + bw - 0.4, y - 1.2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Gold trim + gem.
  ctx.strokeStyle = "#c9a34a";
  ctx.lineWidth = 0.3;
  ctx.beginPath();
  ctx.moveTo(bx + 1.0, y - 4.0);
  ctx.quadraticCurveTo(x, y - 4.8, bx + bw - 1.0, y - 4.0);
  ctx.stroke();
  ctx.fillStyle = "#ff7b72";
  ctx.beginPath();
  ctx.moveTo(x, y - 4.35);
  ctx.lineTo(x + 0.4, y - 3.95);
  ctx.lineTo(x, y - 3.55);
  ctx.lineTo(x - 0.4, y - 3.95);
  ctx.closePath();
  ctx.fill();
  // Seat.
  ctx.fillStyle = "#3c3648";
  rr(ctx, bx + 0.7, y - 1.5, bw - 1.4, 1.3, 0.5);
  ctx.fill();
  ctx.strokeStyle = "#241f2e";
  ctx.lineWidth = 0.3;
  ctx.stroke();
  // Armrests with gold caps.
  ctx.fillStyle = "#4a4356";
  rr(ctx, bx + 0.05, y - 2.5, 1.0, 1.7, 0.4);
  ctx.fill();
  rr(ctx, bx + bw - 1.05, y - 2.5, 1.0, 1.7, 0.4);
  ctx.fill();
  ctx.fillStyle = "#c9a34a";
  rr(ctx, bx + 0.05, y - 2.6, 1.0, 0.35, 0.2);
  ctx.fill();
  rr(ctx, bx + bw - 1.05, y - 2.6, 1.0, 0.35, 0.2);
  ctx.fill();
  // Plinth.
  ctx.fillStyle = "#332d3f";
  rr(ctx, bx + 0.2, y - 0.3, bw - 0.4, 0.5, 0.25);
  ctx.fill();
}

const BOOK_COLORS = ["#8a4a3a", "#3a5a7a", "#5a7a4a", "#7a6a3a", "#6a4a7a", "#8a6a5a", "#4a6a6a", "#7a3a4a"];

function drawBookshelf(ctx: CanvasRenderingContext2D, o: VisualObject): void {
  const { x, y } = o;
  shadow(ctx, x, y, 6.0, 3.6);
  const bw = 6.2;
  const bh = 5.4;
  const bx = x - bw / 2;
  const by = y - bh + 0.4;
  // Frame + dark interior.
  ctx.fillStyle = "#4a3a28";
  ctx.strokeStyle = "#241a0e";
  ctx.lineWidth = 0.4;
  rr(ctx, bx, by, bw, bh, 0.5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#332818";
  rr(ctx, bx + 0.4, by + 0.4, bw - 0.8, bh - 0.8, 0.3);
  ctx.fill();
  // Shelves.
  const shelfYs = [by + 1.7, by + 3.3, by + 4.85];
  ctx.fillStyle = "#5c4a34";
  for (const sy of shelfYs) ctx.fillRect(bx + 0.4, sy - 0.14, bw - 0.8, 0.28);
  // Books (varied heights/colors, some leaning).
  let seed = 0;
  for (const sy of shelfYs) {
    let bx2 = bx + 0.7;
    while (bx2 < bx + bw - 1.2) {
      const w = 0.42 + ((seed * 13) % 30) / 100;
      const h = 0.9 + ((seed * 7) % 5) / 10;
      const c = BOOK_COLORS[seed % BOOK_COLORS.length];
      const lean = seed % 9 === 4;
      ctx.fillStyle = c;
      if (lean) {
        ctx.save();
        ctx.translate(bx2 + w / 2, sy - h / 2);
        ctx.rotate(-0.35);
        rr(ctx, -w / 2, -h / 2, w, h, 0.1);
        ctx.fill();
        ctx.restore();
      } else {
        rr(ctx, bx2, sy - h, w, h, 0.1);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.10)";
        ctx.fillRect(bx2 + 0.08, sy - h + 0.12, w - 0.16, 0.12);
        ctx.fillStyle = c;
      }
      bx2 += w + 0.12;
      seed++;
    }
  }
  // Top molding.
  ctx.fillStyle = "#5c4a34";
  ctx.fillRect(bx - 0.2, by - 0.1, bw + 0.4, 0.5);
}

function drawCouch(ctx: CanvasRenderingContext2D, o: VisualObject): void {
  const { x, y } = o;
  shadow(ctx, x, y, 3.4, 4.2);
  const bw = 3.8;
  const bx = x - bw / 2;
  const fabric = "#3f5a5c";
  const fabricDark = "#33494b";
  const fabricLight = "#4d6c6e";
  // Backrest.
  ctx.fillStyle = fabric;
  ctx.strokeStyle = "#1d2a2c";
  ctx.lineWidth = 0.35;
  rr(ctx, bx, y - 4.2, bw, 2.4, 0.8);
  ctx.fill();
  ctx.stroke();
  // Back cushions.
  ctx.fillStyle = fabricLight;
  rr(ctx, bx + 0.4, y - 3.9, bw / 2 - 0.6, 1.8, 0.5);
  ctx.fill();
  rr(ctx, bx + bw / 2 + 0.2, y - 3.9, bw / 2 - 0.6, 1.8, 0.5);
  ctx.fill();
  // Seat.
  ctx.fillStyle = fabric;
  rr(ctx, bx + 0.35, y - 2.2, bw - 0.7, 1.3, 0.4);
  ctx.fill();
  ctx.strokeStyle = "#1d2a2c";
  ctx.lineWidth = 0.3;
  ctx.stroke();
  // Seat cushion split.
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 0.2;
  line(ctx, x, y - 2.2, x, y - 1.0);
  // Armrests.
  ctx.fillStyle = fabricDark;
  rr(ctx, bx - 0.25, y - 2.6, 1.1, 2.0, 0.5);
  ctx.fill();
  rr(ctx, bx + bw - 0.85, y - 2.6, 1.1, 2.0, 0.5);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  rr(ctx, bx - 0.15, y - 2.55, 0.9, 0.4, 0.2);
  ctx.fill();
  rr(ctx, bx + bw - 0.75, y - 2.55, 0.9, 0.4, 0.2);
  ctx.fill();
  // Legs.
  ctx.fillStyle = "#1d2a2c";
  ctx.fillRect(bx + 0.5, y - 0.7, 0.35, 0.75);
  ctx.fillRect(bx + bw - 0.85, y - 0.7, 0.35, 0.75);
}

function drawTapestry(ctx: CanvasRenderingContext2D, o: VisualObject): void {
  const { x, y } = o;
  shadow(ctx, x, y, 4.6, 4.4);
  const bw = 5.6;
  const bh = 6.0;
  const bx = x - bw / 2;
  const by = y - bh + 0.5;
  // Hanging rod + finials.
  ctx.fillStyle = "#4a4a55";
  rr(ctx, bx - 0.5, by - 0.55, bw + 1.0, 0.6, 0.3);
  ctx.fill();
  ctx.fillStyle = "#c9a34a";
  ctx.beginPath();
  ctx.arc(bx - 0.55, by - 0.25, 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(bx + bw + 0.55, by - 0.25, 0.35, 0, Math.PI * 2);
  ctx.fill();
  // Banner.
  ctx.fillStyle = "#6a2f2f";
  ctx.strokeStyle = "#3a1818";
  ctx.lineWidth = 0.4;
  rr(ctx, bx, by + 0.1, bw, bh - 0.6, 0.3);
  ctx.fill();
  ctx.stroke();
  // Gold border.
  ctx.strokeStyle = "#c9a34a";
  ctx.lineWidth = 0.25;
  rr(ctx, bx + 0.5, by + 0.6, bw - 1.0, bh - 1.7, 0.2);
  ctx.stroke();
  // Crescent emblem.
  ctx.fillStyle = "#e0b45a";
  ctx.beginPath();
  ctx.arc(x + 0.15, y - 0.6, 1.0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#6a2f2f";
  ctx.beginPath();
  ctx.arc(x - 0.25, y - 0.6, 0.85, 0, Math.PI * 2);
  ctx.fill();
  // Folds.
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 0.2;
  line(ctx, x - 1.6, by + 0.4, x - 1.6, by + bh - 0.8);
  line(ctx, x + 1.6, by + 0.4, x + 1.6, by + bh - 0.8);
  // Fringe.
  ctx.fillStyle = "#e0b45a";
  for (let i = 0; i < 8; i++) ctx.fillRect(bx + 0.8 + i * 0.62, by + bh - 0.75, 0.22, 0.5);
}

function drawBrazier(ctx: CanvasRenderingContext2D, o: VisualObject, timeMs: number): void {
  const { x, y } = o;
  shadow(ctx, x, y, 3.8, 3.0);
  const flick = 0.8 + 0.2 * Math.sin(timeMs / 110);
  // Ember glow pool.
  ctx.fillStyle = `rgba(255,157,122,${0.10 + 0.05 * flick})`;
  ctx.beginPath();
  ctx.ellipse(x, y - 0.6, 3.4, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  // Tripod legs + base ring.
  ctx.strokeStyle = "#3a3a44";
  ctx.lineWidth = 0.4;
  line(ctx, x - 1.5, y - 1.9, x - 1.2, y - 0.3);
  line(ctx, x + 1.5, y - 1.9, x + 1.2, y - 0.3);
  line(ctx, x, y - 2.1, x, y - 0.3);
  ctx.fillStyle = "#3a3a44";
  ctx.beginPath();
  ctx.ellipse(x, y - 0.35, 1.55, 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  // Bowl.
  ctx.fillStyle = "#45454f";
  ctx.strokeStyle = "#22222a";
  ctx.lineWidth = 0.35;
  rr(ctx, x - 1.9, y - 3.0, 3.8, 1.6, 0.9);
  ctx.fill();
  ctx.stroke();
  // Coals.
  ctx.fillStyle = `rgba(255,120,60,${0.55 + 0.3 * flick})`;
  ctx.beginPath();
  ctx.ellipse(x, y - 2.35, 1.25, 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(255,209,102,${0.5 * flick})`;
  ctx.beginPath();
  ctx.ellipse(x, y - 2.35, 0.7, 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  // Flame.
  const fh = 1.1 + 0.25 * Math.sin(timeMs / 90);
  ctx.fillStyle = `rgba(255,157,80,${0.85 * flick})`;
  ctx.beginPath();
  ctx.moveTo(x - 0.55, y - 2.5);
  ctx.quadraticCurveTo(x - 0.3, y - 2.5 - fh * 0.6, x, y - 2.5 - fh);
  ctx.quadraticCurveTo(x + 0.3, y - 2.5 - fh * 0.6, x + 0.55, y - 2.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = `rgba(255,235,160,${0.8 * flick})`;
  ctx.beginPath();
  ctx.moveTo(x - 0.28, y - 2.5);
  ctx.quadraticCurveTo(x, y - 2.5 - fh * 0.45, x, y - 2.5 - fh * 0.7);
  ctx.quadraticCurveTo(x + 0.18, y - 2.5 - fh * 0.4, x + 0.28, y - 2.5);
  ctx.closePath();
  ctx.fill();
  // Rising embers.
  ctx.fillStyle = `rgba(255,180,90,${0.5 + 0.3 * Math.sin(timeMs / 130 + 1)})`;
  ctx.beginPath();
  ctx.arc(x - 0.5, y - 3.4, 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(255,200,120,${0.4 + 0.3 * Math.sin(timeMs / 150 + 2)})`;
  ctx.beginPath();
  ctx.arc(x + 0.4, y - 3.6, 0.1, 0, Math.PI * 2);
  ctx.fill();
}

function drawStatue(ctx: CanvasRenderingContext2D, o: VisualObject): void {
  const { x, y } = o;
  shadow(ctx, x, y, 4.2, 4.0);
  // Plinth.
  ctx.fillStyle = "#5a5a66";
  ctx.strokeStyle = "#33333c";
  ctx.lineWidth = 0.35;
  rr(ctx, x - 2.3, y - 0.7, 4.6, 0.8, 0.3);
  ctx.fill();
  ctx.stroke();
  // Column base.
  ctx.fillStyle = "#66666f";
  rr(ctx, x - 1.7, y - 1.8, 3.4, 1.2, 0.3);
  ctx.fill();
  ctx.stroke();
  // Guardian figure.
  const body = "#6f6f78";
  ctx.fillStyle = body;
  rr(ctx, x - 1.0, y - 5.0, 2.0, 3.4, 0.9);
  ctx.fill();
  ctx.strokeStyle = "#33333c";
  ctx.lineWidth = 0.35;
  ctx.stroke();
  // Arms.
  rr(ctx, x - 1.45, y - 4.4, 0.5, 1.6, 0.25);
  ctx.fill();
  rr(ctx, x + 0.95, y - 4.4, 0.5, 1.6, 0.25);
  ctx.fill();
  // Head + helmet visor.
  ctx.beginPath();
  ctx.arc(x, y - 5.45, 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2b2b33";
  ctx.fillRect(x - 0.42, y - 5.5, 0.84, 0.14);
  // Spear.
  ctx.strokeStyle = "#3d3d46";
  ctx.lineWidth = 0.22;
  line(ctx, x + 1.2, y - 5.9, x + 1.2, y - 2.2);
  ctx.fillStyle = "#8a8a94";
  ctx.beginPath();
  ctx.moveTo(x + 1.2, y - 6.0);
  ctx.lineTo(x + 1.45, y - 5.75);
  ctx.lineTo(x + 0.95, y - 5.75);
  ctx.closePath();
  ctx.fill();
  // Highlight + moss.
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.fillRect(x - 0.9, y - 4.9, 0.3, 3.0);
  ctx.fillStyle = "#4a6a3a";
  ctx.beginPath();
  ctx.arc(x - 1.9, y - 0.2, 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 1.6, y - 0.35, 0.14, 0, Math.PI * 2);
  ctx.fill();
}

function drawCauldron(ctx: CanvasRenderingContext2D, o: VisualObject, timeMs: number): void {
  const { x, y } = o;
  shadow(ctx, x, y, 4.4, 3.2);
  // Faint brew glow.
  const g = 0.5 + 0.5 * Math.sin(timeMs / 900);
  ctx.fillStyle = `rgba(142,227,107,${0.06 + 0.05 * g})`;
  ctx.beginPath();
  ctx.ellipse(x, y - 1.4, 3.0, 2.0, 0, 0, Math.PI * 2);
  ctx.fill();
  // Legs.
  ctx.fillStyle = "#22222a";
  ctx.fillRect(x - 1.7, y - 0.5, 0.5, 0.7);
  ctx.fillRect(x + 1.2, y - 0.5, 0.5, 0.7);
  ctx.fillRect(x - 0.25, y - 0.35, 0.5, 0.55);
  // Body.
  ctx.fillStyle = "#2e2e36";
  ctx.strokeStyle = "#141419";
  ctx.lineWidth = 0.4;
  rr(ctx, x - 2.4, y - 2.9, 4.8, 2.7, 1.2);
  ctx.fill();
  ctx.stroke();
  // Rim + bubbling liquid.
  ctx.fillStyle = "#3d3d47";
  ctx.beginPath();
  ctx.ellipse(x, y - 2.9, 2.4, 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#141419";
  ctx.lineWidth = 0.3;
  ctx.stroke();
  ctx.fillStyle = `rgba(110,190,90,${0.5 + 0.2 * g})`;
  ctx.beginPath();
  ctx.ellipse(x, y - 2.95, 2.0, 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  // Bubbles.
  const b1 = (timeMs / 700) % 1;
  ctx.fillStyle = `rgba(170,255,140,${0.6 * (1 - b1)})`;
  ctx.beginPath();
  ctx.arc(x - 0.6, y - 3.0 - b1 * 0.9, 0.12, 0, Math.PI * 2);
  ctx.fill();
  const b2 = ((timeMs + 350) / 700) % 1;
  ctx.fillStyle = `rgba(170,255,140,${0.5 * (1 - b2)})`;
  ctx.beginPath();
  ctx.arc(x + 0.5, y - 3.05 - b2 * 0.8, 0.09, 0, Math.PI * 2);
  ctx.fill();
  // Handles.
  ctx.strokeStyle = "#3d3d47";
  ctx.lineWidth = 0.3;
  ctx.beginPath();
  ctx.arc(x - 2.45, y - 2.2, 0.5, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + 2.45, y - 2.2, 0.5, Math.PI / 2, -Math.PI / 2);
  ctx.stroke();
}

// Fallback: the old slab + plaque (unknown furniture should never appear).
function drawGeneric(ctx: CanvasRenderingContext2D, o: VisualObject): void {
  shadow(ctx, o.x, o.y, o.w, o.h);
  ctx.fillStyle = "#333b52";
  rr(ctx, o.x - o.w / 2 + 0.4, o.y - o.h / 2 + 0.6, o.w, o.h, 1.2);
  ctx.fill();
  ctx.fillStyle = "#4d5871";
  rr(ctx, o.x - o.w / 2, o.y - o.h / 2, o.w, o.h, 1.2);
  ctx.fill();
  ctx.strokeStyle = "#222a3d";
  ctx.lineWidth = 0.5;
  ctx.stroke();
}

// ---- labels (secondary info only) -----------------------------------------

function drawLabel(ctx: CanvasRenderingContext2D, o: VisualObject, alpha: number): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#d6deee";
  ctx.font = "600 0.8px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(o.name.toUpperCase(), o.x, o.y + o.h * 0.55 + 0.55);
  ctx.globalAlpha = 1;
}

// ---- entry point -----------------------------------------------------------

export function drawVisualObject(
  ctx: CanvasRenderingContext2D,
  o: VisualObject,
  timeMs: number,
  labelAlpha: number,
): void {
  switch (o.kind) {
    case "fridge": drawFridge(ctx, o); break;
    case "barrel": drawBarrel(ctx, o); break;
    case "chest": drawChest(ctx, o); break;
    case "throne": drawThrone(ctx, o); break;
    case "bookshelf": drawBookshelf(ctx, o); break;
    case "couch": drawCouch(ctx, o); break;
    case "tapestry": drawTapestry(ctx, o); break;
    case "brazier": drawBrazier(ctx, o, timeMs); break;
    case "statue": drawStatue(ctx, o); break;
    case "cauldron": drawCauldron(ctx, o, timeMs); break;
    default: drawGeneric(ctx, o); break;
  }
  if (labelAlpha > 0.02) drawLabel(ctx, o, labelAlpha);
}

// ---- room-specific props (decor, no gameplay) ------------------------------
// Fixed positions chosen to avoid furniture, pedestals, closets, vents, and
// hatches in the engine layout.

export function drawRoomProps(ctx: CanvasRenderingContext2D, timeMs: number): void {
  // Cafeteria: a kitchen counter with steaming pots, and a food crate.
  drawCounter(ctx, 33, 21, timeMs);
  drawFoodCrate(ctx, 86, 10);
  // Library: a reading desk with an open book and a warm lamp.
  drawDesk(ctx, 60, 40, timeMs);
  // Reactor: a warning-striped machine console.
  drawConsole(ctx, 34, 54, timeMs);
  // Storage: stacked crates.
  drawCrate(ctx, 61, 54);
  drawCrate(ctx, 72, 54, 0.9);
}

function drawCounter(ctx: CanvasRenderingContext2D, x: number, y: number, timeMs: number): void {
  shadow(ctx, x, y, 4.0, 2.0);
  ctx.fillStyle = "#5c4a3a";
  ctx.strokeStyle = "#2e2418";
  ctx.lineWidth = 0.3;
  rr(ctx, x - 2.0, y - 0.9, 4.0, 1.1, 0.3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#6f5a44";
  rr(ctx, x - 2.05, y - 1.0, 4.1, 0.35, 0.2);
  ctx.fill();
  // Pots.
  ctx.fillStyle = "#4a4a55";
  rr(ctx, x - 1.3, y - 1.5, 0.9, 0.7, 0.3);
  ctx.fill();
  ctx.fillStyle = "#3a3a44";
  rr(ctx, x + 0.5, y - 1.4, 0.8, 0.6, 0.3);
  ctx.fill();
  ctx.fillStyle = "#22222a";
  ctx.fillRect(x - 0.95, y - 1.55, 0.2, 0.14);
  // Steam wisps.
  const s = 0.5 + 0.5 * Math.sin(timeMs / 600);
  ctx.strokeStyle = `rgba(200,210,225,${0.12 * s})`;
  ctx.lineWidth = 0.15;
  ctx.beginPath();
  ctx.moveTo(x - 0.85, y - 1.7);
  ctx.quadraticCurveTo(x - 0.75, y - 2.0, x - 0.9, y - 2.3);
  ctx.stroke();
}

function drawFoodCrate(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  shadow(ctx, x, y, 2.4, 2.0);
  ctx.fillStyle = "#6a5236";
  ctx.strokeStyle = "#33250f";
  ctx.lineWidth = 0.3;
  rr(ctx, x - 1.2, y - 1.5, 2.4, 1.7, 0.25);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "rgba(51,37,15,0.5)";
  ctx.lineWidth = 0.14;
  line(ctx, x - 1.2, y - 1.0, x + 1.2, y - 1.0);
  line(ctx, x - 1.2, y - 0.4, x + 1.2, y - 0.4);
  line(ctx, x - 0.6, y - 1.5, x + 0.6, y + 0.2);
}

function drawDesk(ctx: CanvasRenderingContext2D, x: number, y: number, timeMs: number): void {
  shadow(ctx, x, y, 3.6, 2.4);
  // Desk top + legs.
  ctx.fillStyle = "#5c4a3a";
  ctx.strokeStyle = "#2e2418";
  ctx.lineWidth = 0.3;
  rr(ctx, x - 1.8, y - 0.5, 3.6, 0.5, 0.2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#3d3023";
  ctx.fillRect(x - 1.6, y, 0.35, 0.9);
  ctx.fillRect(x + 1.25, y, 0.35, 0.9);
  // Open book.
  ctx.fillStyle = "#d8cfc0";
  rr(ctx, x - 0.9, y - 1.15, 1.8, 1.0, 0.15);
  ctx.fill();
  ctx.strokeStyle = "rgba(90,70,50,0.5)";
  ctx.lineWidth = 0.12;
  line(ctx, x - 0.55, y - 0.9, x - 0.55, y - 0.35);
  line(ctx, x - 0.2, y - 0.9, x - 0.2, y - 0.35);
  line(ctx, x + 0.15, y - 0.9, x + 0.15, y - 0.35);
  line(ctx, x + 0.5, y - 0.9, x + 0.5, y - 0.35);
  // Lamp with warm flickering glow.
  ctx.fillStyle = "#4a4a55";
  ctx.fillRect(x + 1.1, y - 1.2, 0.14, 0.7);
  const flick = 0.85 + 0.15 * Math.sin(timeMs / 500);
  ctx.fillStyle = `rgba(255,209,102,${0.9 * flick})`;
  ctx.beginPath();
  ctx.arc(x + 1.17, y - 1.45, 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(255,209,102,${0.10 * flick})`;
  ctx.beginPath();
  ctx.ellipse(x + 1.17, y - 1.3, 1.6, 1.1, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawConsole(ctx: CanvasRenderingContext2D, x: number, y: number, timeMs: number): void {
  shadow(ctx, x, y, 3.6, 2.4);
  // Machine body.
  ctx.fillStyle = "#3d3d47";
  ctx.strokeStyle = "#1c1c22";
  ctx.lineWidth = 0.35;
  rr(ctx, x - 1.8, y - 1.6, 3.6, 1.8, 0.4);
  ctx.fill();
  ctx.stroke();
  // Flickering screen.
  const flick = 0.7 + 0.3 * Math.sin(timeMs / 300);
  ctx.fillStyle = `rgba(255,123,114,${0.5 + 0.4 * flick})`;
  rr(ctx, x - 1.4, y - 1.3, 2.8, 0.9, 0.2);
  ctx.fill();
  ctx.fillStyle = "rgba(40,10,10,0.5)";
  ctx.fillRect(x - 1.2, y - 1.0, 1.2, 0.12);
  ctx.fillRect(x - 1.2, y - 0.75, 0.8, 0.12);
  // Indicator buttons.
  ctx.fillStyle = "#ff9d7a";
  ctx.beginPath();
  ctx.arc(x - 0.8, y - 0.1, 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#8ee36b";
  ctx.beginPath();
  ctx.arc(x - 0.3, y - 0.1, 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#4fc3f7";
  ctx.beginPath();
  ctx.arc(x + 0.2, y - 0.1, 0.16, 0, Math.PI * 2);
  ctx.fill();
  // Warning stripe corner.
  ctx.fillStyle = "#ff7b72";
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.translate(x + 1.1, y - 1.5);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-0.16, -0.6, 0.32, 1.2);
    ctx.restore();
  }
  // Side pipe.
  ctx.strokeStyle = "#5b6a8a";
  ctx.lineWidth = 0.5;
  line(ctx, x + 1.9, y - 1.2, x + 1.9, y - 0.2);
}

function drawCrate(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1): void {
  shadow(ctx, x, y, 2.6 * scale, 2.2 * scale);
  ctx.fillStyle = "#6a5236";
  ctx.strokeStyle = "#33250f";
  ctx.lineWidth = 0.3;
  rr(ctx, x - 1.3 * scale, y - 1.5 * scale, 2.6 * scale, 1.8 * scale, 0.2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "rgba(51,37,15,0.55)";
  ctx.lineWidth = 0.14;
  line(ctx, x - 1.3 * scale, y - 0.9 * scale, x + 1.3 * scale, y - 0.9 * scale);
  line(ctx, x - 1.3 * scale, y - 0.2 * scale, x + 1.3 * scale, y - 0.2 * scale);
  line(ctx, x - 0.8 * scale, y - 1.5 * scale, x + 0.8 * scale, y + 0.3 * scale);
  line(ctx, x + 0.8 * scale, y - 1.5 * scale, x - 0.8 * scale, y + 0.3 * scale);
}

