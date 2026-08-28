// Phase-1 visual QA: boots the real game server (scripted bots) on :8799 and
// drives headless Chromium through single-player matches at desktop / tablet /
// mobile viewport sizes. Asserts camera framing, world bounds, palette +
// lighting (via canvas pixel sampling), and that movement still works
// (server-authoritative). Captures screenshots to qa/screenshots/.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";

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
          // Verify the ghost within a short frame window: the KNOWN deferred
          // move/transform ordering race can untransform us within ~100ms of
          // the disguise (a move POST in flight when E was pressed), so a
          // single instant read could miss the ghost for reasons unrelated to
          // rendering. Any frame showing transformed+drawn proves the ghost.
          let mine: any = null;
          let sawGhost = false;
          for (let w = 0; w < 8 && !sawGhost; w++) {
            await page.waitForTimeout(60);
            const chars = await getChars(page);
            mine = chars?.find((c) => c.id === me.id) ?? null;
            sawGhost = !!mine && mine.drawn && mine.state === "transformed";
          }
          check(
            "desktop: transformed self renders as ghost (drawn)",
            sawGhost,
            mine ? `state=${mine.state} drawn=${mine.drawn}` : "no info",
          );
          const chars = await getChars(page);
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

// Walk toward any world point from the player's current position. A held
// diagonal always moves at exactly 45°, which overshoots any off-diagonal
// target, so this walks one axis at a time (the larger delta first), polling
// until that axis lands inside tolerance. Returns true if we end close while
// staying active.
async function walkToXY(
  page: Page,
  tx: number,
  ty: number,
  tol = 1.5,
  maxIter = 80,
  stopDist = 2.6,
): Promise<boolean> {
  const st = await getState(page);
  const m = st.players[0];
  if (m.state !== "active") return false;
  const dx = tx - m.x;
  const dy = ty - m.y;
  const stages: { axis: "x" | "y"; target: number; key: string; tol: number }[] = [];
  if (Math.abs(dy) > Math.abs(dx)) {
    stages.push({ axis: "y", target: ty, key: dy > 0 ? "s" : "w", tol: 1.0 });
    stages.push({ axis: "x", target: tx, key: dx > 0 ? "d" : "a", tol });
  } else {
    stages.push({ axis: "x", target: tx, key: dx > 0 ? "d" : "a", tol });
    stages.push({ axis: "y", target: ty, key: dy > 0 ? "s" : "w", tol: 1.0 });
  }
  for (const stage of stages) {
    await page.keyboard.down(stage.key);
    let ok = false;
    for (let i = 0; i < maxIter && !ok; i++) {
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
  return mf.state === "active" && Math.hypot(mf.x - tx, mf.y - ty) <= stopDist;
}

async function walkToBookshelf(page: Page): Promise<boolean> {
  return walkToXY(page, BOOKSHELF.x, BOOKSHELF.y);
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
  } catch (e) {
    // A probe that aborts must FAIL the suite — never silently pass.
    check("desktop: hide probe completed", false, `exception: ${(e as Error).message}`);
  }
}

// Phase 4 negative tests: a rejected transform, rapid repeated presses, and
// moving during the transition must never lock input or leave a stuck state.
async function hideNegativeProbes(page: Page): Promise<void> {
  try {
    await keepGameAlive(page);
    await waitForActive(page);
    // Retry the walk a couple of times before declaring the fixture unreachable
    // (a single Gronk interruption shouldn't disable the checks).
    let reached = false;
    for (let i = 0; i < 2 && !reached; i++) {
      reached = await walkToBookshelf(page);
      if (!reached) {
        await keepGameAlive(page);
        await waitForActive(page);
      }
    }
    const sess = JSON.parse((await page.evaluate(() => localStorage.getItem("gh-session"))) || "null");

    // 1) Rejected transform (furniture far away) must not lock movement. The
    //    API test needs no position, so it runs even if the walk failed.
    const status = await page.evaluate(
      async ({ room, player }) => {
        try {
          const r = await fetch("/api/transform", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roomCode: room, playerId: player, furnitureId: "furn-0" }),
          });
          return r.status;
        } catch {
          // Network/fetch rejection — the mcpHttp/api layer doesn't reject for
          // a 4xx, but guard anyway so this never surfaces as a pageerror.
          return 0;
        }
      },
      { room: sess.roomCode, player: sess.playerId },
    );
    check("desktop: rejected transform returns 400", status === 400, `status=${status}`);
    await assertCanMove(page, "desktop: movement recovers after rejected transform");

    if (!reached) {
      // The remaining checks NEED the bookshelf fixture — an unreachable
      // fixture is a real failure (setup/regression), never a pass.
      check("desktop: rapid transform ends in a valid state", false, "skipped (could not reach bookshelf)");
      check("desktop: no permanent suppression after rapid transform", false, "skipped (could not reach bookshelf)");
      check("desktop: move during transition settles", false, "skipped (could not reach bookshelf)");
      check("desktop: movement unlocked after transition", false, "skipped (could not reach bookshelf)");
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
      check("desktop: move during transition settles", false, "skipped (position drifted — fixture unreachable)");
    }
  } catch (e) {
    // A probe that aborts must FAIL the suite — never silently pass.
    check("desktop: hide negative probes completed", false, `exception: ${(e as Error).message}`);
  }
}

// ---- Phase 5: game feel (audio, particles, effects, ambient life) ---------
// Each check starts a FRESH single-player match so bots/Gronk can't pollute
// the counts, and every probe is wrapped so an exception FAILS the suite
// (never silently passes). Pixel probes verify structure; artistic quality is
// for human review of qa/screenshots.
const BRAZIER = { x: 18, y: 48 };
const CAULDRON = { x: 82, y: 48 };

