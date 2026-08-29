// Throwaway QA script: load the live Godot HTML5 client and screenshot it via CDP.
// Not part of the shipped app; used only to verify the web export boots, renders,
// exposes mobile controls, and moves the player when the joystick is dragged.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const url = process.env.CAPTURE_URL ?? "https://astrixx.duckdns.org/";
const out = process.env.CAPTURE_OUT ?? "/tmp/astrix-web.png";
const waitMs = Number(process.env.CAPTURE_WAIT_MS ?? "16000");
const vw = Number(process.env.CAPTURE_W || "1280");
const vh = Number(process.env.CAPTURE_H || "720");
const isMobile = process.env.CAPTURE_MOBILE === "1";
const simulateDragger = process.env.CAPTURE_DRAG_JOY === "1";

const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({
  viewport: { width: vw, height: vh, isMobile, hasTouch: isMobile },
});

const errors: string[] = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 300));
});
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));

const cdp = await page.context().newCDPSession(page);
async function shot(p: string) {
  const s: { data: string } = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(p, Buffer.from(s.data, "base64"));
}

await page.goto(url, { waitUntil: "load", timeout: 60_000 });
await page.waitForTimeout(waitMs);

const ctx = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  const r = c ? c.getBoundingClientRect() : null;
  return {
    secureContext: window.isSecureContext === true,
    protocol: window.location.protocol,
    canvas: r ? { cssW: r.width, cssH: r.height, attrW: c.width, attrH: c.height } : null,
  };
});
await shot(out);

let drag: unknown = null;
if (simulateDragger) {
  // Drag across the lower-left virtual-joystick area (mouse works for touch UI in Godot web).
  const joy = { x: Math.round(vw * 0.14), y: Math.round(vh * 0.86) };
  const endX = Math.round(vw * 0.45);
  await page.mouse.move(joy.x, joy.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(joy.x + Math.round((endX - joy.x) * (i / 12)), joy.y);
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await page.waitForTimeout(900);
  await shot(out.replace(".png", "-after.png"));
  drag = { joystick: joy, endX, afterShot: out.replace(".png", "-after.png") };
}

console.log(JSON.stringify({ title: await page.title(), ctx, drag, errors, out }, null, 2));
await browser.close();