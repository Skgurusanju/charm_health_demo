/**
 * End-to-end check for the My Templates / Common Medication rework and the
 * generic account screens.
 *
 * Drives the real app in Chromium against the real Flask + SQLite backend, so
 * a pass means the feature works rather than merely compiling.
 *
 *   node scripts/templates-ui-check.mjs
 *
 * Captures go to screenshots/ui-*.png for visual comparison with the
 * CharmHealth reference.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

// Vite falls back to the next free port when 5173 is taken; APP_URL lets a
// run point at wherever `npm run dev` actually landed.
const APP = process.env.APP_URL || 'http://localhost:5173/';
const SHOTS = 'screenshots';
mkdirSync(SHOTS, { recursive: true });

const pass = [];
const fail = [];
const check = (label, cond, detail = '') => {
  (cond ? pass : fail).push(label);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`);
};

const TAB_ORDER = [
  'My Templates',
  'Practice Templates',
  'Email Templates',
  'CharmHealth Library',
  'Common Medication'
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

const activeTab = () => page.locator('.tab-item.active').innerText();
const openTab = async (label) => {
  await page.locator('.tab-item', { hasText: label }).first().click();
  await page.waitForTimeout(450);
};

/* ===================== 1: default landing + no chips ==================== */
console.log('\n=== 1: My Templates is the default tab and carries no condition chips ===');
await page.goto(APP, { waitUntil: 'networkidle' });
await page.locator('.charm-card').waitFor({ timeout: 15000 });

check('lands on My Templates', (await activeTab()).trim() === 'My Templates', await activeTab());

const tabLabels = (await page.locator('.tab-item').allInnerTexts()).map((t) => t.trim());
check(`five tabs in the specified order (${tabLabels.length})`,
  tabLabels.join(' | ') === TAB_ORDER.join(' | '), tabLabels.join(' | '));

check('no condition chips anywhere on the page',
  (await page.locator('.condition-chip').count()) === 0);
check('no medical-condition search block under the tabs',
  (await page.locator('.dedicated-search-box').count()) === 0);

const workspaceText = await page.locator('.charm-card').innerText();
for (const phrase of ['Common Medical Conditions', 'EECP Therapy', 'Chest Pain / Angina', 'Diabetes Mellitus']) {
  check(`  "${phrase}" is absent from My Templates`, !workspaceText.includes(phrase));
}

/* ---- tab order on screen: Template Type sits directly under the tabs ---- */
const tabsBox = await page.locator('.charm-tabs-bar').boundingBox();
const controlsBox = await page.locator('.charm-controls-row').boundingBox();
check('Template Type row sits immediately below the tabs',
  controlsBox.y - (tabsBox.y + tabsBox.height) < 4,
  `${Math.round(controlsBox.y - (tabsBox.y + tabsBox.height))}px gap`);

// innerText comes back upper-cased because the header row is styled with
// text-transform, so compare case-insensitively.
const headers = (await page.locator('.my-templates-table thead th').allInnerTexts())
  .map((h) => h.trim().toLowerCase());
check('table columns are Template Name | Category | Template Type | Actions',
  headers.join('|') === 'template name|category|template type|actions', headers.join('|'));

await page.screenshot({ path: `${SHOTS}/ui-01-my-templates.png` });

/* ======================= 2: Template Type dropdown ===================== */
console.log('\n=== 2: Template Type dropdown ===');
const select = page.locator('select.template-type-select');
check('Template Type is a dropdown, not a list of cards', (await select.count()) === 1);
check('  no cards/pills stand in for the dropdown',
  (await page.locator('.charm-controls-row .badge, .charm-controls-row .type-pill').count()) === 0);

const options = await select.locator('option').allInnerTexts();
check(`  dropdown carries All + 34 types (${options.length})`, options.length === 35, String(options.length));
check('  "All" is first and selected by default',
  options[0] === 'All' && (await select.inputValue()) === 'All');