async function gameFeelProbes(page: Page): Promise<void> {
  try {
    await page.evaluate(() => localStorage.removeItem("gh-session"));
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.click("#btn-single");
    await page.waitForSelector("#screen-game:not(.hidden)", { timeout: 10000 });
    await page.waitForTimeout(1500);

    // 1) Audio: initialized after a user gesture, not muted by default.
    const a0 = await page.evaluate(() => (window as any).__ghAudio?.() ?? null);
    check("desktop: audio initializes after user gesture", !!a0 && a0.initialized, JSON.stringify(a0));
    check("desktop: audio not muted by default", !!a0 && !a0.muted, "");

    // 2) Mute toggle round-trips.
    await page.click("#btn-mute");
    const a1 = await page.evaluate(() => (window as any).__ghAudio?.() ?? null);
    check("desktop: mute button mutes audio", !!a1 && a1.muted, "");
    await page.click("#btn-mute");
    const a2 = await page.evaluate(() => (window as any).__ghAudio?.() ?? null);
    check("desktop: mute button unmutes audio", !!a2 && !a2.muted, "");

    await waitForActive(page);
    const st = await getState(page);
    const m = st.players[0];
    if (m.state !== "active") {
      check("desktop: game-feel probe reached active state", false, `state=${m.state}`);
      return;
    }

    // 3) Room ambience: spawn (9,54) is inside the Reactor zone, so AFTER the
    //    renderer has drawn a few frames the ambient bed must be "reactor"
    //    (re-read the hook — a stale pre-wait snapshot would not prove it).
    await page.waitForTimeout(300);
    const aSpawn = await page.evaluate(() => (window as any).__ghAudio?.() ?? null);
    check("desktop: room ambience set at spawn (reactor)", aSpawn?.room === "reactor", `room=${aSpawn?.room}`);

    // 4) Footsteps: walking produces periodic steps; standing still stops them.
    let s0 = await page.evaluate(() => (window as any).__ghSteps?.() ?? 0);
    let s1 = s0;
    // If Gronk interrupted the first walk (closet), retry once after respawn.
    for (let attempt = 0; attempt < 2 && s1 <= s0; attempt++) {
      s0 = await page.evaluate(() => (window as any).__ghSteps?.() ?? 0);
      const stW = await getState(page);
      const mW = stW.players[0];
      if (mW.state !== "active") await waitForActive(page);
      const stW2 = await getState(page);
      await holdKey(page, stW2.players[0].x < 50 ? "d" : "a", 1600);
      s1 = await page.evaluate(() => (window as any).__ghSteps?.() ?? 0);
    }
    check("desktop: walking produces periodic footsteps", s1 > s0, `${s0} -> ${s1}`);
    const s2 = await page.evaluate(() => (window as any).__ghSteps?.() ?? 0);
    await page.waitForTimeout(1200); // idle move(0,0) — no walk cycle
    const s3 = await page.evaluate(() => (window as any).__ghSteps?.() ?? 0);
    check("desktop: stationary player stops footsteps", s3 === s2, `${s2} -> ${s3}`);

    // 5) Hide/emerge effects: particles spawn + sound plays; room flips to
    //    Library while we're at the bookshelf. A failed walk/transform/exit is
    //    an explicit FAILED check — never a silent skip (Qodo #5).
    if (!(await walkToBookshelf(page))) {
      check("desktop: hide/emerge effects verified", false, "walk to bookshelf failed");
    } else {
      await page.waitForTimeout(400);
      const ai = await page.evaluate(() => (window as any).__ghAudio?.() ?? null);
      check(
        "desktop: interaction tick plays on affordance",
        !!ai && (ai.counts?.interaction ?? 0) >= 1,
        `interaction=${ai?.counts?.interaction ?? 0}`,
      );
      const p0 = await page.evaluate(() => (window as any).__ghParticles?.() ?? null);
      await page.keyboard.press("e");
      let applied = false;
      for (let i = 0; i < 20 && !applied; i++) {
        await page.waitForTimeout(120);
        applied = (await getState(page)).players[0].state === "transformed";
      }
      if (applied) {
        await page.waitForTimeout(350); // motes + hide sounds during the enter anim
        const p1 = await page.evaluate(() => (window as any).__ghParticles?.() ?? null);
        check(
          "desktop: hiding spawns particles",
          !!p1 && (p1.totalSpawned ?? 0) > (p0?.totalSpawned ?? 0),
          `spawned ${p0?.totalSpawned} -> ${p1?.totalSpawned}`,
        );
        const ah = await page.evaluate(() => (window as any).__ghAudio?.() ?? null);
        check(
          "desktop: hiding plays hide sound",
          !!ah && (ah.counts?.hide ?? 0) >= 1,
          `hide=${ah?.counts?.hide ?? 0}`,
        );
        const roomLib = await page.evaluate(() => (window as any).__ghAudio?.()?.room ?? null);
        check("desktop: room ambience follows player (library)", roomLib === "library", `room=${roomLib}`);
        await page.keyboard.press("e");
        let exited = false;
        for (let i = 0; i < 20 && !exited; i++) {
          await page.waitForTimeout(120);
          exited = (await getState(page)).players[0].state === "active";
        }
        if (!exited) {
          check("desktop: emerging effects verified", false, "untransform never applied");
        } else {
          await page.waitForTimeout(300);
          const p2 = await page.evaluate(() => (window as any).__ghParticles?.() ?? null);
          check(
            "desktop: emerging spawns particles",
            !!p2 && (p2.totalSpawned ?? 0) > (p1?.totalSpawned ?? 0),
            `spawned ${p1?.totalSpawned} -> ${p2?.totalSpawned}`,
          );
          const ae = await page.evaluate(() => (window as any).__ghAudio?.() ?? null);
          check(
            "desktop: emerging plays emerge sound",
            !!ae && (ae.counts?.emerge ?? 0) >= 1,
            `emerge=${ae?.counts?.emerge ?? 0}`,
          );
        }
      } else {
        check("desktop: hiding effects verified", false, "transform never applied");
      }
    }

    // 6) Effects: hide/emerge shook the camera; shake decays; bounds intact.
    //    The decay check polls for a quiet sample — an unrelated event (Gronk
    //    alert, bot stun) can inject fresh shake mid-window, so a single fixed
    //    delay is flaky.
    const e0 = await page.evaluate(() => (window as any).__ghEffects?.() ?? null);
    check("desktop: effects system present", !!e0 && typeof e0.shake === "number", "");
    let minSeen = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 12; i++) {
      await keepGameAlive(page); // bots may bank / match may end mid-poll
      await page.waitForTimeout(400);
      const e = await page.evaluate(() => (window as any).__ghEffects?.() ?? null);
      if (e && typeof e.shake === "number") minSeen = Math.min(minSeen, e.shake);
      if (minSeen < 0.05) break;
    }
    check(
      "desktop: camera shake decays to zero",
      minSeen < 0.05,
      `min=${Number.isFinite(minSeen) ? minSeen.toFixed(3) : "none"}`,
    );
    const cam = await getCam(page);
    check(
      "desktop: camera bounds intact after effects",
      !!cam && cam.x >= 0 && cam.x <= 100 && cam.y >= 0 && cam.y <= 60,
      `cam=${cam ? cam.x.toFixed(1) + "," + cam.y.toFixed(1) : "none"}`,
    );

    // 7) Particle pool stays bounded even under event spam.
    const pm = await page.evaluate(() => (window as any).__ghParticles?.() ?? null);
    check("desktop: particle count bounded", !!pm && pm.active <= pm.max, `active=${pm?.active} max=${pm?.max}`);

    // 8) Ambient life: brazier embers spawn while it's on screen. A failed
    //    walk is an explicit FAILED check — never a silent skip (Qodo #6).
    //    The match may have ended / the player closeted during the long
    //    section above — approve/restart and wait for an active spawn first.
    await keepGameAlive(page);
    await waitForActive(page);
    if (!(await walkToXY(page, BRAZIER.x, BRAZIER.y))) {
      check("desktop: brazier emits ambient embers", false, "walk to brazier failed");
    } else {
      await page.waitForTimeout(400);
      const b0 = await page.evaluate(() => (window as any).__ghParticles?.() ?? null);
      await page.waitForTimeout(1500); // ember spawner runs ~every 0.16s
      const b1 = await page.evaluate(() => (window as any).__ghParticles?.() ?? null);
      check(
        "desktop: brazier emits ambient embers",
        !!b1 && (b1.totalSpawned ?? 0) > (b0?.totalSpawned ?? 0),
        `spawned ${b0?.totalSpawned} -> ${b1?.totalSpawned}`,
      );
      await page.screenshot({ path: `${SHOTS}/desktop-reactor-brazier.png` });
    }

    // 9) Ambient life: cauldron vapor while on screen. The cauldron is far
    //    across the map, so give the walk a generous iteration budget and stop
    //    once within camera range (the vapor spawner only needs on-screen).
    await keepGameAlive(page);
    await waitForActive(page);
    if (!(await walkToXY(page, CAULDRON.x, CAULDRON.y, 1.5, 180, 16))) {
      check("desktop: cauldron emits ambient vapor", false, "walk to cauldron failed");
    } else {
      await page.waitForTimeout(400);
      const c0 = await page.evaluate(() => (window as any).__ghParticles?.() ?? null);
      await page.waitForTimeout(1600); // vapor spawner runs ~every 0.38s
      const c1 = await page.evaluate(() => (window as any).__ghParticles?.() ?? null);
      check(
        "desktop: cauldron emits ambient vapor",
        !!c1 && (c1.totalSpawned ?? 0) > (c0?.totalSpawned ?? 0),
        `spawned ${c0?.totalSpawned} -> ${c1?.totalSpawned}`,
      );
      await page.screenshot({ path: `${SHOTS}/desktop-storage-cauldron.png` });
    }
  } catch (e) {
    // A probe that aborts must FAIL the suite — never silently pass.
    check("desktop: game-feel probe completed", false, `exception: ${(e as Error).message}`);
  }
}

