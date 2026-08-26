// Phase-1 visual QA: boots the real game server (scripted bots) on :8799 and
// drives headless Chromium through single-player matches at desktop / tablet /
// mobile viewport sizes. Asserts camera framing, world bounds, palette +
// lighting (via canvas pixel sampling), and that movement still works
// (server-authoritative). Captures screenshots to qa/screenshots/.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";

const PORT = 8799;
const BASE = `http://localhost:${PORT}`;
const SHOTS = "qa/screenshots";
const VIEW_VERTICAL_UNITS = 36; // must match render.ts

let server: ChildProcess | null = null;
let failures: string[] = [];
let checks = 0;

function check(name: string, ok: boolean, detail = ""): void {
  checks++;
  if (ok) console.log(`  \u2713 ${name}`);
  else {
    failures.push(`${name} ${detail}`);
    console.log(`  \u2717 ${name} ${detail}`);
  }
}

function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    server = spawn("node", ["--import", "tsx", "src/server/index.ts"], {
      env: { ...process.env, PORT: String(PORT), BOTS: "scripted" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    const timer = setTimeout(() => reject(new Error("server start timeout")), 15000).unref();
    const onData = (d: Buffer) => {
      buf += d.toString();
      if (buf.includes("listening")) {
        clearTimeout(timer);
        resolve();
      }
    };
    server.stdout?.on("data", onData);
    server.stderr?.on("data", onData);
  });
}

function stopServer(): void {
  if (server) {
    server.kill("SIGTERM");
    server = null;
  }
}

async function getState(page: Page): Promise<any> {
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem("gh-session") || "null"));
  const res = await fetch(`${BASE}/state?room=${s.roomCode}&player=${s.playerId}`);
  return res.json();
}

async function getCam(page: Page): Promise<{ x: number; y: number; scale: number } | null> {
  return page.evaluate(() => (window as any).__ghCam?.() ?? null);
}

// Average RGB over a small square around a CSS-px point (canvas backing pixels).
async function sample(page: Page, cssX: number, cssY: number, half = 1): Promise<[number, number, number]> {
  return page.evaluate(
    ([x, y, h]) => {
      const c = document.getElementById("game-canvas") as HTMLCanvasElement;
      const ctx = c.getContext("2d")!;
      const dpr = window.devicePixelRatio || 1;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = -h; dy <= h; dy++) {
        for (let dx = -h; dx <= h; dx++) {
          const d = ctx.getImageData(Math.round((x + dx) * dpr), Math.round((y + dy) * dpr), 1, 1).data;
          r += d[0];
          g += d[1];
          b += d[2];
          n++;
        }
      }
      return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    },
    [cssX, cssY, half] as [number, number, number],
  );
}

const lum = (p: [number, number, number]) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
const space = [5, 7, 13];
const chanDist = (a: [number, number, number], b: [number, number, number]) =>
  Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

async function enterSinglePlayer(page: Page): Promise<void> {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.click("#btn-single");
  await page.waitForSelector("#screen-game:not(.hidden)", { timeout: 10000 });
  await page.waitForTimeout(1800); // a few polls + frames
}

// Approve any pending-bank modal; if the match already ended, re-enter.
async function keepGameAlive(page: Page): Promise<void> {
  const state = await page.evaluate(() => {
    const modal = document.getElementById("approval-modal");
    if (modal && !modal.classList.contains("hidden")) {
      (document.getElementById("btn-approve") as HTMLButtonElement).click();
      return "approved";
    }
    const result = document.getElementById("screen-result");
    if (result && !result.classList.contains("hidden")) return "result";
    const game = document.getElementById("screen-game");
    if (game && !game.classList.contains("hidden")) return "game";
    return "other";
  });
  if (state === "result") {
    await page.click("#btn-again");
    await page.waitForSelector("#screen-title:not(.hidden)");
    await page.click("#btn-single");
    await page.waitForSelector("#screen-game:not(.hidden)", { timeout: 10000 });
    await page.waitForTimeout(1500);
  }
}