check('  order starts Assessment Notes, Billing Procedure Codes, Billing Inventory',
  options.slice(1, 4).join('|') === 'Assessment Notes|Billing Procedure Codes|Billing Inventory',
  options.slice(1, 4).join('|'));
check('  dropdown is flat (no option groups)',
  (await select.locator('optgroup').count()) === 0);

const rowCountAll = await page.locator('.my-templates-table tbody tr').count();
await select.selectOption('SOAP');
await page.waitForTimeout(600);
const soapTypes = await page.locator('.my-templates-table tbody .badge-type').allInnerTexts();
check(`  selecting SOAP filters the table (${soapTypes.length} of ${rowCountAll} rows)`,
  soapTypes.length > 0 && soapTypes.length < rowCountAll && soapTypes.every((t) => t.trim() === 'SOAP'),
  [...new Set(soapTypes.map((t) => t.trim()))].join(','));

await page.screenshot({ path: `${SHOTS}/ui-02-type-filter.png` });

await select.selectOption('Prescription');
await page.waitForTimeout(600);
const rxTypes = await page.locator('.my-templates-table tbody .badge-type').allInnerTexts();
check(`  selecting Prescription re-filters (${rxTypes.length} rows)`,
  rxTypes.length > 0 && rxTypes.every((t) => t.trim() === 'Prescription'));

await select.selectOption('All');
await page.waitForTimeout(600);
check('  back to All restores the full list',
  (await page.locator('.my-templates-table tbody tr').count()) === rowCountAll);

/* =========================== 3: name search =========================== */
console.log('\n=== 3: Search by Template Name ===');
await page.fill('#template-name-search', 'diabetes');
await page.waitForTimeout(500);
const searchNames = await page.locator('.my-templates-table .template-name-link').allInnerTexts();
check(`  "diabetes" narrows to ${searchNames.length} rows, all matching`,
  searchNames.length > 0 && searchNames.every((n) => n.toLowerCase().includes('diabet')),
  searchNames.slice(0, 3).join('; '));

await page.fill('#template-name-search', 'zzz-no-such-template');
await page.waitForTimeout(500);
check('  a miss shows the empty state, not a crash',
  (await page.locator('.table-state-panel').count()) === 1);

await page.fill('#template-name-search', '');
await page.waitForTimeout(500);

/* ======================== 4: row action menu ========================== */
console.log('\n=== 4: Template action menu ===');
await page.locator('.my-templates-table .three-dot-btn').first().click();
await page.waitForTimeout(200);
const menuItems = (await page.locator('.three-dot-menu-popover .menu-item').allInnerTexts()).map((t) => t.trim());
for (const item of ['Edit', 'Duplicate', 'Delete']) {
  check(`  menu offers ${item}`, menuItems.includes(item), menuItems.join(', '));
}
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

/* ===================== 5: navigation across all tabs =================== */
console.log('\n=== 5: every tab loads its own content ===');
for (const label of TAB_ORDER) {
  await openTab(label);
  const isActive = (await activeTab()).trim() === label;
  const hasContent =
    (await page.locator('#template-tabpanel').innerText()).trim().length > 0;
  check(`  ${label} opens and renders`, isActive && hasContent);
}

/* ======================= 6: Common Medication ========================= */
console.log('\n=== 6: Common Medication tab ===');
await openTab('Common Medication');
check('  the condition catalogue lives here',
  (await page.locator('.cm-table tbody tr').count()) >= 34,
  String(await page.locator('.cm-table tbody tr').count()));
check('  no Template Type / New Template controls on this tab',
  (await page.locator('.charm-controls-row').count()) === 0);
check('  search box is labelled as specified',
  (await page.locator('.cm-search-label').innerText()).includes('Search Common Medication / Condition'));

