import os
import sys

# Ensure backend root is on sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "backend"))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app import create_app
from app.database import init_db
from run import setup_and_seed

if __name__ == "__main__":
    setup_and_seed()
    app = create_app()
    print("=======================================================")
    print(" HEAL YOUR HEART - CLINICAL TEMPLATE MANAGEMENT ENGINE")
    print(" Neelankarai, Chennai, Tamil Nadu, India")
    print(" Backend running on http://127.0.0.1:5000")
    print("=======================================================")
    app.run(host="0.0.0.0", port=5000, debug=True)