async function holdKey(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

const worldToScreen = (
  wx: number,
  wy: number,
  cam: { x: number; y: number; scale: number },
  vw: number,
  vh: number,
) => ({ x: (wx - cam.x) * cam.scale + vw / 2, y: (wy - cam.y) * cam.scale + vh / 2 });

// ---- static visual probes (run ~2s into a match, spawn = bottom-left corner) --
async function staticProbes(page: Page, view: { width: number; height: number; name: string }): Promise<void> {
  const cam = await getCam(page);
  const vw = view.width;
  const vh = view.height;
  check(
    `${view.name}: camera exposed`,
    !!cam && cam.scale > 0,
    cam ? `scale=${cam.scale.toFixed(2)}` : "no __ghCam",
  );
  if (!cam) return;
  const expectScale = vh / VIEW_VERTICAL_UNITS;
  check(
    `${view.name}: zoom ~36 vertical units`,
    Math.abs(cam.scale - expectScale) < 2,
    `scale=${cam.scale.toFixed(2)} expected~${expectScale.toFixed(2)}`,
  );

  const st = await getState(page);
  const me0 = st.players[0];
  const screen = worldToScreen(me0.x, me0.y, cam, vw, vh);
  check(
    `${view.name}: local player on screen`,
    screen.x > 20 && screen.x < vw - 20 && screen.y > 20 && screen.y < vh - 20,
    `player world=(${me0.x.toFixed(1)},${me0.y.toFixed(1)}) screen=(${screen.x.toFixed(0)},${screen.y.toFixed(0)})`,
  );

  // Center of view is floor (dark navy), not deep-space void.
  const center = await sample(page, vw / 2, vh / 2, 2);
  check(
    `${view.name}: no void at center`,
    lum(center) > 14 && chanDist(center, space as [number, number, number]) > 6,
    `rgb(${center.join(",")})`,
  );

  // Bottom edge of the view shows the wall frame (world bottom), never space.
  const edge = await sample(page, vw / 2, vh - 10, 1);
  const edgeLum = lum(edge);
  check(
    `${view.name}: wall frame at bottom edge`,
    edgeLum > 12 && edgeLum < 95 && chanDist(edge, space as [number, number, number]) > 6,
    `rgb(${edge.join(",")}) lum=${edgeLum.toFixed(0)}`,
  );

  // Vignette: near-top-edge area darker than center.
  const top = await sample(page, vw / 2, 18, 2);
  check(
    `${view.name}: vignette darkens edges`,
    lum(top) < lum(center) - 2,
    `top=${lum(top).toFixed(1)} center=${lum(center).toFixed(1)}`,
  );

  // Room distinctness: sample floor-only points in whichever rooms are actually
  // visible in this view (the camera may clip some rooms at spawn). Multiple
  // candidate points per room survive tight views (mobile sees only the
  // bottom-left slice of the world).
  const roomPoints: { label: string; cands: [number, number][] }[] = [
    { label: "CAFETERIA", cands: [[30, 12], [20, 8]] },
    { label: "LIBRARY", cands: [[45, 33], [20, 36], [15.5, 36]] },
    { label: "REACTOR", cands: [[25, 48], [12, 50]] },
    { label: "STORAGE", cands: [[54.5, 48], [60, 50], [75, 48]] },
  ];
  const roomSamples: [string, [number, number, number]][] = [];
  for (const rp of roomPoints) {
    for (const [wx, wy] of rp.cands) {
      const s = worldToScreen(wx, wy, cam, vw, vh);
      if (s.x < 6 || s.x > vw - 6 || s.y < 6 || s.y > vh - 6) continue; // off-screen
      roomSamples.push([rp.label, await sample(page, s.x, s.y, 3)]);
      break;
    }
  }
  let distinctPairs = 0;
  for (let i = 0; i < roomSamples.length; i++) {
    for (let j = i + 1; j < roomSamples.length; j++) {
      if (chanDist(roomSamples[i][1], roomSamples[j][1]) >= 3) distinctPairs++;
    }
  }
  check(
    `${view.name}: rooms visually distinct`,
    roomSamples.length >= 2 && distinctPairs >= 1,
    `${roomSamples.length} rooms visible, distinct pairs ${distinctPairs}/${roomSamples.length * (roomSamples.length - 1) * 0.5}: ${roomSamples.map(([l, p]) => `${l}=rgb(${p.join(",")})`).join(" ")}`,
  );
}

// ---- movement probes: camera follow + clamp + gameplay regression -----------
async function movementProbes(page: Page, view: { width: number; height: number; name: string }): Promise<void> {
  const vw = view.width;
  const vh = view.height;
  const st0 = await getState(page);
  const x0 = st0.players[0].x;

  // Hold right along the bottom wall. The camera target is playerX + lookahead,
  // so once the player passes viewW/2 - 3 the camera must start tracking; we
  // sample camX while the key is still held (lookahead active).
  await page.keyboard.down("d");
  await page.waitForTimeout(5000); // x: 9 -> ~29 (target 32 > clamp 28.8)
  const samples: { camX: number; playerX: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const c = await getCam(page);
    const st = await getState(page);
    if (c) samples.push({ camX: c.x, playerX: st.players[0].x });
    await page.waitForTimeout(300);
  }
  await page.keyboard.up("d");
  await keepGameAlive(page);

  const last = samples[samples.length - 1];
  check(
    `${view.name}: player actually moves (server-authoritative)`,
    last.playerX > x0 + 8 && last.playerX < x0 + 30,
    `x ${x0.toFixed(1)} -> ${last.playerX.toFixed(1)}`,
  );

  let monotonic = true;
  let maxStep = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].camX < samples[i - 1].camX - 0.01) monotonic = false;
    maxStep = Math.max(maxStep, samples[i].camX - samples[i - 1].camX);
  }
  check(
    `${view.name}: camera tracks player (unclamped)`,
    Math.abs(last.camX - (last.playerX + 3)) < 1.6,
    `camX=${last.camX.toFixed(2)} playerX=${last.playerX.toFixed(2)}`,
  );
  check(
    `${view.name}: camera moves smoothly (no snap/jitter)`,
    monotonic && maxStep > 0.01 && maxStep < 2.6,
    `samples=[${samples.map((s) => s.camX.toFixed(2)).join(",")}] maxStep=${maxStep.toFixed(2)}`,
  );
  await page.screenshot({ path: `${SHOTS}/${view.name}-game-follow.png` });

  // Walk back to the corner: camera must clamp back to the world edge.
  await holdKey(page, "a", 4800);
  await keepGameAlive(page);
  const cam3 = (await getCam(page))!;
  const viewW2 = vw / (2 * cam3.scale);
  check(
    `${view.name}: camera clamps at world edge`,
    Math.abs(cam3.x - viewW2) < 0.8,
    `camX=${cam3.x.toFixed(2)} viewW/2=${viewW2.toFixed(2)}`,
  );
  await page.screenshot({ path: `${SHOTS}/${view.name}-game-corner.png` });
}

