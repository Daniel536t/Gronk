// Original fantasy-adventurer character renderer (Phase 3).
//
// Replaces the Among-Us-style bean crewmates with a hooded adventurer that
// belongs to Gronk's dark-fantasy interior: a pointed hood with a shadowed
// face opening and two glowing eyes, a flared cloak with a belt and gold
// buckle, tiny boots, and a star-tipped wand. The hood opening, eyes, wand,
// and hood lean all point in the facing direction, so movement direction
// reads at a glance even at gameplay zoom.
//
// This module is PURE presentation: it consumes the engine's authoritative
// Player state and draws. It never changes game state. Walk animation is
// driven by a caller-supplied phase (advanced by movement speed), idle adds a
// breath + eye blink, stunned adds orbiting stars + a slouch + the existing
// white flash, in_closet desaturates, and a transformed LOCAL player renders
// as a translucent "absorbed" ghost (disguised opponents draw nothing at all —
// they ARE the furniture). Phase 4's hiding/occlusion builds on the same
// state feed; nothing here is gameplay.
import type { Player } from "../engine/types";

export type Facing = "up" | "down" | "left" | "right";

/** Per-frame render info for automated visual QA (read-only, not gameplay). */
export interface CharacterRenderInfo {
  id: string;
  drawn: boolean;
  x: number;
  y: number;
  w: number; // approx body width, world units
  h: number; // approx total height, world units
  state: Player["state"];
  face: Facing;
  color: string;
  animTick: number; // 60fps animation clock (for "animation is alive" checks)
}

export interface CharacterOpts {
  x: number;
  y: number; // feet baseline (world units)
  bodyColor: string; // primary player color
  darkColor: string; // secondary material (trim, boots, wand)
  teamColor: string; // team pip on the floor
  state: Player["state"];
  carrying: boolean;
  walkPhase: number; // radians — advance by movement speed
  speed: number; // 0..1 normalized walk speed
  facing: Facing;
  timeMs: number;
  ghost: boolean; // transformed + local player: translucent absorber feedback
  /** Phase 4: extra fade/scale applied by the hide enter/exit animation.
   *  Pure presentation — the server state is untouched. */
  alphaMul?: number;
  scaleMul?: number;
}

const GOLD = "#ffd166";
const EYE = "#ffe08a";

/** lighten (f>1) or darken (f<1) a hex color. */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

