// Phase 5 — pooled world-space particle system. Lightweight, bounded, and
// deterministic enough for QA: a fixed pool is reused, spawns cap at MAX, and
// the QA hook exposes live counts. Particles live in WORLD units and are drawn
// by the renderer after the characters (before screen-space lighting), so they
// track the world while the camera moves.
//
// Style: small, soft, restrained — motes, dust, sparkles, stun stars, brazier
// embers, cauldron vapor, and Gronk rage. Nothing here is gameplay.

export interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // seconds
  age: number;
  size: number; // world units
  alpha: number; // 0..1 peak opacity
  color: string;
  kind: string; // for QA grouping / throttling
  rot: number;
  vr: number; // rotation velocity (rad/s)
  grav: number; // world units/s^2
  drag: number; // velocity multiplier per second
  square: boolean; // draw as a rotated spark instead of a circle
}

export const MAX_PARTICLES = 350;

export class ParticleSystem {
  private pool: Particle[] = [];
  private cursor = 0;
  totalSpawned = 0;

  get max(): number {
    return MAX_PARTICLES;
  }

  get active(): number {
    let n = 0;
    for (const p of this.pool) if (p.active) n++;
    return n;
  }

  spawn(o: {
    x: number;
    y: number;
    life: number;
    color: string;
    kind?: string;
    vx?: number;
    vy?: number;
    size?: number;
    alpha?: number;
    rot?: number;
    vr?: number;
    grav?: number;
    drag?: number;
    square?: boolean;
  }): void {
    // Ring-buffer over a fixed pool: reuse the oldest slot; if none is dead,
    // overwrite (bounded — never grows past MAX_PARTICLES).
    let slot: Particle | null = null;
    for (let i = 0; i < this.pool.length; i++) {
      const idx = (this.cursor + i) % this.pool.length;
      if (!this.pool[idx].active) {
        slot = this.pool[idx];
        this.cursor = (idx + 1) % this.pool.length;
        break;
      }
    }
    if (!slot) {
      if (this.pool.length >= MAX_PARTICLES) return; // pool full — drop
      slot = { active: false, x: 0, y: 0, vx: 0, vy: 0, life: 1, age: 0, size: 0.2, alpha: 1, color: "#fff", kind: "mote", rot: 0, vr: 0, grav: 0, drag: 1, square: false };
      this.pool.push(slot);
    }
    slot.active = true;
    slot.x = o.x;
    slot.y = o.y;
    slot.vx = o.vx ?? 0;
    slot.vy = o.vy ?? 0;
    slot.life = Math.max(0.05, o.life);
    slot.age = 0;
    slot.size = o.size ?? 0.2;
    slot.alpha = o.alpha ?? 1;
    slot.color = o.color;
    slot.kind = o.kind ?? "mote";
    slot.rot = o.rot ?? Math.random() * Math.PI * 2;
    slot.vr = o.vr ?? 0;
    slot.grav = o.grav ?? 0;
    slot.drag = o.drag ?? 1;
    slot.square = o.square ?? false;
    this.totalSpawned++;
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        continue;
      }
      if (p.drag !== 1) {
        const k = Math.pow(p.drag, dt);
        p.vx *= k;
        p.vy *= k;
      }
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      const t = 1 - p.age / p.life; // 1 -> 0
      const a = p.alpha * t * t;
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.square) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.6 + 0.4 * t), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}

// ---- spawn helpers (semantic bursts; randomness is artistic only) ---------

/** Tiny floor dust kicked up while walking. */
export function spawnDust(sys: ParticleSystem, x: number, y: number, n: number): void {
  for (let i = 0; i < n; i++) {
    sys.spawn({
      x: x + (Math.random() - 0.5) * 0.8,
      y: y + 0.2,
      vx: (Math.random() - 0.5) * 0.4,
      vy: -(0.1 + Math.random() * 0.25),
      life: 0.5 + Math.random() * 0.5,
      size: 0.09 + Math.random() * 0.08,
      alpha: 0.35,
      color: "rgba(190,205,235,1)",
      kind: "dust",
      drag: 0.85,
    });
  }
}