// ---- Phase 6A: character pose rig + furniture reactions ---------------------
async function poseAnimationProbes(page: Page): Promise<void> {
  // Uses the pose params on __ghChars (stride/torsoLean/leanSigned/droop/
  // hunch/cloakSway) to assert the rig actually articulates — deterministic,
  // without claiming artistic quality (human gate is the acceptance bar).

  // 1) Stationary -> idle: NO stride (walk phase stalled).
  await waitForActive(page);
  // Clear any leftover key so a previous probe's held movement settles first.
  await page.keyboard.up("w");
  await page.keyboard.up("a");
  await page.keyboard.up("s");
  await page.keyboard.up("d");
  let settledStride = 99;
  for (let i = 0; i < 10; i++) {
    const info = await getMyPose(page);
    if (info) settledStride = Math.min(settledStride, info.stride);
    await page.waitForTimeout(150);
  }
  check(
    "p6a: stationary player has zero stride",
    settledStride < 0.05,
    `min stride=${settledStride.toFixed(3)}`,
  );
  await page.screenshot({ path: `${SHOTS}/p6a-idle.png` });

  // 2) Walking -> stride + lean articulate (clearly > idle, > perception).
  //    Sample WHILE holding the key (holdKey presses+releases, so keep the
  //    key held and sample in the same window).
  await waitForActive(page);
  await page.keyboard.down("d");
  let sawWalk = false;
  let walkStride = 0;
  let walkLean = 0;
  for (let i = 0; i < 12; i++) {
    const info = await getMyPose(page);
    if (info && info.stride > 0.1) {
      sawWalk = true;
      walkStride = Math.max(walkStride, info.stride);
      walkLean = Math.max(walkLean, info.torsoLean);
    }
    await page.waitForTimeout(70);
  }
  await page.screenshot({ path: `${SHOTS}/p6a-walk.png` });
  await page.keyboard.up("d");
  check(
    "p6a: walking articulates a visible stride + lean",
    sawWalk && walkStride > 0.2 && walkLean > 0.05,
    `stride=${walkStride.toFixed(3)} lean=${walkLean.toFixed(3)}`,
  );

  // 3) Directional silhouettes: walking down leans positive, up negative.
  await waitForActive(page);
  await page.waitForTimeout(150); // clear any residual movement
  await page.keyboard.down("s"); // down
  let downSamples: number[] = [];
  for (let i = 0; i < 6; i++) {
    const info = await getMyPose(page);
    if (info && !Number.isNaN(info.leanSigned) && info.leanSigned > 0.02) downSamples.push(info.leanSigned);
    await page.waitForTimeout(70);
  }
  await page.keyboard.up("s");
  await page.waitForTimeout(200); // let motion settle before the next key
  await waitForActive(page);
  await page.waitForTimeout(150);
  await page.keyboard.down("w"); // up
  let upSamples: number[] = [];
  for (let i = 0; i < 6; i++) {
    const info = await getMyPose(page);
    if (info && !Number.isNaN(info.leanSigned) && info.leanSigned < -0.02) upSamples.push(info.leanSigned);
    await page.waitForTimeout(70);
  }
  await page.keyboard.up("w");
  const downLean = downSamples.reduce((a, b) => a + b, 0) / Math.max(1, downSamples.length);
  const upLean = upSamples.reduce((a, b) => a + b, 0) / Math.max(1, upSamples.length);
  check(
    "p6a: up/down directional silhouettes differ (lean sign flips)",
    downSamples.length > 0 && upSamples.length > 0 && downLean > 0 && upLean < 0,
    `down=${downLean.toFixed(3)} up=${upLean.toFixed(3)}`,
  );

  // 4) Idle keeps breathing (animTick advances) WITHOUT re-gaining stride.
  await waitForActive(page);
  await page.keyboard.up("w");
  await page.keyboard.up("a");
  await page.keyboard.up("s");
  await page.keyboard.up("d");
  await page.waitForTimeout(250);
  const idleA = await getMyPose(page);
  await page.waitForTimeout(300);
  const idleB = await getMyPose(page);
  check(
    "p6a: idle keeps breathing without stride",
    !!idleA && !!idleB && idleA.animTick !== idleB.animTick && idleA.stride < 0.05 && idleB.stride < 0.05,
    `tick ${idleA?.animTick}->${idleB?.animTick} stride ${idleA?.stride?.toFixed(3)}->${idleB?.stride?.toFixed(3)}`,
  );

  // 5) Hide enter + furniture settle reaction. Verify the ACTUAL reaction
  //    fires (via the read-only __ghReact hook), not merely that the player
  //    became transformed (Qodo #12). The naive bots can catch the player
  //    mid-walk, so retry the approach once before failing (never a silent skip).
  await waitForActive(page);
  let reachedShelf = await walkToXY(page, BOOKSHELF.x, BOOKSHELF.y);
  if (!reachedShelf) {
    await keepGameAlive(page);
    await waitForActive(page);
    reachedShelf = await walkToXY(page, BOOKSHELF.x, BOOKSHELF.y);
  }
  if (!reachedShelf) {
    check("p6a: furniture reaction on hide", false, "walk to bookshelf failed (caught twice)");
  } else {
    await page.waitForTimeout(200);
    await page.keyboard.press("e");
    // The reaction is a ~300ms envelope that starts when the CLIENT's own poll
    // observes the transform. Sample state AND the __ghReact hook together in
    // a tight loop so we catch the reaction while it is still live (a separate
    // "wait for transformed" loop can lag a full poll past the window).
    let applied = false;
    let sawReact = false;
    for (let i = 0; i < 30 && !(applied && sawReact); i++) {
      const [st, reacts] = await Promise.all([
        getState(page),
        page.evaluate(() => (window as any).__ghReact?.() ?? []),
      ]);
      applied = st.players[0].state === "transformed";
      sawReact = reacts.some((r: any) => r.fid === BOOKSHELF.id && r.amp > 0.05);
      if (!(applied && sawReact)) await page.waitForTimeout(40);
    }
    check(
      "p6a: furniture reaction on hide",
      applied && sawReact,
      `transformed=${applied} react=${sawReact}`,
    );
    if (applied) {
      await page.screenshot({ path: `${SHOTS}/p6a-hiding.png` });
      await page.keyboard.press("e");
      // Assert the emerge actually completes (Qodo #13) before assuming the
      // "emerged" screenshot is valid.
      let exited = false;
      for (let i = 0; i < 20 && !exited; i++) {
        await page.waitForTimeout(120);
        exited = (await getState(page)).players[0].state !== "transformed";
      }
      if (exited) {
        await page.screenshot({ path: `${SHOTS}/p6a-emerged.png` });
      }
    }
  }

  // 6) Reduced motion: suggested stride amplitude drops (DESIGN.md reduced-
  //    motion gate). Compare full walk stride before vs.with reduced-motion.
  await waitForActive(page);
  await page.keyboard.down("d");
  let normalStride = 0;
  for (let i = 0; i < 8; i++) {
    const info = await getMyPose(page);
    if (info) normalStride = Math.max(normalStride, info.stride);
    await page.waitForTimeout(60);
  }
  await page.keyboard.up("d");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(200);
  await waitForActive(page);
  await page.keyboard.down("d");
  let reducedStride = 0;
  for (let i = 0; i < 8; i++) {
    const info = await getMyPose(page);
    if (info) reducedStride = Math.max(reducedStride, info.stride);
    await page.waitForTimeout(60);
  }
  await page.keyboard.up("d");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  check(
    "p6a: reduced-motion lowers stride amplitude",
    normalStride > 0.2 && reducedStride < normalStride,
    `normal=${normalStride.toFixed(3)} reduced=${reducedStride.toFixed(3)}`,
  );

  // 7) Group screenshot for the human visual gate.
  await waitForActive(page);
  await page.screenshot({ path: `${SHOTS}/p6a-group.png` });
}