/** Four-point sparkle (wand tip, stun stars). */
function star4(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y - r * 0.2, x + r * 0.3, y);
  ctx.quadraticCurveTo(x, y + r * 0.2, x, y + r);
  ctx.quadraticCurveTo(x, y + r * 0.2, x - r * 0.3, y);
  ctx.quadraticCurveTo(x, y - r * 0.2, x, y - r);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawCharacter(ctx: CanvasRenderingContext2D, o: CharacterOpts): void {
  const walking = o.speed > 0.05;
  const bob = walking ? Math.abs(Math.sin(o.walkPhase)) * 0.13 : 0;
  const breathe = walking ? 1 : 1 + 0.018 * Math.sin(o.timeMs / 300);
  const flash = o.state === "stunned" && Math.floor(o.timeMs / 90) % 2 === 0;
  const closeted = o.state === "in_closet";

  let body = o.bodyColor;
  let dark = o.darkColor;
  if (flash) {
    body = "#ffffff";
    dark = "#dde3ee";
  } else if (closeted) {
    body = "#7b8496";
    dark = "#565e6e";
  }

  const ghost = o.ghost;
  const fade = Math.min(1, o.alphaMul ?? 1);
  const baseAlpha = (ghost ? 0.3 + 0.08 * Math.sin(o.timeMs / 260) : closeted ? 0.88 : 1) * fade;

  // ---- floor marks (world space, not the local frame) ---------------------
  // These sit under the character, so they share the hide animation's fade and
  // squash — a fading body must not leave a full-strength pip/shadow behind.
  const squash = o.scaleMul ?? 1;
  // Team pip: small colored floor ring under the feet (identity at a glance).
  ctx.save();
  ctx.globalAlpha = 0.55 * fade;
  ctx.fillStyle = o.teamColor;
  ctx.beginPath();
  ctx.ellipse(o.x, o.y + 0.42, 0.78 * squash, 0.26 * squash, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Soft ground shadow, slightly stretched while moving.
  ctx.save();
  ctx.globalAlpha = 0.4 * fade;
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(o.x + 0.08, o.y + 0.34, (walking ? 1.05 : 0.95) * squash, 0.3 * squash, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Carrier: warm gold aura behind the body.
  if (o.carrying) {
    const pulse = 1 + 0.12 * Math.sin(o.timeMs / 120);
    ctx.save();
    ctx.globalAlpha = 0.22 * fade;
    ctx.fillStyle = "rgba(255,209,102,0.22)";
    ctx.beginPath();
    ctx.arc(o.x, o.y - 1.1, 1.75 * pulse * squash, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---- character (local frame, feet at y=0) -------------------------------
  ctx.save();
  ctx.translate(o.x, o.y - bob);
  ctx.scale(squash, squash * breathe);
  ctx.globalAlpha = baseAlpha;

  const DX = o.facing === "left" ? -1 : o.facing === "right" ? 1 : 0;
  const DY = o.facing === "up" ? -1 : o.facing === "down" ? 1 : 0;
  const lean = o.facing === "down" ? 0.22 : o.facing === "up" ? -0.08 : DX * 0.14;

  // --- cloak body: rounded trapezoid, shoulder highlight -> dark hem --------
  const grad = ctx.createLinearGradient(0, -2.05, 0, -0.35);
  grad.addColorStop(0, shade(body, 1.12));
  grad.addColorStop(1, shade(body, 0.72));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-0.62, -2.05);
  ctx.quadraticCurveTo(-0.8, -1.3, -0.78, -0.45);
  ctx.quadraticCurveTo(0, -0.16, 0.78, -0.45);
  ctx.quadraticCurveTo(0.8, -1.3, 0.62, -2.05);
  ctx.closePath();
  ctx.fill();

  // Hem band (secondary material).
  ctx.globalAlpha = baseAlpha * 0.85;
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.roundRect(-0.7, -0.56, 1.4, 0.2, 0.09);
  ctx.fill();

  // Belt + gold buckle.
  ctx.globalAlpha = baseAlpha * 0.9;
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.roundRect(-0.62, -1.32, 1.24, 0.24, 0.08);
  ctx.fill();
  ctx.fillStyle = GOLD;
  ctx.fillRect(-0.1, -1.29, 0.2, 0.18);
  ctx.globalAlpha = baseAlpha;
  ctx.fillStyle = shade(body, 0.85);
  ctx.fillRect(-0.05, -1.26, 0.1, 0.12);

  // --- hood: pointed cone leaning toward the facing direction ---------------
  const hg = ctx.createLinearGradient(0, -2.0, 0, -3.2);
  hg.addColorStop(0, shade(body, 0.92));
  hg.addColorStop(1, shade(body, 1.1));
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.moveTo(-0.58, -2.02);
  ctx.quadraticCurveTo(-0.55, -2.72, lean * 0.7, -3.2);
  ctx.quadraticCurveTo(0.55, -2.72, 0.58, -2.02);
  ctx.closePath();
  ctx.fill();

  // Hood rim + tip tassel.
  ctx.globalAlpha = baseAlpha * 0.8;
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.roundRect(-0.58, -2.1, 1.16, 0.16, 0.07);
  ctx.fill();
  ctx.globalAlpha = baseAlpha;
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.arc(lean * 0.7, -3.27, 0.05, 0, Math.PI * 2);
  ctx.fill();

  // --- face: shadowed hood opening + two glowing eyes (direction cue) -------
  const cx = DX * 0.2 + lean * 0.3;
  const cy = -2.58 + DY * 0.16;
  ctx.fillStyle = "#0b0e17";
  ctx.beginPath();
  ctx.ellipse(cx, cy, 0.4, 0.27, 0, 0, Math.PI * 2);
  ctx.fill();
  const blink = o.timeMs % 3400 < 140;
  ctx.fillStyle = EYE;
  if (ghost) ctx.globalAlpha *= 0.55;
  for (const ex of [-0.11, 0.11]) {
    ctx.beginPath();
    if (blink) ctx.ellipse(cx + ex, cy, 0.08, 0.03, 0, 0, Math.PI * 2);
    else ctx.arc(cx + ex, cy, 0.08, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = baseAlpha;

  // --- arms: small sleeves swinging along the facing axis -------------------
  const swing = walking ? Math.sin(o.walkPhase) * 0.13 : 0;
  ctx.fillStyle = shade(body, 0.85);
  ctx.beginPath();
  ctx.roundRect(-0.5 + swing * DX * 0.6, -1.95 + swing * DY * 0.6, 0.34, 0.55, 0.16);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(0.5 - swing * DX * 0.6, -1.95 - swing * DY * 0.6, 0.34, 0.55, 0.16);
  ctx.fill();

  // --- star-tipped wand held toward the facing direction --------------------
  const hx = DX * 0.6 + 0.3;
  const hy = -1.75 + DY * 0.15;
  const tx = hx + DX * 0.55;
  const ty = hy + DY * 0.55;
  ctx.strokeStyle = dark;
  ctx.lineWidth = 0.09;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(tx, ty);
  ctx.stroke();
  ctx.save();
  ctx.shadowColor = GOLD;
  ctx.shadowBlur = 0.6;
  star4(ctx, tx, ty, 0.15, GOLD);
  ctx.restore();

  // --- boots: two little feet shuffling on the walk cycle -------------------
  const step = walking ? Math.sin(o.walkPhase) : 0;
  ctx.fillStyle = dark;
  for (const s of [-1, 1]) {
    const lift = walking ? Math.max(0, Math.sin(o.walkPhase + (s > 0 ? 0 : Math.PI))) * 0.07 : 0;
    ctx.beginPath();
    ctx.roundRect(s * 0.3 + step * s * 0.13, -0.3 - lift, 0.4, 0.3, 0.12);
    ctx.fill();
  }

  // --- stunned: orbiting stars around the head ------------------------------
  if (o.state === "stunned") {
    for (let i = 0; i < 3; i++) {
      const a = o.timeMs * 0.0045 + (i * Math.PI * 2) / 3;
      star4(ctx, Math.cos(a) * 1.15, -2.3 + Math.sin(a) * 0.95, 0.17, GOLD, 0.9);
    }
  }

  // --- carrying: bobbing gold diamond above the hood ------------------------
  if (o.carrying) {
    ctx.save();
    ctx.translate(0, -3.7 - 0.12 * Math.sin(o.timeMs / 140));
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = GOLD;
    ctx.fillRect(-0.11, -0.11, 0.22, 0.22);
    ctx.restore();
  }

  // --- transformed (self): motes bleeding out of the disguise ---------------
  if (ghost) {
    for (let i = 0; i < 3; i++) {
      const t = (o.timeMs / 750 + i / 3) % 1;
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.7;
      ctx.fillStyle = o.bodyColor;
      ctx.beginPath();
      ctx.arc(Math.sin(i * 2.4 + o.timeMs / 2600) * 0.7, -0.5 - t * 2.4, 0.07, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.restore();
}
