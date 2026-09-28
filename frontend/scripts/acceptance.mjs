/**
 * Acceptance tests for the Practice Templates / Template Builder work.
 *
 * Drives the real app in Chromium against the real Flask + SQLite backend,
 * covering TEST 1-13 from the clinic's brief plus the conditional-logic
 * behaviour and a sweep for dead buttons.
 *
 *   node scripts/acceptance.mjs
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

// Vite falls back to the next free port when 5173 is taken; APP_URL lets a
// run point at wherever `npm run dev` actually landed.
const APP = process.env.APP_URL || 'http://localhost:5173/';
const API = 'http://127.0.0.1:5000/api';
const SHOTS = 'screenshots';
mkdirSync(SHOTS, { recursive: true });

const pass = [];
const fail = [];
const check = (label, cond, detail = '') => {
  (cond ? pass : fail).push(label);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

const gotoList = async () => {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.locator('.charm-table-container').waitFor({ timeout: 15000 });
};

const EXPECTED_NAMES = [
  'Admission Discharge Summary', 'Adverse Event Report Form_Practice', 'AFB Sputum',
  'Allergy Profile', 'Anemia Profile', 'Assessment Notes 08-05-2024_Practice', 'Blood Group',
  'Chief Complaints_Practice', 'Coronary Aniography_Practice', 'Diabetes Management Template_Practice',
  'Diet for Anemia_Practice', 'Diet for BP Patient_Practice', 'Diet For Cholesterol_Practice',
  'Diet for Diabetes_Practice', 'Diet for Healthy Heart/Healthy Life_Practice',
  'Diet for Kidney Disease_Practice', 'Diet for Thyroid Problem_Practice', 'Discharge Summary',
  'DM1 Practice', 'D_copy', 'eGFR', 'Heart Failure Patient Diet_Practice', 'Heart Failure Plus',
  'HUH - EECP Routine', 'HUH - EECP Routine Out', 'HUH - Medication List_copy',
  'HUH EECP SOAP_Practice', 'HUH-Cardio Diabetic', 'HUH-CD Diabetic Routine', 'HUH-CD-Diabetic',
  'Lab Orders', 'Master Health Checkup', 'Metabolic Profile', 'Patient Transfer Sheet_Practice',
  'Peripheral Blood Smear', 'Renal Profile',
  'Risk prediction for contrast-induced nephropathy_Practice', 'Routine Stool',
  'Send Invoice Email Template (OTP)', 'Send Patient Statement Email Template',
  'Send Patient Statement PHR Template', 'Send Receipt Email Template (OTP)',
  'SendInvoiceEmailTemplate', 'SendInvoicePHRTemplate', 'SendReceiptEmailTemplate',
  'SendReceiptPHRTemplate', 'Symptom', 'Symptoms_Practice', 'Syrub / oint/vit',
  'Treadmill Test (TMT )_Practice', 'Urine C/S', 'Urine Micro Albumin',
  'Vaso-Meditech EECP Event Reporting Form_Practice', 'Vaso-Meditech EECP SOAP_Practice',
  'Vaso-Meditech Follow-up', 'Vasomeditech EECP Diagnosis',
  'Vasomeditech EECP Social History_Practice'
];

/* ============================ TEST 1: list ============================= */
console.log('\n=== TEST 1: Practice Templates list, no patient names ===');
await gotoList();

const apiRows = await (await fetch(`${API}/templates?tab=practice_templates`)).json();
const apiNames = apiRows.map((r) => r.name).sort();
check(`list returns exactly 57 templates (${apiRows.length})`, apiRows.length === 57);
const missing = EXPECTED_NAMES.filter((n) => !apiNames.includes(n));
const extra = apiNames.filter((n) => !EXPECTED_NAMES.includes(n));
check('all 57 required names present', missing.length === 0, missing.slice(0, 3).join('; '));
check('no unexpected names', extra.length === 0, extra.slice(0, 3).join('; '));

const PATIENTS = ['Rajesh Kumar', 'Meenakshi Sundaram', 'Ananthakrishnan', 'Priya Swaminathan', 'K. Balaji'];
const listText = await page.locator('.app-container').innerText();
check('no patient names on the template list', !PATIENTS.some((p) => listText.includes(p)));
await page.screenshot({ path: `${SHOTS}/acc-01-list.png` });

/* ======================= TEST 12/13: duplicate "+" ===================== */
console.log('\n=== TEST 12 & 13: no duplicated "+" ===');
const newBtnText = (await page.locator('button:has-text("New Template")').first().innerText()).trim();
check(`New Template label is "${newBtnText}"`, newBtnText === 'New Template' && !newBtnText.includes('+'));

