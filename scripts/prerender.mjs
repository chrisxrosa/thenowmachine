// Loads the full site in headless Chromium, waits for React/Babel to mount all
// expected sections, then injects the rendered markup into dist/index.html.
// Assets and other files already copied into dist/ are left untouched.

import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const URL = process.env.PRERENDER_URL || 'http://localhost:8080/index.html';
const OUT = process.env.PRERENDER_OUT || 'dist/index.html';
const ROOT_PLACEHOLDER = '<div id="root"></div>';

const EXPECTED_SECTIONS = [
  '#capabilities',
  '#operator',
  '#work',
  '#contact'
];

const browser = await chromium.launch();

let renderedHTML = '';
let pageErrors = [];
let designSystemErrors = [];

try {
  const page = await browser.newPage();

  page.on('pageerror', (error) => {
    pageErrors.push(String(error));
  });

  // Wait for the document to load. Do not depend on networkidle,
  // since fonts and videos may continue loading.
  await page.goto(URL, {
    waitUntil: 'domcontentloaded'
  });

  // Verify that React has mounted the complete website.
  await page.waitForFunction((selectors) => {
    const root = document.querySelector('#root');

    if (!root) return false;

    const allSectionsExist = selectors.every(
      (selector) => root.querySelector(selector)
    );

    const hasWorkPanels =
      root.querySelectorAll('#work .wpanel').length >= 1;

    const hasContactForm =
      Boolean(root.querySelector('#contact form'));

    const hasCapabilities =
      root.querySelectorAll('#capabilities .cap').length >= 3;

    return (
      allSectionsExist &&
      hasWorkPanels &&
      hasContactForm &&
      hasCapabilities
    );
  }, EXPECTED_SECTIONS, {
    timeout: 30000
  });

  // Allow React effects and initial observers to settle.
  await page.waitForTimeout(500);

  // Check for design-system errors.
  designSystemErrors = await page.evaluate(() => {
    return window.TheNowMachineDesignSystem_5b6ea4?.__errors || [];
  });

  if (pageErrors.length || designSystemErrors.length) {
    console.error(
      'The page reported errors during render — refusing to ship a broken snapshot.'
    );

    for (const error of pageErrors) {
      console.error('Page error:', error);
    }

    for (const error of designSystemErrors) {
      console.error('Design-system error:', error);
    }

    process.exitCode = 1;
  } else {
    renderedHTML = await page.$eval(
      '#root',
      (element) => element.innerHTML
    );
  }

} finally {
  await browser.close();
}

// Stop if any errors were reported.
if (process.exitCode) {
  process.exit(process.exitCode);
}

// Make sure React actually rendered meaningful content.
if (!renderedHTML || renderedHTML.trim().length < 200) {
  throw new Error(
    `Rendered content looks too short (${renderedHTML.length} chars) — ` +
    'React may not have mounted correctly. Refusing to ship an empty page.'
  );
}

// Read the original HTML template.
const template = await fs.readFile(OUT, 'utf8');

// Verify that the empty React root exists.
if (!template.includes(ROOT_PLACEHOLDER)) {
  throw new Error(
    `Could not find ${JSON.stringify(ROOT_PLACEHOLDER)} in ${OUT}. ` +
    'Make sure the source index.html still contains the empty root placeholder.'
  );
}

// Inject the prerendered React HTML.
const merged = template.replace(
  ROOT_PLACEHOLDER,
  `<div id="root">${renderedHTML}</div>`
);

await fs.writeFile(OUT, merged, 'utf8');

console.log(`Prerendered ${renderedHTML.length} chars into ${OUT}`);

console.log(
  `Verified sections: ${EXPECTED_SECTIONS.join(', ')}`
);
