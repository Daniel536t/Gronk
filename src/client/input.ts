// Input: WASD/arrows + Space (action) + E (transform) on desktop; a virtual
// joystick (bottom-left) and ACTION/TRANSFORM buttons (bottom-right) on touch.
// The joystick div is only shown on touch devices.
export interface InputHandlers {
  /** Called whenever the movement vector changes (keyboard or joystick). */
  onMove: (dirX: number, dirY: number) => void;
  onAction: () => void;
  onTransform: () => void;
}

const JOYSTICK_RADIUS = 72;

export class InputManager {
  private keys = new Set<string>();
  private joyX = 0;
  private joyY = 0;
  private joystickActive = false;

  constructor(private handlers: InputHandlers) {
    window.addEventListener("keydown", (e) => this.onKey(e, true));
    window.addEventListener("keyup", (e) => this.onKey(e, false));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.pushMove();
    });
    this.wireJoystick();
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const k = e.key.toLowerCase();
    if ([" ", "e", "arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(k)) {
      e.preventDefault();
    }
    if (down) {
      if (k === " " && !e.repeat) this.handlers.onAction();
      if (k === "e" && !e.repeat) this.handlers.onTransform();
    }
    if (down) this.keys.add(k);
    else this.keys.delete(k);
    this.pushMove();
  }

  private keyboardDir(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.keys.has("w") || this.keys.has("arrowup")) y -= 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) y += 1;
    if (this.keys.has("a") || this.keys.has("arrowleft")) x -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) x += 1;
    return { x, y };
  }

  private pushMove(): void {
    if (this.joystickActive) {
      this.handlers.onMove(this.joyX, this.joyY);
      return;
    }
    const { x, y } = this.keyboardDir();
    const len = Math.hypot(x, y);
    this.handlers.onMove(len > 0 ? x / len : 0, len > 0 ? y / len : 0);
  }

  private wireJoystick(): void {
    const stick = document.getElementById("joystick");
    const knob = document.getElementById("joystick-knob");
    if (!stick || !knob) return;

    const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    if (isTouch) stick.classList.remove("hidden");
    if (!isTouch) return; // joystick is touch-only

    let pointerId: number | null = null;

    const setJoy = (cx: number, cy: number, px: number, py: number) => {
      let dx = px - cx;
      let dy = py - cy;
      const len = Math.hypot(dx, dy);
      if (len > JOYSTICK_RADIUS) {
        dx = (dx / len) * JOYSTICK_RADIUS;
        dy = (dy / len) * JOYSTICK_RADIUS;
      }
      this.joyX = dx / JOYSTICK_RADIUS;
      this.joyY = dy / JOYSTICK_RADIUS;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.pushMove();
    };

    const reset = () => {
      pointerId = null;
      this.joystickActive = false;
      this.joyX = 0;
      this.joyY = 0;
      knob.style.transform = "translate(0,0)";
      this.pushMove();
    };

    stick.addEventListener("pointerdown", (e) => {
      pointerId = e.pointerId;
      this.joystickActive = true;
      stick.setPointerCapture(e.pointerId);
      setJoy(stick.clientWidth / 2, stick.clientHeight / 2, e.clientX - stick.getBoundingClientRect().left, e.clientY - stick.getBoundingClientRect().top);
    });
    stick.addEventListener("pointermove", (e) => {
      if (pointerId !== e.pointerId) return;
      setJoy(stick.clientWidth / 2, stick.clientHeight / 2, e.clientX - stick.getBoundingClientRect().left, e.clientY - stick.getBoundingClientRect().top);
    });
    stick.addEventListener("pointerup", (e) => {
      if (pointerId === e.pointerId) reset();
    });
    stick.addEventListener("pointercancel", (e) => {
      if (pointerId === e.pointerId) reset();
    });
  }
}