/* ================== TEST 2: New Template -> editor ===================== */
console.log('\n=== TEST 2: + New Template opens a blank editor ===');
await page.locator('button:has-text("New Template")').first().click();
await page.locator('.tb-shell').waitFor({ timeout: 10000 });
check('Template Builder opened', await page.locator('.tb-shell').count() === 1);
check('no patient list shown', !(await page.locator('.app-container').innerText()).match(/Rajesh Kumar|Select Patient/i));
check('Template Name field present', await page.locator('#tb-name').count() === 1);
check('Template Type field present', await page.locator('#tb-type').count() === 1);
check('canvas starts empty', (await page.locator('.tb-empty-drop').count()) >= 1);

const addSecText = (await page.locator('.tb-add-section').innerText()).trim();
check(`Add Section label is "${addSecText}"`, addSecText === 'Add Section' && !addSecText.includes('+'));

/* ===================== TEST 3/4: drag + edit heading =================== */
console.log('\n=== TEST 3 & 4: drag Heading, edit its properties ===');
await page.locator('.tb-palette-item:has-text("Heading")').dragTo(page.locator('.tb-dropzone').first());
await page.waitForTimeout(200);
check('Heading appears in canvas', (await page.locator('.tb-component').count()) === 1);
check('dropped component auto-selected', (await page.locator('.tb-component.selected').count()) === 1);
check('properties panel populated', (await page.locator('#p-label').count()) === 1);

await page.fill('#p-label', 'Symptoms');
await page.waitForTimeout(150);
check('editing the label updates the canvas',
  (await page.locator('.tb-component-label').first().innerText()).includes('Symptoms'));

/* ====================== TEST 5: Yes/No question ======================== */
console.log('\n=== TEST 5: drag Yes/No Question ===');
await page.locator('.tb-palette-item:has-text("Yes/No Question")').dragTo(page.locator('.tb-dropzone').first());
await page.waitForTimeout(200);
await page.fill('#p-label', 'Chest Pain?');
await page.waitForTimeout(150);
const chips = await page.locator('.tb-component.selected .tb-option-chip').allInnerTexts();
check('Yes/No renders Yes and No options', chips.join(',') === 'Yes,No', chips.join(','));
check('palette item still present after drag',
  (await page.locator('.tb-palette-item:has-text("Yes/No Question")').count()) === 1);

/* ================= TEST 6/7: conditional configuration ================= */
console.log('\n=== TEST 6 & 7: conditional logic ===');
for (const [label, type] of [
  ['Pain Severity', 'Rating Scale'], ['Pain Location', 'Simple Question'],
  ['Pain Duration', 'Simple Question']
]) {
  await page.locator(`.tb-palette-item:has-text("${type}")`).first().click();
  await page.waitForTimeout(120);
  await page.fill('#p-label', label);
  await page.waitForTimeout(120);
}
// Independent question that must survive Chest Pain = No
await page.locator('.tb-palette-item:has-text("Yes/No Question")').click();
await page.waitForTimeout(120);
await page.fill('#p-label', 'Difficulty in Breathing?');
await page.waitForTimeout(120);
await page.locator('.tb-palette-item:has-text("Simple Question")').first().click();
await page.waitForTimeout(120);
await page.fill('#p-label', 'Breathing Onset');
await page.waitForTimeout(150);

// Wire Chest Pain? = Yes -> the three pain questions
await page.locator('.tb-component', { hasText: 'Chest Pain?' }).first().click();
await page.waitForTimeout(200);
const yesRule = page.locator('.tb-rule', { hasText: 'When answer is' }).first();
await yesRule.locator('summary').click();
await page.waitForTimeout(150);
for (const child of ['Pain Severity', 'Pain Location', 'Pain Duration']) {
  await yesRule.locator('label.tb-check', { hasText: child }).locator('input').check();
}
check('3 children wired to Chest Pain = Yes',
  (await yesRule.locator('.tb-rule-count').innerText()).startsWith('3'));

// Wire Difficulty in Breathing? = Yes -> Breathing Onset
await page.locator('.tb-component', { hasText: 'Difficulty in Breathing?' }).first().click();
await page.waitForTimeout(200);
const breathRule = page.locator('.tb-rule').first();
await breathRule.locator('summary').click();
await page.waitForTimeout(150);
await breathRule.locator('label.tb-check', { hasText: 'Breathing Onset' }).locator('input').check();
check('1 child wired to Difficulty in Breathing = Yes',
  (await breathRule.locator('.tb-rule-count').innerText()).startsWith('1'));

