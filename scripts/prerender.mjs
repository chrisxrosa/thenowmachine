// Loads the site in a real headless Chromium, waits for React/Babel to
// actually finish mounting, and writes the rendered DOM into dist/index.html
// in place of the empty <div id="root"></div>. Everything else in dist/ —
// assets, CNAME, favicons — was already copied by the workflow and is left
// untouched.

import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const URL = 'http://localhost:8080/index.html';
const OUT = 'dist/index.html';
const ROOT_PLACEHOLDER = '<div id="root"></div>';

const browser = await chromium.launch();
const page = await browser.newPage();

const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));

await page.goto(URL, { waitUntil: 'networkidle' });

// #process and #capabilities only exist once React has actually rendered the
// Process and Capabilities components — a stronger signal than "scripts loaded."
await page.waitForSelector('#process', { timeout: 20000 });
await page.waitForSelector('#capabilities', { timeout: 20000 });

// Small buffer for anything on a rAF/useEffect tick (scroll-reveal classes,
// the hero handoff's initial tick). Doesn't affect which text ends up in the
// DOM — everything on this page renders unconditionally, scroll effects only
// change opacity/transform — but it keeps the captured markup tidy.
await page.waitForTimeout(1000);

if (pageErrors.length) {
  console.error('Page threw errors during render — aborting so a broken snapshot never ships:');
  for (const e of pageErrors) console.error(' ', e);
  await browser.close();
  process.exit(1);
}

const renderedHTML = await page.$eval('#root', (el) => el.innerHTML);
await browser.close();

if (!renderedHTML || renderedHTML.trim().length < 200) {
  throw new Error(
    `Rendered content looks too short (${renderedHTML.length} chars) — ` +
    `the app likely failed to mount. Aborting rather than shipping an empty page.`
  );
}

const template = await fs.readFile(OUT, 'utf8');

if (!template.includes(ROOT_PLACEHOLDER)) {
  throw new Error(
    `Could not find ${JSON.stringify(ROOT_PLACEHOLDER)} in ${OUT}. ` +
    `If the root div's markup changed, update ROOT_PLACEHOLDER in this script to match.`
  );
}

const merged = template.replace(ROOT_PLACEHOLDER, `<div id="root">${renderedHTML}</div>`);
await fs.writeFile(OUT, merged, 'utf8');

console.log(`Prerendered ${renderedHTML.length} chars of content into ${OUT}`);
