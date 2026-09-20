// Visual life + camera QA against the DEPLOYED build.
//
// verify-deploy.ts proves the engine boots and the HTTP surface is right. This
// script answers the two questions that only a running build can answer:
//   1. Is the world actually ANIMATING once deployed? (two frames, seconds apart)
//   2. Do the camera controls actually reframe the world when tapped?
// Frames are written to disk; scripts/png_diff.py measures the change.
//
// Usage: npx tsx scripts/verify-visual-life.ts [baseUrl] [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
const OUT = process.argv[3] ?? "artifacts/visual-life";

type View = { name: string; width: number; height: number; touch: boolean };
const ALL_VIEWS: View[] = [
  { name: "desktop-landscape", width: 1600, height: 900, touch: false },
  { name: "tablet-landscape", width: 1180, height: 820, touch: true },
  { name: "tablet-portrait", width: 820, height: 1180, touch: true },
];

// ASTRIX_VIEWS=desktop-landscape runs a single viewport. Software rendering is
// slow here, so a targeted question (does the BRIDGE render?) should not have to
// pay for all three viewports.
const ONLY = (process.env.ASTRIX_VIEWS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const VIEWS: View[] = ONLY.length ? ALL_VIEWS.filter((v) => ONLY.includes(v.name)) : ALL_VIEWS;

// MobileHUD._reposition: the cluster is bottom-right, 150x170, with a 20px safe
// margin that portrait widens to 36. Pills sit in a 2x2 grid inside it.
const CLUSTER = { w: 150, h: 170 };
const PILL = {
  world: { x: 35.5, y: 96 },
  island: { x: 114.5, y: 96 },
  steward: { x: 35.5, y: 148 },
  walk: { x: 114.5, y: 148 },
};

function pillAt(view: View, which: keyof typeof PILL): { x: number; y: number } {
  const margin = view.width / view.height < 1.05 ? 36 : 20;
  const cx = view.width - CLUSTER.w - margin;
  const cy = view.height - CLUSTER.h - margin;
  return { x: cx + PILL[which].x, y: cy + PILL[which].y };
}

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function grab(page: Page, path: string): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const shot = (await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true })) as { data: string };
  writeFileSync(path, Buffer.from(shot.data, "base64"));
  await cdp.detach();
}

async function tap(page: Page, view: View, which: keyof typeof PILL): Promise<void> {
  const at = pillAt(view, which);
  if (view.touch) await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(2500);
}

async function run(browser: Browser, view: View): Promise<void> {
  console.log(`[life] ${view.name} ${view.width}x${view.height}`);
  const ctx = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    hasTouch: view.touch, isMobile: false, deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const started = await page.waitForFunction(
    () => (document.getElementById("status") === null ? "running" : false),
    undefined, { timeout: 300_000, polling: 500 },
  ).then((h) => h.jsonValue() as Promise<string>);
  check(`${view.name} engine started`, started === "running", started);

  await page.waitForTimeout(14_000);
  const dir = `${OUT}/${view.name}`;
  mkdirSync(dir, { recursive: true });
  await grab(page, `${dir}/01-world-a.png`);
  await page.waitForTimeout(4_000);
  await grab(page, `${dir}/02-world-b.png`);

  await tap(page, view, "island");
  await grab(page, `${dir}/03-island-1.png`);
  await tap(page, view, "island");
  await grab(page, `${dir}/04-island-2.png`);
  await tap(page, view, "steward");
  await grab(page, `${dir}/05-steward.png`);
  await tap(page, view, "walk");
  await grab(page, `${dir}/06-walk.png`);
  await tap(page, view, "world");
  await grab(page, `${dir}/07-world-again.png`);

  const fatal = errors.filter((e) => !/favicon|AudioContext|autoplay|deprecated/i.test(e));
  check(`${view.name} no page errors`, fatal.length === 0, fatal.slice(0, 3).join(" | "));
  console.log(`  saved 7 frames to ${dir}`);
  await ctx.close();
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--no-sandbox", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
  });
  try {
    for (const view of VIEWS) {
      try { await run(browser, view); }
      catch (err) { check(`${view.name} completed`, false, (err as Error).message.split("\n")[0]); }
    }
  } finally { await browser.close(); }
  console.log(`[life] failures=${failures}`);
  console.log(`[life] RESULT=${failures === 0 ? "PASS" : "FAIL"}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
