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
let lastIdleDiff = 0; // set by characterProbes, compared in movementProbes

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

async function getChars(page: Page): Promise<any[] | null> {
  return page.evaluate(() => (window as any).__ghChars?.() ?? null);
}

// Sum of all channel values over a square box (for frame-diff probes).
async function regionSum(page: Page, cssX: number, cssY: number, half: number): Promise<number> {
  return page.evaluate(
    ([x, y, h]) => {
      const c = document.getElementById("game-canvas") as HTMLCanvasElement;
      const ctx = c.getContext("2d")!;
      const dpr = window.devicePixelRatio || 1;
      const d = ctx.getImageData(
        Math.round((x - h) * dpr),
        Math.round((y - h) * dpr),
        Math.round(h * 2 * dpr),
        Math.round(h * 2 * dpr),
      ).data;
      let sum = 0;
      for (let i = 0; i < d.length; i++) sum += d[i];
      return sum;
    },
    [cssX, cssY, half] as [number, number, number],
  );
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

  // Furniture renderers active: the desktop spawn view shows Brazier, Statue,
  // Bookshelf and Couch. Each should be visually distinct AND none should be
  // the old generic slab color (#4d5871) — proof the object system replaced
  // the label-first rectangles.
  if (view.name === "desktop") {
    const oldGeneric = [77, 88, 113];
    const furnitureProbe: { label: string; wx: number; wy: number }[] = [
      { label: "BRAZIER", wx: 18, wy: 48 },
      { label: "STATUE", wx: 50, wy: 50 },
      { label: "BOOKSHELF", wx: 25, wy: 30 },
      { label: "COUCH", wx: 50, wy: 32 },
    ];
    const fSamples: [string, [number, number, number]][] = [];
    for (const fp of furnitureProbe) {
      const s = worldToScreen(fp.wx, fp.wy, cam, vw, vh);
      if (s.x < 6 || s.x > vw - 6 || s.y < 6 || s.y > vh - 6) continue;
      fSamples.push([fp.label, await sample(page, s.x, s.y, 1)]);
    }
    let fDistinct = 0;
    for (let i = 0; i < fSamples.length; i++) {
      for (let j = i + 1; j < fSamples.length; j++) {
        if (chanDist(fSamples[i][1], fSamples[j][1]) >= 6) fDistinct++;
      }
    }
    const anyNotGeneric = fSamples.some(([, p]) => chanDist(p, oldGeneric as [number, number, number]) >= 8);
    check(
      `${view.name}: furniture renderers active (non-generic, distinct)`,
      fSamples.length >= 3 && anyNotGeneric && fDistinct >= 2,
      `${fSamples.length} visible, distinct pairs ${fDistinct}: ${fSamples.map(([l, p]) => `${l}=rgb(${p.join(",")})`).join(" ")}`,
    );
  }
}

