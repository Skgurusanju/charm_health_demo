# charmhealth — Clinical Template Management & Horizontal Clinical Pathway

> **Demonstration Prototype for:**  
> **Heal Your Heart**  
> Neelankarai, Chennai, Tamil Nadu, India  
> *(Specializing in Non-Invasive EECP & Cardiac Care, with five locations across Tamil Nadu: Neelankarai (HUH001), Royapettah (HUH002), Manapakkam (HUH003), Madurai (005) and Tirunelveli (004))*

---

## 🌟 Overview & Core UX Innovation

This application replicates the exact UI/UX design, compact typography, color palette, and enterprise workflow of **CharmHealth / CharmEHR**, while solving the critical clinical challenge: **the endless vertical scrolling problem of nested hierarchical clinical questions**.

### Horizontal hierarchical options

Clinical templates nest their options - *Chest Pain? -> Yes -> CCS -> Class II*.
Drawn the traditional way each level is indented one row further down, so a
single question can occupy a dozen rows and a SOAP template runs for pages.

Here the levels run **left to right** instead:

```text
Chest Pain?
[ ] No   [x] Yes  →  [x] CCS  [ ] With Exertion  [ ] At Rest  →  [ ] Class I  [ ] Class II  …
```

The rules, in short:

- **Questions stay vertical; only the option levels inside a question go sideways.**
- **The checkbox is the disclosure.** A level is rendered only once the option
  above it is ticked, so there is never an empty child container, and no
  disclosure triangle to click. The `→` is a hierarchy indicator, not a control.
- **Depth is not capped.** The renderer recurses for as many levels as the
  template stores; a selected option with no children simply reveals nothing.
- **Un-ticking takes the subtree with it** - the descendants disappear *and*
  their selections are cleared, so a tick nobody can see is never submitted.
- **Only the option box scrolls sideways** (`.hopt-scroll`). The page, header
  and application shell never gain a horizontal scrollbar.
- **Branching is handled.** While one ticked option on a level has children the
  next level continues on the same line; when two ticked siblings both have
  children, each opens its own labelled line.

The same field is used everywhere option groups are drawn - the read-only
template viewer, the clinical preview and the consultation pathway - and the
answer keeps its existing comma-separated label format, so nothing changed in
the API or the database. Flat, non-hierarchical option groups are untouched.

Covered end to end by `frontend/scripts/hierarchy-check.mjs`.

### The Problem in Traditional EHRs:
```text
Chest Pain?
    ↓ (vertical expansion)
Yes
    ↓
Severity?
    ↓ (vertical expansion)
Heavy
    ↓
Classification?
    ↓ (vertical expansion)
CCS
    ↓
... Endless downward page scrolling ...
```

### The New Solution: Horizontal Progressive Disclosure Pathway
```text
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│   CHEST PAIN    │       │    SEVERITY     │       │ CLASSIFICATION  │       │     DETAILS     │
│                 │   ➔   │                 │   ➔   │                 │   ➔   │                 │
│  ○ No  ● Yes    │       │  ● Severe       │       │  ● With Exertion│       │ Location/Dur.   │
└─────────────────┘       └─────────────────┘       └─────────────────┘       └─────────────────┘
                                ← Horizontal Scroll Container Only →
```

- **Isolated Horizontal Container**: The webpage itself retains standard vertical scrolling. Only the dedicated clinical question stage scrolls horizontally.
- **Progressive Disclosure**: Child questions reveal dynamically only when parent trigger conditions are met.
- **Dynamic Pruning**: Changing a parent answer (e.g., changing *Chest Pain* from *Yes* to *No*) immediately hides downstream child questions and resets their values in the live narrative.
- **Live Sticky Patient Summary**: Displays real-time responses, progress count (`8 / 12 answered`), and generates a live SOAP clinical note preview.

---

## 🚀 Live Demo & Access

The application is running full-stack locally:

- **Frontend Vite Dev Server**: `http://localhost:5173`
- **Backend Flask API & Unified SPA**: `http://localhost:5000`

### Demo Account Credentials:
- **Email**: `sanju2kguru@gmail.com`
- **Password**: `password123`

