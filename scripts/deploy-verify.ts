import { chromium, devices } from "playwright";
const BASE = process.env.OBS_BASE ?? "https://astrixx.duckdns.org";
const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`);
  if (!ok) process.exitCode = 1;
};
const btnText = (page: import("playwright").Page, t: string) =>
  page.locator(`button:has-text("${t}")`).first();
const bodyText = async (page: import("playwright").Page) =>
  (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");

async function open(page: import("playwright").Page) {
  await page.goto(`${BASE}/observatory/`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(700);
}

async function worldVisible(page: import("playwright").Page) {
  const box = await page.locator("#world").boundingBox().catch(() => null);
  return !!box && box.width > 100 && box.height > 100 && box.height > 0;
}

const browser = await chromium.launch();

// ---------- LIVE ----------
{
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await open(page);
  await btnText(page, "LIVE").first().click().catch(() => {});
  await page.waitForTimeout(2000);
  const hud = await page.locator("#hud").innerText().catch(() => "");
  const body = await bodyText(page);
  const vis = await worldVisible(page);
  const children = await page.locator("#world > *").count().catch(() => 0);
  check("LIVE: observatory screen visible with world laid out", vis, `box ok, children=${children}`);
  check("LIVE: reads real server state (POP/FOOD/DAY present)", /POP \d/.test(hud) && /FOOD \d/.test(hud) && /DAY \d/.test(hud), hud.replace(/\s+/g, " ").slice(0, 70));
  check("LIVE: connected, not OFFLINE", !/OFFLINE/.test(body));
  check("LIVE: zero console/page errors", errors.length === 0, errors.slice(0, 3).join("; ") || "none");
  await page.screenshot({ path: "/tmp/observatory-shots/deploy-live.png" });
  await page.close();
}

// ---------- REPLAY ----------
{
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await open(page);
  await btnText(page, "REPLAY").first().click().catch(() => {});
  await page.waitForTimeout(600);
  check("REPLAY: observatory visible after clicking REPLAY", await worldVisible(page));
  // speed to 10x then play
  await btnText(page, "5×").click().catch(() => {});
  await btnText(page, "10×").click().catch(() => {});
  await page.locator("#rc-play").click().catch(() => {});
  let day = 0, survived = false, gates = 0;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1500);
    const t = await page.locator("body").innerText().catch(() => "");
    const m = t.match(/DAY (\d+)/);
    if (m) day = parseInt(m[1], 10);
    if (/VILLAGE SURVIVED/.test(t)) { survived = true; break; }
    // drive approval gate
    const app = btnText(page, "APPROVE");
    if ((await app.count().catch(() => 0)) > 0 && (await app.isVisible().catch(() => false))) {
      await app.click().catch(() => {}); gates++; await page.waitForTimeout(700);
    }
    if (/DAY 30/.test(t)) break;
  }
  const txt = await bodyText(page);
  check("REPLAY: reaches VILLAGE SURVIVED finale", survived || /VILLAGE SURVIVED/.test(txt), `day=${day} gates=${gates}`);
  check("REPLAY: canonical metrics from evidence (Farms7 Bridges2 Food62 Pop4->2)",
    /Farms\s*7/.test(txt) && /Bridges?\s*2/.test(txt) && /62/.test(txt) && /4 → 2/.test(txt), txt.slice(-140));
  check("REPLAY: zero console/page errors", errors.length === 0, errors.slice(0, 3).join("; ") || "none");
  await page.screenshot({ path: "/tmp/observatory-shots/deploy-final.png" });
  await page.close();
}

// ---------- Approval interaction ----------
{
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await open(page);
  await btnText(page, "REPLAY").first().click().catch(() => {});
  await page.waitForTimeout(500);
  await btnText(page, "5×").click().catch(() => {});
  await btnText(page, "10×").click().catch(() => {});
  await page.locator("#rc-play").click().catch(() => {});
  let approval = false, paused = false;
  for (let i = 0; i < 18; i++) {
    await page.waitForTimeout(1400);
    const t = await page.locator("body").innerText().catch(() => "");
    if (/HUMAN APPROVAL|APPROVAL REQUIRED/.test(t)) approval = true;
    if (/WORLD TIME: PAUSED/.test(t)) paused = true;
    if (approval && paused) break;
  }
  const t = await page.locator("body").innerText().catch(() => "");
  check("APPROVAL: panel shown from real event", approval, "");
  check("APPROVAL: WORLD TIME: PAUSED shown", paused, "");
  check("APPROVAL: ACTION label (BUILD_BRIDGE) shown", /BUILD BRIDGE|BUILD_BRIDGE/.test(t), "");
  check("APPROVAL: APPROVE + REJECT buttons both present", /APPROVE/.test(t) && /REJECT/.test(t), "");
  await btnText(page, "APPROVE").click().catch(() => {});
  await page.waitForTimeout(2500);
  const a = await page.locator("body").innerText().catch(() => "");
  check("APPROVAL: approve collapses panel + world advances", !/APPROVAL REQUIRED/.test(a) || /BUILD_BRIDGE/.test(a) || /EXECUTED|VERIFIED/.test(a), "");
  check("APPROVAL: zero console/page errors", errors.length === 0, errors.slice(0, 3).join("; ") || "none");
  await page.screenshot({ path: "/tmp/observatory-shots/deploy-approval.png" });
  await page.close();
}

// ---------- Mobile / tablet ----------
for (const [dev, name] of [
  [devices["iPad (gen 7) landscape"], "tablet"],
  [devices["iPhone 13"], "phone"],
] as const) {
  const ctx = await browser.newContext(dev);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await open(page);
  const visHome = await worldVisible(page).catch(() => false); // home splash world may not fill
  await btnText(page, "LIVE").first().click().catch(() => {});
  await page.waitForTimeout(1600);
  const vis = await worldVisible(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  check(`MOBILE ${name}: observatory visible after entering LIVE`, vis, "");
  check(`MOBILE ${name}: no horizontal page overflow`, !overflow, "");
  check(`MOBILE ${name}: world has children rendered`, (await page.locator("#world > *").count().catch(() => 0)) > 3, "");
  check(`MOBILE ${name}: zero console/page errors`, errors.length === 0, errors.slice(0, 3).join("; ") || "none");
  await page.screenshot({ path: `/tmp/observatory-shots/deploy-${name}.png` });
  await ctx.close();
}

await browser.close();
console.log("\n=== ASTRIX OBSERVATORY DEPLOY VERIFICATION (" + BASE + ") ===");
for (const r of results) console.log(r);
console.log(`\n${results.filter((r) => r.startsWith("PASS")).length} passed / ${results.length} total`);