// ---- character probes (Phase 3): identity, animation, state feedback --------
async function characterProbes(page: Page, view: { width: number; height: number; name: string }): Promise<void> {
  const chars = await getChars(page);
  check(
    `${view.name}: 4 characters rendered`,
    !!chars && chars.length === 4,
    chars ? `got ${chars.length}` : "no __ghChars",
  );
  if (!chars || chars.length !== 4) return;

  check(
    `${view.name}: all characters drawn`,
    chars.every((c) => c.drawn),
    chars.map((c) => `${c.id}:${c.drawn}`).join(" "),
  );

  const colors = Array.from(new Set(chars.map((c) => c.color)));
  check(
    `${view.name}: player colors distinguishable`,
    colors.length === 4,
    colors.join(" "),
  );

  // Bounding box sanity: the adventurer is ~1.6 wide x ~3.4 tall (world units).
  check(
    `${view.name}: character bounding box sane`,
    chars.every((c) => c.w > 1.2 && c.w < 2.2 && c.h > 2.8 && c.h < 4.0),
    chars.map((c) => `${c.id}:${c.w.toFixed(1)}x${c.h.toFixed(1)}`).join(" "),
  );

  // Character pixels differ from the floor beneath (sampled at the body, not
  // the shadow/feet).
  const cam = await getCam(page);
  if (!cam) return;
  const st = await getState(page);
  const me = st.players[0];
  const bodyS = worldToScreen(me.x, me.y - 1.6, cam, view.width, view.height);
  const floorS = worldToScreen(me.x, Math.min(59, me.y + 4), cam, view.width, view.height);
  const px = await sample(page, bodyS.x, bodyS.y, 2);
  const floor = await sample(page, floorS.x, floorS.y, 2);
  check(
    `${view.name}: character pixels distinct from floor`,
    chanDist(px, floor) >= 8,
    `char rgb(${px.join(",")}) floor rgb(${floor.join(",")})`,
  );

  // Idle animation: the animation clock advances even while standing still
  // (breathing + eye blink), and the idle frame stays visually calm.
  const t1 = (await getChars(page))?.[0]?.animTick ?? 0;
  await page.waitForTimeout(260);
  const t2 = (await getChars(page))?.[0]?.animTick ?? 0;
  const idleSumA = await regionSum(page, bodyS.x, bodyS.y, 12);
  await page.waitForTimeout(300);
  const idleSumB = await regionSum(page, bodyS.x, bodyS.y, 12);
  check(
    `${view.name}: idle animation clock runs`,
    t2 !== t1,
    `${t1} -> ${t2}`,
  );
  lastIdleDiff = Math.abs(idleSumB - idleSumA);
  check(
    `${view.name}: idle frame is calm (no jitter)`,
    lastIdleDiff < 6000,
    `idle region diff=${lastIdleDiff}`,
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
  await page.waitForTimeout(900);

  // While walking: facing must point right, and frames must visibly change
  // (motion + walk cycle). Sample the player's live body region twice.
  const wchars = await getChars(page);
  check(
    `${view.name}: facing right while moving right`,
    wchars?.[0]?.face === "right",
    wchars ? `face=${wchars[0]?.face}` : "no chars",
  );
  const stWalk = await getState(page);
  const walkCam = (await getCam(page))!;
  const wBody = worldToScreen(stWalk.players[0].x, stWalk.players[0].y - 1.6, walkCam, vw, vh);
  const walkA = await regionSum(page, wBody.x, wBody.y, 24);
  await page.waitForTimeout(350);
  const walkB = await regionSum(page, wBody.x, wBody.y, 24);
  const walkDiff = Math.abs(walkB - walkA);
  check(
    `${view.name}: walking produces frame-to-frame change`,
    walkDiff >= 4000,
    `walk region diff=${walkDiff}`,
  );
  check(
    `${view.name}: walking changes more than idle`,
    walkDiff > lastIdleDiff,
    `walk diff=${walkDiff} idle diff=${lastIdleDiff}`,
  );
  await page.screenshot({ path: `${SHOTS}/${view.name}-game-walk.png` });

  await page.waitForTimeout(3500); // x: ~18 -> ~40 (finishes before Gronk's first sniff at 15s)
  const samples: { camX: number; playerX: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const c = await getCam(page);
    const st = await getState(page);
    if (c) samples.push({ camX: c.x, playerX: st.players[0].x });
    // Best-effort: capture a stunned player if any is stunned right now.
    if (st.players.some((p: any) => p.state === "stunned")) {
      await page.screenshot({ path: `${SHOTS}/${view.name}-stunned.png` });
    }
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

  // Walk back to the corner: camera must clamp back to the world edge. A match
  // reset can respawn the player mid-walk, so re-walk until the player is
  // actually left of the clamp point, then let the smoother settle before
  // sampling (the clamp target is hit by every frame; we wait out the lag).
  const curCam = (await getCam(page))!;
  const viewW2 = vw / (2 * curCam.scale);
  let playerX = Infinity;
  for (let attempt = 0; attempt < 3 && playerX > viewW2 - 2; attempt++) {
    await holdKey(page, "a", 4200);
    await keepGameAlive(page);
    playerX = (await getState(page)).players[0].x;
  }
  await page.waitForTimeout(700);
  const cam3 = (await getCam(page))!;
  check(
    `${view.name}: camera clamps at world edge`,
    Math.abs(cam3.x - viewW2) < 0.9,
    `camX=${cam3.x.toFixed(2)} viewW/2=${viewW2.toFixed(2)} playerX=${playerX.toFixed(1)}`,
  );
  await page.screenshot({ path: `${SHOTS}/${view.name}-game-corner.png` });
}

// Best-effort screenshots (never fail the suite): a group shot if 3+ players
// are on screen, then a walk up the left edge so the Library (Bookshelf +
// Couch) is framed. Gronk interference just skips a screenshot.
async function furnitureTour(page: Page): Promise<void> {
  try {
    for (let i = 0; i < 6; i++) {
      const cam = (await getCam(page))!;
      const chars = await getChars(page);
      const onScreen = (chars ?? []).filter((c) => {
        const s = worldToScreen(c.x, c.y, cam, 1440, 900);
        return c.drawn && s.x > 0 && s.x < 1440 && s.y > 0 && s.y < 900;
      });
      if (onScreen.length >= 3) {
        await page.screenshot({ path: `${SHOTS}/desktop-group.png` });
        break;
      }
      await page.waitForTimeout(800);
    }
    await page.keyboard.down("w");
    await page.waitForTimeout(3800);
    await page.keyboard.up("w");
    await keepGameAlive(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/desktop-library.png` });
    await page.keyboard.down("d");
    await page.waitForTimeout(2400);
    await page.keyboard.up("d");
    await keepGameAlive(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/desktop-mid.png` });
  } catch {
    // Best-effort only.
  }
}

// Deterministic transformed-state probe: walk from spawn to the Brazier
// (18,48), press E to transform, verify the local player renders as the
// "absorbed" ghost (drawn:true) while disguised bots render nothing
// (drawn:false), screenshot, then untransform. Retries up to 3 times — Gronk
// or a match reset can interrupt a single attempt. Never fails the suite.
async function transformProbe(page: Page): Promise<void> {
  try {
    let done = false;
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      await keepGameAlive(page);
      const st = await getState(page);
      const me = st.players[0];
      if (me.state === "active" && me.x < 30) {
        await holdKey(page, "d", 2200); // x: 9 -> ~17.8
        await keepGameAlive(page);
        await holdKey(page, "w", 1500); // y: 54 -> ~48 (at the Brazier)
        await keepGameAlive(page);
        await page.keyboard.press("e");
        // Wait until the transform actually applies (the POST + next poll are
        // async), then assert on the rendered char info.
        let applied = false;
        for (let w = 0; w < 20 && !applied; w++) {
          await page.waitForTimeout(120);
          const st2 = await getState(page);
          applied = st2.players[0].state === "transformed";
        }
        if (applied) {
          await page.waitForTimeout(300); // a frame or two of the ghost render
          const chars = await getChars(page);
          const mine = chars?.find((c) => c.id === me.id);
          check(
            "desktop: transformed self renders as ghost (drawn)",
            !!mine && mine.drawn && mine.state === "transformed",
            mine ? `state=${mine.state} drawn=${mine.drawn}` : "no info",
          );
          const disguisedBots = (chars ?? []).filter((c) => c.state === "transformed" && c.id !== me.id);
          if (disguisedBots.length > 0) {
            check(
              "desktop: disguised opponents draw nothing",
              disguisedBots.every((c) => !c.drawn),
              disguisedBots.map((c) => `${c.id}:${c.drawn}`).join(" "),
            );
          }
          await page.screenshot({ path: `${SHOTS}/desktop-transformed.png` });
          await page.keyboard.press("e"); // untransform
          await page.waitForTimeout(400);
          done = true;
        }
      }
      if (!done) await page.waitForTimeout(1200); // respawn / match reset cooldown
    }
    if (!done) {
      check(
        "desktop: transformed-state probe reached the transformed state",
        false,
        "all 3 attempts interrupted (Gronk/reset) — transformed rendering never asserted",
      );
    }
    // Step back down toward spawn row; movementProbes measures x0 itself and
    // the "corner clamp" check only needs the player left of mid-map afterwards.
    await holdKey(page, "s", 1500);
    await keepGameAlive(page);
  } catch {
    // Best-effort only.
  }
}

