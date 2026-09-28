import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Layers, Plus, Search } from 'lucide-react';

import { Header } from './components/layout/Header';
import { TemplateTabs } from './components/layout/TemplateTabs';
import { GlobalSearch } from './components/common/GlobalSearch';
import { TemplateTypeSelect } from './components/common/TemplateTypeSelect';
import { MyTemplatesTable } from './components/templates/MyTemplatesTable';
import { PracticeTemplatesTable } from './components/templates/PracticeTemplatesTable';
import { EmailTemplatesTable } from './components/templates/EmailTemplatesTable';
import { LibraryTemplatesTable } from './components/templates/LibraryTemplatesTable';
import { CommonMedicationPanel } from './components/templates/CommonMedicationPanel';
import { TemplateDetailsPage } from './components/viewer/TemplateDetailsPage';
import { TemplatePreview } from './components/clinical/TemplatePreview';
import { NewTemplateModal } from './components/modals/NewTemplateModal';
import { SoapSectionModal } from './components/modals/SoapSectionModal';
import { AssignRolesModal } from './components/modals/AssignRolesModal';
import { DefaultValuesModal } from './components/modals/DefaultValuesModal';
import { ConfirmModal } from './components/modals/ConfirmModal';
import { TemplateBuilder } from './components/builder/TemplateBuilder';
import { Login } from './components/auth/Login';
import { Signup } from './components/auth/Signup';
import { ForgotPassword } from './components/auth/ForgotPassword';

import {
  ClinicalTemplate,
  MedicalCondition,
  Patient,
  TabType,
  TemplateSection,
  UserSession
} from './types';
import { ActionOption } from './components/common/ThreeDotMenu';
import { api } from './services/api';
import {
  MEDICAL_CATEGORIES,
  MEDICAL_CONDITIONS,
  TEMPLATE_TYPE_OPTIONS
} from './constants/templateTypes';

type Toast = { message: string; kind: 'success' | 'error' };

