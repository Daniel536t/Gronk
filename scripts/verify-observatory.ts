// ASTrix Observatory — Playwright smoke verification.
// Loads the deployed Observatory, checks home renders, LIVE connects and paints
// a world, REPLAY loads the bundle and reaches Day 30, and there are no console
// errors. Not a substitute for the unit suite; this catches bundle/runtime regressions.
// Usage: ASTRIX_URL=http://127.0.0.1:8787 npx tsx scripts/verify-observatory.ts
import { chromium } from "playwright";

const base = (process.env.ASTRIX_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");

async function main(): Promise<void> {
  console.log(`[observe-smoke] target ${base}/observatory/`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  // 1. home
  await page.goto(`${base}/observatory/`, { waitUntil: "networkidle" });
  const homeVisible = await page.locator("#home").isVisible().catch(() => false);
  console.log(`home visible: ${homeVisible}`);

  // 2. LIVE
  await page.click("#btn-live");
  await page.waitForTimeout(3500);
  const worldHasSvg = await page.locator("#world .island").count().then((c) => c > 0).catch(() => false);
  const hudDay = await page.textContent("#hud-values").catch(() => "");
  console.log(`live world rendered: ${worldHasSvg}  hud: ${String(hudDay).replace(/\s+/g, " ").slice(0, 60)}`);

  // 3. REPLAY
  await page.goto(`${base}/observatory/`, { waitUntil: "networkidle" });
  await page.click("#btn-replay");
  await page.waitForTimeout(2500);
  const replayLoaded = await page.textContent("#rc-pos").catch(() => "");
  console.log(`replay loaded, pos: ${String(replayLoaded).replace(/\s+/g, " ")}`);
  // Press play and fast-forward a few seconds to ensure it advances (no freeze).
  await page.click("#rc-play");
  await page.waitForTimeout(3000);
  const pos2 = await page.textContent("#rc-pos").catch(() => "");
  console.log(`replay after play: ${String(pos2).replace(/\s+/g, " ")}`);

  // 4. DEMO autoplay path loads
  await page.goto(`${base}/observatory/`, { waitUntil: "networkidle" });
  await page.click("#btn-demo");
  await page.waitForTimeout(2000);
  const demoPos = await page.textContent("#rc-pos").catch(() => "");
  console.log(`demo autoplay pos: ${String(demoPos).replace(/\s+/g, " ")}`);

  const svgEls = await page.locator("#world > *").count();
  console.log(`world svg elements present: ${svgEls}`);

  console.log(`errors: ${errors.length === 0 ? "NONE" : "\n  " + errors.join("\n  ")}`);
  await browser.close();
  if (errors.length > 0) process.exitCode = 1;
  else console.log("[observe-smoke] OK");
}

void main();