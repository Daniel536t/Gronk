// Fantasy-adventurer character renderer (Phase 6A — articulated pose rig).
//
// Replaces the fixed trapezoid/cone body with a pose-based rig so characters
// read as physical RPG adventurers inside Gronk's dark interior, not rigid UI
// icons translating across a canvas.
//
// DESIGN.md (ANIMATION LANGUAGE) is the source of truth:
//  - IDLE: breathing + periodic blink + a tiny head/hood tilt; no constant move
//  - WALK: speed-scaled stride (alternating feet plant/push), hip sway, opposing
//    arm swing, body bob, forward lean, cloak lag; a stationary player has ZERO
//    stride (the walk phase is stalled when speed is 0)
//  - STUN: impact flinch -> droop/slouch + wobble + orbiting stars
//  - CARRY: arms-to-hold hunch with the gold diamond held up
//  - DIRECTIONAL SILHOUETTES: readable back / front / left / right poses (a back
//    view hides the face; a front view shows two eyes; profiles show one)
//  - SECONDARY MOTION: cloak hem sways/trails behind movement
//
// This module is PURE presentation: it consumes the engine's authoritative
// Player state and draws. It never changes game state. Local transformed
// players render a translucent absorbed ghost; disguised opponents draw
// nothing (they ARE the furniture).
import type { Player } from "../engine/types";

export type Facing = "up" | "down" | "left" | "right";