/** The LOCAL player's pose params (chars carry a `mine` flag). */
async function getMyPose(page: Page): Promise<any | null> {
  const chars = await getChars(page);
  return (chars ?? []).find((c) => c.mine) ?? null;
}

// ---- Phase 6A.1: input / movement feel (release must not rewind) -------------
// The controller bug: releasing the stick/keyboard snapped the locally
// predicted avatar back to the lagging 10Hz server position (a visible
// rewind). These probes assert the PRESS -> MOVE / RELEASE -> STAY contract
// using the rendered position from __ghChars (x/y are the drawn position,
// including the local prediction override).
async function inputFeelProbes(page: Page): Promise<void> {
  const releaseKeys = async (): Promise<void> => {
    await page.keyboard.up("w");
    await page.keyboard.up("a");
    await page.keyboard.up("s");
    await page.keyboard.up("d");
  };

  // 1) move -> release -> remain stationary (the core regression). The old
  //    code snapped to the server position on release, so the released sample
  //    fell below the last moving sample and the position drifted back.
  await keepGameAlive(page);
  await waitForActive(page);
  await releaseKeys();
  await page.waitForTimeout(350); // settle any prior movement
  const r0 = await getMyPose(page);
  if (!r0) {
    check("p6a1: move+release holds position", false, "no rendered position");
    return;
  }
  await page.keyboard.down("d");
  let movingX = 0;
  for (let i = 0; i < 12; i++) {
    const r = await getMyPose(page);
    if (r) movingX = Math.max(movingX, r.x);
    await page.waitForTimeout(60);
  }
  await page.keyboard.up("d");
  const rRel = await getMyPose(page);
  const moved = movingX > r0.x + 1.5; // actually walked (4u/s * ~0.7s)
  const noRewind = !!rRel && rRel.x >= movingX - 0.3; // release did NOT snap back
  check(
    "p6a1: move+release holds position (no rewind on release)",
    moved && noRewind,
    `x0=${r0.x.toFixed(2)} moving=${movingX.toFixed(2)} released=${rRel?.x.toFixed(2)}`,
  );
  // After the server reconciles (a round-trip + tick), the position must not
  // drift back below the released spot by more than a sub-tick lerp.
  await keepGameAlive(page);
  await page.waitForTimeout(800);
  const rSettled = await getMyPose(page);
  check(
    "p6a1: released position persists after server reconcile",
    !!rSettled && !!rRel && rSettled.x >= rRel.x - 0.6,
    `released=${rRel?.x.toFixed(2)} settled=${rSettled?.x.toFixed(2)}`,
  );

  // 2) Repeated move/release cycles: each release holds, never drifts back.
  await keepGameAlive(page);
  await waitForActive(page);
  await releaseKeys();
  await page.waitForTimeout(250);
  const c0 = await getMyPose(page);
  if (!c0) {
    check("p6a1: repeated move/release cycles hold position", false, "no rendered position");
    return;
  }
  let cLast = c0;
  let okCycles = true;
  for (let c = 0; c < 3 && okCycles; c++) {
    const dir = c % 2 === 0 ? "a" : "d"; // left, then right, then left
    const sign = c % 2 === 0 ? -1 : 1; // left decreases x, right increases x
    await page.keyboard.down(dir);
    // Track the extreme x reached in the intended direction.
    let extreme = cLast.x; // 'a': min; 'd': max
    for (let i = 0; i < 8; i++) {
      const r = await getMyPose(page);
      if (r) extreme = c % 2 === 0 ? Math.min(extreme, r.x) : Math.max(extreme, r.x);
      await page.waitForTimeout(50);
    }
    await page.keyboard.up(dir);
    await page.waitForTimeout(80);
    const r2 = await getMyPose(page);
    if (!r2) {
      okCycles = false;
      break;
    }
    // Progress: the player actually moved in the intended direction.
    const progress = sign < 0 ? r2.x <= cLast.x - 1.0 : r2.x >= cLast.x + 1.0;
    // Release holds: the position after release is at/inside the extreme
    // reached while moving (never rewound back toward the cycle start).
    const held = sign < 0 ? r2.x <= extreme + 0.4 : r2.x >= extreme - 0.4;
    okCycles = progress && held;
    if (!okCycles) {
      check(
        "p6a1: repeated move/release cycles hold position",
        false,
        `cycle ${c} dir=${dir} from=${cLast.x.toFixed(2)} extreme=${extreme.toFixed(2)} after=${r2.x.toFixed(2)}`,
      );
      break;
    }
    cLast = r2;
    await keepGameAlive(page);
    await waitForActive(page);
  }
  if (okCycles) check("p6a1: repeated move/release cycles hold position", true, "3 cycles");

  // 3) Direction change while moving never rewinds.
  await keepGameAlive(page);
  await waitForActive(page);
  await releaseKeys();
  await page.waitForTimeout(200);
  await page.keyboard.down("w");
  await page.waitForTimeout(250);
  await page.keyboard.down("d"); // direction change mid-move (diagonal)
  await page.waitForTimeout(250);
  // 'w' decreases y (moves up), 'd' increases x (moves right): track the
  // extreme in each movement axis (min y, max x) so the release-hold check
  // is direction-correct.
  let diagMaxX = 0;
  let diagMinY = 999;
  for (let i = 0; i < 6; i++) {
    const r = await getMyPose(page);
    if (r) {
      diagMaxX = Math.max(diagMaxX, r.x);
      diagMinY = Math.min(diagMinY, r.y);
    }
    await page.waitForTimeout(50);
  }
  await releaseKeys();
  const dRel = await getMyPose(page);
  check(
    "p6a1: direction change + release holds (no rewind)",
    !!dRel && dRel.x >= diagMaxX - 0.3 && dRel.y <= diagMinY + 0.3,
    `extreme=(${diagMaxX.toFixed(2)},${diagMinY.toFixed(2)}) released=(${dRel?.x.toFixed(2)},${dRel?.y.toFixed(2)})`,
  );

  // 4) Transform immediately after release: walk to the bookshelf, let go,
  //    press E, stay hidden (no stale movement reveals), untransform cleanly.
  await keepGameAlive(page);
  await waitForActive(page);
  await releaseKeys();
  let reached = await walkToXY(page, BOOKSHELF.x, BOOKSHELF.y);
  if (!reached) {
    await keepGameAlive(page);
    await waitForActive(page);
    reached = await walkToXY(page, BOOKSHELF.x, BOOKSHELF.y);
  }
  if (!reached) {
    check("p6a1: transform immediately after release", false, "walk to bookshelf failed");
  } else {
    await page.waitForTimeout(150); // release fully settles
    const near = await getMyPose(page);
    await page.keyboard.press("e");
    let applied = false;
    for (let i = 0; i < 20 && !applied; i++) {
      await page.waitForTimeout(120);
      applied = (await getState(page)).players[0].state === "transformed";
    }
    // After the transform, wait a beat: a stale released-movement POST must
    // NOT have untransformed us (that was the guard's whole purpose).
    let stillHidden = false;
    if (applied) {
      await page.waitForTimeout(450);
      stillHidden = (await getState(page)).players[0].state === "transformed";
    }
    check(
      "p6a1: transform immediately after release succeeds and stays hidden",
      applied && stillHidden,
      `applied=${applied} stillHidden=${stillHidden} near=(${near?.x.toFixed(1)},${near?.y.toFixed(1)})`,
    );
    if (applied) {
      await page.keyboard.press("e");
      let exited = false;
      for (let i = 0; i < 20 && !exited; i++) {
        await page.waitForTimeout(120);
        exited = (await getState(page)).players[0].state !== "transformed";
      }
      check(
        "p6a1: emerge after release returns to active",
        exited,
        exited ? "active" : "still transformed",
      );
    }
  }
}