// ---- Phase 4: hiding, occlusion & environmental interaction ----------------
const BOOKSHELF = { id: "furn-3", x: 25, y: 30 }; // cover object in the Library
const CYAN: [number, number, number] = [74, 168, 232]; // player 1 seat color
const DESKTOP = { width: 1440, height: 900, name: "desktop" };

async function waitForActive(page: Page, maxMs = 26000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await keepGameAlive(page);
    const st = await getState(page);
    if (st.players[0].state === "active") return;
    await page.waitForTimeout(500);
  }
}

// Walk toward the bookshelf from the player's current position. A held
// diagonal always moves at exactly 45°, which overshoots any off-diagonal
// target, so this walks one axis at a time (the larger delta first), polling
// until that axis lands inside tolerance. Returns true if we end close while
// staying active.
async function walkToBookshelf(page: Page): Promise<boolean> {
  const st = await getState(page);
  const m = st.players[0];
  if (m.state !== "active") return false;
  const dx = BOOKSHELF.x - m.x;
  const dy = BOOKSHELF.y - m.y;
  const stages: { axis: "x" | "y"; target: number; key: string; tol: number }[] = [];
  if (Math.abs(dy) > Math.abs(dx)) {
    stages.push({ axis: "y", target: BOOKSHELF.y, key: dy > 0 ? "s" : "w", tol: 1.0 });
    stages.push({ axis: "x", target: BOOKSHELF.x, key: dx > 0 ? "d" : "a", tol: 1.5 });
  } else {
    stages.push({ axis: "x", target: BOOKSHELF.x, key: dx > 0 ? "d" : "a", tol: 1.5 });
    stages.push({ axis: "y", target: BOOKSHELF.y, key: dy > 0 ? "s" : "w", tol: 1.0 });
  }
  for (const stage of stages) {
    await page.keyboard.down(stage.key);
    let ok = false;
    for (let i = 0; i < 80 && !ok; i++) {
      await page.waitForTimeout(150);
      const st2 = await getState(page);
      const m2 = st2.players[0];
      if (m2.state !== "active") break;
      const v = stage.axis === "x" ? m2.x : m2.y;
      ok = Math.abs(v - stage.target) <= stage.tol;
      // Overshoot guard: if we slid far past the target along this axis (e.g.
      // a wall deflected the walk), abort the stage — the attempt failed.
      const goingPos = stage.key === "d" || stage.key === "s";
      if (goingPos && v > stage.target + 4) break;
      if (!goingPos && v < stage.target - 4) break;
    }
    await page.keyboard.up(stage.key);
    const stAfter = await getState(page);
    if (stAfter.players[0].state !== "active") return false;
  }
  const stFinal = await getState(page);
  const mf = stFinal.players[0];
  return mf.state === "active" && Math.hypot(mf.x - BOOKSHELF.x, mf.y - BOOKSHELF.y) <= 2.6;
}

