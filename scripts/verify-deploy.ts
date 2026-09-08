// Deployment verification for the ASTrix Godot web build.
//
// An export command exiting 0 is NOT a deployment. This script proves the
// DEPLOYED artifact works by loading the served page in a real browser, waiting
// for the Godot engine to hide its own boot overlay, and screenshotting the
// running world at each target viewport. It also asserts the HTTP surface the
// client depends on (/, /index.js, /index.wasm, /index.pck, /astrix/state).
//
// Usage: npx tsx scripts/verify-deploy.ts [baseUrl] [outDir]
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
const OUT = process.argv[3] ?? "artifacts/deploy-verify";

type View = { name: string; width: number; height: number; touch: boolean };
const VIEWS: View[] = [
  { name: "desktop-landscape", width: 1600, height: 900, touch: false },
  { name: "tablet-landscape", width: 1180, height: 820, touch: true },
  { name: "tablet-portrait", width: 820, height: 1180, touch: true },
];

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function checkHttp(): Promise<void> {
  console.log("[deploy] HTTP surface");
  const expect: Array<[string, string]> = [
    ["/", "text/html"],
    ["/index.js", "text/javascript"],
    ["/index.wasm", "application/wasm"],
    ["/index.pck", "application/octet-stream"],
    ["/astrix/state", "application/json"],
    ["/astrix/agent/status", "application/json"],
  ];
  for (const [path, type] of expect) {
    const res = await fetch(`${BASE}${path}`);
    const ct = res.headers.get("content-type") ?? "";
    const len = (await res.arrayBuffer()).byteLength;
    check(`GET ${path}`, res.status === 200 && ct.includes(type) && len > 0, `${res.status} ${ct} ${len}b`);
  }
  const state = (await (await fetch(`${BASE}/astrix/state`)).json()) as Record<string, unknown>;
  check("/astrix/state carries an authoritative world", typeof state.day === "number" && Array.isArray(state.islands),
    `day=${state.day} islands=${(state.islands as unknown[] | undefined)?.length}`);
}

async function shoot(browser: Browser, view: View): Promise<void> {
  console.log(`[deploy] ${view.name} ${view.width}x${view.height}`);
  const ctx = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    hasTouch: view.touch,
    isMobile: false,
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });

  // The Godot shell REMOVES #status once the engine is running, and fills
  // #status-notice on failure. Wait for whichever happens.
  const outcome = await page.waitForFunction(
    () => {
      const s = document.getElementById("status");
      if (s === null) return "running";
      const notice = document.getElementById("status-notice");
      const text = (notice?.textContent ?? "").trim();
      return text.length > 0 ? `failed: ${text}` : false;
    },
    undefined,
    { timeout: 300_000, polling: 500 },
  ).then((h) => h.jsonValue() as Promise<string>);
  check(`${view.name} engine started`, outcome === "running", outcome);
  if (outcome !== "running") {
    await ctx.close();
    return;
  }

  // Canvas is sized to the viewport by the shell, and the world needs a few
  // seconds of real frames for the camera solve, villagers and light grade.
  const size = await page.evaluate(() => {
    const c = document.getElementById("canvas") as HTMLCanvasElement | null;
    return c ? { w: c.width, h: c.height } : null;
  });
  check(`${view.name} canvas fills the viewport`,
    !!size && size.w === view.width && size.h === view.height,
    size ? `${size.w}x${size.h}` : "no canvas");

  await page.waitForTimeout(15_000);
  const path = `${OUT}/${view.name}.png`;
  // Playwright's screenshot waits for a STABLE frame, which a continuously
  // rendering WebGL canvas under swiftshader never delivers -- it timed out at
  // the 30s default. Capture through raw CDP instead, which grabs the surface as
  // it is, and keep a generous-timeout page.screenshot as the fallback.
  let captured = false;
  try {
    const cdp = await page.context().newCDPSession(page);
    const shot = (await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true })) as { data: string };
    writeFileSync(path, Buffer.from(shot.data, "base64"));
    await cdp.detach();
    captured = true;
  } catch (err) {
    console.log(`  cdp capture failed (${(err as Error).message}); falling back`);
  }
  if (!captured) await page.screenshot({ path, timeout: 180_000 });
  check(`${view.name} frame captured`, existsSync(path) && statSync(path).size > 10_000,
    existsSync(path) ? `${statSync(path).size}b` : "missing");
  console.log(`  saved ${path}`);
  const fatal = errors.filter((e) => !/favicon|AudioContext|autoplay|deprecated/i.test(e));
  check(`${view.name} no page errors`, fatal.length === 0, fatal.slice(0, 3).join(" | "));
  await ctx.close();
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await checkHttp();
  const browser = await chromium.launch({
    args: [
      "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--no-sandbox", "--disable-gpu-vsync", "--disable-frame-rate-limit",
    ],
  });
  try {
    for (const view of VIEWS) {
      try {
        await shoot(browser, view);
      } catch (err) {
        check(`${view.name} completed`, false, (err as Error).message.split("\n")[0]);
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`[deploy] failures=${failures}`);
  console.log(`[deploy] RESULT=${failures === 0 ? "PASS" : "FAIL"}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