await page.fill('#tb-name', 'ACCEPTANCE Chest Pain Consultation');
await page.screenshot({ path: `${SHOTS}/acc-02-builder.png` });

/* ======================== TEST 11: preview ============================= */
console.log('\n=== TEST 11: Preview shows only the clinical form ===');
await page.locator('button:has-text("Preview")').first().click();
await page.locator('.tpv-modal').waitFor({ timeout: 8000 });
check('preview opened', (await page.locator('.tpv-modal').count()) === 1);
check('no palette in preview', (await page.locator('.tpv-modal .tb-palette').count()) === 0);
check('no properties panel in preview', (await page.locator('.tpv-modal .tb-props').count()) === 0);
check('no delete controls in preview', (await page.locator('.tpv-modal .tb-component-actions').count()) === 0);
check('no patient names in preview', !(await page.locator('.tpv-modal').innerText()).match(/Rajesh Kumar/));

const visibleLabels = async () => (await page.locator('.tpv-modal .cfr-label').allInnerTexts()).map((t) => t.trim());

let labels = await visibleLabels();
check('conditional children hidden before answering',
  !labels.includes('Pain Severity') && !labels.includes('Breathing Onset'),
  labels.join(' | '));
check('independent questions visible',
  labels.includes('Chest Pain?') && labels.includes('Difficulty in Breathing?'));

// Chest Pain = YES -> reveal its branch only
await page.locator('.cfr-row', { hasText: 'Chest Pain?' }).locator('button:has-text("Yes")').click();
await page.waitForTimeout(200);
labels = await visibleLabels();
check('YES reveals Severity/Location/Duration',
  ['Pain Severity', 'Pain Location', 'Pain Duration'].every((l) => labels.includes(l)), labels.join(' | '));
check('YES does not reveal the breathing branch', !labels.includes('Breathing Onset'));
await page.screenshot({ path: `${SHOTS}/acc-03-preview-yes.png` });

// Chest Pain = NO -> collapse the branch
await page.locator('.cfr-row', { hasText: 'Chest Pain?' }).locator('button:has-text("No")').click();
await page.waitForTimeout(200);
labels = await visibleLabels();
check('NO hides the whole chest-pain branch',
  !['Pain Severity', 'Pain Location', 'Pain Duration'].some((l) => labels.includes(l)), labels.join(' | '));
check('TEST 7: independent question survives Chest Pain = No',
  labels.includes('Difficulty in Breathing?'));

// TEST 8: breathing = NO hides its dependants
await page.locator('.cfr-row', { hasText: 'Difficulty in Breathing?' }).locator('button:has-text("Yes")').click();
await page.waitForTimeout(200);
check('TEST 8a: breathing YES reveals its follow-up',
  (await visibleLabels()).includes('Breathing Onset'));
await page.locator('.cfr-row', { hasText: 'Difficulty in Breathing?' }).locator('button:has-text("No")').click();
await page.waitForTimeout(200);
check('TEST 8b: breathing NO hides its follow-up',
  !(await visibleLabels()).includes('Breathing Onset'));

const yesNoHorizontal = await page.locator('.cfr-row', { hasText: 'Chest Pain?' })
  .locator('.cfr-options').evaluate((el) => {
    const [a, b] = [...el.children];
    return a && b ? Math.abs(a.getBoundingClientRect().top - b.getBoundingClientRect().top) < 4 : false;
  });
check('Yes/No are side by side, not stacked', yesNoHorizontal);

await page.locator('.tpv-footer button:has-text("Close")').click();
await page.waitForTimeout(200);

/* ==================== TEST 9/10: save then reopen ====================== */
console.log('\n=== TEST 9 & 10: save, appears in list, reopens in editor ===');
await page.locator('button:has-text("Save Template")').click();
await page.locator('.charm-table-container').waitFor({ timeout: 15000 });
await page.waitForTimeout(600);

const saved = (await (await fetch(`${API}/templates?tab=practice_templates&search=ACCEPTANCE`)).json());
check('template persisted to SQLite', saved.length === 1, `${saved.length} row(s)`);
const savedId = saved[0]?.id;
const detail = savedId ? await (await fetch(`${API}/templates/${savedId}`)).json() : null;
check('sections persisted', (detail?.sections?.length ?? 0) >= 1);
check('conditional rules persisted', (detail?.relationships?.length ?? 0) === 4,
  `${detail?.relationships?.length} rules`);

