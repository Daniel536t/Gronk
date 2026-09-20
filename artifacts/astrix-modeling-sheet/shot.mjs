import { chromium } from 'playwright';
import path from 'path';

const src = path.resolve('/home/ubuntu/ba/artifacts/astrix-modeling-sheet/index.html');
const outPng = '/home/ubuntu/ba/artifacts/astrix-modeling-sheet/ASTRIX_Modeling_Sheet.png';
const outPdf = '/home/ubuntu/ba/artifacts/astrix-modeling-sheet/ASTRIX_Modeling_Sheet.pdf';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 2400, height: 1200 } });
await page.goto('file://' + src, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: outPng, fullPage: true });
console.log('PNG done:', outPng);
await page.pdf({ path: outPdf, width: '2400px', printBackground: true });
console.log('PDF done:', outPdf);
await browser.close();
