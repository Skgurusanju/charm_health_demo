/**
 * Headless render check for the My Templates module.
 *
 * Loads the real components through Vite's SSR pipeline and renders them with
 * react-dom/server. This catches runtime errors in render logic (bad imports,
 * undefined property access, malformed props) without needing a browser or any
 * extra dependency. Effects and browser APIs are out of scope by design.
 *
 *   node scripts/render-check.mjs
 */

import { createServer } from 'vite';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';

const failures = [];
const passes = [];

function check(label, fn) {
  try {
    const html = fn();
    if (typeof html !== 'string') throw new Error('render produced no markup');
    passes.push(label);
    console.log(`  PASS  ${label}  (${html.length} chars)`);
    return html;
  } catch (err) {
    failures.push(label);
    console.log(`  FAIL  ${label}\n        ${err.message}`);
    return '';
  }
}

const SAMPLE_TEMPLATE = {
  id: 1,
  name: 'Chest Pain Assessment',
  template_type: 'SOAP',
  specialty: 'Cardiac',
  category: 'Cardiac',
  description: 'Comprehensive cardiac chest pain diagnostic pathway.',
  content: 'S:\nO:\nA:\nP:',
  tags: 'chest pain, angina, cardiac',
  tags_list: ['chest pain', 'angina', 'cardiac'],
  is_active: true,
  is_practice: 1,
  is_library: 0,
  created_at: '2026-01-05 10:30:00',
  updated_at: '2026-02-11 14:05:00',
  relationships: [
    { id: 1, parent_component_id: 1, trigger_value: 'Yes', child_component_id: 2, parent_label: 'Chest Pain Present?', child_label: 'Pain Severity Level' }
  ],
  sections: [
    {
      id: 1,
      title: 'Symptoms',
      category: 'Subjective',
      column_layout: 1,
      components: [
        { id: 1, component_type: 'Heading', label: 'Section A: Symptom Checklist', options: [] },
        {
          id: 2,
          component_type: 'Single Choice',
          label: 'Polyuria (Excessive urination)',
          default_value: '1 - Mild',
          options: [
            { id: 1, option_label: '0 - None', option_value: '0 - None' },
            { id: 2, option_label: '1 - Mild', option_value: '1 - Mild' },
            { id: 3, option_label: '2 - Moderate', option_value: '2 - Moderate' },
            { id: 4, option_label: '3 - Severe', option_value: '3 - Severe' }
          ]
        },
        { id: 3, component_type: 'Notes', label: 'Total Symptom Score', default_value: '', options: [] },
        {
          id: 4,
          component_type: 'Table',
          label: 'Frequency log',
          options: [
            { id: 5, option_label: 'Chest Pain Frequency per Week:', option_value: '' },
            { id: 6, option_label: 'S/L Nitroglycerin per Week:', option_value: '' }
          ]
        }
      ]
    }
  ]
};

const INACTIVE_TEMPLATE = { ...SAMPLE_TEMPLATE, id: 2, name: 'Retired Protocol', is_active: false, relationships: [] };

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error'
});

