import os
import sys

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from app import create_app
from app.database import init_db, run_migrations
from app.seed.seed_data import seed_database
from app.seed.demo_templates import seed_missing_demo_templates
from app.seed.reference_templates import seed_reference_templates
from app.seed.practice_catalog import seed_practice_catalog
from app.seed.all_clinical_templates import seed_all_clinical_templates
from app.seed.medication_seed import seed_medication_references
import sqlite3
from app.config import DATABASE_PATH

def setup_and_seed():
    # init_db() creates any missing tables and then runs the additive
    # schema migrations, so an existing database is upgraded in place.
    init_db()

    # Check if templates table has data
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM templates;")
    count = cursor.fetchone()[0]
    conn.close()

    if count == 0:
        print("Database is empty. Running initial seed data...")
        seed_database()
        # Backfill category / owner_email on the freshly seeded rows.
        run_migrations()
    else:
        print(f"Database already contains {count} templates.")

    # Additive top-up: inserts only demo templates that are missing by name,
    # so every template type stays represented without ever overwriting a
    # user-created template.
    seed_missing_demo_templates()

    # Structured clinical templates used by the template viewer. Also
    # additive: creates what is missing, never overwrites an authored one.
    seed_reference_templates()

    # Make the Practice Templates list exactly the clinic's 57 templates.
    # Non-catalogue rows are un-flagged, never deleted.
    seed_practice_catalog()

    # Populate complete clinical sections, progressive options, components,
    # and questions for all 14 categories and 59+ templates so no template is empty!
    seed_all_clinical_templates()

    # Seed common medications clinical reference catalog
    seed_medication_references()

if __name__ == "__main__":
    setup_and_seed()
    app = create_app()
    print("=======================================================")
    print(" HEAL YOUR HEART - CLINICAL TEMPLATE MANAGEMENT ENGINE")
    print(" Neelankarai, Chennai, Tamil Nadu, India")
    print(" Backend running on http://127.0.0.1:5000")
    print("=======================================================")
    app.run(host="0.0.0.0", port=5000, debug=True)
