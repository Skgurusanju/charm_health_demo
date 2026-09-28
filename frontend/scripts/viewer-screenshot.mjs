/**
 * Capture the template viewer in a real browser for visual comparison
 * against the CharmHealth reference screenshots.
 *
 * Drives the actual app (My Templates -> template name -> View Template),
 * so what is captured is the real rendered modal, not a fixture.
 *
 *   node scripts/viewer-screenshot.mjs [outDir]
 *
 * Reference images are 1202x730, so the viewport is sized to match and the
 * captures can be laid side by side at 1:1.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

// Vite falls back to the next free port when 5173 is taken; APP_URL lets a
// run point at wherever `npm run dev` actually landed.
const APP = process.env.APP_URL || 'http://localhost:5173/';
const OUT = process.argv[2] || 'screenshots';
mkdirSync(OUT, { recursive: true });

// Matches the reference screenshot dimensions.
const VIEWPORT = { width: 1280, height: 780 };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });

const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

async function openTemplate(name) {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.fill('#template-name-search', name);
  const link = page.locator('.template-name-link', { hasText: name }).first();
  await link.waitFor({ state: 'visible', timeout: 15000 });
  await link.click();
  await page.locator('.ctv-modal').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(350); // let fonts settle
}

/** Report the measured geometry of one element. */
async function box(selector, label) {
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) return `${label}: (absent)`;
  const b = await el.boundingBox();
  if (!b) return `${label}: (not visible)`;
  return `${label}: ${Math.round(b.width)}x${Math.round(b.height)} @ (${Math.round(b.x)},${Math.round(b.y)})`;
}

async function css(selector, props) {
  return page.locator(selector).first().evaluate((el, p) => {
    const s = getComputedStyle(el);
    return Object.fromEntries(p.map((k) => [k, s.getPropertyValue(k)]));
  }, props);
}

const report = [];

/* ------------------------------------------- Diabetes (screenshots 1-3) */
await openTemplate('Diabetes Management Template');
await page.screenshot({ path: `${OUT}/mine-01-diabetes-top.png` });

report.push('--- Diabetes Management Template ---');
for (const [sel, label] of [
  ['.ctv-modal', 'modal'],
  ['.ctv-header', 'header'],
  ['.ctv-meta-row', 'metadata row'],
  ['.ctv-meta-name input', 'Template Name field'],
  ['.ctv-meta-type input', 'Template Type field'],
  ['.ctv-scroll', 'scroll well'],
  ['.ctv-section', 'first section'],
  ['.ctv-option-panel', 'first option panel'],
  ['.ctv-footer', 'footer'],
  ['.ctv-close-btn', 'Close button']
]) report.push('  ' + (await box(sel, label)));

report.push('  section title: ' + JSON.stringify(await css('.ctv-section-title', ['font-size', 'color', 'font-weight'])));
report.push('  clinical label: ' + JSON.stringify(await css('.ctv-label', ['font-size', 'color', 'font-weight'])));
report.push('  subheading: ' + JSON.stringify(await css('.ctv-subheading', ['font-size', 'color', 'font-weight'])));
report.push('  option text: ' + JSON.stringify(await css('.ctv-option', ['font-size', 'color'])));
report.push('  view title: ' + JSON.stringify(await css('.ctv-header h3', ['font-size', 'color', 'font-weight'])));
report.push('  option panel bg: ' + JSON.stringify(await css('.ctv-option-panel', ['background-color', 'padding'])));

// Column distribution of the first radio grid.
report.push('  radio grid cols: ' + (await page.locator('.ctv-option-grid').first()
  .evaluate((el) => getComputedStyle(el).gridTemplateColumns)));

// Scroll down to the Interpretation block and History section.
await page.locator('.ctv-scroll').evaluate((el) => { el.scrollTop = 620; });
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/mine-02-diabetes-interpretation.png` });

await page.locator('.ctv-scroll').evaluate((el) => { el.scrollTop = 1250; });
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/mine-03-diabetes-hpi.png` });

/* --------------------------------------------------- EECP (screenshot 4) */
await openTemplate('Vaso-Meditech EECP SOAP Protocol');
await page.locator('.ctv-scroll').evaluate((el) => { el.scrollTop = 120; });
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/mine-04-eecp-nested.png` });

report.push('--- Vaso-Meditech EECP SOAP Protocol ---');
const indents = await page.locator('.ctv-tree-row').evaluateAll((rows) =>
  rows.slice(0, 9).map((r) => ({
    indent: getComputedStyle(r).paddingLeft,
    label: r.textContent.trim().replace(/\s+/g, ' ')
  })));
for (const i of indents) report.push(`  indent ${i.indent.padStart(5)}  ${i.label}`);

report.push('  ' + (await box('.ctv-table', 'clinical table')));
const cell = await css('.ctv-table th', ['border-top-width', 'border-top-color', 'font-size', 'padding']);
report.push('  table cell: ' + JSON.stringify(cell));
const firstRow = await page.locator('.ctv-table tr').first().boundingBox();
report.push(`  table row height: ${Math.round(firstRow.height)}px`);

/* --------------------------------------------- scrolling / close behavior */
report.push('--- Behaviour ---');
const scrollInfo = await page.locator('.ctv-scroll').evaluate((el) => ({
  scrollable: el.scrollHeight > el.clientHeight,
  scrollHeight: el.scrollHeight,
  clientHeight: el.clientHeight,
  overflowY: getComputedStyle(el).overflowY,
  gutter: el.offsetWidth - el.clientWidth
}));
report.push('  scroll: ' + JSON.stringify(scrollInfo));

const pageScrolls = await page.evaluate(() =>
  document.documentElement.scrollHeight > window.innerHeight + 2);
report.push(`  page grows behind modal: ${pageScrolls} (expected false)`);

await page.keyboard.press('Escape');
await page.waitForTimeout(250);
report.push(`  Escape closes modal: ${(await page.locator('.ctv-modal').count()) === 0}`);

/* ------------------------------------------------------ tablet rendering */
await page.setViewportSize({ width: 820, height: 1100 });
await openTemplate('Vaso-Meditech EECP SOAP Protocol');
await page.screenshot({ path: `${OUT}/mine-05-tablet.png` });
report.push(`  tablet 820px renders: ${(await page.locator('.ctv-modal').count()) === 1}`);

console.log(report.join('\n'));
console.log('\nconsole errors: ' + (consoleErrors.length ? consoleErrors.join(' | ') : 'none'));
console.log(`screenshots written to ${OUT}/`);

await browser.close();
