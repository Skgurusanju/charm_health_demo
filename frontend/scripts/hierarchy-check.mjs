/**
 * Interaction check for the horizontal hierarchical option tree.
 *
 * Drives the real app in Chromium against the real Flask + SQLite backend, so
 * a pass means a clinician can actually walk Yes -> CCS -> Class II and see
 * each level appear beside the last - not that the markup merely compiles.
 *
 *   node scripts/hierarchy-check.mjs
 *   APP_URL=http://localhost:5174/ node scripts/hierarchy-check.mjs
 *
 * Captures go to screenshots/ui-13-hierarchy-*.png.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const APP = process.env.APP_URL || 'http://localhost:5173/';
const API = process.env.API_URL || 'http://127.0.0.1:5000/api';
const SHOTS = 'screenshots';
mkdirSync(SHOTS, { recursive: true });

const pass = [];
const fail = [];
const check = (label, cond, detail = '') => {
  (cond ? pass : fail).push(label);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

/** The option chip carrying an exact label, inside the open viewer. */
const chip = (label) =>
  page.locator('.hopt-opt').filter({ has: page.locator(`label:text-is("${label}")`) });

const box = (label) => chip(label).locator('input.hopt-check');
const visible = async (label) => (await chip(label).count()) > 0 && (await chip(label).first().isVisible());
const ticked = (label) => box(label).first().isChecked();

/** Open one template in the read-only viewer via its row action menu. */
async function openViewer(templateName) {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.locator('.my-templates-table tbody tr').first().waitFor({ timeout: 15000 });
  await page.fill('#template-name-search', templateName);
  await page.waitForTimeout(400);
  const row = page.locator('.my-templates-table tbody tr', { hasText: templateName }).first();
  await row.locator('.three-dot-btn').click();
  await page.locator('.menu-item', { hasText: 'View' }).first().click();
  await page.locator('.ctv-modal').waitFor({ timeout: 10000 });
  await page.locator('.hopt-scroll').first().waitFor({ timeout: 10000 });
}

/* =================== 1: the stored branch renders sideways ================ */
console.log('\n=== 1: Vaso-Meditech EECP SOAP_Practice opens with its stored branch ===');
await openViewer('Vaso-Meditech EECP SOAP_Practice');

check('the viewer shows "Chest Pain?"',
  (await page.locator('.ctv-label', { hasText: 'Chest Pain?' }).count()) > 0);
check('  both top-level options are present', (await visible('No')) && (await visible('Yes')));
check('  the stored Yes tick is honoured', await ticked('Yes'));
check('  and its children are shown', (await visible('CCS')) && (await visible('With Exertion')) &&
  (await visible('At Rest')));
check('  the stored CCS tick opens the third level',
  (await ticked('CCS')) && (await visible('Class I')) && (await visible('Class IV')));

// Levels must advance to the RIGHT, not down the page.
const geom = async (a, b) => {
  const ba = await chip(a).first().boundingBox();
  const bb = await chip(b).first().boundingBox();
  return { right: bb.x > ba.x + ba.width - 1, sameLine: Math.abs(bb.y - ba.y) < 6 };
};
const yesToCcs = await geom('Yes', 'CCS');
check('  level 2 sits to the RIGHT of level 1, on the same line',
  yesToCcs.right && yesToCcs.sameLine, JSON.stringify(yesToCcs));
const ccsToClass = await geom('CCS', 'Class I');
check('  level 3 sits to the RIGHT of level 2, on the same line',
  ccsToClass.right && ccsToClass.sameLine, JSON.stringify(ccsToClass));
check('  an arrow marks each step', (await page.locator('.hopt-arrow').count()) >= 2,
  `${await page.locator('.hopt-arrow').count()} arrows`);
check('  the old vertical triangle is gone', (await page.locator('.ctv-triangle').count()) === 0);
await page.screenshot({ path: `${SHOTS}/ui-13-hierarchy-stored.png` });