/** Per-frame render info for automated visual QA (read-only, not gameplay). */
export interface CharacterRenderInfo {
  id: string;
  mine: boolean; // is this the local player? (QA filtering)
  drawn: boolean;
  x: number;
  y: number;
  w: number; // approx body width, world units
  h: number; // approx total height, world units
  state: Player["state"];
  face: Facing;
  color: string;
  animTick: number; // 60fps animation clock (for "animation is alive" checks)
  // Phase 6A pose params — deterministic articulation check hooks.
  stride: number; // |amplitude of alternating foot offset|
  torsoLean: number; // |signed torso lean toward movement|
  leanSigned: number; // signed torso lean (positive = down/right along facing)
  droop: number; // 0..1 stun slouch
  hunch: number; // 0..1 carrying hunch
  cloakSway: number; // |cloak hem sway offset|
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
  /** When the player most recently entered the stunned state (ms), so the
   *  rig can play a short impact-flinch. Optional; presentation only. */
  stunMs?: number;
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

/** reduced motion gate — amplitude factor (0..1). Read each frame (cheap). */
function reducedMotionFactor(): number {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0.55 : 1;
  } catch {
    return 1;
  }
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

/**
 * A packed pose — pure presentation data computed from authoritative state.
 * Drawn in a local frame whose feet are at (0,0) and whose positive Y points
 * DOWN (canvas space). `{DX,DY}` is the unit facing/movement axis.
 */
export interface Pose {
  gait: number; // 0=idle .. 1=full walk (drives stride amplitudes)
  stride: number; // signed alternating foot offset along the stride axis
  strideAmp: number; // |stride|
  liftL: number; // left foot lift (0..1)
  liftR: number; // right foot lift
  bob: number; // vertical body bob
  hipSway: number; // horizontal hip sway (perpendicular to stride)
  bobHip: number; // combined bob for QA (peak |bob| + stride)
  lean: number; // signed torso lean (world X for L/R, world Y for U/D)
  armSwingL: number; // own-arm swing
  armSwingR: number;
  hoodTilt: number; // hood/head tilt in the facing direction
  cloakSway: number; // cloak hem lateral sway (perpendicular to motion)
  cloakStream: number; // cloak hem trailing opposite motion
  droop: number; // 0..1 stun slouch
  hunch: number; // 0..1 carrying hunch
  wobble: number; // stun wobble angle (radians)
  flinch: number; // 0..1 early stun impact recoil
}

/**
 * Compute the pose for a character from authoritative-state inputs.
 * Allocation-light and all motion is time-based.
 */
export function computePose(o: CharacterOpts): Pose {
  const speed01 = Math.max(0, Math.min(1, o.speed));
  const gait = o.speed > 0.05 ? Math.min(1, speed01 * 1.4) : 0;
  const rm = reducedMotionFactor();

  const DX = o.facing === "left" ? -1 : o.facing === "right" ? 1 : 0;
  const DY = o.facing === "up" ? -1 : o.facing === "down" ? 1 : 0;

  // Stall the walk phase while idle so a stationary character has zero stride.
  const ph = gait > 0 ? o.walkPhase : 0;

  const rawStride = Math.sin(ph) * gait;
  const strideAmp = Math.abs(rawStride) * 0.55 * rm;
  const liftL = gait > 0 ? Math.max(0, Math.sin(ph + Math.PI)) : 0;
  const liftR = gait > 0 ? Math.max(0, Math.sin(ph)) : 0;
  const bob = gait > 0 ? Math.abs(Math.sin(ph)) * 0.12 * rm : 0;
  const hipSway = gait > 0 ? Math.sin(ph + Math.PI / 2) * 0.12 * rm : 0;

  // Forward lean scales with speed, direction-aware. The magnitude is scaled
  // by reduced-motion consistently across every direction (Qodo #14).
  const leanTarget = gait * (0.16 + 0.1 * speed01) * rm;
  const lean =
    o.facing === "down" ? leanTarget : o.facing === "up" ? -0.12 * gait * rm : DX * leanTarget;

  const armSwingL = -Math.sin(ph) * 0.26 * gait * rm;
  const armSwingR = Math.sin(ph) * 0.26 * gait * rm;

  const cloakSway = gait > 0 ? Math.sin(ph + Math.PI / 2) * 0.22 * rm : 0;
  const cloakStream =
    -gait * (0.18 + 0.2 * speed01) * rm * (Math.abs(DX) > Math.abs(DY) ? DX : DY);

  const hoodTilt = lean * 0.7 + (gait > 0 ? Math.sin(ph) * 0.04 * rm : 0);

  // Stun droop/wobble/flinch.
  let droop = o.state === "stunned" ? 0.32 : 0;
  let wobble = o.state === "stunned" ? 0.12 * Math.sin(o.timeMs / 240) : 0;
  let flinch = 0;
  if (o.state === "stunned" && o.stunMs != null) {
    const since = o.timeMs - o.stunMs;
    if (since >= 0 && since < 120) {
      flinch = 1 - since / 120;
      droop = 0.5 + 0.3 * flinch;
      wobble = 0.2 * Math.sin(o.timeMs / 160);
    }
  }

  return {
    gait,
    stride: rawStride * 0.55 * rm,
    strideAmp,
    liftL: liftL * rm,
    liftR: liftR * rm,
    bob,
    hipSway,
    bobHip: bob,
    lean,
    armSwingL,
    armSwingR,
    hoodTilt,
    cloakSway,
    cloakStream,
    droop,
    hunch: o.carrying ? 1 : 0,
    wobble,
    flinch,
  };
}

/**
 * Draw the posed adventurer in world space. This is the public entry point the
 * renderer calls. `pose` is computed inside from opts (so callers keep the old
 * single-arg contract); pass the return of computePose only if you want the
 * pose values for a QA hook.
 */
export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  o: CharacterOpts,
  pose?: Pose,
): Pose {
  const p = pose ?? computePose(o);
  drawPose(ctx, o, p);
  return p;
}

