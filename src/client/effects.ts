// Phase 5 — camera micro-feedback + screen effects. Small, temporary, and
// always bounded:
//   - camera impulse: a world-unit offset that decays exponentially (bump
//     toward an event), clamped back into world bounds by the renderer.
//   - screen shake: a CSS-px jitter that decays; halved on touch devices.
//   - screen flash: a full-viewport color wash that fades fast.
// The Phase 1 camera stays authoritative for framing — these only nudge the
// presentation for a fraction of a second. Nothing here is gameplay.

export class Effects {
  private impX = 0;
  private impY = 0;
  private shakeMag = 0;
  private flashA = 0;
  private flashColor = "#ffffff";
  private touchScale = 1;
  private reducedMotionActive = false;

  // prefers-reduced-motion gate (DESIGN.md P2 #12 / accessibility): shake and
  // flash are pure impact decoration — dropped under reduced motion. Read live
  // (not cached at import) so OS-level changes and test emulation apply.
  private reducedMotion(): boolean {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  private applyMotionPreference(): boolean {
    const reduced = this.reducedMotion();
    if (reduced && !this.reducedMotionActive) {
      // A preference change can happen while an impact is already visible.
      // Clear nonessential active shake/flash immediately, not only future
      // requests, so the live accessibility preference is honored.
      this.shakeMag = 0;
      this.flashA = 0;
    }
    this.reducedMotionActive = reduced;
    return reduced;
  }

  /** Halve shake on small screens (spec #14). */
  setTouchScale(v: boolean): void {
    this.touchScale = v ? 0.5 : 1;
  }

  bumpCamera(x: number, y: number, mag: number): void {
    if (this.applyMotionPreference()) return;
    this.impX += x * mag;
    this.impY += y * mag;
  }

  addShake(mag: number): void {
    if (this.reducedMotion()) return;
    this.shakeMag = Math.min(6, this.shakeMag + mag);
  }

  flash(color: string, strength: number): void {
    if (this.reducedMotion()) return;
    if (strength > this.flashA) {
      this.flashA = strength;
      this.flashColor = color;
    }
  }

  /** Decay all effects. Call once per frame with dt. */
  step(dt: number): void {
    const reduced = this.applyMotionPreference();
    const k = Math.exp(-dt * 8);
    this.impX *= k;
    this.impY *= k;
    this.shakeMag *= Math.exp(-dt * 5);
    this.flashA *= Math.exp(-dt * 4);
    if (reduced) {
      this.shakeMag = 0;
      this.flashA = 0;
    }
  }

  get camOffset(): { x: number; y: number } {
    return { x: this.impX, y: this.impY };
  }

  /** QA-only: seed bounded impact values without exposing gameplay behavior. */
  qaSeedImpact(): void {
    this.shakeMag = 4;
    this.flashA = 1;
  }

  /** Current shake magnitude in CSS px (touch-reduced). */
  get shake(): number {
    return this.applyMotionPreference() ? 0 : this.shakeMag * this.touchScale;
  }

  get flashAmount(): number {
    return this.applyMotionPreference() ? 0 : this.flashA;
  }

  get flashColorValue(): string {
    return this.flashColor;
  }

  reset(): void {
    this.impX = 0;
    this.impY = 0;
    this.shakeMag = 0;
    this.flashA = 0;
  }
}