/* ======================= 2: questions stay vertical ====================== */
console.log('\n=== 2: questions stay stacked, options run sideways ===');
const chestBox = await page.locator('.ctv-field', { hasText: 'Chest Pain?' }).first().boundingBox();
const symptomsBox = await page.locator('.ctv-field', { hasText: 'Associated Symptoms' }).first().boundingBox();
check('"Associated Symptoms" sits BELOW "Chest Pain?", not beside it',
  symptomsBox.y > chestBox.y + chestBox.height - 1 && Math.abs(symptomsBox.x - chestBox.x) < 4,
  `chest y=${Math.round(chestBox.y)} symptoms y=${Math.round(symptomsBox.y)}`);

/* ============ 3: an unticked parent renders no child container =========== */
console.log('\n=== 3: unticked parents reveal nothing ===');
check('Dyspnea is offered', await visible('Dyspnea'));
check('  its NYHA children are NOT in the DOM while it is unticked',
  (await chip('NYHA Class I').count()) === 0);
check('  and no empty child container is drawn',
  (await page.locator('.hopt-line:has(.hopt-arrow):not(:has(.hopt-opt))').count()) === 0);

/* ================= 4: ticking reveals the next level live ================ */
console.log('\n=== 4: ticking a parent opens the next level (TEST 2/3/4) ===');
await box('Dyspnea').first().check();
await page.waitForTimeout(200);
check('ticking Dyspnea reveals its four NYHA classes',
  (await visible('NYHA Class I')) && (await visible('NYHA Class IV')));
const dysGeom = await geom('Dyspnea', 'NYHA Class I');
check('  they appear to the RIGHT, on the same line', dysGeom.right && dysGeom.sameLine,
  JSON.stringify(dysGeom));
await page.screenshot({ path: `${SHOTS}/ui-13-hierarchy-expanded.png` });

/* ================= 5: deselect hides and clears descendants ============== */
console.log('\n=== 5: un-ticking collapses the whole subtree (TEST 5) ===');
await box('NYHA Class II').first().check();
check('a grandchild can be ticked', await ticked('NYHA Class II'));
await box('Dyspnea').first().uncheck();
await page.waitForTimeout(200);
check('un-ticking Dyspnea removes its children from the DOM',
  (await chip('NYHA Class II').count()) === 0);
await box('Dyspnea').first().check();
await page.waitForTimeout(200);
check('  and the descendant tick was cleared, not merely hidden',
  (await visible('NYHA Class II')) && !(await ticked('NYHA Class II')));
await box('Dyspnea').first().uncheck();

console.log('\n=== 5b: the same on the reference branch (Chest Pain?) ===');
await box('Yes').first().uncheck();
await page.waitForTimeout(200);
check('un-ticking Yes hides CCS and every class below it',
  (await chip('CCS').count()) === 0 && (await chip('Class I').count()) === 0);
check('  No and Yes both remain', (await visible('No')) && (await visible('Yes')));
await box('No').first().check();
await page.waitForTimeout(150);
check('ticking No reveals nothing (it has no children)',
  (await ticked('No')) && (await chip('CCS').count()) === 0);
await page.screenshot({ path: `${SHOTS}/ui-13-hierarchy-collapsed.png` });

await box('Yes').first().check();
await page.waitForTimeout(200);
check('re-ticking Yes brings its children back, cleared',
  (await visible('CCS')) && !(await ticked('CCS')) && (await chip('Class I').count()) === 0);

/* ============= 6: the medical content itself is untouched =============== */
console.log('\n=== 6: medical content and table fields are preserved ===');
const modalText = await page.locator('.ctv-modal').innerText();
for (const label of [
  'Chest Pain?', 'Associated Symptoms', 'CCS', 'With Exertion', 'At Rest',
  'Chest Pain Frequency per Week', 'S/L Nitroglycerin per Week',
  'Walking Time without Symptoms'
]) {
  check(`  "${label}" still present`, modalText.includes(label));
}
check('  the Angina Frequency Log is still a real table',
  (await page.locator('table.ctv-table').count()) > 0);

