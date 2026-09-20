#!/usr/bin/env node
// visual:hero — one command, full visual evidence set.
// Captures hero + civic + farm + harbor from the Observatory (local :5199,
// which serves the repo root, same code as production) into
// artifacts/visual/hero/renders/. Prints __astrix state per view.
// Usage: npm run visual:hero
import { chromium } from 'playwright';

const BASE = process.env.HERO_BASE || 'http://127.0.0.1:5199/astrix-three/index.html';
const OUT = '/home/ubuntu/ba/artifacts/visual/hero/renders';
const VIEWS = { hero: '', civic: '?focus=civic', farm: '?focus=farm', harbor: '?focus=harbor' };

const browser = await chromium.launch();
for (const [name, q] of Object.entries(VIEWS)) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 150)));
  await page.goto(BASE + q, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__astrixReady === true, null, { timeout: 90000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  const info = await page.evaluate(() => ({
    b: window.__astrix.snapshot.buildings.length,
    c: window.__astrix.snapshot.crops.length,
    br: window.__astrix.bridges,
  }));
  console.log(name, JSON.stringify(info), errs.length ? `ERRORS: ${errs}` : 'clean');
  await page.close();
}
await browser.close();
