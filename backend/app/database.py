import sqlite3
import os
from .config import DATABASE_PATH

def get_db_connection():
    conn = sqlite3.connect(DATABASE_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA busy_timeout = 30000;")
    return conn

get_db = get_db_connection

def init_db():
    conn = get_db_connection()
    conn.execute("PRAGMA journal_mode = WAL;")
    cursor = conn.cursor()

    # Users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            full_name TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'Physician',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    ''')

    # Roles table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            role_name TEXT UNIQUE NOT NULL,
            description TEXT
        );
    ''')

    # Templates table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            template_type TEXT NOT NULL,
            specialty TEXT NOT NULL DEFAULT 'General Medicine',
            category TEXT,
            description TEXT,
            content TEXT DEFAULT '',
            tags TEXT DEFAULT '',
            is_active INTEGER NOT NULL DEFAULT 1,
            is_practice INTEGER DEFAULT 1,
            is_library INTEGER DEFAULT 0,
            created_by TEXT DEFAULT 'Dr. Rajagopal, MD',
            owner_email TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    ''')

    # Template Sections
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS template_sections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            category TEXT DEFAULT 'Subjective',
            order_index INTEGER DEFAULT 0,
            column_layout INTEGER DEFAULT 1,
            FOREIGN KEY (template_id) REFERENCES templates (id) ON DELETE CASCADE
        );
    ''')

    # Template Components
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS template_components (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            section_id INTEGER NOT NULL,
            component_type TEXT NOT NULL,
            label TEXT NOT NULL,
            placeholder TEXT,
            is_required INTEGER DEFAULT 0,
            default_value TEXT,
            order_index INTEGER DEFAULT 0,
            column_count INTEGER DEFAULT 3,
            help_text TEXT,
            config TEXT,
            FOREIGN KEY (section_id) REFERENCES template_sections (id) ON DELETE CASCADE
        );
    ''')

    # Template Options
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS template_options (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            component_id INTEGER NOT NULL,
            option_label TEXT NOT NULL,
            option_value TEXT NOT NULL,
            order_index INTEGER DEFAULT 0,
            parent_option_id INTEGER,
            is_selected INTEGER DEFAULT 0,
            is_expandable INTEGER DEFAULT 0,
            FOREIGN KEY (component_id) REFERENCES template_components (id) ON DELETE CASCADE,
            FOREIGN KEY (parent_option_id) REFERENCES template_options (id) ON DELETE CASCADE
        );
    ''')

    # Horizontal Pathway Relationships (Parent -> Trigger -> Child)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS template_relationships (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_id INTEGER NOT NULL,
            parent_component_id INTEGER NOT NULL,
            trigger_value TEXT NOT NULL,
            child_component_id INTEGER NOT NULL,
            FOREIGN KEY (template_id) REFERENCES templates (id) ON DELETE CASCADE,
            FOREIGN KEY (parent_component_id) REFERENCES template_components (id) ON DELETE CASCADE,
            FOREIGN KEY (child_component_id) REFERENCES template_components (id) ON DELETE CASCADE
        );
    ''')

    # Template Permissions (Role Access)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS template_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_id INTEGER NOT NULL,
            role_name TEXT NOT NULL,
            FOREIGN KEY (template_id) REFERENCES templates (id) ON DELETE CASCADE
        );
    ''')

    # Patients table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS patients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mrn TEXT UNIQUE NOT NULL,
            full_name TEXT NOT NULL,
            age INTEGER NOT NULL,
            gender TEXT NOT NULL,
            phone TEXT,
            email TEXT,
            condition_history TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    ''')

    # Consultations
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS consultations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            template_id INTEGER NOT NULL,
            doctor_name TEXT DEFAULT 'Dr. Rajagopal, MD',
            status TEXT DEFAULT 'Completed',
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE,
            FOREIGN KEY (template_id) REFERENCES templates (id) ON DELETE CASCADE
        );
    ''')

    # Template Responses
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS template_responses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            consultation_id INTEGER NOT NULL,
            component_id INTEGER NOT NULL,
            component_label TEXT,
            response_value TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (consultation_id) REFERENCES consultations (id) ON DELETE CASCADE
        );
    ''')

    # Common Medication References
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS medication_references (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            condition_key TEXT NOT NULL,
            condition_name TEXT NOT NULL,
            category TEXT NOT NULL,
            medication_name TEXT NOT NULL,
            generic_name TEXT NOT NULL,
            form TEXT DEFAULT 'Tablet',
            strength TEXT DEFAULT '',
            route TEXT DEFAULT 'Oral',
            frequency TEXT DEFAULT 'Once daily',
            duration TEXT DEFAULT '5 days',
            instructions TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    ''')

    cursor.execute("CREATE INDEX IF NOT EXISTS idx_med_condition ON medication_references (condition_key);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_med_name ON medication_references (medication_name);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_med_category ON medication_references (category);")

    conn.commit()
    conn.close()
    print("Database tables initialized successfully.")

    run_migrations()


# ---------------------------------------------------------------------------
# Schema migrations
#
# Every migration here is ADDITIVE and IDEMPOTENT: columns are only created
# when absent and backfills only touch NULL / legacy values. Existing rows,
# including user-created templates, are never dropped or overwritten.
# ---------------------------------------------------------------------------

DEFAULT_OWNER_EMAIL = "sanju2kguru@gmail.com"

# table -> [(column name, DDL fragment)] appended to "ALTER TABLE <t> ADD COLUMN"
COLUMN_MIGRATIONS = {
    "templates": [
        ("category", "TEXT"),
        ("content", "TEXT"),
        ("tags", "TEXT"),
        ("is_active", "INTEGER NOT NULL DEFAULT 1"),
        ("owner_email", "TEXT"),
    ],
    # Per-component layout hints used by the clinical template viewer:
    # how many columns a choice grid uses, and the small parenthetical hint
    # rendered next to a label.
    "template_components": [
        ("column_count", "INTEGER DEFAULT 3"),
        ("help_text", "TEXT"),
        ("config", "TEXT"),
    ],
    # Option nesting drives the hierarchical checkbox trees (for example
    # Chest Pain? -> Yes -> CCS -> Class I..IV). `is_selected` stores the
    # pre-ticked state shown in a saved template; `is_expandable` marks a
    # node that renders a disclosure triangle even when collapsed.
    "template_options": [
        ("parent_option_id", "INTEGER"),
        ("is_selected", "INTEGER DEFAULT 0"),
        ("is_expandable", "INTEGER DEFAULT 0"),
    ],
}


def _existing_columns(cursor, table):
    cursor.execute(f"PRAGMA table_info({table});")
    return {row["name"] for row in cursor.fetchall()}


def run_migrations():
    """Bring an existing ehr_templates.db up to the current schema in place."""
    conn = get_db_connection()
    cursor = conn.cursor()
    applied = []

    for table, columns in COLUMN_MIGRATIONS.items():
        existing = _existing_columns(cursor, table)
        for column, ddl in columns:
            if column not in existing:
                cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl};")
                applied.append(f"{table}.{column}")

    # Backfill: category mirrors the pre-existing specialty value so no
    # template shows a blank Category badge in the My Templates table.
    cursor.execute("""
        UPDATE templates
        SET category = specialty
        WHERE category IS NULL OR TRIM(category) = '';
    """)

    cursor.execute("UPDATE templates SET is_active = 1 WHERE is_active IS NULL;")
    cursor.execute("UPDATE templates SET tags = '' WHERE tags IS NULL;")
    cursor.execute("UPDATE templates SET content = '' WHERE content IS NULL;")

    # Pre-existing seeded templates belong to the demo physician so the
    # My Templates tab is populated on first run.
    cursor.execute(
        "UPDATE templates SET owner_email = ? WHERE owner_email IS NULL OR TRIM(owner_email) = '';",
        (DEFAULT_OWNER_EMAIL,),
    )

    # Normalise the one legacy spelling that differs from the canonical list.
    cursor.execute("UPDATE templates SET template_type = 'Follow up' WHERE template_type = 'Follow Up';")

    # Indexes backing the My Templates filters.
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_templates_type ON templates (template_type);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_templates_category ON templates (category);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_templates_owner ON templates (owner_email);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_templates_active ON templates (is_active);")
    # Backs the option-tree lookup performed when rendering a template.
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_options_parent ON template_options (parent_option_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_options_component ON template_options (component_id);")

    # Choice grids default to 3 columns, matching the reference layout.
    cursor.execute("UPDATE template_components SET column_count = 3 WHERE column_count IS NULL;")

    conn.commit()
    conn.close()

    if applied:
        print(f"Applied schema migrations: {', '.join(applied)}")
    else:
        print("Schema already up to date - no migrations needed.")

    return applied