/** Soft magical motes for hide/emerge. */
export function spawnMotes(sys: ParticleSystem, x: number, y: number, n: number, color = "#ffe08a"): void {
  for (let i = 0; i < n; i++) {
    sys.spawn({
      x: x + (Math.random() - 0.5) * 1.4,
      y: y + (Math.random() - 0.5) * 1.4,
      vx: (Math.random() - 0.5) * 0.9,
      vy: -(0.2 + Math.random() * 0.5),
      life: 0.6 + Math.random() * 0.7,
      size: 0.12 + Math.random() * 0.1,
      alpha: 0.7,
      color,
      kind: "mote",
      drag: 0.9,
    });
  }
}

/** Bright gold sparkles on treasure pickup. */
export function spawnSparkles(sys: ParticleSystem, x: number, y: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * Math.PI * 2;
    const sp = 0.6 + Math.random() * 1.6;
    sys.spawn({
      x,
      y,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp - 0.4,
      life: 0.35 + Math.random() * 0.4,
      size: 0.14 + Math.random() * 0.1,
      alpha: 0.95,
      color: Math.random() < 0.5 ? "#ffd166" : "#fff8d6",
      kind: "sparkle",
      square: true,
      vr: (Math.random() - 0.5) * 14,
      grav: 0.4,
      drag: 0.92,
    });
  }
}

/** Stun stars — a short orbital burst around the stunned player. */
export function spawnStars(sys: ParticleSystem, x: number, y: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    sys.spawn({
      x: x + Math.cos(ang) * 1.2,
      y: y + Math.sin(ang) * 1.2,
      vx: Math.cos(ang) * 0.7,
      vy: Math.sin(ang) * 0.7 - 0.2,
      life: 0.8 + Math.random() * 0.4,
      size: 0.16 + Math.random() * 0.08,
      alpha: 0.9,
      color: "#ffd166",
      kind: "star",
      square: true,
      vr: 6,
      drag: 0.9,
    });
  }
}

/** Brazier embers — slow rising orange specks. */
export function spawnEmbers(sys: ParticleSystem, x: number, y: number, n: number): void {
  for (let i = 0; i < n; i++) {
    sys.spawn({
      x: x + (Math.random() - 0.5) * 1.6,
      y: y - 2.6 - Math.random() * 0.4,
      vx: (Math.random() - 0.5) * 0.25,
      vy: -(0.25 + Math.random() * 0.45),
      life: 0.8 + Math.random() * 0.9,
      size: 0.08 + Math.random() * 0.08,
      alpha: 0.65,
      color: Math.random() < 0.6 ? "#ff9d50" : "#ffd166",
      kind: "ember",
      drag: 0.97,
    });
  }
}

/** Cauldron vapor — faint green-tinged bubbles drifting up. */
export function spawnVapor(sys: ParticleSystem, x: number, y: number, n: number): void {
  for (let i = 0; i < n; i++) {
    sys.spawn({
      x: x + (Math.random() - 0.5) * 2.4,
      y: y - 3.1 - Math.random() * 0.3,
      vx: (Math.random() - 0.5) * 0.2,
      vy: -(0.12 + Math.random() * 0.3),
      life: 1.0 + Math.random() * 0.8,
      size: 0.14 + Math.random() * 0.14,
      alpha: 0.3,
      color: "#aef08c",
      kind: "vapor",
      drag: 0.98,
    });
  }
}

/** Gronk rage — dark red motes when enraged. */
export function spawnRage(sys: ParticleSystem, x: number, y: number, n: number): void {
  for (let i = 0; i < n; i++) {
    sys.spawn({
      x: x + (Math.random() - 0.5) * 3,
      y: y - 2 + Math.random() * 2,
      vx: (Math.random() - 0.5) * 0.6,
      vy: -(0.15 + Math.random() * 0.3),
      life: 0.6 + Math.random() * 0.6,
      size: 0.12 + Math.random() * 0.1,
      alpha: 0.5,
      color: "#ff5a4a",
      kind: "rage",
      drag: 0.94,
    });
  }
}

// QA hook: live particle stats (read-only, not gameplay).
export function installParticlesQaHook(sys: ParticleSystem): void {
  (window as unknown as {
    __ghParticles?: () => { active: number; totalSpawned: number; max: number };
  }).__ghParticles = () => ({
    active: sys.active,
    totalSpawned: sys.totalSpawned,
    max: sys.max,
  });
}
