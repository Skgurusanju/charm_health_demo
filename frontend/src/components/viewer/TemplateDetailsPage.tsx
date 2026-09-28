import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ArrowLeft,
  Edit,
  Calendar,
  Tag,
  Shield,
  FileText,
  Layers,
  Save,
  CheckCircle,
  AlertCircle,
  RotateCcw,
  User,
  Search,
  Pill,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { ClinicalTemplate, Patient, UserSession, MedicationReference } from '../../types';
import { ClinicalFormRenderer } from '../clinical/ClinicalFormRenderer';
import { allComponentsOf, computeVisibility, pruneHiddenAnswers } from '../clinical/conditionalLogic';
import { api } from '../../services/api';

interface TemplateDetailsPageProps {
  template: ClinicalTemplate;
  currentUser?: UserSession | null;
  onBack: () => void;
  onEdit: (template: ClinicalTemplate) => void;
}

function fillPatientPlaceholders(text: string, p: Patient): string {
  if (!text) return '';
  return text
    .replace(/\$\{patient\.name\}/gi, p.full_name)
    .replace(/\$\{patient\.record_id\}/gi, p.mrn)
    .replace(/\$\{patient\.mrn\}/gi, p.mrn)
    .replace(/\$\{patient\.age\}/gi, String(p.age))
    .replace(/\$\{patient\.date_of_birth\}/gi, (p as any).dob || (p as any).date_of_birth || '1970-05-14')
    .replace(/\$\{patient\.gender\}/gi, p.gender)
    .replace(/\$\{patient\.birth_sex\}/gi, p.gender)
    .replace(/\$\{patient\.phone\}/gi, p.phone || '+91 98400 12345')
    .replace(/\$\{patient\.pcp\}/gi, 'Dr. Rajagopal, MD')
    .replace(/\$\{patient\.referring_provider\}/gi, 'Heal Your Heart Neelankarai')
    .replace(/\$\{patient\.past_medical_history\}/gi, p.condition_history || 'Coronary Artery Disease')
    .replace(/\$\{patient\.allergies\}/gi, 'No known drug allergies (NKDA)')
    .replace(/\$\{patient\.medications\}/gi, 'Aspirin 75mg OD, Atorvastatin 40mg HS')
    .replace(/\$\{patient\.supplements\}/gi, 'Omega-3 Fatty Acids, CoQ10 100mg')
    .replace(/\$\{patient\.diagnoses\}/gi, p.condition_history || 'Under clinical evaluation')
    .replace(/\$\{patient\.immunizations\}/gi, 'Influenza (2025), Pneumococcal PCV13')
    .replace(/\$\{patient\.procedures\}/gi, 'Coronary Angiography (2023)')
    .replace(/\$\{patient\.family_history\}/gi, 'Father: IHD at age 62; Mother: Type 2 Diabetes');
}

