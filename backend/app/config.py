import os

BASE_DIR = os.path.abspath(os.path.dirname(os.path.dirname(__file__)))
DATABASE_PATH = os.path.join(BASE_DIR, "ehr_templates.db")

class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "heal-your-heart-secret-key-2026")
    DATABASE = DATABASE_PATH
    DEBUG = True