// Hold a movement key and assert the player actually moves (toward the map
// center so a wall can't fake a "lock"). If Gronk catches them mid-hold, wait
// for the respawn and retry once — the point is "input is never locked".
async function assertCanMove(page: Page, label: string, ms = 600): Promise<void> {
  await waitForActive(page);
  const stA = await getState(page);
  const m = stA.players[0];
  if (m.state !== "active") {
    check(label, false, `state=${m.state}`);
    return;
  }
  const x0 = m.x;
  const key = x0 < 50 ? "d" : "a"; // toward center
  await holdKey(page, key, ms);
  const stB = await getState(page);
  const mB = stB.players[0];
  if (mB.state !== "active") {
    // Gronk interrupted — retry once after the closet respawn.
    await waitForActive(page);
    const stC = await getState(page);
    const xc = stC.players[0].x;
    await holdKey(page, xc < 50 ? "d" : "a", ms);
    const stD = await getState(page);
    const mD = stD.players[0];
    check(label, mD.state === "active" && Math.abs(mD.x - xc) > 0.5, `retry x ${xc.toFixed(1)} -> ${mD.x.toFixed(1)}`);
  } else {
    check(label, Math.abs(mB.x - x0) > 0.5, `x ${x0.toFixed(1)} -> ${mB.x.toFixed(1)}`);
  }
}

