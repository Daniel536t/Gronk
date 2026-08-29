// Throwaway QA script: load the live Godot HTML5 client and screenshot it via CDP.
// Not part of the shipped app; used only to verify the web export boots and renders.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const url = process.env.CAPTURE_URL ?? "http://127.0.0.1:8787/";
const out = process.env.CAPTURE_OUT ?? "/tmp/astrix-web.png";
const waitMs = Number(process.env.CAPTURE_WAIT_MS ?? "15000");

const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors: string[] = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 300));
});
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));

await page.goto(url, { waitUntil: "load", timeout: 60_000 });
await page.waitForTimeout(waitMs);

const canvasInfo = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { cssW: r.width, cssH: r.height, attrW: c.width, attrH: c.height };
});

// CDP capture bypasses Playwright's font-settling wait, which stalls on the
// continuously repainting WebGL canvas.
const cdp = await page.context().newCDPSession(page);
const shot: { data: string } = await cdp.send("Page.captureScreenshot", {
  format: "png",
});
writeFileSync(out, Buffer.from(shot.data, "base64"));

console.log(JSON.stringify({ title: await page.title(), canvasInfo, errors, out }, null, 2));
await browser.close();
