// ASTrix Observatory — browser visual verification.
// Loads the deployed Observatory, drives DEMO (living world) and LIVE, screenshots
// desktop + tablet(portrait), and reports pixel colorfulness / console errors.
// Never touches authoritative state; presentation-only.
import { chromium } from "playwright";
import { writeFileSync, readFileSync } from "node:fs";

const BASE = "https://astrixx.duckdns.org/observatory/";
const out = (name, buf) => {
  writeFileSync(`/tmp/observatory-${name}.png`, buf);
  console.log(`[shot] ${name}`);
};

async function colorfulness(page, pngPath) {
  // Decode the PNG in the browser (no deps) and count quantized colors.
  const b64 = readFileSync(pngPath).toString("base64");
  return page.evaluate(async (base64) => {
    const img = new Image();
    const src = "data:image/png;base64," + base64;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const c = cv.getContext("2d");
    c.drawImage(img, 0, 0);
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    const colors = new Set();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      colors.add(((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3));
      if (colors.size > 14000) break;
    }
    return colors.size;
  }, b64);
}

async function shot(page, name) {
  await page.waitForTimeout(1400);
  const buf = await page.screenshot({ fullPage: true });
  await out(name, buf);
  // colorfulness measured on a throwaway hidden page context: reuse the same page.
  return { colors: await colorfulness(page, `/tmp/observatory-${name}.png`) };
}

const browser = await chromium.launch();
const errors = [];

async function runCase(label, size) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${label}] console: ${m.text()}`); });
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(800);
  return { ctx, page, label };
}

// ---- DEMO: the living 3-minute presentation (rich voters/crops/bridges) ----
const demo = await runCase("demo", { width: 1280, height: 720 });
await demo.page.click("#btn-demo");
await demo.page.waitForSelector("#observatory:not(.hidden)", { timeout: 15000 });
await demo.page.waitForTimeout(6000); // let it auto-advance into the living world
const demoShot = await shot(demo.page, "demo-landscape");
console.log("DEMO colorfulness:", demoShot.colors, "distinct colors");
// count projected villagers (population >0 somewhere) & world elements in DOM
const domTrees = await demo.page.locator(".tree-group").count();
const domVillagers = await demo.page.locator(".villager").count();
const domFarms = await demo.page.locator(".crop-clump").count();
console.log("DEMO DOM: trees=", domTrees, "villagers=", domVillagers, "crops=", domFarms);
await demo.ctx.close();

// ---- DEMO on tablet portrait ----
const tDemo = await runCase("demo-tablet", { width: 800, height: 1280 });
await tDemo.page.click("#btn-demo");
await tDemo.page.waitForSelector("#observatory:not(.hidden)", { timeout: 15000 });
await tDemo.page.waitForTimeout(6000);
const tShot = await shot(tDemo.page, "demo-tablet-portrait");
console.log("DEMO-tablet colorfulness:", tShot.colors);
const vCount = await tDemo.page.locator(".villager").count();
const treeCount = await tDemo.page.locator(".tree-group").count();
const cropCount = await tDemo.page.locator(".crop-clump").count();
console.log("DEMO-tablet DOM: trees=", treeCount, "villagers=", vCount, "crops=", cropCount);
// world must be ON-canvas (not clipped): svg has a viewBox + non-empty children
const hasViewBox = await tDemo.page.$eval("#world", (el) => el.getAttribute("viewBox") && el.childElementCount > 0);
console.log("tablet hasViewBox&children:", hasViewBox);
await tDemo.ctx.close();

// ---- LIVE: the real server world ----
const live = await runCase("live", { width: 1280, height: 720 });
await live.page.click("#btn-live");
await live.page.waitForSelector("#observatory:not(.hidden)", { timeout: 15000 });
await live.page.waitForTimeout(5000); // allow a state poll + paint
const liveShot = await shot(live.page, "live-landscape");
console.log("LIVE colorfulness:", liveShot.colors);
const liveWorld = await live.page.locator("#world").count();
const liveTrees = await live.page.locator(".tree-group").count();
const liveVillagers = await live.page.locator(".villager").count();
console.log("LIVE DOM: world=", liveWorld, "trees=", liveTrees, "villagers=", liveVillagers);
await live.ctx.close();

await browser.close();
console.log("console/page errors:", errors.length);
for (const e of errors) console.log("  ✗", e);
console.log("DONE");