await page.fill('#template-name-search', 'ACCEPTANCE');
await page.waitForTimeout(400);
check('new template appears in the list',
  (await page.locator('.template-name-link', { hasText: 'ACCEPTANCE' }).count()) === 1);

await page.locator('.template-name-link', { hasText: 'ACCEPTANCE' }).click();
await page.locator('.tb-shell').waitFor({ timeout: 10000 });
check('TEST 10: clicking the name opens the editor', (await page.locator('.tb-shell').count()) === 1);
check('TEST 10: no patient list', !(await page.locator('.app-container').innerText()).match(/Rajesh Kumar/));
check('saved rules reloaded into the editor',
  (await page.locator('.tb-rule-note').count()) === 4,
  `${await page.locator('.tb-rule-note').count()} conditional markers`);

/* ==================== Existing template opens editor =================== */
console.log('\n=== Existing template opens editor, not a patient list ===');
await page.locator('.tb-toolbar button:has-text("Back")').click();
await page.locator('.charm-table-container').waitFor({ timeout: 10000 });
await page.fill('#template-name-search', 'Symptoms_Practice');
await page.waitForTimeout(400);
await page.locator('.template-name-link', { hasText: 'Symptoms_Practice' }).first().click();
await page.locator('.tb-shell').waitFor({ timeout: 10000 });
check('Symptoms_Practice opens in the editor', (await page.locator('.tb-shell').count()) === 1);
check('no patient names', !(await page.locator('.app-container').innerText()).match(/Rajesh Kumar/));
check('its sections loaded', (await page.locator('.tb-section').count()) >= 3,
  `${await page.locator('.tb-section').count()} sections`);

/* ====================== Consultation stays separate ==================== */
// The header no longer carries a consultation button: a consultation starts
// from the template it will use, through that row's action menu.
console.log('\n=== Consultation module is separate and reachable ===');
await page.locator('.tb-toolbar button:has-text("Back")').click();
await page.locator('.charm-table-container').waitFor({ timeout: 10000 });
check('the header carries no consultation button',
  (await page.locator('.header-consult-btn').count()) === 0);
check('and no patient name leaks into the template list',
  !(await page.locator('.charm-table-container').innerText()).match(/Rajesh Kumar/));

await page.locator('.my-templates-table tbody tr').first().waitFor({ timeout: 10000 });
await page.locator('.three-dot-btn').first().click();
await page.locator('.three-dot-menu-popover').waitFor({ timeout: 5000 });
await page.locator('.menu-item', { hasText: 'Use in Consultation' }).click();
await page.locator('.modal-card').first().waitFor({ timeout: 8000 });
// Wait for the patient fetch to resolve before asserting on the contents.
await page.waitForTimeout(600);
const clText = await page.locator('.modal-card').first().innerText();
check('"Use in Consultation" opens the patient list', PATIENTS.some((p) => clText.includes(p)),
  clText.split('\n').slice(0, 3).join(' / '));
await page.screenshot({ path: `${SHOTS}/acc-04-consultation.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

/* ========================= dead-control sweep ========================== */
console.log('\n=== Dead control sweep ===');
await gotoList();
const unlabelled = await page.locator('button:visible').evaluateAll((btns) =>
  btns.filter((b) => !b.textContent.trim() && !b.getAttribute('aria-label') && !b.getAttribute('title')).length);
check('every visible button has a label, aria-label or title', unlabelled === 0, `${unlabelled} bare`);

const dupPlus = await page.locator('button:visible').evaluateAll((btns) =>
  btns.filter((b) => (b.textContent.match(/\+/g) || []).length > 1).map((b) => b.textContent.trim()));
check('no button renders two "+" characters', dupPlus.length === 0, dupPlus.join('; '));

/* ================================ cleanup ============================== */
if (savedId) {
  await fetch(`${API}/templates/${savedId}`, { method: 'DELETE' });
  console.log(`\ncleaned up acceptance template #${savedId}`);
}

console.log('\n' + '='.repeat(62));
console.log(`  ${pass.length} passed, ${fail.length} failed`);
if (fail.length) console.log('  FAILED: ' + fail.join('; '));
console.log('  console errors: ' + (consoleErrors.length ? consoleErrors.join(' | ') : 'none'));
console.log('='.repeat(62));

await browser.close();
process.exit(fail.length || consoleErrors.length ? 1 : 0);
