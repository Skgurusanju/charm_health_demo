import { chromium } from 'playwright';

const APP = 'http://localhost:5173/';

async function run() {
  console.log('Launching browser with msedge channel...');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log('Navigating to', APP);
  await page.goto(APP, { waitUntil: 'networkidle' });

  // Wait for table to load
  await page.locator('.my-templates-table tbody tr').first().waitFor({ timeout: 15000 });
  console.log('Table loaded.');

  // Search and open Vaso-Meditech EECP SOAP_Practice
  await page.fill('#template-name-search', 'Vaso-Meditech EECP SOAP_Practice');
  await page.waitForTimeout(500);

  const row = page.locator('.my-templates-table tbody tr', { hasText: 'Vaso-Meditech EECP SOAP_Practice' }).first();
  await row.locator('.three-dot-btn').click();
  await page.locator('.menu-item', { hasText: 'View' }).first().click();

  // Wait for template details page / ClinicalFormRenderer
  await page.locator('.cfr-row, .hopt-tree-root, .hopt-opt').first().waitFor({ timeout: 10000 });
  console.log('Template details view opened.');

  // Wait for Chest Pain section
  await page.locator('.cfr-row, .ctv-field', { hasText: 'Chest Pain?' }).first().waitFor({ timeout: 5000 });
  console.log('Chest Pain? field found.');

  // Helper to check visibility of option labels
  const getOpt = (label) => page.locator('.hopt-opt').filter({ hasText: label });
  const isVisible = async (label) => {
    const loc = getOpt(label);
    const count = await loc.count();
    return count > 0 && await loc.first().isVisible();
  };

  const isChecked = async (label) => {
    return await getOpt(label).first().locator('input.hopt-check').isChecked();
  };

  // Test 1: Selecting Yes displays CCS, With Exertion, At Rest
  console.log('\n--- Test 1: Chest Pain -> Yes displays CCS, With Exertion, At Rest ---');
  console.log('Yes visible:', await isVisible('Yes'), 'Checked:', await isChecked('Yes'));
  console.log('CCS visible:', await isVisible('CCS'));
  console.log('With Exertion visible:', await isVisible('With Exertion'));
  console.log('At Rest visible:', await isVisible('At Rest'));

  // Test 2 & 3: With Exertion shows all options without clicking an arrow
  console.log('\n--- Test 2 & 3: With Exertion options visible without clicking arrow ---');
  console.log('Running visible:', await isVisible('Running'));
  console.log('Walking up Stairs visible:', await isVisible('Walking up Stairs'));
  console.log('Walking up Slope visible:', await isVisible('Walking up Slope'));
  console.log('Walking on Flat Surface visible:', await isVisible('Walking on Flat Surface'));

  // Test 4: Walking on Flat Surface distance options are visible
  console.log('\n--- Test 4: Distance options under Walking on Flat Surface ---');
  console.log('More than 1/2 km visible:', await isVisible('More than 1/2 km'));
  console.log('Less than 1/2 km visible:', await isVisible('Less than 1/2 km'));
  console.log('Less than 100 m visible:', await isVisible('Less than 100 m'));

  // Check no chevrons (› or ▸) exist
  const chevrons = await page.locator('.hopt-chevron').count();
  console.log('Chevron count (must be 0):', chevrons);

  // Test 5: Every checkbox clickable and functional
  console.log('\n--- Test 5: Checkboxes clickable & functional ---');
  console.log('Clicking "Running"...');
  await getOpt('Running').first().click();
  await page.waitForTimeout(200);
  console.log('Running checked:', await isChecked('Running'));
  console.log('With Exertion still checked:', await isChecked('With Exertion'));
  console.log('CCS still checked (no deselect of sibling!):', await isChecked('CCS'));

  console.log('Clicking "More than 1/2 km"...');
  await getOpt('More than 1/2 km').first().click();
  await page.waitForTimeout(200);
  console.log('More than 1/2 km checked:', await isChecked('More than 1/2 km'));
  console.log('Walking on Flat Surface auto-checked:', await isChecked('Walking on Flat Surface'));

  // Test 6: Wrap on resize (no horizontal scrollbar on options container)
  console.log('\n--- Test 6: Responsive wrap on resize ---');
  await page.setViewportSize({ width: 800, height: 900 });
  await page.waitForTimeout(300);
  const scrollWidth = await page.evaluate(() => {
    const el = document.querySelector('.hopt-options-wrap');
    return el ? { clientWidth: el.clientWidth, scrollWidth: el.scrollWidth } : null;
  });
  console.log('Viewport 800px - wrap dimensions:', scrollWidth);

  // Take screenshot
  await page.screenshot({ path: 'test_result_view.png', fullPage: false });
  console.log('Screenshot saved to test_result_view.png');

  // Test 7: Universal across other templates (e.g. Chest Pain Assessment)
  console.log('\n--- Test 7: Universal across templates (Chest Pain Assessment) ---');
  const backBtn = page.locator('button:has-text("Back to Templates"), button:has-text("Back"), .btn-back').first();
  if (await backBtn.isVisible()) {
    await backBtn.click();
    await page.waitForTimeout(400);

    await page.fill('#template-name-search', 'Chest Pain Assessment');
    await page.waitForTimeout(500);
    const row2 = page.locator('.my-templates-table tbody tr', { hasText: 'Chest Pain Assessment' }).first();
    await row2.locator('.three-dot-btn').click();
    await page.locator('.menu-item', { hasText: 'View' }).first().click();
    await page.locator('.cfr-row, .hopt-tree-root').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);

    console.log('Chest Pain Assessment - With Exertion visible:', await isVisible('With Exertion'));
    console.log('Chest Pain Assessment - Running visible:', await isVisible('Running'));
    console.log('Chest Pain Assessment - Walking on Flat Surface visible:', await isVisible('Walking on Flat Surface'));
    console.log('Chest Pain Assessment - More than 1/2 km visible:', await isVisible('More than 1/2 km'));
  }

  await browser.close();
  console.log('\nALL VERIFICATION CHECKS COMPLETE!');
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