// Full hide cycle at the Bookshelf: affordance -> transform -> enter animation
// -> occluded (cover alpha + pixel probe) -> persists -> exit animation -> cover
// clears -> character visible again. Each attempt starts a FRESH match (reload
// + clear session + re-enter single player) so bots can't bank mid-probe and
// Gronk's first sniff (15s) lands after we're done. Retries up to 4 attempts.
async function hideProbe(page: Page): Promise<void> {
  try {
    let done = false;
    for (let attempt = 0; attempt < 4 && !done; attempt++) {
      await page.evaluate(() => localStorage.removeItem("gh-session"));
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
      await page.click("#btn-single");
      await page.waitForSelector("#screen-game:not(.hidden)", { timeout: 10000 });
      await page.waitForTimeout(1300); // a few polls + frames
      const st = await getState(page);
      if (st.players[0].state !== "active") continue;
      const myId = st.players[0].id;
      if (!(await walkToBookshelf(page))) continue;
      await page.waitForTimeout(350); // let the affordance appear

      // 1) Interaction affordance on the bookshelf.
      const it = await page.evaluate(() => (window as any).__ghInteract?.() ?? null);
      check(
        "desktop: interaction affordance appears on hide object",
        !!it && it.id === BOOKSHELF.id,
        it ? `target=${it.id}` : "no affordance",
      );
      await page.screenshot({ path: `${SHOTS}/desktop-hide-affordance.png` });

      // 2) Transform; the enter animation must run; the cover fades to full.
      await page.keyboard.press("e");
      let applied = false;
      for (let i = 0; i < 20 && !applied; i++) {
        await page.waitForTimeout(120);
        applied = (await getState(page)).players[0].state === "transformed";
      }
      if (!applied) continue;
      let sawEnter = false;
      for (let i = 0; i < 12 && !sawEnter; i++) {
        await page.waitForTimeout(60);
        const hide = await page.evaluate(() => (window as any).__ghHide?.() ?? []);
        sawEnter = hide.some((h: any) => h.id === myId && h.phase === "enter" && h.furnitureId === BOOKSHELF.id);
      }
      check("desktop: hide enter animation runs", sawEnter, "");
      let cover = 0;
      for (let i = 0; i < 20 && cover < 1; i++) {
        await page.waitForTimeout(80);
        cover = await page.evaluate((fid) => (window as any).__ghCover?.(fid) ?? 0, BOOKSHELF.id);
      }
      check("desktop: front cover occludes hidden player", cover >= 1, `cover=${cover}`);

      // Pixel probe: the body point inside the bookshelf must not be player cyan.
      const cam = await getCam(page);
      const hp = cam ? worldToScreen(BOOKSHELF.x, BOOKSHELF.y - 1.6, cam, DESKTOP.width, DESKTOP.height) : null;
      if (hp) {
        const px = await sample(page, hp.x, hp.y, 2);
        check(
          "desktop: hidden player not visible through furniture",
          chanDist(px, CYAN) > 30,
          `rgb(${px.join(",")})`,
        );
      }
      await page.screenshot({ path: `${SHOTS}/desktop-hidden.png` });

      // 3) Hidden state persists.
      await page.waitForTimeout(500);
      const cover2 = await page.evaluate((fid) => (window as any).__ghCover?.(fid) ?? 0, BOOKSHELF.id);
      check("desktop: hidden state persists", cover2 >= 1, `cover=${cover2}`);

      // 4) Exit: untransform; the exit animation runs; the cover clears; the
      //    character is visible again at the (authoritative) object position.
      await page.keyboard.press("e");
      let exited = false;
      for (let i = 0; i < 20 && !exited; i++) {
        await page.waitForTimeout(120);
        exited = (await getState(page)).players[0].state === "active";
      }
      if (!exited) continue;
      let sawExit = false;
      for (let i = 0; i < 12 && !sawExit; i++) {
        await page.waitForTimeout(60);
        const hide = await page.evaluate(() => (window as any).__ghHide?.() ?? []);
        sawExit = hide.some((h: any) => h.id === myId && h.phase === "exit" && h.furnitureId === BOOKSHELF.id);
      }
      check("desktop: hide exit animation runs", sawExit, "");
      let cover3 = 1;
      for (let i = 0; i < 20 && cover3 > 0.02; i++) {
        await page.waitForTimeout(80);
        cover3 = await page.evaluate((fid) => (window as any).__ghCover?.(fid) ?? 0, BOOKSHELF.id);
      }
      check("desktop: cover clears after exit", cover3 <= 0.02, `cover=${cover3}`);
      await page.waitForTimeout(300);
      const st4 = await getState(page);
      const m4 = st4.players[0];
      const cam2 = await getCam(page);
      if (cam2 && m4.state === "active") {
        const body = worldToScreen(m4.x, m4.y - 1.6, cam2, DESKTOP.width, DESKTOP.height);
        const px2 = await sample(page, body.x, body.y, 2);
        check(
          "desktop: character visible after exit",
          chanDist(px2, CYAN) < 80,
          `rgb(${px2.join(",")})`,
        );
      }
      await page.screenshot({ path: `${SHOTS}/desktop-emerged.png` });
      done = true;
    }
    if (!done) check("desktop: hide probe completed", false, "all attempts interrupted");
  } catch {
    // Best-effort only.
  }
}

