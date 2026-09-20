import { chromium } from 'playwright';
const browser = await chromium.launch();
async function shot(url, path, waitMs = 5000) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__astrixReady === true, null, { timeout: 60000 });
  await page.waitForTimeout(waitMs);
  await page.screenshot({ path });
  const info = await page.evaluate(() => ({ bridges: window.__astrix.bridges, crops: window.__astrix.crops, approvals: window.__astrix.approvals, npcs: window.__astrix.npcs }));
  console.log(path, JSON.stringify(info));
  await page.close();
}
const gate = process.argv[2] || 'gate';
if (gate === 'gate') await shot('http://127.0.0.1:5199/astrix-three/index.html?focus=bridge', '/home/ubuntu/ba/artifacts/witness-gate.png');
else await shot('http://127.0.0.1:5199/astrix-three/index.html?focus=bridge', '/home/ubuntu/ba/artifacts/witness-bridge.png');
await browser.close();