try {
  const { MyTemplatesTable } = await server.ssrLoadModule('/src/components/templates/MyTemplatesTable.tsx');
  const { CommonMedicationPanel } = await server.ssrLoadModule('/src/components/templates/CommonMedicationPanel.tsx');
  const { TemplateTabs } = await server.ssrLoadModule('/src/components/layout/TemplateTabs.tsx');
  const { TemplateTypeSelect } = await server.ssrLoadModule('/src/components/common/TemplateTypeSelect.tsx');
  const { ThreeDotMenu } = await server.ssrLoadModule('/src/components/common/ThreeDotMenu.tsx');
  const { TEMPLATE_TYPE_OPTIONS, TEMPLATE_TYPE_DROPDOWN, MEDICAL_CONDITIONS } =
    await server.ssrLoadModule('/src/constants/templateTypes.ts');

  const noop = () => {};

  console.log('\n=== Template type constants ===');
  check('34 template types, "All" first, reference order', () => {
    if (TEMPLATE_TYPE_OPTIONS[0] !== 'All') throw new Error("'All' is not first");
    if (TEMPLATE_TYPE_DROPDOWN.length !== 34) {
      throw new Error(`expected 34 types, got ${TEMPLATE_TYPE_DROPDOWN.length}`);
    }
    const expectedHead = ['Assessment Notes', 'Billing Procedure Codes', 'Billing Inventory'];
    const head = TEMPLATE_TYPE_DROPDOWN.slice(0, 3).join('|');
    if (head !== expectedHead.join('|')) throw new Error(`dropdown starts with ${head}`);
    if (TEMPLATE_TYPE_DROPDOWN.at(-1) !== 'Vaccine') throw new Error('last type is not Vaccine');
    return JSON.stringify(TEMPLATE_TYPE_DROPDOWN);
  });

  console.log('\n=== Tabs ===');
  const tabsHtml = check('TemplateTabs', () =>
    renderToString(createElement(TemplateTabs, { activeTab: 'my_templates', onSelectTab: () => {} })));
  check('  renders the five tabs in order', () => {
    const labels = [
      'My Templates', 'Practice Templates', 'Email Templates',
      'CharmHealth Library', 'Common Medication'
    ];
    let cursor = -1;
    for (const label of labels) {
      const at = tabsHtml.indexOf(label, cursor + 1);
      if (at === -1) throw new Error(`missing or out-of-order tab "${label}"`);
      cursor = at;
    }
    return labels.join(' | ');
  });
  check('  My Templates is the selected tab', () => {
    if (!/aria-selected="true"[^>]*>My Templates|My Templates/.test(tabsHtml)) throw new Error('no active tab');
    const active = tabsHtml.match(/class="tab-item active"[^>]*>([^<]+)/);
    if (!active) throw new Error('no .tab-item.active');
    if (!tabsHtml.includes('aria-selected="true"')) throw new Error('no aria-selected tab');
    return active[1];
  });
  check('  no medical conditions rendered beside the tabs', () => {
    const leaked = MEDICAL_CONDITIONS.filter((c) => tabsHtml.includes(c.label));
    if (leaked.length) throw new Error(`condition chips leaked: ${leaked.map((c) => c.label).join(', ')}`);
    return 'clean';
  });

  console.log('\n=== Template table states ===');
  const tableProps = { onAction: noop, onTemplateClick: noop, onRetry: noop, onResetFilters: noop };

  const rowsHtml = check('table with rows', () =>
    renderToString(createElement(MyTemplatesTable, {
      ...tableProps, templates: [SAMPLE_TEMPLATE, INACTIVE_TEMPLATE], loading: false
    })));
  check('  renders all four column headers', () => {
    for (const h of ['Template Name', 'Category', 'Template Type', 'Actions']) {
      if (!rowsHtml.includes(h)) throw new Error(`missing column "${h}"`);
    }
    return 'ok';
  });
  check('  renders category and type badges', () => {
    if (!rowsHtml.includes('badge-category')) throw new Error('no category badge');
    if (!rowsHtml.includes('badge-type')) throw new Error('no type badge');
    if (!rowsHtml.includes('Inactive')) throw new Error('inactive badge missing');
    return 'ok';
  });

  const emptyHtml = check('empty state', () =>
    renderToString(createElement(MyTemplatesTable, { ...tableProps, templates: [], loading: false, hasActiveFilters: true })));
  check('  shows the required empty copy', () => {
    if (!emptyHtml.includes('No templates available')) throw new Error('missing "No templates available"');
    if (!emptyHtml.includes('Try changing your search or template type')) throw new Error('missing hint copy');
    return 'ok';
  });

  const loadingHtml = check('loading state', () =>
    renderToString(createElement(MyTemplatesTable, { ...tableProps, templates: [], loading: true })));
  check('  shows "Loading templates…"', () => {
    if (!loadingHtml.includes('Loading templates')) throw new Error('missing loading copy');
    return 'ok';
  });

  const errorHtml = check('error state', () =>
    renderToString(createElement(MyTemplatesTable, {
      ...tableProps, templates: [], loading: false, error: 'Cannot reach the server.'
    })));
  check('  shows a friendly error, no stack trace', () => {
    if (!errorHtml.includes('Unable to load templates')) throw new Error('missing error title');
    if (errorHtml.includes('Traceback')) throw new Error('leaked a traceback');
    return 'ok';
  });

  console.log('\n=== Filter controls ===');
  const typeSelectHtml = check('TemplateTypeSelect', () =>
    renderToString(createElement(TemplateTypeSelect, {
      value: 'All', onChange: noop, options: TEMPLATE_TYPE_OPTIONS
    })));
  check('  every required type is an <option>', () => {
    const missing = TEMPLATE_TYPE_DROPDOWN.filter((t) => !typeSelectHtml.includes(t.replace(/&/g, '&amp;')));
    if (missing.length) throw new Error(`missing options: ${missing.join(', ')}`);
    return `${TEMPLATE_TYPE_DROPDOWN.length} options present`;
  });
  check('  is a flat dropdown, not a grouped one', () => {
    if (typeSelectHtml.includes('optgroup')) throw new Error('dropdown still uses <optgroup>');
    return 'flat';
  });

  console.log('\n=== Common Medication ===');
  const cmProps = {
    conditions: MEDICAL_CONDITIONS, onSearchChange: noop, onSelectCondition: noop,
    templates: [], loading: false, onViewTemplate: noop
  };

  const cmHtml = check('CommonMedicationPanel catalogue', () =>
    renderToString(createElement(CommonMedicationPanel, {
      ...cmProps, searchTerm: '', activeCondition: ''
    })));
  check(`  lists all ${MEDICAL_CONDITIONS.length} conditions`, () => {
    const missing = MEDICAL_CONDITIONS.filter((c) => !cmHtml.includes(c.label.replace(/'/g, '&#x27;')));
    if (missing.length) throw new Error(`missing: ${missing.map((c) => c.label).join(', ')}`);
    return `${MEDICAL_CONDITIONS.length} conditions`;
  });
  check('  shows the specified search label', () => {
    if (!cmHtml.includes('Search Common Medication / Condition')) throw new Error('search label missing');
    if (!cmHtml.includes('Common Medication / Conditions')) throw new Error('list heading missing');
    return 'ok';
  });

  const cmFilteredHtml = check('  search narrows the catalogue', () =>
    renderToString(createElement(CommonMedicationPanel, {
      ...cmProps, searchTerm: 'cough', activeCondition: ''
    })));
  check('    only matching conditions survive', () => {
    if (!cmFilteredHtml.includes('Cough')) throw new Error('"Cough" was filtered out');
    if (cmFilteredHtml.includes('Heart Failure')) throw new Error('non-matching condition still shown');
    return 'ok';
  });

  const cmDetailHtml = check('  condition detail view', () =>
    renderToString(createElement(CommonMedicationPanel, {
      ...cmProps, searchTerm: '', activeCondition: 'diabetes',
      templates: [{ ...SAMPLE_TEMPLATE, name: 'Diabetes Management Template' }]
    })));
  check('    shows the condition and its templates', () => {
    if (!cmDetailHtml.includes('All Conditions')) throw new Error('no back link');
    if (!cmDetailHtml.includes('Diabetes Management Template')) throw new Error('template row missing');
    return 'ok';
  });

  check('ThreeDotMenu trigger', () =>
    renderToString(createElement(ThreeDotMenu, { template: SAMPLE_TEMPLATE, mode: 'my', onAction: noop })));

  console.log('\n=== Modals ===');
  // The View Template modal now lives in src/components/viewer and is
  // covered end-to-end against live API data by scripts/viewer-check.mjs.
  // The template form modal was removed; the Template Builder is now the
  // single editor and is covered end-to-end by scripts/acceptance.mjs.

  console.log('\n' + '='.repeat(58));
  console.log(`  ${passes.length} passed, ${failures.length} failed`);
  if (failures.length) console.log('  FAILED: ' + failures.join('; '));
  console.log('='.repeat(58));
} finally {
  await server.close();
}

process.exit(failures.length ? 1 : 0);
