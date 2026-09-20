// Verify the Observatory world renders VISIBLY by rasterizing the world region
// and measuring non-background pixel diversity — a true human-visibility check,
// not a DOM child-count.
import { chromium, devices } from "playwright";
const BASE = process.env.OBS_BASE ?? "https://astrixx.duckdns.org";
const browser = await chromium.launch();

async function visibleWorldReport(page: import("playwright").Page, tag: string): Promise<boolean> {
  // rasterize the <svg> to an image via canvas and sample pixels in the browser
  const report = await page.evaluate(async () => {
    const svg = document.querySelector("#world") as SVGSVGElement;
    const vb = svg.getAttribute("viewBox");
    if (!vb) return { ok: false, reason: "no viewBox" };
    const rect = svg.getBoundingClientRect();
    const W = 800, H = 500;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    // draw the svg scaled to the canvas
    const src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
      `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">${svg.innerHTML}</svg>`
    );
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("img")); img.src = src; });
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0e2029";
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;
    // count distinct colors and non-background pixels
    const seen = new Set<number>();
    let colored = 0, total = W * H;
    for (let i = 0; i < total; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
      if (a < 10) continue;
      // background is roughly #0e2029
      const bg = Math.abs(r - 0x0e) + Math.abs(g - 0x20) + Math.abs(b - 0x29) < 12;
      if (!bg) colored++;
      seen.add((r << 16) | (g << 8) | b);
    }
    return { ok: true, colored, total, pct: Math.round((colored / total) * 100), distinct: seen.size, viewBox: vb, rectW: Math.round(rect.width), rectH: Math.round(rect.height) };
  }).catch((e) => ({ ok: false, reason: String(e).slice(0, 80) }));
  console.log(`\n[${tag}]`, JSON.stringify(report));
  return !!report.ok && report.pct > 5 && report.colored > 2000 && report.distinct > 8;
}

const results: string[] = [];
const check = (n: string, ok: boolean, d = "") => { results.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  | " + d : ""}`); if (!ok) process.exitCode = 1; };

// ---- LIVE ----
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`${BASE}/observatory/`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(500);
  await page.locator('button:has-text("LIVE")').first().click().catch(() => {});
  await page.waitForTimeout(1800);
  check("LIVE viewBox present (was null)", await page.locator("#world").getAttribute("viewBox").then((v) => !!v && v !== "null"), (await page.locator("#world").getAttribute("viewBox")) ?? "");
  check("LIVE world VISIBLY rendered (colored pixels)", await visibleWorldReport(page, "LIVE"));
  check("LIVE zero console errors", errs.length === 0, errs.slice(0, 2).join("; ") || "none");
  await page.screenshot({ path: "/tmp/observatory-shots/fix-LIVE.png" });
  await page.close();
}

// ---- REPLAY (advance to mid-run to see farms/crops/bridges) ----
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`${BASE}/observatory/`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(500);
  await page.locator('button:has-text("REPLAY")').first().click().catch(() => {});
  await page.waitForTimeout(500);
  await page.locator('button:has-text("5×")').click().catch(() => {});
  await page.locator("#rc-play").click().catch(() => {});
  // advance past a couple gates to a developed world
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1300);
    const t = await page.locator("body").innerText().catch(() => "");
    const m = t.match(/DAY (\d+)/);
    const day = m ? parseInt(m[1], 10) : 0;
    const app = page.locator('button:has-text("APPROVE")');
    if ((await app.count().catch(() => 0)) > 0 && (await app.isVisible().catch(() => false))) { await app.click().catch(() => {}); await page.waitForTimeout(700); }
    if (day >= 9) break;
  }
  check("REPLAY world VISIBLY rendered", await visibleWorldReport(page, "REPLAY"));
  check("REPLAY zero console errors", errs.length === 0, errs.slice(0, 2).join("; ") || "none");
  await page.screenshot({ path: "/tmp/observatory-shots/fix-REPLAY.png" });
  await page.close();
}

// ---- DEMO auto ----
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`${BASE}/observatory/`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(500);
  await page.locator('button:has-text("DEMO")').first().click().catch(() => {});
  await page.waitForTimeout(1500);
  check("DEMO world VISIBLY rendered", await visibleWorldReport(page, "DEMO"));
  check("DEMO zero console errors", errs.length === 0, errs.slice(0, 2).join("; ") || "none");
  await page.screenshot({ path: "/tmp/observatory-shots/fix-DEMO.png" });
  await page.close();
}

// ---- Android tablet ----
{
  const ctx = await browser.newContext(devices["iPad (gen 7) landscape"]);
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`${BASE}/observatory/`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(500);
  await page.locator('button:has-text("LIVE")').first().click().catch(() => {});
  await page.waitForTimeout(1500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  check("TABLET landscape: world VISIBLY rendered", await visibleWorldReport(page, "TABLET"));
  check("TABLET: no horizontal overflow", !overflow);
  check("TABLET zero console errors", errs.length === 0, errs.slice(0, 2).join("; ") || "none");
  await page.screenshot({ path: "/tmp/observatory-shots/fix-tablet.png" });
  await ctx.close();
}

await browser.close();
console.log("\n=== OBSERVATORY VISUAL-VISIBILITY VERIFICATION ===");
for (const r of results) console.log(r);
console.log(`\n${results.filter((r) => r.startsWith("PASS")).length} passed / ${results.length} total`);