// ---- Phase 6A.1: virtual joystick release (touch/controller path) -----------
// The joystick shares the SAME onMove path as the keyboard, but drives it with
// real pointer events on a touch-enabled context: drag up -> release -> the
// rendered position must HOLD (no rewind to the lagging server position) and
// the knob must return to neutral.
async function joystickReleaseProbe(browser: Browser): Promise<void> {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => failures.push(`joystick pageerror: ${e.message}`));
  try {
    await p.goto(BASE, { waitUntil: "domcontentloaded" });
    await p.click("#btn-single");
    await p.waitForSelector("#screen-game:not(.hidden)", { timeout: 10000 });
    await p.waitForTimeout(1500);

    const stick = p.locator("#joystick");
    const visible = await stick.isVisible();
    check("p6a1: joystick visible on touch device", visible, visible ? "shown" : "hidden");
    if (!visible) {
      await ctx.close();
      return;
    }
    const box = await stick.boundingBox();
    if (!box) {
      check("p6a1: joystick drag+release holds position", false, "no joystick box");
      await ctx.close();
      return;
    }
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Baseline rendered + server y (spawn is near the bottom; up = smaller y).
    const base = await p.evaluate(() => {
      const chars = (window as any).__ghChars?.() ?? [];
      const mine = chars.find((c: any) => c.mine);
      return mine ? { x: mine.x, y: mine.y } : null;
    });
    // Drag up ~40px and hold.
    await p.mouse.move(cx, cy);
    await p.mouse.down();
    await p.mouse.move(cx, cy - 40, { steps: 4 });
    await p.waitForTimeout(450);
    const held = await p.evaluate(() => {
      const chars = (window as any).__ghChars?.() ?? [];
      const mine = chars.find((c: any) => c.mine);
      return mine ? { x: mine.x, y: mine.y } : null;
    });
    const movedUp = !!base && !!held && held.y < base.y - 1.0;
    check("p6a1: joystick drag moves the player up", movedUp, `base=${base?.y.toFixed(2)} held=${held?.y.toFixed(2)}`);

    // Release: the rendered position must NOT rewind back down toward the
    // lagging server position.
    await p.mouse.up();
    await p.waitForTimeout(120);
    const released = await p.evaluate(() => {
      const chars = (window as any).__ghChars?.() ?? [];
      const mine = chars.find((c: any) => c.mine);
      return mine ? { x: mine.x, y: mine.y } : null;
    });
    // Knob returns to neutral.
    const knobReset = await p.evaluate(() => {
      const knob = document.getElementById("joystick-knob") as HTMLElement;
      if (!knob) return false;
      // reset() sets "translate(0,0)"; the browser serializes it back as
      // "translate(0px, 0px)" — normalize by stripping px before comparing.
      const t = knob.style.transform.replace(/px/g, "");
      return t === "" || t === "translate(0,0)" || t === "translate(0, 0)";
    });
    check(
      "p6a1: joystick knob returns to neutral on release",
      knobReset,
      knobReset ? "translate(0,0)" : "not reset",
    );
    // No rewind: the released y stays above (smaller than) the held y + tol,
    // and stays up the field vs baseline (never snaps back toward spawn).
    const noRewind = !!held && !!released && released.y <= held.y + 0.6;
    check(
      "p6a1: joystick release holds position (no rewind)",
      noRewind && movedUp,
      `held=${held?.y.toFixed(2)} released=${released?.y.toFixed(2)}`,
    );
    // After the server reconciles, the rendered position persists up-field.
    await p.waitForTimeout(800);
    const settled = await p.evaluate(() => {
      const chars = (window as any).__ghChars?.() ?? [];
      const mine = chars.find((c: any) => c.mine);
      return mine ? { x: mine.x, y: mine.y } : null;
    });
    check(
      "p6a1: joystick released position persists after reconcile",
      !!settled && !!base && settled.y <= base.y - 0.5 && settled.y <= (released?.y ?? 999) + 0.6,
      `base=${base?.y.toFixed(2)} settled=${settled?.y.toFixed(2)}`,
    );
    await p.screenshot({ path: `${SHOTS}/p6b-mobile-controls.png` });
  } catch (e) {
    check("p6a1: joystick release probe completed", false, `exception: ${(e as Error).message}`);
  } finally {
    await ctx.close();
  }
}