The account screens are generic. Sign in runs in two steps: an *Email address
or mobile number*, then *Next*, then the password panel - which shows the
identifier with a **Change** link back, a reveal control on the password field,
and links for *Sign in using email OTP* and *Forgot Password?*. Create Account
asks only for First Name, Last Name, Email ID and a confirmed password. Forgot
Password takes the identifier, then *Continue*, then a new password and its
confirmation. Nothing anywhere asks whether the account holder is a clinician,
and the signed-in user is shown by plain name - never prefixed with "Dr." and
never labelled with a role, qualification or specialty.

---

## 📁 Key Features Implemented

1. **Exact CharmHealth Visual Replication**:
   - Signature **charmEHR logo** with yellow heart and purple person dot, magenta "charm", and orange "EHR".
   - Top Header with the clinic location switcher (*Neelankarai HUH001, Royapettah HUH002, Manapakkam HUH003, Madurai 005, Tirunelveli 004*) and the user account menu - the only two controls it carries.
   - Large rounded pill search bar: *"Search in Settings and perform actions"*.
   - Tab navigation (*My Templates*, *Practice Templates*, *Email Templates*, *CharmHealth Library*, *Common Medication*) with cyan active underline (`#00a2ae` / `#0288d1`). My Templates is the default tab.
   - Orange primary CTA buttons (`#f57c00` / `#f58220`).
   - Template Type dropdown carrying *All* plus all 34 types in the reference order (*Assessment Notes, Billing Procedure Codes, Billing Inventory, Chief Complaints, ... Treatment Notes, Vaccine*). Selecting a type filters the table.
   - Medical conditions live on the **Common Medication** tab only - never as chips under the template tabs. That tab has its own search over the condition catalogue, and picking a condition lists the templates that mention it.
   - Three-dot `[...]` action menu with all 8 operational actions (*View, Edit, Assign Roles, Default Values, Duplicate, Personalise, Share to Library, Delete*).
   - Green `"Default values configured"` badge.
   - Pagination (*1 - 25 of 47*) with Previous and Next controls.

2. **Full SOAP Template Creation Flow**:
   - `+ New Template` button opens modal.
   - Enter Template Name and choose `SOAP Template`.
   - Click `Proceed` ➔ opens **Add SOAP Sections modal** (*Subjective, Objective, Assessment, Plan*).
   - Click `Add` ➔ opens the **Visual Template Builder**.

3. **3-Part Template Builder**:
   - **Left Panel**: Component palette (*Heading, Check List, Simple Question, Single Choice, Multi Choice, Rating Scale, Yes/No Question, Notes, Table, Image, + Add Section*).
   - **Center Canvas**: Sections, component order management (Move Up / Down), deletion, and section categorization.
   - **Right Panel**: Question Properties & **Question Relationship Builder**:
     - Link `Parent Question` + `Trigger Answer` ➔ `Child Question to Reveal Horizontally`.
     - Supports saving new clinical templates directly into SQLite.

4. **Clinical Consultation & Fictional Patients**:
   - 5 pre-seeded fictional demo patients (*Rajesh Kumar, Meenakshi Sundaram, Ananthakrishnan V., Priya Swaminathan, K. Balaji*).
   - Full patient selector modal before consultation.
   - Dual-view toggle: **Horizontal Clinical Pathway** vs. **Vertical Stack (Old Way)** for side-by-side comparison during Chief Doctor demonstration.
   - Save consultation button with persistent SQLite database storage.

---

## 🏥 Pre-Seeded Clinical Templates (47 Templates)

### 1. Cardiology & EECP:
- Chest Pain Assessment (Horizontal Pathway Enabled)
- Angina Triage & Evaluation
- Heart Failure Management
- Coronary Artery Disease (CAD) Profile
- Palpitations Assessment
- Cardiac Edema & Fluid Retention
- Hypertension Management Note
- Cardiac Follow-up Summary
- EECP Initial Assessment & Candidacy
- EECP Eligibility Documentation
- EECP Daily Session Pressure Log
- EECP Treatment Progress Note
- EECP 35-Hour Treatment Summary
- EECP Routine Assessment

### 2. Respiratory:
- Respiratory Assessment
- Acute & Chronic Cough Evaluation
- Shortness of Breath (Dyspnea) Triage
- Bronchial Asthma Action Plan
- COPD Follow-up
- Wheezing Evaluation
- Respiratory Tract Infection Note
- Pneumonia Follow-up

