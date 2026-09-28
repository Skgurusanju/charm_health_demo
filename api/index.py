import os
import sys
import shutil
import sqlite3

# Ensure backend root is on sys.path
root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
backend_dir = os.path.join(root_dir, "backend")

if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from app import create_app
from app.config import DATABASE_PATH, DEFAULT_DB_PATH
from app.seed import setup_and_seed

def _ensure_database_initialized():
    """
    Ensure the SQLite database has tables and initial seed data.
    Runs ONCE at serverless cold start/initialization, NEVER inside request handlers.
    """
    # If using /tmp and it doesn't exist, but bundled DB exists, fast copy it
    if DATABASE_PATH != DEFAULT_DB_PATH and not os.path.exists(DATABASE_PATH):
        if os.path.exists(DEFAULT_DB_PATH) and os.path.getsize(DEFAULT_DB_PATH) > 0:
            try:
                shutil.copyfile(DEFAULT_DB_PATH, DATABASE_PATH)
                return
            except Exception as e:
                print(f"[api/index.py] Note: Could not copy default DB to {DATABASE_PATH}: {e}")

    needs_seed = False
    try:
        if not os.path.exists(DATABASE_PATH) or os.path.getsize(DATABASE_PATH) == 0:
            needs_seed = True
        else:
            conn = sqlite3.connect(DATABASE_PATH)
            cursor = conn.cursor()
            cursor.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='templates';")
            row = cursor.fetchone()
            if not row or row[0] == 0:
                needs_seed = True
            else:
                cursor.execute("SELECT COUNT(*) FROM templates;")
                count = cursor.fetchone()[0]
                if count == 0:
                    needs_seed = True
            conn.close()
    except Exception as e:
        print(f"[api/index.py] Database check exception: {e}")
        needs_seed = True

    if needs_seed:
        try:
            setup_and_seed()
        except Exception as seed_err:
            print(f"[api/index.py] Seed execution exception: {seed_err}")

# Cold start initialization
_ensure_database_initialized()

# Create Flask application instance for WSGI serverless runtime
app = create_app()