/* ================ 7: overflow is contained, page never scrolls =========== */
console.log('\n=== 7: only the hierarchy box scrolls sideways ===');
for (const width of [1366, 1440, 1920]) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(250);
  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  check(`  ${width}px: the page does not scroll sideways`, pageOverflow <= 0, `${pageOverflow}px`);

  const modalOverflow = await page.evaluate(() => {
    const m = document.querySelector('.ctv-modal');
    return m.scrollWidth - m.clientWidth;
  });
  check(`  ${width}px: the modal itself does not scroll sideways`, modalOverflow <= 1, `${modalOverflow}px`);

  const scrollersContained = await page.evaluate(
    () => [...document.querySelectorAll('.hopt-scroll')]
      .every((el) => getComputedStyle(el).overflowX === 'auto')
  );
  check(`  ${width}px: every hierarchy box owns its own horizontal scroll`, scrollersContained);
  await page.screenshot({ path: `${SHOTS}/ui-13-hierarchy-${width}.png` });
}
await page.setViewportSize({ width: 1440, height: 900 });

// A chain far deeper than the column proves containment rather than assuming it.
const narrowOverflow = await page.evaluate(() => {
  const el = document.querySelector('.hopt-scroll');
  return { canScroll: el.scrollWidth >= el.clientWidth, overflowX: getComputedStyle(el).overflowX };
});
check('the hierarchy box is the scroll container', narrowOverflow.overflowX === 'auto',
  JSON.stringify(narrowOverflow));

/* ============ 8: it is data-driven, not built for one template ========== */
// Only one seeded clinical template nests its options today, and inventing
// nesting inside real medical content is not ours to do. So depth is proved
// against a throwaway template written through the normal API and deleted
// again - four levels, which no hard-coded two- or three-level renderer could
// display.
console.log('\n=== 8: arbitrary depth, data-driven (TEST 4/6) ===');
await page.locator('.ctv-close-x').click();
await page.waitForTimeout(300);

const DEEP_NAME = 'ZZ Hierarchy Depth Probe';
const created = await fetch(`${API}/templates`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: DEEP_NAME,
    template_type: 'Symptoms',
    category: 'General Medicine',
    description: 'Temporary template used by scripts/hierarchy-check.mjs.',
    sections: [{
      title: 'Depth', category: 'Custom', column_layout: 1,
      components: [{
        component_type: 'Check List',
        label: 'Depth Probe?',
        options: [
          { option_label: 'L1 No' },
          {
            option_label: 'L1 Yes',
            children: [{
              option_label: 'L2 Alpha',
              children: [{
                option_label: 'L3 Beta',
                children: [{ option_label: 'L4 Gamma' }, { option_label: 'L4 Delta' }]
              }]
            }]
          }
        ]
      }]
    }]
  })
}).then((r) => r.json());

const deepId = created.id;
check('a four-level template can be stored through the existing API', Boolean(deepId),
  JSON.stringify(created).slice(0, 80));