const cmText = await page.locator('.cm-panel').innerText();
for (const cond of ['Diarrhea', 'Back Pain', 'Cardiac', 'Cough', 'Cold', 'Fever', 'Anaesthesia',
  'Chest Pain', 'Heart Failure', 'Hypertension', 'Diabetes', 'Asthma']) {
  check(`  lists "${cond}"`, cmText.includes(cond));
}
await page.screenshot({ path: `${SHOTS}/ui-03-common-medication.png` });

await page.fill('#common-medication-search', 'cough');
await page.waitForTimeout(300);
const filteredConds = (await page.locator('.cm-condition-link').allInnerTexts()).map((t) => t.trim());
check(`  search "cough" narrows the catalogue to ${filteredConds.length}`,
  filteredConds.includes('Cough') && filteredConds.length < 34, filteredConds.join(', '));

await page.fill('#common-medication-search', '');
await page.waitForTimeout(300);

await page.locator('.cm-condition-link', { hasText: 'Diabetes' }).first().click();
await page.waitForTimeout(700);
check('  selecting a condition opens its templates',
  (await page.locator('.cm-detail-title').innerText()).trim() === 'Diabetes');
const relatedCount = await page.locator('.cm-detail .my-templates-table tbody tr').count();
check(`  ${relatedCount} related templates listed`, relatedCount > 0);
await page.screenshot({ path: `${SHOTS}/ui-04-common-medication-detail.png` });

await page.locator('.cm-detail .my-templates-table .template-name-link').first().click();
await page.locator('.ctv-modal').waitFor({ timeout: 15000 });
check('  clicking a template opens the read-only viewer',
  (await page.locator('.ctv-modal').count()) === 1);
await page.locator('.ctv-close-btn').first().click();
await page.waitForTimeout(400);

await page.locator('.cm-back-link').click();
await page.waitForTimeout(400);
check('  "All Conditions" returns to the catalogue',
  (await page.locator('.cm-table tbody tr').count()) >= 34);

/* ============ 7: conditions never leak back into My Templates ========= */
console.log('\n=== 7: data separation ===');
await openTab('My Templates');
check('  My Templates still shows no condition list',
  (await page.locator('.cm-table').count()) === 0 &&
  (await page.locator('.condition-chip').count()) === 0);
check('  and still lists templates',
  (await page.locator('.my-templates-table tbody tr').count()) > 0);

await openTab('Practice Templates');
check('  Practice Templates keeps its own table',
  (await page.locator('.charm-table').count()) === 1 &&
  (await page.locator('.cm-table').count()) === 0);

await openTab('Email Templates');
const emailTypes = (await page.locator('.charm-table tbody .type-pill').allInnerTexts()).map((t) => t.trim());
check(`  Email Templates only holds email templates (${emailTypes.length})`,
  emailTypes.length > 0 && emailTypes.every((t) => t === 'Email'), emailTypes.join(','));

await openTab('CharmHealth Library');
check('  CharmHealth Library keeps its own table',
  (await page.locator('.charm-table tbody tr').count()) > 0 &&
  (await page.locator('.cm-table').count()) === 0);

/* =========================== 8: responsive ============================ */
console.log('\n=== 8: responsive behaviour ===');
await openTab('My Templates');
for (const [label, width, height] of [
  ['desktop', 1500, 950],
  ['laptop', 1280, 800],
  ['tablet', 834, 1112],
  ['mobile', 390, 844]
]) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(400);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  check(`  ${label} (${width}px): page does not scroll sideways`, overflow <= 1, `${overflow}px`);

  check(`  ${label}: all five tabs still reachable`,
    (await page.locator('.tab-item').count()) === 5);

  const selBox = await page.locator('select.template-type-select').boundingBox();
  check(`  ${label}: Template Type dropdown fits the screen`,
    selBox.x >= 0 && selBox.x + selBox.width <= width + 1,
    `${Math.round(selBox.x)}..${Math.round(selBox.x + selBox.width)}`);

  // Down to tablet width the real table stays; a phone falls back to cards
  // and the table container is the thing that scrolls sideways, not the page.
  const headerVisible = await page.locator('.my-templates-table thead').isVisible();
  check(`  ${label}: ${width > 720 ? 'keeps the table header' : 'stacks into cards'}`,
    width > 720 ? headerVisible : !headerVisible);

  await page.screenshot({ path: `${SHOTS}/ui-05-responsive-${label}.png` });
}
await page.setViewportSize({ width: 1500, height: 950 });
await page.waitForTimeout(300);