export const TemplateDetailsPage: React.FC<TemplateDetailsPageProps> = ({
  template,
  currentUser,
  onBack,
  onEdit
}) => {
  const allComponents = useMemo(() => allComponentsOf(template), [template]);
  const sectionsCount = template.sections?.length || 0;
  const componentsCount = allComponents.length;

  // Patient state
  const [patients, setPatients] = useState<Patient[]>([]);
  const [activePatient, setActivePatient] = useState<Patient | null>(null);

  // Form answer state
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [savedConsultationId, setSavedConsultationId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Medication reference state
  const [showMeds, setShowMeds] = useState(false);
  const [medications, setMedications] = useState<MedicationReference[]>([]);
  const [medSearch, setMedSearch] = useState('');
  const [medLoading, setMedLoading] = useState(false);

  // 1. Load patients and existing saved answers for this template
  useEffect(() => {
    let isCancelled = false;

    async function loadData() {
      try {
        const [patientsData, consultationsData] = await Promise.all([
          api.getPatients().catch(() => [] as Patient[]),
          api.getConsultations({ template_id: template.id }).catch(() => [])
        ]);

        if (isCancelled) return;

        let selectedPatient: Patient | null = null;
        if (patientsData && patientsData.length > 0) {
          setPatients(patientsData);
          selectedPatient = patientsData[0];
          setActivePatient(patientsData[0]);
        }

        // Check if there are previously saved responses for this template
        if (consultationsData && consultationsData.length > 0) {
          const latest = consultationsData[0];
          setSavedConsultationId(latest.id);

          if (latest.patient_id && patientsData) {
            const matchedPatient = patientsData.find((p) => p.id === latest.patient_id);
            if (matchedPatient) {
              selectedPatient = matchedPatient;
              setActivePatient(matchedPatient);
            }
          }

          // Populate answers from saved consultation responses
          if (Array.isArray(latest.responses) && latest.responses.length > 0) {
            const loadedAnswers: Record<number, string> = {};
            latest.responses.forEach((r: any) => {
              if (r.component_id) {
                loadedAnswers[r.component_id] = r.response_value ?? '';
              }
            });
            setAnswers(loadedAnswers);
            return;
          }
        }

        // If no saved responses exist, seed default values
        const initial: Record<number, string> = {};
        allComponents.forEach((c) => {
          if (c.id) {
            if (c.default_value) {
              initial[c.id] = selectedPatient
                ? fillPatientPlaceholders(c.default_value, selectedPatient)
                : c.default_value;
            } else if (c.component_type === 'Notes' || c.component_type === 'Textarea') {
              if (c.placeholder && c.placeholder.includes('${patient.') && selectedPatient) {
                initial[c.id] = fillPatientPlaceholders(c.placeholder, selectedPatient);
              }
            }
          }
        });
        setAnswers(initial);
      } catch (err) {
        console.error('Error loading template form data:', err);
      }
    }

    loadData();

    return () => {
      isCancelled = true;
    };
  }, [template.id, allComponents]);

  // Load medications when medication reference is expanded
  useEffect(() => {
    if (showMeds && medications.length === 0) {
      setMedLoading(true);
      api.getMedications({ category: template.category })
        .then((data) => setMedications(data))
        .catch(() => {
          // Fallback to all medications
          api.getMedications().then(setMedications).catch(() => {});
        })
        .finally(() => setMedLoading(false));
    }
  }, [showMeds, medications.length, template.category]);

  // Handle patient switch
  const handlePatientChange = (patientId: number) => {
    const selected = patients.find((p) => p.id === patientId);
    if (!selected) return;
    setActivePatient(selected);

    // Refresh placeholders in text fields if they are currently unedited or contain old patient info
    setAnswers((prev) => {
      const updated = { ...prev };
      allComponents.forEach((c) => {
        if (c.id && (c.component_type === 'Notes' || c.component_type === 'Textarea')) {
          if (c.placeholder && c.placeholder.includes('${patient.')) {
            updated[c.id] = fillPatientPlaceholders(c.placeholder, selected);
          }
        }
      });
      return updated;
    });
  };

  // Handle interactive answer change with automatic branch pruning
  const handleAnswerChange = useCallback(
    (componentId: number, value: string) => {
      setAnswers((prev) => {
        const updated = { ...prev, [componentId]: value };
        const { hidden } = computeVisibility(allComponents, template.relationships || [], updated);
        return pruneHiddenAnswers(updated, hidden);
      });
      if (validationError) setValidationError(null);
      if (saveSuccess) setSaveSuccess(false);
    },
    [allComponents, template.relationships, validationError, saveSuccess]
  );

  // Validate and Save Answers to Database
  const handleSave = async (exitAfterSave = false) => {
    const { visible } = computeVisibility(allComponents, template.relationships || [], answers);
    const missingRequired = allComponents.filter(
      (c) => c.id && visible.has(c.id) && (c.is_mandatory || (c as any).is_required) && !answers[c.id]?.trim()
    );

    if (missingRequired.length > 0) {
      setValidationError(
        `Please complete required question(s): ${missingRequired.map((m) => m.label).join(', ')}`
      );
      window.scrollTo({ top: 120, behavior: 'smooth' });
      return;
    }

    setValidationError(null);
    setSaving(true);

    try {
      const responsesPayload = allComponents
        .filter((c) => c.id && visible.has(c.id) && answers[c.id] !== undefined && answers[c.id] !== '')
        .map((c) => ({
          component_id: c.id!,
          component_label: c.label,
          response_value: answers[c.id!]
        }));

      const patientId = activePatient?.id || (patients[0]?.id ?? 1);

      if (savedConsultationId) {
        // Update existing saved consultation
        await api.updateConsultation(savedConsultationId, {
          patient_id: patientId,
          notes: `Updated clinical assessment for ${activePatient?.full_name || 'Patient'}. ${responsesPayload.length} fields recorded.`,
          responses: responsesPayload
        });
      } else {
        // Create new consultation response
        const res = await api.saveConsultation({
          patient_id: patientId,
          template_id: template.id,
          doctor_name: currentUser?.full_name || 'Dr. Sanjana K',
          notes: `Clinical assessment completed for ${activePatient?.full_name || 'Patient'}. ${responsesPayload.length} questions recorded.`,
          responses: responsesPayload
        });
        setSavedConsultationId(res.consultation_id);
      }

      setSaveSuccess(true);

      if (exitAfterSave) {
        onBack();
      } else {
        window.scrollTo({ top: 180, behavior: 'smooth' });
      }
    } catch (err) {
      console.error('Save error:', err);
      alert('Failed to save template response. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Reset form answers
  const handleReset = () => {
    if (window.confirm('Reset all entered responses for this template?')) {
      const initial: Record<number, string> = {};
      allComponents.forEach((c) => {
        if (c.id && c.default_value) {
          initial[c.id] = activePatient
            ? fillPatientPlaceholders(c.default_value, activePatient)
            : c.default_value;
        }
      });
      setAnswers(initial);
      setSaveSuccess(false);
      setValidationError(null);
    }
  };

  const { visible } = useMemo(
    () => computeVisibility(allComponents, template.relationships || [], answers),
    [allComponents, template.relationships, answers]
  );

  const visibleQuestions = allComponents.filter(
    (c) => typeof c.id === 'number' && visible.has(c.id) && c.component_type !== 'Heading'
  );
  const answeredCount = visibleQuestions.filter((c) => Boolean(answers[c.id as number])).length;
  const progressPercent =
    visibleQuestions.length > 0 ? Math.round((answeredCount / visibleQuestions.length) * 100) : 0;

  const filteredMeds = useMemo(() => {
    const q = medSearch.trim().toLowerCase();
    if (!q) return medications;
    return medications.filter((m) =>
      [m.medication_name, m.generic_name, m.condition_name, m.category, m.instructions]
        .filter(Boolean)
        .some((t) => String(t).toLowerCase().includes(q))
    );
  }, [medications, medSearch]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Top action bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '20px',
          flexWrap: 'wrap',
          gap: '12px'
        }}
      >
        <button
          type="button"
          className="btn-secondary"
          onClick={onBack}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '7px 14px',
            fontSize: '13px',
            cursor: 'pointer'
          }}
        >
          <ArrowLeft size={16} /> Back to Templates
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onEdit(template)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 16px',
              fontSize: '13.5px',
              cursor: 'pointer'
            }}
          >
            <Edit size={15} /> Edit Template
          </button>

          <button
            type="button"
            className="btn-orange"
            onClick={() => handleSave(false)}
            disabled={saving}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 20px',
              fontSize: '13.5px',
              fontWeight: 600,
              backgroundColor: '#ea580c',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.7 : 1
            }}
          >
            <Save size={15} /> {saving ? 'Saving...' : 'Save'}
          </button>

          <button
            type="button"
            onClick={() => handleSave(true)}
            disabled={saving}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 16px',
              fontSize: '13.5px',
              fontWeight: 600,
              backgroundColor: '#0288d1',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              cursor: saving ? 'not-allowed' : 'pointer'
            }}
          >
            Save &amp; Exit
          </button>
        </div>
      </div>

      {/* Template Metadata card */}
      <div
        style={{
          backgroundColor: '#ffffff',
          border: '1px solid #d1d5db',
          borderRadius: '6px',
          padding: '20px 24px',
          marginBottom: '20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#111827', margin: 0 }}>
                {template.name}
              </h1>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  backgroundColor: '#fff7ed',
                  color: '#c2410c',
                  border: '1px solid #fed7aa',
                  padding: '2px 8px',
                  borderRadius: '12px'
                }}
              >
                {template.template_type}
              </span>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  backgroundColor: template.is_active ? '#ecfdf5' : '#fef2f2',
                  color: template.is_active ? '#047857' : '#b91c1c',
                  border: '1px solid',
                  borderColor: template.is_active ? '#a7f3d0' : '#fecaca',
                  padding: '2px 8px',
                  borderRadius: '12px'
                }}
              >
                {template.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
            <p style={{ fontSize: '13.5px', color: '#4b5563', margin: 0 }}>
              {template.description || 'Quadrant-based clinical assessment and documentation.'}
            </p>
          </div>
        </div>

        {/* Details Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '16px',
            paddingTop: '16px',
            borderTop: '1px solid #f3f4f6',
            fontSize: '13px'
          }}
        >
          <div>
            <span style={{ color: '#6b7280', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }}>
              <FileText size={14} /> Specialty / Category
            </span>
            <span style={{ fontWeight: 600, color: '#1f2937' }}>
              {template.category || template.specialty || 'General Medicine'}
            </span>
          </div>

          <div>
            <span style={{ color: '#6b7280', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }}>
              <Tag size={14} /> Tags
            </span>
            <span style={{ fontWeight: 600, color: '#1f2937' }}>
              {template.tags || 'General Clinical'}
            </span>
          </div>

          <div>
            <span style={{ color: '#6b7280', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }}>
              <Layers size={14} /> Sections &amp; Components
            </span>
            <span style={{ fontWeight: 600, color: '#1f2937' }}>
              {sectionsCount} Sections, {componentsCount} Fields
            </span>
          </div>

          <div>
            <span style={{ color: '#6b7280', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }}>
              <Shield size={14} /> Accessible To
            </span>
            <span style={{ fontWeight: 600, color: '#1f2937' }}>
              {template.accessible_to || 'Physician'}
            </span>
          </div>

          <div>
            <span style={{ color: '#6b7280', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }}>
              <Calendar size={14} /> Last Updated
            </span>
            <span style={{ fontWeight: 600, color: '#1f2937' }}>
              {template.updated_at ? new Date(template.updated_at).toLocaleDateString() : 'Recent'}
            </span>
          </div>
        </div>
      </div>

      {/* Patient Context Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '6px',
          padding: '10px 16px',
          marginBottom: '20px',
          flexWrap: 'wrap',
          gap: '12px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              backgroundColor: '#e0f2fe',
              color: '#0288d1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '13px'
            }}
          >
            <User size={16} />
          </div>
          <div>
            <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#1e293b' }}>
              {activePatient ? (
                <>
                  {activePatient.full_name}{' '}
                  <span style={{ fontWeight: 400, color: '#64748b' }}>
                    ({activePatient.mrn}) • {activePatient.age} yrs • {activePatient.gender}
                  </span>
                </>
              ) : (
                'Clinical Patient Record'
              )}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b' }}>
              {activePatient?.condition_history || 'Heal Your Heart Clinic, Neelankarai, Chennai'}
            </div>
          </div>
        </div>

        {patients.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label htmlFor="patient-select" style={{ fontSize: '12.5px', color: '#64748b', fontWeight: 500 }}>
              Select Patient:
            </label>
            <select
              id="patient-select"
              value={activePatient?.id || ''}
              onChange={(e) => handlePatientChange(Number(e.target.value))}
              style={{
                padding: '5px 10px',
                fontSize: '13px',
                borderRadius: '4px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                cursor: 'pointer'
              }}
            >
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name} ({p.mrn}) - {p.gender}, {p.age}y
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Validation Error Message */}
      {validationError && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
            borderRadius: '6px',
            padding: '12px 16px',
            marginBottom: '20px',
            fontSize: '13.5px'
          }}
        >
          <AlertCircle size={18} />
          <span>{validationError}</span>
        </div>
      )}

      {/* Save Success Message */}
      {saveSuccess && (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: '#ecfdf5',
            border: '1px solid #a7f3d0',
            color: '#047857',
            borderRadius: '6px',
            padding: '12px 16px',
            marginBottom: '20px',
            fontSize: '13.5px',
            fontWeight: 500
          }}
        >
          <CheckCircle size={18} />
          <span>Template response saved successfully. Previous responses are stored in the database.</span>
        </div>
      )}

      {/* Interactive Clinical Template Form Card */}
      <div
        style={{
          backgroundColor: '#ffffff',
          border: '1px solid #d1d5db',
          borderRadius: '6px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          overflow: 'hidden',
          marginBottom: '24px'
        }}
      >
        {/* Card Header: CLINICAL TEMPLATE */}
        <div
          style={{
            backgroundColor: '#f9fafb',
            borderBottom: '1px solid #e5e7eb',
            padding: '14px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px'
          }}
        >
          <div>
            <span
              style={{
                fontSize: '15px',
                fontWeight: 700,
                color: '#111827',
                letterSpacing: '0.4px',
                display: 'block'
              }}
            >
              CLINICAL TEMPLATE
            </span>
            <span style={{ fontSize: '12.5px', color: '#6b7280' }}>
              Fill and record clinical findings directly below. Answers persist to the database.
            </span>
          </div>

          <div
            style={{
              padding: '4px 12px',
              borderRadius: '12px',
              backgroundColor: progressPercent === 100 ? '#ecfdf5' : '#f0f9ff',
              color: progressPercent === 100 ? '#047857' : '#0369a1',
              fontSize: '12.5px',
              fontWeight: 600,
              border: `1px solid ${progressPercent === 100 ? '#a7f3d0' : '#bae6fd'}`
            }}
          >
            {answeredCount} / {visibleQuestions.length} fields completed ({progressPercent}%)
          </div>
        </div>

        {/* Live Form Renderer */}
        <div style={{ padding: '24px' }}>
          <ClinicalFormRenderer
            template={template}
            answers={answers}
            onAnswer={handleAnswerChange}
            disabled={saving}
          />
        </div>
      </div>

      {/* Common Medication Reference (Clinician Reference Only) */}
      <div
        style={{
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '6px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          overflow: 'hidden',
          marginBottom: '24px'
        }}
      >
        <button
          type="button"
          onClick={() => setShowMeds((prev) => !prev)}
          style={{
            width: '100%',
            backgroundColor: '#f8fafc',
            border: 'none',
            padding: '12px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            textAlign: 'left'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Pill size={16} color="#ea580c" />
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>
              Common Medication Reference (Clinician Reference Only)
            </span>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: '#64748b',
                backgroundColor: '#e2e8f0',
                padding: '2px 8px',
                borderRadius: '10px'
              }}
            >
              Non-prescriptive
            </span>
          </div>
          {showMeds ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {showMeds && (
          <div style={{ padding: '16px 20px', borderTop: '1px solid #e2e8f0' }}>
            <div
              style={{
                backgroundColor: '#fffbeb',
                border: '1px solid #fef3c7',
                borderRadius: '4px',
                padding: '8px 12px',
                fontSize: '12.5px',
                color: '#92400e',
                marginBottom: '12px'
              }}
            >
              <strong>Safety Disclaimer:</strong> This table is a clinician-editable reference list. It does not automatically prescribe medications or calculate doses.
            </div>

            <div style={{ marginBottom: '12px', maxWidth: '350px' }}>
              <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #cbd5e1', borderRadius: '4px', padding: '4px 8px' }}>
                <Search size={14} color="#94a3b8" style={{ marginRight: '6px' }} />
                <input
                  type="text"
                  placeholder="Search medication or instructions..."
                  value={medSearch}
                  onChange={(e) => setMedSearch(e.target.value)}
                  style={{ border: 'none', outline: 'none', fontSize: '13px', width: '100%' }}
                />
              </div>
            </div>

            {medLoading ? (
              <p style={{ color: '#64748b', fontSize: '13px' }}>Loading medications...</p>
            ) : filteredMeds.length === 0 ? (
              <p style={{ color: '#64748b', fontSize: '13px' }}>No medications found matching search.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', border: '1px solid #e2e8f0' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '1px solid #cbd5e1', textAlign: 'left' }}>
                      <th style={{ padding: '7px 10px', fontWeight: 600 }}>Medication</th>
                      <th style={{ padding: '7px 10px', fontWeight: 600 }}>Generic Name</th>
                      <th style={{ padding: '7px 10px', fontWeight: 600 }}>Strength</th>
                      <th style={{ padding: '7px 10px', fontWeight: 600 }}>Form</th>
                      <th style={{ padding: '7px 10px', fontWeight: 600 }}>Route</th>
                      <th style={{ padding: '7px 10px', fontWeight: 600 }}>Frequency</th>
                      <th style={{ padding: '7px 10px', fontWeight: 600 }}>Duration</th>
                      <th style={{ padding: '7px 10px', fontWeight: 600 }}>Instructions / Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMeds.slice(0, 10).map((m, idx) => (
                      <tr key={m.id ?? idx} style={{ borderBottom: '1px solid #e2e8f0', backgroundColor: idx % 2 === 0 ? '#ffffff' : '#fcfcfd' }}>
                        <td style={{ padding: '6px 10px', fontWeight: 600, color: '#0f172a' }}>{m.medication_name}</td>
                        <td style={{ padding: '6px 10px', color: '#475569' }}>{m.generic_name}</td>
                        <td style={{ padding: '6px 10px' }}>{m.strength || '-'}</td>
                        <td style={{ padding: '6px 10px' }}>{m.form || 'Tablet'}</td>
                        <td style={{ padding: '6px 10px' }}>{m.route || 'Oral'}</td>
                        <td style={{ padding: '6px 10px' }}>{m.frequency || 'OD'}</td>
                        <td style={{ padding: '6px 10px' }}>{m.duration || 'As directed'}</td>
                        <td style={{ padding: '6px 10px', color: '#64748b' }}>{m.instructions || m.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Save & Exit Action Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#ffffff',
          border: '1px solid #d1d5db',
          borderRadius: '6px',
          padding: '16px 24px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          flexWrap: 'wrap',
          gap: '12px'
        }}
      >
        <button
          type="button"
          onClick={handleReset}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: 'transparent',
            border: 'none',
            color: '#64748b',
            fontSize: '13px',
            cursor: 'pointer'
          }}
        >
          <RotateCcw size={14} /> Reset Form Answers
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={onBack}
            style={{ padding: '8px 16px', fontSize: '13.5px', cursor: 'pointer' }}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={() => handleSave(true)}
            disabled={saving}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 18px',
              fontSize: '13.5px',
              fontWeight: 600,
              backgroundColor: '#0288d1',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              cursor: saving ? 'not-allowed' : 'pointer'
            }}
          >
            Save &amp; Exit
          </button>

          <button
            type="button"
            className="btn-orange"
            onClick={() => handleSave(false)}
            disabled={saving}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 24px',
              fontSize: '14px',
              fontWeight: 700,
              backgroundColor: '#ea580c',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              cursor: saving ? 'not-allowed' : 'pointer',
              boxShadow: '0 1px 3px rgba(234, 88, 12, 0.25)'
            }}
          >
            <Save size={16} /> {saving ? 'Saving...' : 'SAVE'}
          </button>
        </div>
      </div>
    </div>
  );
};