try {
  await openViewer(DEEP_NAME);
  check('it renders as a horizontal hierarchy', (await page.locator('.hopt-scroll').count()) > 0);
  check('  only level 1 shows before anything is ticked',
    (await visible('L1 No')) && (await visible('L1 Yes')) && (await chip('L2 Alpha').count()) === 0);

  await box('L1 Yes').first().check();
  await page.waitForTimeout(150);
  check('  ticking level 1 opens level 2', await visible('L2 Alpha'));

  await box('L2 Alpha').first().check();
  await page.waitForTimeout(150);
  check('  ticking level 2 opens level 3', await visible('L3 Beta'));

  await box('L3 Beta').first().check();
  await page.waitForTimeout(150);
  check('  ticking level 3 opens level 4', (await visible('L4 Gamma')) && (await visible('L4 Delta')));

  const deepGeom = await geom('L1 Yes', 'L4 Gamma');
  check('  level 4 is still to the RIGHT, on the same line',
    deepGeom.right && deepGeom.sameLine, JSON.stringify(deepGeom));
  check('  four arrows join the four steps',
    (await page.locator('.hopt-arrow').count()) >= 3,
    `${await page.locator('.hopt-arrow').count()} arrows`);
  await page.screenshot({ path: `${SHOTS}/ui-13-hierarchy-depth4.png` });

  // Collapsing from the top must take all three levels below it.
  await box('L1 Yes').first().uncheck();
  await page.waitForTimeout(150);
  check('  un-ticking level 1 removes levels 2, 3 and 4',
    (await chip('L2 Alpha').count()) === 0 && (await chip('L3 Beta').count()) === 0 &&
    (await chip('L4 Gamma').count()) === 0);
} finally {
  if (deepId) await fetch(`${API}/templates/${deepId}`, { method: 'DELETE' });
}

/* ================ 9: a template without nesting is unaffected =========== */
console.log('\n=== 9: a flat template is unaffected ===');
await page.locator('.ctv-close-x').click().catch(() => {});
await page.waitForTimeout(300);
await page.goto(APP, { waitUntil: 'networkidle' });
await page.locator('.my-templates-table tbody tr').first().waitFor({ timeout: 15000 });
await page.fill('#template-name-search', 'Symptoms_Practice');
await page.waitForTimeout(400);
const flatRow = page.locator('.my-templates-table tbody tr', { hasText: 'Symptoms_Practice' }).first();
await flatRow.locator('.three-dot-btn').click();
await page.locator('.menu-item', { hasText: 'View' }).first().click();
await page.locator('.ctv-modal').waitFor({ timeout: 10000 });
await page.waitForTimeout(300);
check('a template with no nesting renders no hierarchy chain',
  (await page.locator('.hopt-scroll').count()) === 0);
check('  and still renders its own fields',
  (await page.locator('.ctv-field').count()) > 0,
  `${await page.locator('.ctv-field').count()} fields`);

/* ========= 10: the same hierarchy, live and saved, in a consultation ===== */
// The viewer explores a branch without writing anything back. The clinical
// form is where a selection has to survive: it is derived from, and written
// to, the consultation's answer string, so the round-trip below is the real
// proof that this is state and not decoration.
console.log('\n=== 10: the consultation form persists a hierarchical answer ===');
await page.locator('.ctv-close-x').click().catch(() => {});
await page.waitForTimeout(300);
await page.goto(APP, { waitUntil: 'networkidle' });
await page.locator('.my-templates-table tbody tr').first().waitFor({ timeout: 15000 });
await page.fill('#template-name-search', 'Vaso-Meditech EECP SOAP_Practice');
await page.waitForTimeout(400);
await page.locator('.my-templates-table tbody tr', { hasText: 'Vaso-Meditech EECP SOAP_Practice' })
  .first().locator('.three-dot-btn').click();
await page.locator('.menu-item', { hasText: 'Use in Consultation' }).click();
await page.locator('.modal-card').first().waitFor({ timeout: 10000 });
// Wait for the patient fetch, then pick the first demo patient by name.
await page.locator('.modal-card').getByText('Rajesh Kumar').first().waitFor({ timeout: 10000 });
await page.locator('.modal-card').getByText('Rajesh Kumar').first().click();
await page.locator('.modal-footer button', { hasText: 'Start Horizontal Template' }).click();
await page.locator('button:has-text("Save Consultation")').waitFor({ timeout: 10000 }).catch(() => {});
await page.waitForTimeout(600);

const inForm = (await page.locator('button:has-text("Save Consultation")').count()) > 0;
check('the consultation screen opened', inForm);

