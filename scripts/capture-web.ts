// Throwaway QA script: load the live Godot HTML5 client, emulate touch via CDP,
// capture before/after joystick-drag frames, and log progress + errors to a file.
// Not part of the shipped app.
import { chromium } from "playwright";
import { writeFileSync, appendFileSync } from "node:fs";

const url = process.env.CAPTURE_URL ?? "https://astrixx.duckdns.org/";
const out = process.env.CAPTURE_OUT ?? "/tmp/astrix-web.png";
const waitMs = Number(process.env.CAPTURE_WAIT_MS ?? "18000");
const vw = Number(process.env.CAPTURE_W || "1280");
const vh = Number(process.env.CAPTURE_H || "720");
const isMobile = process.env.CAPTURE_MOBILE === "1";
const simulateDragger = process.env.CAPTURE_DRAG_JOY === "1";
const log = process.env.CAPTURE_LOG_FILE ?? "/tmp/cap.log";
const tl = (s: string) => {
  try { appendFileSync(log, `[${new Date().toISOString()}] ${s}\n`); } catch {}
};

tl(`start url=${url} vw=${vw} vh=${vh} mobile=${isMobile} drag=${simulateDragger}`);

const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
tl("browser launched");
const page = await browser.newPage({
  viewport: { width: vw, height: vh, isMobile, hasTouch: isMobile },
});

const errors: string[] = [];
page.on("console", (m) => {
  if (m.type() === "error") {
    const t = m.text().slice(0, 300);
    errors.push(t);
    tl("console-error: " + t);
  }
});
page.on("pageerror", (e) => {
  const t = String(e).slice(0, 300);
  errors.push(t);
  tl("page-error: " + t);
});
page.on("crash", () => tl("PAGE CRASH EVENT"));

const cdp = await page.context().newCDPSession(page);
async function shot(p: string) {
  const s: { data: string } = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(p, Buffer.from(s.data, "base64"));
  tl("shot written: " + p);
}

tl("navigating");
await page.goto(url, { waitUntil: "load", timeout: 60_000 });
tl("navigated, waiting");
await page.waitForTimeout(waitMs);
tl("wait done, before-shot");
await shot(out);

const ctx = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  const r = c ? c.getBoundingClientRect() : null;
  return {
    secureContext: window.isSecureContext === true,
    protocol: window.location.protocol,
    canvas: r ? { cssW: r.width, cssH: r.height, attrW: c.width, attrH: c.height } : null,
  };
});
tl("ctx: " + JSON.stringify(ctx));

let drag: unknown = null;
if (simulateDragger) {
  tl("starting drag");
  const joy = { x: Math.round(vw * 0.16), y: Math.round(vh * 0.84) };
  const endX = Math.round(vw * 0.5);
  try {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: joy.x, y: joy.y, id: 0, radiusX: 6, radiusY: 6, force: 1 }],
    });
    tl("touchStart sent");
    for (let i = 1; i <= 10; i++) {
      const x = joy.x + Math.round((endX - joy.x) * (i / 10));
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: joy.y, id: 0, radiusX: 6, radiusY: 6, force: 1 }],
      });
    }
    tl("touchMove sequence sent");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    tl("touchEnd sent");
    await page.waitForTimeout(900);
    tl("post-drag wait done, after-shot");
    await shot(out.replace(".png", "-after.png"));
    drag = { joystick: joy, endX, before: out, after: out.replace(".png", "-after.png") };
    tl("drag complete");
  } catch (e) {
    const m = String(e).slice(0, 300);
    drag = { error: m };
    tl("drag error: " + m);
  }
}

tl("capturing final console result");
try {
  console.log(JSON.stringify({ title: await page.title(), ctx, drag, errors, out }, null, 2));
} catch (e) {
  tl("title threw: " + String(e).slice(0, 200));
  console.log(JSON.stringify({ title: null, ctx, drag, errors, out }, null, 2));
}
await browser.close();
tl("done");

// Fail loudly so automation cannot report success when the probe itself
// failed: drag dispatch errors, collected page/console errors, or a missing
// secure context should all flip the exit code.
const dragErr = drag && typeof drag === "object" && "error" in drag ? String((drag as { error: unknown }).error) : "";
const missingEvidence =
  simulateDragger &&
  (!drag || typeof drag !== "object" || !("after" in drag));
const insecureCtx = ctx && ctx.secureContext === false;
const exitCode = dragErr || missingEvidence || insecureCtx || errors.length > 0 ? 1 : 0;
if (exitCode !== 0) {
  tl("PROBE FAILED: dragErr=" + (dragErr || "-") + " missingEvidence=" + missingEvidence + " insecureCtx=" + insecureCtx + " errors=" + errors.length);
}
process.exit(exitCode);