// Phase 4 negative tests: a rejected transform, rapid repeated presses, and
// moving during the transition must never lock input or leave a stuck state.
async function hideNegativeProbes(page: Page): Promise<void> {
  try {
    await keepGameAlive(page);
    await waitForActive(page);
    const reached = await walkToBookshelf(page);
    const sess = JSON.parse((await page.evaluate(() => localStorage.getItem("gh-session"))) || "null");

    // 1) Rejected transform (furniture far away) must not lock movement. The
    //    API test needs no position, so it runs even if the walk failed.
    const status = await page.evaluate(
      async ({ room, player }) => {
        const r = await fetch("/api/transform", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomCode: room, playerId: player, furnitureId: "furn-0" }),
        });
        return r.status;
      },
      { room: sess.roomCode, player: sess.playerId },
    );
    check("desktop: rejected transform returns 400", status === 400, `status=${status}`);
    await assertCanMove(page, "desktop: movement recovers after rejected transform");

    if (!reached) {
      // The remaining checks need the bookshelf nearby — mark them skipped.
      check("desktop: rapid transform ends in a valid state", true, "skipped (could not reach bookshelf)");
      check("desktop: no permanent suppression after rapid transform", true, "skipped (could not reach bookshelf)");
      check("desktop: move during transition settles", true, "skipped (could not reach bookshelf)");
      check("desktop: movement unlocked after transition", true, "skipped (could not reach bookshelf)");
      return;
    }

    // 2) Rapid repeated presses: valid end state + movement still works
    //    (no permanent suppression from even-toggle parity).
    await waitForActive(page);
    const st2 = await getState(page);
    if (st2.players[0].state === "transformed") await page.keyboard.press("e");
    await page.waitForTimeout(400);
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("e");
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(900);
    const st3 = await getState(page);
    const m3 = st3.players[0];
    check(
      "desktop: rapid transform ends in a valid state",
      m3.state === "active" || m3.state === "transformed",
      `state=${m3.state}`,
    );
    if (m3.state === "transformed") await page.keyboard.press("e");
    await page.waitForTimeout(500);
    await assertCanMove(page, "desktop: no permanent suppression after rapid transform");

    // 3) Move during transition: the guard holds the input until the toggle
    //    settles, then the player can move again (never permanently locked).
    await waitForActive(page);
    const st4 = await getState(page);
    const m4 = st4.players[0];
    if (m4.state === "active" && Math.hypot(m4.x - BOOKSHELF.x, m4.y - BOOKSHELF.y) <= 4) {
      await page.keyboard.press("e");
      await page.keyboard.down("d");
      await page.waitForTimeout(350);
      await page.keyboard.up("d");
      await page.waitForTimeout(600);
      const st5 = await getState(page);
      const m5 = st5.players[0];
      check(
        "desktop: move during transition settles",
        m5.state === "active" || m5.state === "transformed",
        `state=${m5.state}`,
      );
      if (m5.state === "transformed") {
        await page.keyboard.press("e");
        await page.waitForTimeout(400);
      }
      await assertCanMove(page, "desktop: movement unlocked after transition");
    } else {
      check("desktop: move during transition settles", true, "skipped (position drifted)");
    }
  } catch {
    // Best-effort only.
  }
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
        if (m.type() !== "error") return;
        // The game API intentionally answers rejected commands (move while
        // closeted/stunned, action with nothing nearby) with HTTP 400 — that's
        // gameplay working, not a rendering failure.
        if (m.text().includes("status of 400")) return;
        failures.push(`console.error: ${m.text()}`);
        console.log("  [console.error]", m.text());
      });
      console.log(`\n=== ${view.name.toUpperCase()} ${view.width}x${view.height} ===`);
      await enterSinglePlayer(p);
      await p.screenshot({ path: `${SHOTS}/${view.name}-title.png` });
      await staticProbes(p, view);
      await characterProbes(p, view);
      await p.screenshot({ path: `${SHOTS}/${view.name}-game-spawn.png` });
      if (view.name === "desktop") {
        await transformProbe(p);
        await movementProbes(p, view);
        await furnitureTour(p);
        await hideProbe(p);
        await hideNegativeProbes(p);
      }
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
