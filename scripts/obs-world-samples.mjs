// Definitive world-visibility check (plain JS, no tsx/esbuild transform so no
// __name helper breaks page.evaluate). Samples colors at projected positions of
// authoritative entities and asserts they show the expected material.
import { chromium } from "playwright";
const BASE = process.env.OBS_BASE || "https://astrixx.duckdns.org";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
await page.goto(`${BASE}/observatory/`, { waitUntil: "load", timeout: 30000 });
await page.waitForTimeout(500);
await page.locator('button:has-text("LIVE")').first().click().catch(() => {});
await page.waitForTimeout(2400);

// read the season the live world is actually in (island palette is season-aware:
// spring/summer = green, autumn = warm tan, winter = pale).
const season = await page.evaluate(function () {
  return fetch('/astrix/state').then(function (r) { return r.json(); }).then(function (s) { return s.season; }).catch(function () { return 'spring'; });
});
console.log('live season:', season);

const samples = await page.evaluate(function () {
  return new Promise(function (resolve) {
    const svg = document.querySelector("#world");
    const vb = (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);
    const vx = vb[0], vy = vb[1], vw = vb[2], vh = vb[3];
    const W = 480, H = 360;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    const src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="' + svg.getAttribute("viewBox") + '">' + svg.innerHTML + "</svg>"
    );
    const img = new Image();
    img.onload = function () {
      ctx.drawImage(img, 0, 0, W, H);
      function at(x, z) {
        const sx = (x - z) * 2, sy = x + z;
        const X = Math.floor(((sx - vx) / vw) * W), Y = Math.floor(((sy - vy) / vh) * H);
        if (X < 0 || Y < 0 || X >= W || Y >= H) return { x: X, y: Y, hex: "OFF" };
        const d = ctx.getImageData(X, Y, 1, 1).data;
        const hx = "#" + [d[0], d[1], d[2]].map(function (v) { return v.toString(16).padStart(2, "0"); }).join("");
        return { x: X, y: Y, hex: hx };
      }
      resolve({
        meadow: at(24, 30), frost: at(50, 16), dusk: at(76, 34),
        houseRoof: at(20, 27), water: at(83, 60),
      });
    };
    img.onerror = function () { resolve({ error: "rasterize failed" }); };
    img.src = src;
  });
});

console.log("world color samples:", JSON.stringify(samples));
if (!samples || samples.error) { console.log("FAIL rasterize"); process.exit(1); }

const hex = (h) => parseInt(h.slice(1), 16);
// island palette depends on live season
const isGreen = (h) => { const n = hex(h), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; return g > 90 && g > b + 20 && g > r + 20; };
const isWarmTan = (h) => { const n = hex(h), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; return r > 150 && r >= g && g > b + 10; };
const isPale = (h) => { const n = hex(h), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; return r > 190 && g > 190 && b > 190; };
const isWarm = (h) => { const n = hex(h), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; return r > 150 && g > 110 && b < 200; };
const isBlue = (h) => { const n = hex(h), b = n & 255; return b > 140 && b > ((n >> 8) & 255); };
// what the island terrain should look like in the current season:
const islandOK = season === "winter" ? isPale : season === "autumn" ? isWarmTan : isGreen;

const checks = [
  [`meadow island matches ${season} palette`, islandOK(samples.meadow.hex), samples.meadow.hex],
  [`frost island matches ${season} palette`, islandOK(samples.frost.hex), samples.frost.hex],
  [`dusk island matches ${season} palette`, islandOK(samples.dusk.hex), samples.dusk.hex],
  ["house roof/wall is warm tan", isWarm(samples.houseRoof.hex), samples.houseRoof.hex],
  ["open water between islands is blue", isBlue(samples.water.hex), samples.water.hex],
];
let pass = 0, fail = 0;
for (const [name, ok, sample] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  [${sample}]`);
  ok ? pass++ : fail++;
}
console.log(`\nisland/house/water visibility: ${pass} passed / ${pass + fail} total`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);