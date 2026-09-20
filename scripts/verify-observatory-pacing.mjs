// ASTrix Observatory — verify DEMO pacing + camera focus in a real browser.
// Watches the live deployed /observatory/ DEMO for: the .world-focus camera
// class firing (season change) and #world-overlay flashes (starvation/harvest/
// season). Reports what actually happened. Presentation-only.
import { chromium } from "playwright";

const BASE = "https://astrixx.duckdns.org/observatory/";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
await page.click("#btn-demo");
await page.waitForSelector("#observatory:not(.hidden)", { timeout: 15000 });

// Instrument the live DOM to capture consequential moments; counters are stored
// on window so they can be read back after the run.
await page.evaluate(() => {
  if (window.__obsCtrs) return { reused: true };
  const world = document.querySelector("#world");
  const overlay = document.querySelector("#world-overlay");
  const ctrs = { focusFires: 0, flashTexts: [] };
  window.__obsCtrs = ctrs;
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type !== "attributes") continue;
      if (m.target === world && m.attributeName === "class" && world.classList.contains("world-focus")) ctrs.focusFires++;
      if (m.target === overlay && m.attributeName === "class" && !overlay.classList.contains("hidden")) {
        ctrs.flashTexts.push(overlay.textContent || "");
      }
    }
  });
  obs.observe(world, { attributes: true, attributeFilter: ["class"] });
  obs.observe(overlay, { attributes: true, attributeFilter: ["class"] });
  window.__obs = obs;
  return { instrumented: true };
});

// Drive the demo forward: the DEMO pauses at each recorded approval (human
// control) and waits for a decision. Auto-click through gates here so the run
// can reach the consequential milestones (harvest / starvation / season) that
// this script is checking for. This is presentation verification only.
const deadline = Date.now() + 45000;
let clicked = 0;
while (Date.now() < deadline) {
  const vis = await page.evaluate(() => {
    const ap = document.querySelector("#approval-panel");
    return ap ? !ap.classList.contains("hidden") : false;
  });
  if (vis) {
    await page.click("#approve-btn").catch(() => {});
    clicked++;
    await page.waitForTimeout(300);
  }
  const done = await page.evaluate(() => document.querySelector("#final") && !document.querySelector("#final").classList.contains("hidden"));
  if (done) break;
  await page.waitForTimeout(200);
}

const results = await page.evaluate(() => {
  return window.__obsCtrs ? { ...window.__obsCtrs } : null;
});
console.log("DEMO consequential moments captured:");
console.log("  camera-focus fires (season change):", results?.focusFires ?? 0);
const texts = results?.flashTexts ?? [];
const uniq = [...new Set(texts)];
console.log("  overlay flashes (unique):", uniq.length);
uniq.slice(0, 40).forEach((t) => console.log("    ·", t));
const harvestFlashes = uniq.filter((t) => /HARVEST/i.test(t)).length;
const shortageFlashes = uniq.filter((t) => /FOOD SHORTAGE|STARV/i.test(t)).length;
const seasonFlashes = uniq.filter((t) => /BEGINS/i.test(t)).length;
console.log("  harvest flashes:", harvestFlashes, "| food-shortage:", shortageFlashes, "| season:", seasonFlashes);
console.log("  approvals auto-driven:", clicked);

await browser.close();
console.log("console/page errors:", errors.length);
for (const e of errors) console.log("  ✗", e);
console.log("DONE");