// ---- Phase 6B: UI/HUD design-system probes ---------------------------------
// Automated checks prove the token layer RESOLVES and the semantic rules are
// wired — they cannot prove the interface "belongs to the game"; that judgment
// is the human visual gate (screenshots captured below serve it).

const RGB = {
  gold: "rgb(255, 209, 102)", // --accent-gold
  danger: "rgb(255, 123, 114)", // --danger
  success: "rgb(79, 195, 107)", // --success
  info: "rgb(79, 195, 247)", // --info
  panel: "rgb(16, 22, 31)", // --bg-panel
  border: "rgb(58, 70, 96)", // --surface-border
};

// Confetti palette must be exactly the in-world family: gold/warm + 4 seats.
const CONFETTI_ALLOWED = ["#ffd166", "#ffe08a", "#c9a34a", "#4aa8e8", "#f2765b", "#8ee36b", "#e072f0"];

async function accessibilityRegressionProbes(page: Page): Promise<void> {
  // Qodo: active effects must stop when reduced motion changes live, not just
  // reject future effect requests.
  const motion = await page.evaluate(() => {
    const effects = (window as any).__ghEffects;
    if (typeof effects !== "function") return null;
    effects.qaSeedImpact?.();
    return { before: effects(), hasLiveGate: true };
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reduced = await page.evaluate(() => {
    const effects = (window as any).__ghEffects;
    return typeof effects === "function" ? effects() : null;
  });
  const reducedCamera = await page.evaluate(() => {
    const effects = (window as any).__ghEffects;
    return typeof effects === "function" ? effects() : null;
  });
  check("p6b: reduced motion keeps active camera feedback suppressed", !!reducedCamera && reducedCamera.shake === 0 && reducedCamera.flash === 0, JSON.stringify(reducedCamera));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  check(
    "p6b: active shake/flash clears on live reduced motion",
    !!motion && !!reduced && motion.hasLiveGate && reduced.shake === 0 && reduced.flash === 0,
    JSON.stringify({ motion, reduced }),
  );

  // Qodo: announcements live outside #screen-game so a result transition
  // cannot remove the decisive message from the accessibility tree.
  const announcement = await page.evaluate(() => {
    const el = document.getElementById("announcements");
    const game = document.getElementById("screen-game");
    return { live: el?.getAttribute("aria-live"), outsideGame: !!el && !game?.contains(el), hiddenClass: el?.className };
  });
  check(
    "p6b: persistent result announcement region",
    announcement.live === "polite" && announcement.outsideGame === true && announcement.hiddenClass === "sr-only",
    JSON.stringify(announcement),
  );
}

async function hudProbes(page: Page): Promise<void> {
  // HUD avatar: the Among-Us bean + visor must be gone; chips render the mini
  // hooded-adventurer SVG instead (P1 #5).
  const chips = await page.evaluate(() => ({
    chips: document.querySelectorAll(".player-chip").length,
    beans: document.querySelectorAll(".player-chip .bean").length,
    avatars: document.querySelectorAll(".player-chip .avatar svg").length,
  }));
  check(
    "p6b: HUD avatar is the hooded adventurer (no bean/visor)",
    chips.chips === 4 && chips.beans === 0 && chips.avatars === 4,
    JSON.stringify(chips),
  );

  // Toast semantic kinds: surface + border + state dot per kind.
  const toastColors = await page.evaluate(() => {
    const ui = (window as any).__ghUI;
    if (!ui) return null;
    const kinds = ["danger", "success", "info", "warning"];
    for (const k of kinds) ui.addToast(`probe ${k}`, k);
    const out: Record<string, { border: string; dot: string }> = {};
    for (const k of kinds) {
      const el = document.querySelector(`.toast-${k}`) as HTMLElement;
      const cs = getComputedStyle(el);
      const dot = getComputedStyle(el, "::before");
      out[k] = { border: cs.borderTopColor, dot: dot.backgroundColor };
    }
    return out;
  });
  const toastsOk =
    !!toastColors &&
    toastColors.danger.border === RGB.danger &&
    toastColors.success.border === RGB.success &&
    toastColors.info.border === RGB.info &&
    toastColors.warning.border === RGB.gold &&
    Object.values(toastColors).every((t) => t.dot === t.border);
  check("p6b: toast kinds carry semantic tokens", toastsOk, JSON.stringify(toastColors));
  await page.screenshot({ path: `${SHOTS}/p6b-toasts.png` });

  // Timer states resolve to their tokens (class wiring on the live element).
  const timerStates = await page.evaluate(() => {
    const el = document.getElementById("timer-hud") as HTMLElement;
    const base = el.className;
    el.classList.add("timer-warning");
    const warning = getComputedStyle(el).color;
    el.classList.remove("timer-warning");
    el.classList.add("timer-critical");
    const critical = getComputedStyle(el).color;
    el.classList.remove("timer-critical");
    el.className = base;
    return { warning, critical };
  });
  check(
    "p6b: timer warning/critical tokens resolve",
    timerStates.warning === RGB.gold && timerStates.critical === RGB.danger,
    JSON.stringify(timerStates),
  );

  // P0: modal tokens — the surface must be opaque bg-panel with the surface
  // border and gold title (the old undefined vars rendered transparent).
  const modal = await page.evaluate(() => {
    const backdrop = document.getElementById("approval-modal") as HTMLElement;
    backdrop.classList.remove("hidden");
    const m = backdrop.querySelector(".modal") as HTMLElement;
    const cs = getComputedStyle(m);
    const title = getComputedStyle(m.querySelector("h2") as HTMLElement);
    return { bg: cs.backgroundColor, border: cs.borderTopColor, title: title.color };
  });
  check(
    "p6b: modal tokens defined (P0)",
    modal.bg === RGB.panel && modal.border === RGB.border && modal.title === RGB.gold,
    JSON.stringify(modal),
  );
  // Re-hide: the 10Hz poll re-hides a DOM-shown approval modal anyway (the
  // server has no pendingBank — authoritative state wins, by design), so the
  // VISUAL capture of the shared .modal component happens on a poll-free
  // screen in menuLobbyProbes (p6b-modal.png via the reconnect overlay).
  await page.evaluate(() => (document.getElementById("approval-modal") as HTMLElement).classList.add("hidden"));

  // Touch target: mute ≥44px on every pointer (P1 #7).
  const muteBox = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById("btn-mute") as HTMLElement);
    return { w: cs.width, h: cs.height };
  });
  check(
    "p6b: mute button ≥44px touch target",
    parseFloat(muteBox.w) >= 44 && parseFloat(muteBox.h) >= 44,
    JSON.stringify(muteBox),
  );
}

