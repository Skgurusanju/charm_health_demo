import os

BASE_DIR = os.path.abspath(os.path.dirname(os.path.dirname(__file__)))
DEFAULT_DB_PATH = os.path.join(BASE_DIR, "ehr_templates.db")

# Detect serverless environment (Vercel / Lambda) where root filesystem is read-only
_is_serverless = bool(os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))
_default_serverless_db = os.path.join(os.environ.get("TMPDIR", "/tmp"), "ehr_templates.db")

DATABASE_PATH = os.environ.get(
    "DATABASE_PATH",
    _default_serverless_db if _is_serverless else DEFAULT_DB_PATH
)

# Ensure parent directory exists for SQLite database file
_db_dir = os.path.dirname(DATABASE_PATH)
if _db_dir and not os.path.exists(_db_dir):
    try:
        os.makedirs(_db_dir, exist_ok=True)
    except Exception:
        pass

class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "heal-your-heart-secret-key-2026")
    DATABASE = DATABASE_PATH
    DEBUG = os.environ.get("FLASK_DEBUG", "0").lower() in ("1", "true")