export function App() {
  // ----------------------------------------------------------- Auth state
  // A generic account: a plain name, no title, qualification or specialty.
  const [currentUser, setCurrentUser] = useState<UserSession | null>(() => ({
    id: 1,
    email: 'sanju2kguru@gmail.com',
    full_name: 'Sanjana K',
    role: 'User'
  }));
  const [authView, setAuthView] = useState<'login' | 'signup' | 'forgot' | 'app'>('app');
  /** Carried from sign-in into recovery so the identifier is typed once. */
  const [recoveryIdentifier, setRecoveryIdentifier] = useState('');

  const [selectedBranch, setSelectedBranch] = useState('Heal Your Heart Neelankarai');
  const [mode, setMode] = useState<'dashboard' | 'view' | 'builder'>('dashboard');

  // ------------------------------------------------------ Filters & paging
  const [activeTab, setActiveTab] = useState<TabType>('my_templates');
  const [selectedType, setSelectedType] = useState('All');
  const [nameSearchQuery, setNameSearchQuery] = useState('');
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');

  // Common Medication keeps its own two filters: a box that narrows the
  // condition catalogue, and the condition the user drilled into. Neither is
  // ever applied to the template tabs.
  const [conditionSearchQuery, setConditionSearchQuery] = useState('');
  const [activeCondition, setActiveCondition] = useState('');

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;

  // ----------------------------------------------------------------- Data
  const [templates, setTemplates] = useState<ClinicalTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Reference lists come from the backend so the dropdowns can never drift
  // from the server's validation list; the bundled constants are the fallback.
  const [typeOptions, setTypeOptions] = useState<string[]>(TEMPLATE_TYPE_OPTIONS);
  const [categoryOptions, setCategoryOptions] = useState<string[]>(['All', ...MEDICAL_CATEGORIES]);
  const [conditionOptions, setConditionOptions] = useState<MedicalCondition[]>(MEDICAL_CONDITIONS);

  // ------------------------------------------------------ Active selection
  const [activeTemplate, setActiveTemplate] = useState<ClinicalTemplate | null>(null);
  const [activePatient, setActivePatient] = useState<Patient | null>(null);

  // --------------------------------------------------------------- Modals
  const [showNewTemplateModal, setShowNewTemplateModal] = useState(false);
  const [showSoapModal, setShowSoapModal] = useState(false);
  const [pendingNewTemplateName, setPendingNewTemplateName] = useState('');
  const [pendingNewTemplateSpecialty, setPendingNewTemplateSpecialty] = useState('General Medicine');
  const [previewTemplate, setPreviewTemplate] = useState<ClinicalTemplate | null>(null);
  const [showRolesModal, setShowRolesModal] = useState(false);
  const [showDefaultsModal, setShowDefaultsModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = useCallback((message: string, kind: 'success' | 'error' = 'success') => {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  // -------------------------------------------------- Load reference lists
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [types, categories, conditions] = await Promise.allSettled([
        api.getTemplateTypes(),
        api.getTemplateCategories(),
        api.getMedicalConditions()
      ]);

      if (cancelled) return;
      if (types.status === 'fulfilled' && types.value.length) setTypeOptions(types.value);
      if (categories.status === 'fulfilled' && categories.value.length) setCategoryOptions(categories.value);
      if (conditions.status === 'fulfilled' && conditions.value.length) setConditionOptions(conditions.value);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ------------------------------------------------------- Fetch templates
  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.getTemplates({
        tab: activeTab,
        template_type: selectedType,
        // Only Common Medication filters by condition. The template tabs pass
        // nothing here, so a condition can never narrow My Templates.
        condition: activeTab === 'common_medication' ? activeCondition : '',
        // The header search drives the server-side query; the Template Name
        // box narrows the result further on the client.
        search: globalSearchQuery,
        owner: currentUser?.email
      });
      setTemplates(data);
    } catch (err) {
      setTemplates([]);
      setLoadError(err instanceof Error ? err.message : 'Unable to load templates right now.');
    } finally {
      setLoading(false);
    }
  }, [activeTab, selectedType, activeCondition, globalSearchQuery, currentUser?.email]);

  useEffect(() => {
    if (authView !== 'app') return;
    fetchTemplates();
  }, [authView, fetchTemplates]);

  // Any filter change returns to the first page of results.
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, selectedType, activeCondition, globalSearchQuery, nameSearchQuery]);

  // ---------------------------------------------- Client-side multi-field filter
  const filteredTemplates = useMemo(() => {
    const needle = nameSearchQuery.trim().toLowerCase();
    if (!needle) return templates;
    return templates.filter((t) => {
      return (
        t.name?.toLowerCase().includes(needle) ||
        t.specialty?.toLowerCase().includes(needle) ||
        t.template_type?.toLowerCase().includes(needle) ||
        t.tags?.toLowerCase().includes(needle) ||
        t.category?.toLowerCase().includes(needle) ||
        t.description?.toLowerCase().includes(needle)
      );
    });
  }, [templates, nameSearchQuery]);

  const totalTemplates = filteredTemplates.length;
  const totalPages = Math.max(1, Math.ceil(totalTemplates / pageSize));

  const paginatedTemplates = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredTemplates.slice(start, start + pageSize);
  }, [filteredTemplates, currentPage, pageSize]);

  const isCommonMedication = activeTab === 'common_medication';

  const hasActiveFilters = Boolean(
    selectedType !== 'All' || nameSearchQuery || globalSearchQuery
  );

  const resetFilters = () => {
    setSelectedType('All');
    setActiveCondition('');
    setConditionSearchQuery('');
    setNameSearchQuery('');
    setGlobalSearchQuery('');
  };

  // ------------------------------------------------------ Template actions
  const loadFullTemplate = async (tpl: ClinicalTemplate): Promise<ClinicalTemplate> => {
    try {
      return await api.getTemplate(tpl.id);
    } catch {
      return tpl;
    }
  };

  const handleDuplicate = async (tpl: ClinicalTemplate) => {
    try {
      const result = await api.duplicateTemplate(tpl.id);
      showToast(result.message || `Duplicated "${tpl.name}".`);
      await fetchTemplates();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to duplicate template', 'error');
    }
  };

  const handleToggleStatus = async (tpl: ClinicalTemplate) => {
    const nextActive = tpl.is_active === false;
    try {
      const result = await api.setTemplateStatus(tpl.id, nextActive);
      showToast(result.message);
      await fetchTemplates();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to change status', 'error');
    }
  };

  const handleTemplateAction = async (action: ActionOption, tpl: ClinicalTemplate) => {
    // Actions that do not need the full section tree run straight away.
    if (action === 'duplicate') return handleDuplicate(tpl);
    if (action === 'toggle_status') return handleToggleStatus(tpl);

    const fullTpl = await loadFullTemplate(tpl);
    setActiveTemplate(fullTpl);

    switch (action) {
      case 'view':
        setMode('view');
        break;

      case 'edit':
        setMode('builder');
        break;

      case 'assign_roles':
        setShowRolesModal(true);
        break;

      case 'default_values':
        setShowDefaultsModal(true);
        break;

      case 'use_consultation':
        handleTemplateClick(tpl);
        break;

      case 'personalise':
        showToast(`Template "${tpl.name}" personalized for your account.`);
        break;

      case 'share_library':
        try {
          await api.shareTemplate(tpl.id);
          showToast(`Template "${tpl.name}" shared to CharmHealth Library.`);
          await fetchTemplates();
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Failed to share template', 'error');
        }
        break;

      case 'delete':
        setShowDeleteModal(true);
        break;

      case 'import':
        try {
          await api.importLibraryTemplate(tpl.id);
          showToast(`Template "${tpl.name}" imported to My Templates!`);
          setActiveTab('my_templates');
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Failed to import template', 'error');
        }
        break;

      default:
        break;
    }
  };

  /** Clicking a template name or row opens its dedicated View mode - never the editor! */
  const handleTemplateClick = async (tpl: ClinicalTemplate) => {
    const full = await loadFullTemplate(tpl);
    setActiveTemplate(full);
    setMode('view');
  };

  /** Open the interactive, usable clinical template form */
  const handleViewTemplate = async (tpl: ClinicalTemplate) => {
    const full = await loadFullTemplate(tpl);
    setActiveTemplate(full);
    setMode('view');
  };



  const handleConfirmDelete = async () => {
    if (!activeTemplate) return;
    try {
      const result = await api.deleteTemplate(activeTemplate.id);
      showToast(result.message || `Template "${activeTemplate.name}" deleted.`);
      setShowDeleteModal(false);
      setActiveTemplate(null);
      await fetchTemplates();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to delete template', 'error');
      setShowDeleteModal(false);
    }
  };

  const handleSaveRoles = async (templateId: number, roles: string[]) => {
    try {
      await api.assignRoles(templateId, roles);
      showToast('Template role permissions updated.');
      setShowRolesModal(false);
      await fetchTemplates();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update roles', 'error');
    }
  };

  const handleSaveDefaults = async (templateId: number, defaults: Record<string, string>) => {
    try {
      await api.saveDefaultValues(templateId, defaults);
      showToast('Default values configured successfully.');
      setShowDefaultsModal(false);
      await fetchTemplates();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save default values', 'error');
    }
  };

  // --------------------------------------------- Create / edit via the form
  /** Opens a blank Template Builder straight away - no patient list, no
   *  intermediate dialog, per the clinic's requirement. */
  const openBlankBuilder = () => {
    setActiveTemplate(null);
    setMode('builder');
  };

  // ------------------------- Legacy visual-builder creation flow (retained)
  const handleProceedNewTemplate = (name: string, type: string, specialty: string, tags: string = '') => {
    setShowNewTemplateModal(false);
    setPendingNewTemplateName(name);
    setPendingNewTemplateSpecialty(specialty);

    if (type === 'SOAP' || type === 'SOAP Template') {
      setShowSoapModal(true);
      return;
    }

    setActiveTemplate({
      id: 0,
      name,
      template_type: type,
      specialty,
      category: specialty,
      tags: tags || undefined,
      is_practice: 1,
      is_library: 0,
      sections: [
        {
          id: 1,
          title: `${type} Assessment`,
          category: 'Custom',
          order_index: 1,
          column_layout: 1,
          components: []
        }
      ],
      relationships: []
    });
    setMode('builder');
  };

  const handleAddSoapSections = (
    selectedSections: Array<{ title: string; category: 'Subjective' | 'Objective' | 'Assessment' | 'Plan' }>
  ) => {
    setShowSoapModal(false);

    const generatedSections: TemplateSection[] = selectedSections.map((sec, idx) => ({
      id: idx + 1,
      title: sec.title,
      category: sec.category,
      order_index: idx + 1,
      column_layout: 1,
      components: [
        {
          id: (idx + 1) * 100 + 1,
          component_type: 'Simple Question',
          label: `${sec.title} Clinical Observations`,
          placeholder: `Enter ${sec.title.toLowerCase()} notes...`,
          is_required: false,
          default_value: '',
          order_index: 1
        }
      ]
    }));

    setActiveTemplate({
      id: 0,
      name: pendingNewTemplateName || 'New SOAP Clinical Template',
      template_type: 'SOAP Template',
      specialty: pendingNewTemplateSpecialty || 'General Medicine',
      category: pendingNewTemplateSpecialty || 'General Medicine',
      is_practice: 1,
      is_library: 0,
      sections: generatedSections,
      relationships: []
    });
    setMode('builder');
  };

  // ------------------------------------------------------------ Auth views
  if (authView === 'login') {
    return (
      <Login
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          setAuthView('app');
        }}
        onNavigateToSignup={() => setAuthView('signup')}
        onNavigateToForgotPassword={(identifier) => {
          setRecoveryIdentifier(identifier || '');
          setAuthView('forgot');
        }}
      />
    );
  }

  if (authView === 'signup') {
    return (
      <Signup
        onSignupSuccess={(user) => {
          setCurrentUser(user);
          setAuthView('app');
        }}
        onNavigateToLogin={() => setAuthView('login')}
      />
    );
  }

  if (authView === 'forgot') {
    return (
      <ForgotPassword
        initialIdentifier={recoveryIdentifier}
        onNavigateToLogin={() => setAuthView('login')}
      />
    );
  }

  const tableProps = {
    templates: paginatedTemplates,
    loading,
    onAction: handleTemplateAction,
    onTemplateClick: handleTemplateClick
  };

  return (
    <div className="app-container">
      <Header
        currentUser={currentUser}
        onLogout={() => {
          setCurrentUser(null);
          setAuthView('login');
        }}
        onNavigateHome={() => setMode('dashboard')}
        selectedBranch={selectedBranch}
        onSelectBranch={(b) => setSelectedBranch(b)}
      />

      {toast && (
        <div className={`app-toast ${toast.kind}`} role="status" aria-live="polite">
          {toast.kind === 'success' ? (
            <CheckCircle2 size={16} color="#22c55e" aria-hidden="true" />
          ) : (
            <AlertCircle size={16} color="#f87171" aria-hidden="true" />
          )}
          {toast.message}
        </div>
      )}

      {mode === 'view' && activeTemplate ? (
        <TemplateDetailsPage
          template={activeTemplate}
          currentUser={currentUser}
          onBack={() => setMode('dashboard')}
          onEdit={(tpl) => {
            setActiveTemplate(tpl);
            setMode('builder');
          }}
        />
      ) : mode === 'builder' ? (
        <TemplateBuilder
          initialTemplate={activeTemplate}
          onBack={() => {
            setMode('dashboard');
            setActiveTemplate(null);
          }}
          onSave={async (saved) => {
            showToast(`Template "${saved.name}" saved successfully.`);
            setActiveTemplate(saved);
            await fetchTemplates();
          }}
          onPreview={(tpl) => {
            setPreviewTemplate(tpl);
          }}
        />
      ) : (
        <main className="my-templates-workspace">
          <GlobalSearch onSearch={setGlobalSearchQuery} />

          <div className="charm-card">
            <TemplateTabs
              activeTab={activeTab}
              onSelectTab={(tab) => {
                setActiveTab(tab);
                resetFilters();
              }}
              onBack={resetFilters}
            />

            {!isCommonMedication && (
              <div className="charm-controls-row">
                <div className="controls-left">
                  <TemplateTypeSelect
                    value={selectedType}
                    onChange={setSelectedType}
                    options={typeOptions}
                  />
                </div>

                <div className="controls-right" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div className="template-search-input-wrap">
                      <Search size={15} className="template-search-icon" aria-hidden="true" />
                      <label className="visually-hidden" htmlFor="template-name-search">
                        Search by medical condition or template name
                      </label>
                      <input
                        id="template-name-search"
                        type="search"
                        placeholder="Search by medical condition or template name"
                        style={{ minWidth: '320px', borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
                        value={nameSearchQuery}
                        onChange={(e) => setNameSearchQuery(e.target.value)}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn-primary"
                      style={{
                        height: '32px',
                        borderTopLeftRadius: 0,
                        borderBottomLeftRadius: 0,
                        padding: '0 14px',
                        fontSize: '12px'
                      }}
                      onClick={() => {}}
                    >
                      Search
                    </button>
                  </div>

                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => setShowNewTemplateModal(true)}
                    title="Create a new clinical template"
                  >
                    <Plus size={16} aria-hidden="true" /> New Template
                  </button>
                </div>
              </div>
            )}

            {!isCommonMedication && hasActiveFilters && (
              <div className="filter-summary-bar">
                <span>
                  Showing <strong>{totalTemplates}</strong> template{totalTemplates === 1 ? '' : 's'}
                  {selectedType !== 'All' && <> of type <strong>{selectedType}</strong></>}
                  {nameSearchQuery && <> matching <strong>{nameSearchQuery}</strong></>}
                </span>
                <button type="button" className="btn-link" onClick={resetFilters}>
                  Reset Filters
                </button>
              </div>
            )}

            <div id="template-tabpanel" role="tabpanel" aria-labelledby={`tab-${activeTab}`}>
              {activeTab === 'my_templates' && (
                <MyTemplatesTable
                  {...tableProps}
                  error={loadError}
                  onRetry={fetchTemplates}
                  onResetFilters={resetFilters}
                  hasActiveFilters={hasActiveFilters}
                />
              )}
              {activeTab === 'practice_templates' && <PracticeTemplatesTable {...tableProps} />}
              {activeTab === 'email_templates' && <EmailTemplatesTable {...tableProps} />}
              {activeTab === 'template_library' && (
                <LibraryTemplatesTable
                  {...tableProps}
                  onQuickImport={(tpl) => handleTemplateAction('import', tpl)}
                />
              )}
              {isCommonMedication && (
                <CommonMedicationPanel
                  conditions={conditionOptions}
                  searchTerm={conditionSearchQuery}
                  onSearchChange={setConditionSearchQuery}
                  activeCondition={activeCondition}
                  onSelectCondition={setActiveCondition}
                  templates={templates}
                  loading={loading}
                  error={loadError}
                  onRetry={fetchTemplates}
                  onViewTemplate={handleViewTemplate}
                />
              )}
            </div>

            {!isCommonMedication && (
              <div className="charm-pagination-bar">
                <div className="pagination-info">
                  {totalTemplates === 0
                    ? '0 - 0 of 0'
                    : `${(currentPage - 1) * pageSize + 1} - ${Math.min(currentPage * pageSize, totalTemplates)} of ${totalTemplates}`}
                </div>

                <div className="pagination-nav">
                  <button
                    type="button"
                    className="page-nav-btn"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                  >
                    <ChevronLeft size={15} aria-hidden="true" /> Previous
                  </button>
                  <button
                    type="button"
                    className="page-nav-btn"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                  >
                    Next <ChevronRight size={15} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      )}

      {/* ------------------------------------------------------------ Modals */}

      <NewTemplateModal
        isOpen={showNewTemplateModal}
        onClose={() => setShowNewTemplateModal(false)}
        onProceed={handleProceedNewTemplate}
      />

      <SoapSectionModal
        isOpen={showSoapModal}
        templateName={pendingNewTemplateName}
        onClose={() => setShowSoapModal(false)}
        onAddSections={handleAddSoapSections}
      />

      <AssignRolesModal
        isOpen={showRolesModal}
        template={activeTemplate}
        onClose={() => setShowRolesModal(false)}
        onSaveRoles={handleSaveRoles}
      />

      <DefaultValuesModal
        isOpen={showDefaultsModal}
        template={activeTemplate}
        onClose={() => setShowDefaultsModal(false)}
        onSaveDefaults={handleSaveDefaults}
      />


      {/* Clinical preview: the form as a doctor sees it during consultation.
          No editing controls, no patient list. */}
      <TemplatePreview
        isOpen={previewTemplate !== null}
        template={previewTemplate}
        onClose={() => setPreviewTemplate(null)}
      />



      <ConfirmModal
        isOpen={showDeleteModal}
        title="Delete Template"
        message={`Are you sure you want to delete template "${activeTemplate?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        isDanger
        onConfirm={handleConfirmDelete}
        onCancel={() => setShowDeleteModal(false)}
      />
    </div>
  );
}

export default App;