async function main(): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  console.log("Booting game server on :" + PORT + " ...");
  await startServer();
  const browser = await chromium.launch();

  try {
    const views = [
      { width: 1440, height: 900, name: "desktop" },
      { width: 768, height: 1024, name: "tablet" },
      { width: 390, height: 844, name: "mobile" },
    ];
    for (const view of views) {
      // Fresh context per viewport: isolated storage (no resumeSession from a
      // previous match) + correct viewport for the pixel probes.
      const ctx = await browser.newContext({ viewport: { width: view.width, height: view.height } });
      const p = await ctx.newPage();
      p.on("pageerror", (e) => {
        failures.push(`pageerror: ${e.message}`);
        console.log("  [pageerror]", e.message);
      });
      p.on("console", (m) => {
        if (m.type() === "error") {
          failures.push(`console.error: ${m.text()}`);
          console.log("  [console.error]", m.text());
        }
      });
      console.log(`\n=== ${view.name.toUpperCase()} ${view.width}x${view.height} ===`);
      await enterSinglePlayer(p);
      await p.screenshot({ path: `${SHOTS}/${view.name}-title.png` });
      await staticProbes(p, view);
      await p.screenshot({ path: `${SHOTS}/${view.name}-game-spawn.png` });
      if (view.name === "desktop") await movementProbes(p, view);
      const cam = await getCam(p);
      if (cam) {
        check(
          `${view.name}: player readable scale`,
          cam.scale * 2.6 >= 55,
          `bean px=${(cam.scale * 2.6).toFixed(0)}`,
        );
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    stopServer();
  }

  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length > 0) {
    console.log("FAILURES:");
    for (const f of failures) console.log("  - " + f);
    process.exitCode = 1;
  } else {
    console.log("ALL VISUAL CHECKS PASSED");
  }
}

main().catch((e) => {
  console.error("QA crashed:", e);
  stopServer();
  process.exit(1);
});