### 3. General Medicine:
- Acute Fever Assessment
- Headache & Migraine Evaluation
- Chronic Fatigue & Weakness
- Dizziness & Vertigo Evaluation
- Acute Diarrhea Evaluation
- Abdominal Pain Triage
- Back Pain & Musculoskeletal Evaluation

### 4. Diabetes, Endocrine & Renal:
- Diabetes Mellitus Comprehensive Assessment
- Diabetic Routine Follow-up
- Thyroid Assessment & TSH Review
- Urinary Symptoms & UTI Evaluation
- Renal Profile & Kidney Disease Staging

### 5. Anesthesia & Surgery:
- Pre-Anesthesia Medical Evaluation
- Anesthesia Clearance Note
- Preoperative Cardiac Risk Assessment
- Post-Anesthesia Recovery Follow-up

### 6. Preventive, Lab & Imaging:
- Adult & Senior Vaccination Record
- Master Health Checkup Summary
- Routine Health Examination
- Comprehensive Metabolic Profile
- Cardiac Imaging & Echo Request

---

## 🛠️ Technology Stack & Architecture

```text
heal-your-heart-ehr/
├── backend/
│   ├── app/
│   │   ├── routes/
│   │   │   ├── auth.py          # Signup, Login, Forgot / Reset Password, Current User
│   │   │   ├── templates.py     # Template CRUD, Roles, Defaults, Duplicate
│   │   │   ├── search.py        # Dedicated fuzzy condition search
│   │   │   ├── patients.py      # Demo patient list & details
│   │   │   └── responses.py     # Consultation save & response retrieval
│   │   ├── seed/
│   │   │   └── seed_data.py     # 47 seeded templates & demo patients
│   │   ├── config.py
│   │   ├── database.py          # SQLite schema & connection pooling
│   │   └── __init__.py          # Flask app & static SPA serving
│   ├── ehr_templates.db         # SQLite persistent database
│   └── run.py                   # Backend entrypoint (Port 5000)
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── auth/            # Login.tsx, Signup.tsx, ForgotPassword.tsx
│   │   │   ├── builder/         # TemplateBuilder.tsx (3-panel)
│   │   │   ├── common/          # GlobalSearch.tsx, TemplateTypeSelect.tsx, ThreeDotMenu.tsx
│   │   │   ├── consultation/    # ConsultationScreen.tsx, PatientSelectModal.tsx
│   │   │   ├── layout/          # Header.tsx, TemplateTabs.tsx
│   │   │   ├── modals/          # NewTemplateModal.tsx, SoapSectionModal.tsx, etc.
│   │   │   ├── options/         # HorizontalOptionTree.tsx, NestedOptionField.tsx,
│   │   │   │                    #   optionSelection.ts - the sideways hierarchy
│   │   │   ├── pathway/         # HorizontalPathway.tsx (Core UX Innovation)
│   │   │   └── templates/       # My / Practice / Email / Library tables,
│   │   │   │                    #   CommonMedicationPanel.tsx
│   │   ├── styles/
│   │   │   ├── charm-theme.css  # CharmHealth exact color & font tokens
│   │   │   ├── my-templates.css # Workspace, table & Common Medication tab
│   │   │   ├── auth.css         # Login / Create Account / Forgot Password
│   │   │   ├── option-tree.css  # Horizontal hierarchical options (hopt-*)
│   │   │   └── pathway.css      # Horizontal pathway layout & animations
│   │   ├── types/               # TypeScript data models
│   │   ├── services/api.ts      # REST API client
│   │   └── App.tsx              # Main orchestrator
│   └── vite.config.ts           # Vite dev server with /api proxy (Port 5173)
└── README.md
```

---

## ⚡ Running Locally

### 1. Run the Backend:
```bash
cd backend
python run.py
```
*Backend initializes SQLite database tables, runs seed script, and listens on `http://127.0.0.1:5000`.*

### 2. Run the Frontend:
```bash
cd frontend
npm install
npm run dev
```
*Vite dev server starts on `http://localhost:5173` with instant proxy to backend `/api`.*

*(Alternatively, run `npm run build` once, and `python run.py` will serve both the backend API and the frontend SPA from `http://127.0.0.1:5000`!)*