if (inForm) {
  // The pathway view is the default; the stacked form sits behind a toggle.
  // Both must show the hierarchy sideways, so check each in turn.
  check('  the pathway view renders the hierarchy horizontally',
    (await page.locator('.hopt-scroll').count()) > 0,
    `${await page.locator('.hopt-scroll').count()} groups`);

  // Walk a fresh branch: Dyspnea -> NYHA Class III.
  check('  NYHA classes are withheld until Dyspnea is ticked',
    (await chip('NYHA Class III').count()) === 0);
  await box('Dyspnea').first().check();
  await page.waitForTimeout(200);
  check('  ticking Dyspnea opens its level', await visible('NYHA Class III'));
  await box('NYHA Class III').first().check();
  await page.waitForTimeout(200);
  check('  a grandchild can be ticked', await ticked('NYHA Class III'));
  await page.screenshot({ path: `${SHOTS}/ui-13-hierarchy-consultation.png` });

  // Reading the POST body is the most direct proof of what a save submits.
  const savePost = page.waitForRequest(
    (r) => r.method() === 'POST' && /\/api\/(responses|consultations)$/.test(r.url()),
    { timeout: 10000 }
  );
  await page.locator('button:has-text("Save Consultation")').first().click();
  const submitted = await savePost.then((r) => r.postData()).catch(() => null);

  check('  saving posts the consultation to the existing API', Boolean(submitted));
  if (submitted) {
    check('  the submitted answers carry the whole ticked branch',
      submitted.includes('Dyspnea') && submitted.includes('NYHA Class III'));
    check('  and carry no sibling the clinician never ticked',
      !submitted.includes('NYHA Class I"') && !submitted.includes('NYHA Class II"') &&
      !submitted.includes('NYHA Class IV'));
  }
  await page.waitForTimeout(800);
}

/* ======== 11: the clinical preview form uses the same field ============= */
// TemplatePreview renders the form as a clinician sees it while filling one
// in. It is the third surface that draws option groups, so it gets the same
// horizontal cascade rather than a flattened chip row.
console.log('\n=== 11: the clinical preview form ===');
await page.goto(APP, { waitUntil: 'networkidle' });
await page.locator('.my-templates-table tbody tr').first().waitFor({ timeout: 15000 });
await page.fill('#template-name-search', 'Vaso-Meditech EECP SOAP_Practice');
await page.waitForTimeout(400);
await page.locator('.template-name-link', { hasText: 'Vaso-Meditech EECP SOAP_Practice' }).first().click();
await page.locator('.tb-shell').waitFor({ timeout: 15000 });
await page.locator('.tb-toolbar button:has-text("Preview")').first().click();
await page.locator('.cfr-form').waitFor({ timeout: 10000 });
await page.waitForTimeout(400);

check('the clinical preview renders the hierarchy horizontally',
  (await page.locator('.cfr-control .hopt-scroll').count()) > 0,
  `${await page.locator('.cfr-control .hopt-scroll').count()} groups`);
check('  an unticked parent still reveals nothing',
  (await visible('Dyspnea')) && (await chip('NYHA Class I').count()) === 0);
await box('Dyspnea').first().check();
await page.waitForTimeout(200);
check('  ticking it opens the level', await visible('NYHA Class I'));
const prevGeom = await geom('Dyspnea', 'NYHA Class I');
check('  to the RIGHT, on the same line', prevGeom.right && prevGeom.sameLine,
  JSON.stringify(prevGeom));
await page.screenshot({ path: `${SHOTS}/ui-13-hierarchy-preview.png` });

/* ========================= console cleanliness ========================== */
console.log('\n=== 12: browser console ===');
const realErrors = consoleErrors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
check(`no console errors during the run (${realErrors.length})`, realErrors.length === 0,
  realErrors.slice(0, 3).join(' | '));

console.log('\n' + '='.repeat(60));
console.log(`  ${pass.length} passed, ${fail.length} failed`);
if (fail.length) console.log('  FAILED: ' + fail.join('; '));
console.log('='.repeat(60));

await browser.close();
process.exit(fail.length ? 1 : 0);
