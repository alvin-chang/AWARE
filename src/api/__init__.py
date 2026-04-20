"""
src/api/__init__.py — Flask app entry point for the diary service.
"""
import os
import sys

# Ensure project src root is on path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask, jsonify, g
from flask_cors import CORS


def create_app():
    app = Flask(__name__)
    CORS(app)

    app.config["SECRET_KEY"] = os.environ.get("DIARY_SECRET", "dev-secret-change-in-production")

    from .routes.diary_bp import diary_bp
    app.register_blueprint(diary_bp)

    @app.route("/health")
    def health():
        return jsonify({"status": "ok"})

    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("DIARY_PORT", 5001))
    app.run(host="0.0.0.0", port=port, debug=False)
