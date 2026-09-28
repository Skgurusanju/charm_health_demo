import os
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from .config import Config
from .database import init_db
from .routes.auth import auth_bp
from .routes.templates import templates_bp
from .routes.search import search_bp
from .routes.patients import patients_bp
from .routes.responses import responses_bp
from .routes.medications import medications_bp

def create_app(config_class=Config):
    frontend_dist = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist"))

    if os.path.exists(frontend_dist):
        app = Flask(__name__, static_folder=frontend_dist, static_url_path="")
    else:
        app = Flask(__name__)

    app.config.from_object(config_class)

    # Enable CORS for frontend Vite dev server (port 5173 / localhost)
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    # Register blueprints under /api
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(templates_bp, url_prefix="/api")
    app.register_blueprint(search_bp, url_prefix="/api")
    app.register_blueprint(patients_bp, url_prefix="/api")
    app.register_blueprint(responses_bp, url_prefix="/api")
    app.register_blueprint(medications_bp, url_prefix="/api")

    # API errors return JSON, never an HTML debugger page or a stack trace.
    @app.errorhandler(Exception)
    def handle_api_exception(err):
        from werkzeug.exceptions import HTTPException

        if not request.path.startswith("/api/"):
            raise err

        if isinstance(err, HTTPException):
            return jsonify({
                "error": err.name,
                "message": err.description,
            }), err.code

        app.logger.exception("Unhandled API error on %s", request.path)
        return jsonify({
            "error": "Internal server error",
            "message": "Something went wrong while processing this request. Please try again.",
        }), 500

    @app.route("/api/health", methods=["GET"])
    def health_check():
        return jsonify({
            "status": "online",
            "service": "Heal Your Heart EHR Template Engine",
            "branch": "Neelankarai, Chennai, Tamil Nadu, India"
        })

    # Catch-all route for serving Vite React SPA
    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_frontend(path):
        if os.path.exists(frontend_dist):
            if path != "" and os.path.exists(os.path.join(frontend_dist, path)):
                return send_from_directory(frontend_dist, path)
            return send_from_directory(frontend_dist, "index.html")
        return jsonify({"message": "Frontend build not found, please build frontend."}), 404

    return app
