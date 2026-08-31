import { chromium } from "playwright";
import { readFileSync } from "fs";
const PNG_PATH = process.argv[2] || "/tmp/observatory-shots/astrix-godot.png";
const b64 = readFileSync(PNG_PATH).toString("base64");
const browser = await chromium.launch();
const page = await browser.newPage();
const analysis = await page.evaluate(async (dataUrl) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("load")); img.src = "data:image/png;base64," + dataUrl; });
  const W = 128, H = 72;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const hexAt = (x, y) => { const i = (y * W + x) * 4; return "#" + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join(""); };
  // color diversity
  const seen = new Set();
  let colorful = 0;
  const bg = "#b8d6db"; // project default clear color
  for (let y = 2; y < H - 2; y += 2) for (let x = 2; x < W - 2; x += 2) {
    const h = hexAt(x, y); seen.add(h);
    if (h !== bg) colorful++;
  }
  // 10x6 coarse grid of a few sample cells
  const grid = [];
  for (let gy = 0; gy < 6; gy++) { let row = []; for (let gx = 0; gx < 10; gx++) row.push(hexAt(Math.floor(gx * W / 10 + W / 20), Math.floor(gy * H / 6 + H / 12))); grid.push(row); }
  return { size: img.width + "x" + img.height, distinct: seen.size, colorfulPct: Math.round((colorful / ((W - 4) * (H - 4) / 4)) * 100), grid };
}, b64);
console.log("PNG:", PNG_PATH, analysis.size, "distinct:", analysis.distinct, "colorful%:", analysis.colorfulPct);
console.log("10x6 grid:");
for (const row of analysis.grid) console.log(" ", row.join(" "));
await browser.close();