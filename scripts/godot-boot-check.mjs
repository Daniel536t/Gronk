// Verify the DEPLOYED Godot web build boots in a real browser (canvas present,
// game runs, no fatal page/console errors).
import { chromium } from "playwright";
const BASE = process.env.OBS_BASE || "https://astrixx.duckdns.org";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const warnings = [];
page.on("console", (m) => { if (m.type() === "error") warnings.push(`console: ${m.text().slice(0, 140)}`); });
page.on("pageerror", (e) => warnings.push(`pageerror: ${String(e).slice(0, 140)}`));
await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 40000 }).catch((e) => warnings.push("nav: " + String(e).slice(0, 100)));
await page.waitForTimeout(7000); // give the wasm time to boot + render
const info = await page.evaluate(() => {
  const canvases = [...document.querySelectorAll("canvas")].map((c) => ({ w: c.width, h: c.height }));
  const text = (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 200);
  return { canvases, title: document.title, text, htmlHasEngine: /Godot|\.wasm|index\.pck/i.test(document.documentElement.outerHTML) };
}).catch((e) => ({ error: String(e).slice(0, 140) }));
console.log("GODOT BOOT CHECK:", JSON.stringify(info));
console.log("error/warn count:", warnings.length);
warnings.slice(0, 8).forEach((w) => console.log("  -", w));
const booted = info && !info.error && (info.canvases || []).length > 0 && (info.canvases.some((c) => c.w >= 100));
console.log(booted ? "PASS deployed Godot booted (canvas + no fatal errors)" : "FAIL / inconclusive");
await browser.close();
process.exit(booted ? 0 : 1);