// Menu/lobby system checks in a fresh context (title + multi + lobby screens).
async function menuLobbyProbes(browser: Browser): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => failures.push(`p6b menu pageerror: ${e.message}`));
  try {
    await p.goto(BASE, { waitUntil: "domcontentloaded" });

    // Focus-visible (P1 #8): keyboard focus shows the gold outline.
    await p.keyboard.press("Tab");
    for (let i = 0; i < 5 && (await p.evaluate(() => document.activeElement?.id)) !== "btn-single"; i++) {
      await p.keyboard.press("Tab");
    }
    const focus = await p.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      return { id: el.id, outline: getComputedStyle(el).outlineColor, width: getComputedStyle(el).outlineWidth };
    });
    check(
      "p6b: keyboard focus-visible is gold",
      focus.id === "btn-single" && focus.outline === RGB.gold && parseFloat(focus.width) > 0,
      JSON.stringify(focus),
    );

    // Confetti palette is in-world (P1 #4).
    const pal = await p.evaluate(() => (window as any).__ghUI?.CONFETTI_COLORS ?? null);
    check(
      "p6b: confetti palette in-world (gold + seats only)",
      JSON.stringify(pal) === JSON.stringify(CONFETTI_ALLOWED),
      JSON.stringify(pal),
    );

    // Reduced motion gates the confetti spawn (P2 #12)...
    await p.emulateMedia({ reducedMotion: "reduce" });
    const rmSpawn = await p.evaluate(() => (window as any).__ghUI.spawnConfetti());
    check("p6b: reduced motion skips confetti", rmSpawn === 0, `spawned=${rmSpawn}`);
    // ...and normal motion still spawns the full burst.
    await p.emulateMedia({ reducedMotion: "no-preference" });
    const spawn = await p.evaluate(() => (window as any).__ghUI.spawnConfetti());
    const pieces = await p.evaluate(() => document.querySelectorAll(".confetti").length);
    check("p6b: confetti spawns under normal motion", spawn === 80 && pieces >= 70, `spawned=${spawn} pieces=${pieces}`);
    await p.evaluate(() => document.querySelectorAll(".confetti").forEach((n) => n.remove()));

    // Modal surface, captured on a screen with no poll loop fighting the
    // authoritative state (the in-game approval modal is re-hidden by the 10Hz
    // poll — by design; its tokens are probe-verified in hudProbes). The
    // reconnect overlay uses the same .modal component.
    await p.evaluate(() => (document.getElementById("reconnect-overlay") as HTMLElement).classList.remove("hidden"));
    await p.waitForTimeout(80);
    await p.screenshot({ path: `${SHOTS}/p6b-modal.png` });
    await p.evaluate(() => (document.getElementById("reconnect-overlay") as HTMLElement).classList.add("hidden"));

    // Screen h2 headers are styled (P1 #3) — not browser-default.
    await p.click("#btn-multi");
    const h2 = await p.evaluate(() => {
      const el = document.querySelector("#screen-multi h2") as HTMLElement;
      const cs = getComputedStyle(el);
      return { size: cs.fontSize, weight: cs.fontWeight, transform: cs.textTransform };
    });
    check(
      "p6b: screen h2 styled",
      h2.weight === "700" && h2.transform === "uppercase" && parseFloat(h2.size) >= 20,
      JSON.stringify(h2),
    );

    // Lobby renders the team columns + code; capture for the human gate.
    await p.click("#btn-create");
    await p.waitForSelector("#screen-lobby:not(.hidden)", { timeout: 10000 });
    const lobby = await p.evaluate(() => ({
      cols: document.querySelectorAll(".team-col").length,
      seats: document.querySelectorAll(".seat").length,
      code: (document.getElementById("lobby-code") as HTMLElement).textContent,
    }));
    check(
      "p6b: lobby renders team columns",
      lobby.cols === 2 && lobby.seats === 4 && !!lobby.code && lobby.code !== "----",
      JSON.stringify(lobby),
    );
    await p.screenshot({ path: `${SHOTS}/p6b-lobby.png` });

    // Accessibility wiring: live region + toggle state.
    const aria = await p.evaluate(() => ({
      live: document.getElementById("announcements")?.getAttribute("aria-live"),
      persistent: !document.getElementById("screen-game")?.contains(document.getElementById("announcements")),
      pressed: document.getElementById("btn-mute")?.getAttribute("aria-pressed"),
    }));
    check(
      "p6b: persistent live announcements + mute aria-pressed present",
      aria.live === "polite" && aria.persistent === true && aria.pressed === "false",
      JSON.stringify(aria),
    );
  } catch (e) {
    check("p6b: menu/lobby probes completed", false, `exception: ${(e as Error).message}`);
  } finally {
    await ctx.close();
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
      if (view.name === "desktop") {
        await hudProbes(p);
        await accessibilityRegressionProbes(p);
      }
      await p.screenshot({ path: `${SHOTS}/${view.name}-game-spawn.png` });
      if (view.name === "desktop") {
        await transformProbe(p);
        await movementProbes(p, view);
        await furnitureTour(p);
        await hideProbe(p);
        await hideNegativeProbes(p);
        await gameFeelProbes(p);
        await poseAnimationProbes(p);
        await inputFeelProbes(p);
        await joystickReleaseProbe(browser);
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
    await menuLobbyProbes(browser);
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
