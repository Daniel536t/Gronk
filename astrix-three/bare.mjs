#!/usr/bin/env node
// Bare terrain review captures: ?bare=1 + six test views.
// Usage: node astrix-three/bare.mjs [outdir]
import { chromium } from 'playwright';
const OUT = process.argv[2] || '/home/ubuntu/ba/artifacts/visual/hero/renders';
const VIEWS = { 'bare-top': '?bare=1&focus=top', 'bare-hero': '?bare=1', 'bare-opposite': '?bare=1&focus=opposite', 'bare-shore': '?bare=1&focus=shore', 'bare-highland': '?bare=1&focus=highland', 'bare-civic': '?bare=1&focus=civic' };
const browser = await chromium.launch();
for (const [name, q] of Object.entries(VIEWS)) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  await page.goto('http://127.0.0.1:5199/astrix-three/index.html' + q, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__astrixReady === true, null, { timeout: 90000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(name, errs.length ? errs : 'clean');
  await page.close();
}
await browser.close();