function drawPose(ctx: CanvasRenderingContext2D, o: CharacterOpts, pose: Pose): void {
  const rm = reducedMotionFactor();
  const walking = pose.gait > 0;
  const breathe = 1 + 0.018 * Math.sin(o.timeMs / 300);
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

  // Squash from the Phase 4 hide animation + posture (stun recoil, carry).
  // NOTE: reduced-motion must NOT scale the whole character (that would shrink
  // avatars by 45%); it only damps animated offsets/amplitudes (Qodo #4).
  const squash = (o.scaleMul ?? 1) * (1 - pose.hunch * 0.05) * (1 - pose.flinch * 0.12);

  // ---- floor marks (world space, not the local frame) ---------------------
  const floorSquash = o.scaleMul ?? 1;
  ctx.save();
  ctx.globalAlpha = 0.55 * fade;
  ctx.fillStyle = o.teamColor;
  ctx.beginPath();
  ctx.ellipse(o.x, o.y + 0.42, 0.78 * floorSquash, 0.26 * floorSquash, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.4 * fade;
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(
    o.x + 0.08,
    o.y + 0.34,
    (walking ? 1.08 : 0.95) * floorSquash,
    0.3 * floorSquash,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  // Carrier: warm gold aura behind the body (kept per DESIGN.md).
  if (o.carrying) {
    const pulse = 1 + 0.12 * Math.sin(o.timeMs / 120) * rm;
    ctx.save();
    ctx.globalAlpha = 0.22 * fade;
    ctx.fillStyle = "rgba(255,209,102,0.22)";
    ctx.beginPath();
    ctx.arc(o.x, o.y - 1.1, 1.75 * pulse * floorSquash, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---- character (local frame, feet at y=0, +y DOWN) ----------------------
  ctx.save();
  ctx.translate(o.x, o.y - pose.bob);
  ctx.rotate(pose.wobble * (o.state === "stunned" ? 1 : 0));
  ctx.scale(squash, squash * breathe);
  ctx.globalAlpha = baseAlpha;

  // Feet stay planted on the floor at y=0.
  drawFeet(ctx, pose, dark, baseAlpha, o.facing);

  // Torso + head (everything above the feet). A stun droop compresses and
  // lowers the upper body toward the feet so the slouch actually renders
  // (Qodo #6); the feet remain planted.
  ctx.save();
  ctx.translate(0, pose.droop * 0.22);
  ctx.scale(1 + pose.droop * 0.03, 1 - pose.droop * 0.12);
  drawCloakBody(ctx, pose, body, dark, baseAlpha);
  drawArms(ctx, pose, body, baseAlpha, o.facing);
  drawHoodHead(ctx, o, pose, body, baseAlpha);
  ctx.restore();

  // ---- character-attached effects (drawn INSIDE the local frame so their
  // local coordinates stay attached to the character — Qodo #5) -----------
  if (o.state === "stunned") {
    for (let i = 0; i < 3; i++) {
      const a = o.timeMs * 0.0045 + (i * Math.PI * 2) / 3;
      star4(ctx, Math.cos(a) * 1.15, -2.3 + Math.sin(a) * 0.95, 0.17, GOLD, 0.9 * rm);
    }
  }

  if (o.carrying) {
    // Gold diamond bob held above the hood (arms-to-hold posture is on the body).
    ctx.save();
    ctx.translate(0, -3.7 - 0.12 * Math.sin(o.timeMs / 140) - pose.droop * 0.2);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = GOLD;
    ctx.fillRect(-0.11, -0.11, 0.22, 0.22);
    ctx.restore();
  }

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

/** Feet — alternating stride along the movement axis, front/back in profile. */
function drawFeet(
  ctx: CanvasRenderingContext2D,
  pose: Pose,
  dark: string,
  baseAlpha: number,
  facing: Facing,
): void {
  const DX = facing === "left" ? -1 : facing === "right" ? 1 : 0;
  const DY = facing === "up" ? -1 : facing === "down" ? 1 : 0;
  // perpendicular axis (left/right of the body)
  const px = DY;
  const py = DX;

  ctx.fillStyle = dark;
  ctx.globalAlpha = baseAlpha * 0.9;
  for (const s of [-1, 1]) {
    const lift = s > 0 ? pose.liftR : pose.liftL;
    const along = pose.stride * s; // lead foot +stride, trail -stride
    const perp = s * 0.3;
    const fx = along * DX + perp * px;
    const fy = along * DY + perp * py;
    ctx.save();
    ctx.translate(fx, fy);
    // Boot cap angles to point in the facing direction for front/back views.
    if (facing === "up") ctx.rotate(Math.PI);
    ctx.beginPath();
    ctx.roundRect(-0.18 - lift * 0.03, -0.25 - lift * 0.09, 0.4, 0.26, 0.12);
    ctx.fill();
    ctx.restore();
  }
}

/** Cloak body + hem + belt (the character's core, secondary-motion sway). */
function drawCloakBody(
  ctx: CanvasRenderingContext2D,
  pose: Pose,
  body: string,
  dark: string,
  baseAlpha: number,
): void {
  // Torso lean shifts the shoulders toward the movement axis.
  ctx.save();
  ctx.translate(pose.lean * 0.25, 0);
  ctx.rotate(-pose.lean * 0.15);

  const cw = 0.62; // half-width at shoulders
  const hemW = 0.74; // half-width at hem
  const sway = pose.cloakSway; // lateral sway (perpendicular to motion)
  const stream = pose.cloakStream; // trailing offset opposite movement (Qodo #7)

  const grad = ctx.createLinearGradient(0, -2.0, 0, -0.35);
  grad.addColorStop(0, shade(body, 1.12));
  grad.addColorStop(1, shade(body, 0.72));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-cw, -2.0);
  ctx.quadraticCurveTo(-hemW * 1.1 + sway * 0.1, -1.3 + stream * 0.3, -hemW + sway + stream, -0.42);
  ctx.quadraticCurveTo(0 + stream * 0.4, -0.08 + sway * 0.5 + stream * 0.4, hemW + sway + stream, -0.42);
  ctx.quadraticCurveTo(hemW * 1.1 + sway * 0.1, -1.3 + stream * 0.3, cw, -2.0);
  ctx.closePath();
  ctx.fill();

  // Hem band follows the sway + trail.
  ctx.globalAlpha = baseAlpha * 0.85;
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.roundRect(-hemW + sway + stream, -0.5 + sway * 0.3, hemW * 2, 0.2, 0.09);
  ctx.fill();

  // Belt + gold buckle.
  ctx.globalAlpha = baseAlpha * 0.9;
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.roundRect(-cw * 0.9, -1.28 + pose.hipSway * 0.1, cw * 1.8, 0.24, 0.08);
  ctx.fill();
  ctx.fillStyle = GOLD;
  ctx.fillRect(-0.1, -1.25, 0.2, 0.18);
  ctx.globalAlpha = baseAlpha;
  ctx.fillStyle = shade(body, 0.85);
  ctx.fillRect(-0.05, -1.22, 0.1, 0.12);

  ctx.restore();
}

/** Arms — counter the stride; carrying switches to a two-handed hold. */
function drawArms(
  ctx: CanvasRenderingContext2D,
  pose: Pose,
  body: string,
  baseAlpha: number,
  facing: Facing,
): void {
  const DX = facing === "left" ? -1 : facing === "right" ? 1 : 0;
  const armH = 0.6;
  const armW = 0.3;
  const shY = -1.72 + pose.lean * 0.2; // shoulder line (leans with body)

  ctx.fillStyle = shade(body, 0.88);
  ctx.globalAlpha = baseAlpha;
  if (pose.hunch > 0) {
    // carrying: both hands held up toward the diamond.
    ctx.beginPath();
    ctx.roundRect(-0.62, shY + 0.05, armW, armH * 0.9, 0.14);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(0.36, shY + 0.05, armW, armH * 0.9, 0.14);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.roundRect(-0.62 + pose.armSwingL * DX * 0.5, shY + pose.armSwingL, armW, armH, 0.14);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(0.36 + pose.armSwingR * DX * 0.5, shY - pose.armSwingR, armW, armH, 0.14);
    ctx.fill();
  }
}

/** Hood + head — directional silhouette (back hides face, front shows it). */
function drawHoodHead(
  ctx: CanvasRenderingContext2D,
  o: CharacterOpts,
  pose: Pose,
  body: string,
  baseAlpha: number,
): void {
  const facing = o.facing;
  const DX = facing === "left" ? -1 : facing === "right" ? 1 : 0;
  const DY = facing === "up" ? -1 : facing === "down" ? 1 : 0;
  const rimY = -2.0;
  // Forward lean: the hood tip leans toward the facing axis, but the cone keeps
  // a real width for every direction (Qodo #2 — never multiply the base width by
  // DX, which is 0 for up/down). The tip X offsets by the lean; the rim stays
  // full width.
  const tipX = DX * 0.32 + pose.hoodTilt * DX * 0.5;
  const tipY = rimY - 1.2 + pose.hoodTilt * (DY !== 0 ? DY * 0.3 : 0);

  const hg = ctx.createLinearGradient(0, rimY, 0, tipY);
  hg.addColorStop(0, shade(body, 0.92));
  hg.addColorStop(1, shade(body, 1.12));
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.moveTo(-0.52, rimY + 0.02);
  ctx.quadraticCurveTo(-0.46 + DX * 0.1, rimY - 0.45, tipX - 0.18, tipY + 0.1);
  ctx.quadraticCurveTo(tipX + 0.02, tipY - 0.05, tipX + 0.18, tipY + 0.1);
  ctx.quadraticCurveTo(0.46 + DX * 0.1, rimY - 0.45, 0.52, rimY + 0.02);
  ctx.quadraticCurveTo(0, rimY + 0.34, -0.52, rimY + 0.02);
  ctx.closePath();
  ctx.fill();

  // Hood rim band.
  ctx.globalAlpha = baseAlpha * 0.8;
  ctx.fillStyle = o.darkColor;
  ctx.beginPath();
  ctx.roundRect(-0.5, rimY - 0.12, 1.0, 0.16, 0.07);
  ctx.fill();

  // Tip tassel (gold).
  ctx.globalAlpha = baseAlpha;
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.arc(tipX, tipY + 0.05, 0.05, 0, Math.PI * 2);
  ctx.fill();

  const blink = o.timeMs % 3400 < 140;
  if (facing === "down") {
    // FRONT: a dark opening with two glowing eyes + the buckle visible below.
    ctx.fillStyle = "#0b0e17";
    ctx.beginPath();
    ctx.ellipse(0.05, rimY - 0.28, 0.42, 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = EYE;
    ctx.globalAlpha = baseAlpha * (o.ghost ? 0.55 : 1);
    for (const ex of [-0.11, 0.11]) {
      ctx.beginPath();
      if (blink) ctx.ellipse(0.05 + ex, rimY - 0.26, 0.08, 0.03, 0, 0, Math.PI * 2);
      else ctx.arc(0.05 + ex, rimY - 0.26, 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (facing === "up") {
    // BACK: the hood opening is hidden — just a rounded back-of-head hint.
    ctx.fillStyle = shade(body, 0.9);
    ctx.beginPath();
    ctx.ellipse(0, rimY - 0.3, 0.3, 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // PROFILE: a single eye near the leading edge of the hood.
    ctx.fillStyle = "#0b0e17";
    ctx.beginPath();
    ctx.ellipse(DX * 0.14, rimY - 0.28, 0.32, 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = EYE;
    ctx.globalAlpha = baseAlpha * (o.ghost ? 0.55 : 1);
    ctx.beginPath();
    if (blink) ctx.ellipse(DX * 0.14, rimY - 0.26, 0.09, 0.035, 0, 0, Math.PI * 2);
    else ctx.arc(DX * 0.14, rimY - 0.26, 0.09, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = baseAlpha;
  void pose;
}