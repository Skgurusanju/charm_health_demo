/**
 * Render check for the clinical template viewer.
 *
 * Pulls the REAL templates from the running Flask API and renders them with
 * the real viewer components through Vite's SSR pipeline, then asserts the
 * reference-screenshot structure: nesting depth, three-column choice grids,
 * clinical tables, entity decoding, and read-only controls.
 *
 * Requires the backend on :5000.
 *   node scripts/viewer-check.mjs
 */

import { createServer } from 'vite';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';

const API = 'http://127.0.0.1:5000/api';
const passes = [];
const failures = [];

function check(label, cond, detail = '') {
  (cond ? passes : failures).push(label);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`);
}

async function api(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

/** Fetch one template by its EXACT name - several share a search prefix. */
async function byName(name) {
  const rows = await api(`/templates?tab=practice_templates&search=${encodeURIComponent(name)}`);
  const row = rows.find((r) => r.name === name);
  if (!row) throw new Error(`template not found: ${name}`);
  return api(`/templates/${row.id}`);
}

/** Count occurrences of a substring. */
const count = (hay, needle) => hay.split(needle).length - 1;

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });

try {
  const { TemplateViewModal } = await server.ssrLoadModule('/src/components/viewer/TemplateViewModal.tsx');
  const { buildOptionTree, flattenTree } = await server.ssrLoadModule('/src/components/viewer/optionTree.ts');
  const { decodeEntities } = await server.ssrLoadModule('/src/components/viewer/decodeEntities.ts');

  const render = (template) =>
    renderToString(createElement(TemplateViewModal, { isOpen: true, template, onClose: () => {} }));

  /* ---------------------------------------------- entity decoding (§32) */
  console.log('\n=== HTML entity decoding ===');
  check('&amp; decodes to &',
    decodeEntities('needs lifestyle &amp; dose adjustment') === 'needs lifestyle & dose adjustment',
    decodeEntities('needs lifestyle &amp; dose adjustment'));
  check('&lt; / &gt; decode', decodeEntities('D/S &lt; 1.0') === 'D/S < 1.0', decodeEntities('D/S &lt; 1.0'));
  check('numeric refs decode', decodeEntities('&#8805; 1.5') === '≥ 1.5', decodeEntities('&#8805; 1.5'));
  check('unknown entity left verbatim', decodeEntities('Na&K; balance') === 'Na&K; balance');
  check('single-pass only (no double decode)',
    decodeEntities('&amp;amp;') === '&amp;', decodeEntities('&amp;amp;'));
  check('plain text untouched', decodeEntities('Polyuria (Excessive urination)') === 'Polyuria (Excessive urination)');

  /* ------------------------------------------------------- option tree */
  console.log('\n=== Option tree builder ===');
  const flat = [
    { id: 1, option_label: 'No', option_value: 'No', order_index: 0, parent_option_id: null },
    { id: 2, option_label: 'Yes', option_value: 'Yes', order_index: 1, parent_option_id: null, is_selected: true },
    { id: 3, option_label: 'CCS', option_value: 'CCS', order_index: 0, parent_option_id: 2, is_selected: true },
    { id: 4, option_label: 'Class I', option_value: 'Class I', order_index: 0, parent_option_id: 3 },
    { id: 5, option_label: 'At Rest', option_value: 'At Rest', order_index: 2, parent_option_id: 2 }
  ];
  const tree = buildOptionTree(flat);
  check('roots resolved', tree.length === 2, `${tree.length} roots`);
  check('depth-3 nesting resolved', tree[1].children[0].children[0].option.option_label === 'Class I');
  check('sibling order preserved', tree[1].children.map((c) => c.option.option_label).join(',') === 'CCS,At Rest');
  check('all nodes reachable', flattenTree(tree).length === 5);

  const orphan = buildOptionTree([
    { id: 9, option_label: 'Orphan', option_value: 'o', order_index: 0, parent_option_id: 404 }
  ]);
  check('dangling parent promoted to root, not dropped', orphan.length === 1);

  const cyclic = buildOptionTree([
    { id: 1, option_label: 'A', option_value: 'A', order_index: 0, parent_option_id: 2 },
    { id: 2, option_label: 'B', option_value: 'B', order_index: 1, parent_option_id: 1 }
  ]);
  check('cycle does not hang and keeps both options', flattenTree(cyclic).length === 2);

  const legacyFlat = buildOptionTree([
    { id: 1, option_label: '0 - None', option_value: '0', order_index: 0 },
    { id: 2, option_label: '1 - Mild', option_value: '1', order_index: 1 }
  ]);
  check('pre-migration flat options still render', legacyFlat.length === 2 && legacyFlat[0].depth === 0);

  /* ------------------------------------------- live EECP reference template */
  console.log('\n=== EECP reference template (screenshot 4) ===');
  const eecp = await byName('Vaso-Meditech EECP SOAP_Practice');
  const eecpHtml = render(eecp);

  check('modal chrome present',
    eecpHtml.includes('View Template') && eecpHtml.includes('ctv-modal') && eecpHtml.includes('ctv-footer'));
  check('template name shown in metadata',
    eecpHtml.includes('Vaso-Meditech EECP SOAP_Practice'));
  check('template type shown in metadata', eecpHtml.includes('value="SOAP"'));
  check('centered "Initial Assessment" heading', eecpHtml.includes('ctv-centered-heading'));
  check('"Chest Pain?" clinical label', eecpHtml.includes('Chest Pain?'));

  for (const lbl of ['Class I', 'Class II', 'Class III', 'Class IV', 'With Exertion', 'At Rest', 'CCS']) {
    check(`  nested option "${lbl}" rendered`, eecpHtml.includes(`>${lbl}<`));
  }
  // The hierarchy runs sideways now: levels are nested chains with an arrow
  // between them, not rows indented further and further down the page.
  check('hierarchy levels render as horizontal chains',
    eecpHtml.includes('hopt-scroll') && eecpHtml.includes('data-level="1"') &&
    eecpHtml.includes('data-level="2"'),
    'levels 1 and 2 present');
  check('levels are joined by a horizontal arrow', eecpHtml.includes('hopt-arrow'));
  check('no vertical indentation is applied',
    !eecpHtml.includes('padding-left:25px') && !eecpHtml.includes('padding-left:50px'));
  check('the old vertical disclosure triangle is gone', !eecpHtml.includes('ctv-triangle'));
  check('a parent that opens a level is marked as such', eecpHtml.includes('has-children'));
  check('checked state preserved from stored template', count(eecpHtml, 'checked=""') >= 2);

  // Children exist in the data but stay unrendered until their parent is
  // ticked - that is what stops an empty child container appearing, and what
  // keeps the DOM small on a deep template.
  check('an unticked parent renders none of its children',
    eecpHtml.includes('>Dyspnea<') && !eecpHtml.includes('>NYHA Class I<'),
    'Dyspnea shown, NYHA classes withheld');

  check('clinical table rendered as a real <table>', eecpHtml.includes('<table class="ctv-table"'));
  for (const row of ['Chest Pain Frequency per Week', 'S/L Nitroglycerin per Week', 'Walking Time without Symptoms']) {
    check(`  table row "${row}"`, eecpHtml.includes(row));
  }
  check('entity in Interpretation decoded to &',
    eecpHtml.includes('review cuff fit &amp; pressure') && !eecpHtml.includes('&amp;amp;'),
    'rendered as & (HTML-escaped once by React)');

  /* ---------------------------------------- live Diabetes reference template */
  console.log('\n=== Diabetes reference template (screenshots 1-3) ===');
  const diab = await byName('Diabetes Management Template_Practice');
  const diabHtml = render(diab);

  check('section headings from stored data',
    diabHtml.includes('Symptoms') && diabHtml.includes('History of Present Illness'));
  check('blue bold sub-heading (Section A)', diabHtml.includes('Section A: Symptom Checklist'));
  for (const lbl of ['Polyuria (Excessive urination)', 'Polyphagia (Increased hunger)',
    'Fatigue / Weakness (Low energy)', 'Mood Changes (Irritability / depression / anxiety)',
    'Type of Diabetes', 'Duration of Diabetes:', 'Diet Compliance']) {
    check(`  clinical label "${lbl.slice(0, 34)}"`, diabHtml.includes(lbl));
  }
  check('3-column choice grid', diabHtml.includes('grid-template-columns:repeat(3, minmax(0, 1fr))'));
  check('1-column stacked rows for Physical Activity',
    diabHtml.includes('ctv-stacked-row'), 'Yes/No one per full-width row');
  check('Total Symptom Score uses the large field', diabHtml.includes('ctv-input-large'));
  check('Interpretation block rendered', diabHtml.includes('ctv-interpretation-grid'));
  check('Interpretation "&" decoded correctly',
    diabHtml.includes('needs lifestyle &amp; dose adjustment') && !diabHtml.includes('&amp;amp;'));
  check('radio controls, not pills', diabHtml.includes('type="radio"'));
  check('≥ and – characters preserved',
    diabHtml.includes('≥150 min/wk') && diabHtml.includes('0 – None'));

  /* ------------------------------------------------------- read-only (§24) */
  console.log('\n=== Read-only enforcement ===');
  for (const [label, html] of [['EECP', eecpHtml], ['Diabetes', diabHtml]]) {
    // Controls stay visually native (so checked boxes render blue rather than
    // grayed out) and are made inert via readOnly + removal from the tab order.
    // Hierarchical option checkboxes are deliberately live: ticking one is how
    // the next level is revealed. Everything else in the viewer stays inert,
    // so the count to satisfy excludes those checkboxes only.
    const inputs = count(html, '<input');
    const liveChoices = count(html, 'class="hopt-check"');
    const inertInputs = inputs - liveChoices;
    // React's SSR emits the camelCase form; the browser DOM attribute is
              // lowercase `readonly` either way.
    const readonly = (html.match(/readonly=""/gi) || []).length;
    const untabbable = count(html, 'tabindex="-1"');
    check(`${label}: every non-hierarchical input is readOnly (${readonly}/${inertInputs})`,
      readonly >= inertInputs, `${inputs} inputs, ${liveChoices} hierarchical`);
    check(`${label}: every non-hierarchical input is out of the tab order (${untabbable}/${inertInputs})`,
      untabbable >= inertInputs);
    check(`${label}: hierarchical checkboxes stay keyboard reachable`,
      !html.includes('class="hopt-check" tabindex="-1"'));
    check(`${label}: choice controls marked aria-readonly`, html.includes('aria-readonly="true"'));
    check(`${label}: no raw markup injected`, !html.includes('<script'));
  }

  /* ------------------------------------ data-driven across template types */
  console.log('\n=== Data-driven across other template types ===');
  for (const name of ['Symptoms_Practice', 'HUH EECP SOAP_Practice', 'Renal Profile', 'Lab Orders']) {
    let full;
    try { full = await byName(name); }
    catch { check(`template "${name}" found`, false); continue; }
    let html = '';
    try { html = render(full); } catch (e) { check(`renders "${name}"`, false, e.message); continue; }
    check(`renders "${name}" (${full.sections?.length ?? 0} sections)`, html.includes('View Template') && html.length > 500);
  }

  // A catalogue template with no structured sections yet.
  const emptyStructure = await byName('Blood Group');
  check('content-only template falls back to the content block',
    render(emptyStructure).includes('ctv-content-text') || render(emptyStructure).includes('ctv-empty'));

  console.log('\n' + '='.repeat(60));
  console.log(`  ${passes.length} passed, ${failures.length} failed`);
  if (failures.length) console.log('  FAILED: ' + failures.join('; '));
  console.log('='.repeat(60));
} finally {
  await server.close();
}

process.exit(failures.length ? 1 : 0);