/* ================== 9: header identity and locations =================== */
console.log('\n=== 9: header identity and locations ===');

const headerText = (await page.locator('.charm-header').innerText()).toLowerCase();
for (const word of ['dr.', 'physician', 'cardiology', 'start consultation']) {
  check(`  header never says "${word}"`, !headerText.includes(word), headerText.replace(/\n/g, ' '));
}
check('  no notification bell remains',
  (await page.locator('.charm-header svg.lucide-bell').count()) === 0);
check('  account shows the plain user name',
  (await page.locator('.user-profile-badge').innerText()).includes('Sanjana K'));

await page.locator('.clinic-branch-badge').click();
await page.waitForTimeout(200);
const branchItems = (await page.locator('.branch-menu-item').allInnerTexts()).map((t) =>
  t.replace(/\s+/g, ' ').trim()
);
const EXPECTED_BRANCHES = [
  'Heal Your Heart Neelankarai HUH001',
  'Heal Your Heart Royapettah HUH002',
  'Heal Your Heart - Manapakkam HUH003',
  'Heal Your Heart-Madurai 005',
  'Heal Your Heart-Tirunelveli 004'
];
check('  location switcher lists exactly the five clinic locations',
  branchItems.length === 5 && EXPECTED_BRANCHES.every((b, i) => branchItems[i].startsWith(b)),
  branchItems.join(' / '));
check('  and offers no provider or partner entries',
  !/Ramasamy|4R Health/i.test(branchItems.join(' ')));

await page.locator('.branch-menu-item', { hasText: 'Royapettah' }).click();
await page.waitForTimeout(200);
check('  picking a location updates the header',
  (await page.locator('.clinic-branch-badge').innerText()).includes('Royapettah'));
