// ASTrix Observatory — verify the EXPERIENCE vs EVIDENCE theme separation.
// EXPERIENCE = full-bleed living world, data panel hidden.
// EVIDENCE   = world shrinks beside a structured STATE/EVENTS panel.
// Presentation-only; never touches authoritative state.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = "https://astrixx.duckdns.org/observatory/";
const browser = await chromium.launch();
const allErrors = [];
const report = {};

async function newPage(view) {
  const ctx = await browser.newContext(view);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => allErrors.push(`${view.name}: pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") allErrors.push(`${view.name}: console: ${m.text()}`); });
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  return { ctx, page };
}

// ---- Desktop, REPLAY (paused) for deterministic theme checks ----
const D = await newPage({ name: "desktop", viewport: { width: 1280, height: 720 } });
await D.page.click("#btn-replay");
await D.page.waitForSelector("#observatory:not(.hidden)", { timeout: 15000 });
await D.page.waitForTimeout(1200);

report.experience = await D.page.evaluate(() => {
  const obs = document.querySelector("#observatory");
  const ev = document.querySelector("#evidence");
  const ww = document.querySelector("#world-wrap");
  return {
    theme: obs.dataset.obsTheme,
    evidenceHidden: getComputedStyle(ev).display === "none",
    worldWidth: Math.round(ww.getBoundingClientRect().width),
    vw: window.innerWidth,
    expActive: document.querySelector("#theme-experience").classList.contains("active"),
  };
});
const expShot = await D.page.screenshot({ path: "/tmp/observatory-experience.png" });
writeFileSync("/tmp/observatory-experience-dt.png", expShot);
console.log("EXPERIENCE:", JSON.stringify(report.experience));
console.log("  evidenceHidden(expect true) =", report.experience.evidenceHidden,
  "| world fills viewport(expect ~1280) =", report.experience.worldWidth);

await D.page.click("#theme-evidence");
await D.page.waitForTimeout(400);
report.evidence = await D.page.evaluate(() => {
  const obs = document.querySelector("#observatory");
  const ev = document.querySelector("#evidence");
  const ww = document.querySelector("#world-wrap");
  const state = document.querySelector("#evidence-state");
  return {
    theme: obs.dataset.obsTheme,
    evidenceVisible: getComputedStyle(ev).display !== "none",
    worldWidth: Math.round(ww.getBoundingClientRect().width),
    stateHasPopulation: state.textContent.includes("Population"),
    stateTextHead: (state.textContent || "").replace(/\n/g, " ").slice(0, 90),
    evActive: document.querySelector("#theme-evidence").classList.contains("active"),
  };
});
console.log("EVIDENCE:", JSON.stringify(report.evidence));
console.log("  evidenceVisible(expect true) =", report.evidence.evidenceVisible,
  "| world narrower(expect <1280) =", report.evidence.worldWidth,
  "| state populated =", report.evidence.stateHasPopulation);
const evShot = await D.page.screenshot({ path: "/tmp/observatory-evidence-desktop.png" });
writeFileSync("/tmp/observatory-evidence-desktop.png", evShot);
console.log("[shot] observatory-evidence-desktop.png");

// EVENTS tab: push a few replay steps then confirm the event log populated.
await D.page.click("#evidence-tab-events");
await D.page.waitForTimeout(200);
for (let i = 0; i < 6; i++) await D.page.click("#rc-next");
await D.page.waitForTimeout(400);
report.eventsTab = await D.page.evaluate(() => {
  const log = document.querySelector("#evidence-log");
  const t = log.textContent || "";
  return { nonEmpty: t.length > 0, head: t.split("\n").slice(0, 3).join(" | "), hasEvent: /day|OBSERVE|PLAN|APPROVAL/i.test(t) };
});
console.log("EVENTS tab:", JSON.stringify(report.eventsTab));

// Back to EXPERIENCE restores full-bleed world + hidden panel.
await D.page.click("#theme-experience");
await D.page.waitForTimeout(300);
report.back = await D.page.evaluate(() => ({
  theme: document.querySelector("#observatory").dataset.obsTheme,
  evidenceHidden: getComputedStyle(document.querySelector("#evidence")).display === "none",
  worldWidth: Math.round(document.querySelector("#world-wrap").getBoundingClientRect().width),
}));
console.log("back-to-EXPERIENCE:", JSON.stringify(report.back));
await D.ctx.close();

// ---- Tablet portrait in EVIDENCE theme ----
const T = await newPage({ name: "tablet", viewport: { width: 800, height: 1280 } });
await T.page.click("#btn-replay");
await T.page.waitForSelector("#observatory:not(.hidden)", { timeout: 15000 });
await T.page.click("#theme-evidence");
await T.page.waitForTimeout(400);
const tShot = await T.page.screenshot({ path: "/tmp/observatory-evidence-tablet.png" });
writeFileSync("/tmp/observatory-evidence-tablet.png", tShot);
report.tablet = await T.page.evaluate(() => {
  const ww = document.querySelector("#world-wrap");
  const ev = document.querySelector("#evidence");
  const ok = [];
  return {
    theme: document.querySelector("#observatory").dataset.obsTheme,
    worldWidth: Math.round(ww.getBoundingClientRect().width),
    evidenceWidth: Math.round(ev.getBoundingClientRect().width),
    noHScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
    worldVisible: ww.getBoundingClientRect().width > 150,
    evidenceVisible: getComputedStyle(ev).display !== "none",
    _: ok,
  };
});
console.log("tablet EVIDENCE:", JSON.stringify(report.tablet));
console.log("  world visible beside panel(expect >150) =", report.tablet.worldVisible,
  "| no horizontal overflow =", report.tablet.noHScroll);
await T.ctx.close();

await browser.close();
console.log("console/page errors:", allErrors.length);
for (const e of allErrors) console.log("  ✗", e);
console.log("DONE");