await page.locator('.clinic-branch-badge').click();
await page.locator('.branch-menu-item', { hasText: 'Neelankarai' }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${SHOTS}/ui-09-header.png` });

/* ====================== 10: account screens =========================== */
console.log('\n=== 10: sign in, signup and forgot password ===');
await page.locator('.user-profile-badge').click();
await page.waitForTimeout(200);
await page.locator('.menu-item', { hasText: 'Sign Out' }).click();
await page.locator('.auth-card').waitFor({ timeout: 10000 });

check('signing out lands on the Sign in screen',
  (await page.locator('.auth-title').innerText()).trim() === 'Sign in');
check('  subheading names the product',
  (await page.locator('.auth-subtitle').innerText()).trim() === 'to access charmhealth');

const loginText = (await page.locator('.auth-page').innerText()).toLowerCase();
for (const word of ['doctor', 'physician', 'medical professional', 'registration number', 'license']) {
  check(`  sign-in page never says "${word}"`, !loginText.includes(word));
}
check('  step 1 asks only for the identifier',
  (await page.locator('.auth-field input').count()) === 1 &&
  (await page.locator('#login-identifier').getAttribute('placeholder')) ===
    'Email address or mobile number');
check('  step 1 CTA is Next',
  (await page.locator('button.auth-submit').innerText()).trim() === 'Next');
await page.screenshot({ path: `${SHOTS}/ui-06-login.png` });

await page.locator('button.auth-submit').click();
await page.waitForTimeout(200);
check('  an empty identifier is rejected',
  (await page.locator('.auth-field-error').innerText()).includes('Enter your email address'));

await page.fill('#login-identifier', 'not-an-identifier');
await page.locator('button.auth-submit').click();
await page.waitForTimeout(200);
check('  a malformed identifier is rejected',
  (await page.locator('.auth-field-error').innerText()).includes('valid email address or mobile'));

await page.fill('#login-identifier', 'sanju2kguru@gmail.com');
await page.locator('button.auth-submit').click();
await page.locator('#login-password').waitFor({ timeout: 5000 });
check('  Next advances to the password step',
  (await page.locator('.auth-identity-value').innerText()).trim() === 'sanju2kguru@gmail.com');
check('  the password field has a reveal control',
  (await page.locator('.auth-reveal-btn').count()) === 1 &&
  (await page.locator('#login-password').getAttribute('type')) === 'password');
await page.locator('.auth-reveal-btn').click();
check('  reveal toggles the password to plain text',
  (await page.locator('#login-password').getAttribute('type')) === 'text');
await page.locator('.auth-reveal-btn').click();

const step2Links = (await page.locator('.auth-links-row .auth-link').allInnerTexts()).map((t) => t.trim());
check('  step 2 offers OTP sign-in and password recovery',
  step2Links.includes('Sign in using email OTP') && step2Links.includes('Forgot Password?'),
  step2Links.join(' / '));
check('  step 2 CTA is Sign in',
  (await page.locator('button.auth-submit').innerText()).trim() === 'Sign in');

await page.locator('.auth-link', { hasText: 'Sign in using email OTP' }).click();
await page.waitForTimeout(150);
check('  the OTP link answers rather than doing nothing',
  (await page.locator('.auth-alert.info').innerText()).includes('one-time passcode'));
await page.screenshot({ path: `${SHOTS}/ui-06-login-step2.png` });

await page.locator('.auth-link', { hasText: 'Change' }).click();
await page.waitForTimeout(200);
check('  Change returns to the identifier step',
  (await page.locator('#login-identifier').inputValue()) === 'sanju2kguru@gmail.com' &&
  (await page.locator('#login-password').count()) === 0);

/* ------------------------------- forgot ------------------------------- */
await page.locator('button.auth-submit').click();
await page.locator('.auth-link', { hasText: 'Forgot Password?' }).click();
await page.waitForTimeout(300);
check('  Forgot Password opens its own screen',
  (await page.locator('.auth-title').innerText()).trim() === 'Forgot Password');
check('  and carries the identifier across',
  (await page.locator('#forgot-identifier').inputValue()) === 'sanju2kguru@gmail.com');

await page.fill('#forgot-identifier', 'not-an-identifier');
await page.locator('button.auth-submit').click();
await page.waitForTimeout(200);
check('  a malformed identifier is rejected',
  (await page.locator('.auth-field-error').innerText()).includes('valid email address or mobile'));

await page.fill('#forgot-identifier', 'sanju2kguru@gmail.com');
await page.locator('button.auth-submit').click();
await page.locator('#reset-password').waitFor({ timeout: 10000 });
check('  Continue advances to the reset step',
  (await page.locator('.auth-title').innerText()).trim() === 'Reset Password');
await page.screenshot({ path: `${SHOTS}/ui-07-forgot-password.png` });

await page.fill('#reset-password', 'short');
await page.fill('#reset-confirm-password', 'mismatch');
await page.locator('button.auth-submit').click();
await page.waitForTimeout(200);
const resetErrors = (await page.locator('.auth-field-error').allInnerTexts()).map((t) => t.trim());
check('  a short password and a mismatch are both flagged',
  resetErrors.some((e) => e.includes('at least')) && resetErrors.includes('Passwords do not match.'),
  resetErrors.join(' / '));

await page.fill('#reset-password', 'password123');
await page.fill('#reset-confirm-password', 'password123');
await page.locator('button.auth-submit').click();
await page.locator('.auth-alert.success').waitFor({ timeout: 10000 });
check('  a valid reset is confirmed',
  (await page.locator('.auth-alert.success').innerText()).toLowerCase().includes('reset'));

await page.locator('.auth-link', { hasText: 'Back to Sign in' }).click();
await page.waitForTimeout(300);

/* ------------------------------- signup ------------------------------- */
await page.locator('.auth-link', { hasText: 'Create Account' }).click();
await page.waitForTimeout(300);
check('  Create Account opens its own screen',
  (await page.locator('.auth-title').innerText()).trim() === 'Create Account');

const signupLabels = (await page.locator('.auth-field label').allInnerTexts()).map((t) => t.trim());
check('  asks for exactly the five specified fields',
  signupLabels.join('|') === 'First Name|Last Name|Email ID|New Password|Confirm Password',
  signupLabels.join('|'));

const signupText = (await page.locator('.auth-page').innerText()).toLowerCase();
for (const word of ['doctor', 'physician', 'specialty', 'hospital', 'license', 'registration number']) {
  check(`  signup page never asks about "${word}"`, !signupText.includes(word));
}

await page.locator('button.auth-submit').click();
await page.waitForTimeout(250);
const signupErrors = (await page.locator('.auth-field-error').allInnerTexts()).map((t) => t.trim());
check('  empty signup flags all five fields', signupErrors.length === 5, signupErrors.join(' / '));

await page.fill('#signup-first-name', 'Asha');
await page.fill('#signup-last-name', 'Raman');
await page.fill('#signup-email', 'not-an-email');
await page.fill('#signup-password', 'secret1');
await page.fill('#signup-confirm-password', 'secret2');
await page.locator('button.auth-submit').click();
await page.waitForTimeout(250);
const mixedErrors = (await page.locator('.auth-field-error').allInnerTexts()).map((t) => t.trim());
check('  invalid email is flagged', mixedErrors.some((e) => e.includes('valid email')), mixedErrors.join(' / '));
check('  password mismatch is flagged', mixedErrors.includes('Passwords do not match.'), mixedErrors.join(' / '));
await page.screenshot({ path: `${SHOTS}/ui-08-signup-validation.png` });

await page.fill('#signup-email', 'asha.raman@example.com');
await page.fill('#signup-confirm-password', 'secret1');
await page.waitForTimeout(150);
check('  fixing a field clears its error',
  !(await page.locator('.auth-field-error').allInnerTexts()).some((e) => e.includes('valid email')));

await page.locator('.auth-switch .auth-link').click();
await page.waitForTimeout(300);

/* ------------------------------- sign in ------------------------------ */
await page.fill('#login-identifier', 'sanju2kguru@gmail.com');
await page.locator('button.auth-submit').click();
await page.locator('#login-password').waitFor({ timeout: 5000 });
await page.fill('#login-password', 'password123');
await page.locator('button.auth-submit').click();
await page.locator('.charm-card').waitFor({ timeout: 15000 });
check('signing back in returns to My Templates',
  (await activeTab()).trim() === 'My Templates');
check('  and the header greets the plain user name',
  (await page.locator('.user-profile-badge').innerText()).includes('Sanjana K'));
// The first row only exists once the template fetch resolves.
await page.locator('.my-templates-table tbody tr').first().waitFor({ timeout: 15000 });
check('  and the template list is populated',
  (await page.locator('.my-templates-table tbody tr').count()) > 0);

/* ========================= console cleanliness ======================== */
console.log('\n=== 11: browser console ===');
const realErrors = consoleErrors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
check(`no console errors during the run (${realErrors.length})`, realErrors.length === 0,
  realErrors.slice(0, 3).join(' | '));

console.log('\n' + '='.repeat(58));
console.log(`  ${pass.length} passed, ${fail.length} failed`);
if (fail.length) console.log('  FAILED: ' + fail.join('; '));
console.log('='.repeat(58));

await browser.close();
process.exit(fail.length ? 1 : 0);
