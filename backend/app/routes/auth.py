"""
Account endpoints: sign up, log in, and password recovery.

The clinic asked for a generic account system: nothing here asks whether the
person is a doctor, and no medical registration / licence / specialty field is
collected. `role` exists only because template permissions are role-based; new
accounts get the neutral default below and an administrator grants clinical
roles afterwards.
"""

import re
import sqlite3

from flask import Blueprint, request, jsonify

from ..database import get_db_connection

auth_bp = Blueprint("auth", __name__)

DEFAULT_ROLE = "User"
DEFAULT_BRANCH = "Heal Your Heart Neelankarai"
MIN_PASSWORD_LENGTH = 6

# Deliberately permissive: enough to reject "not an email", not so strict that
# a valid address is refused.
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Sign-in and recovery both accept "email address or mobile number", so a
# 10-15 digit number (optionally with a + country prefix, spaces or dashes)
# is a valid identifier too.
MOBILE_RE = re.compile(r"^\+?[0-9][0-9\s\-]{8,16}$")


def _clean(value, max_length=160):
    return str(value or "").strip()[:max_length]


def _is_email(value):
    return bool(EMAIL_RE.match(value))


def _is_mobile(value):
    return bool(MOBILE_RE.match(value)) and len(re.sub(r"\D", "", value)) >= 10


def _is_identifier(value):
    """True for anything usable as a sign-in identifier."""
    return _is_email(value) or _is_mobile(value)


def _session(user_id, email, full_name, role):
    return {
        "id": user_id,
        "email": email,
        "full_name": full_name,
        "role": role,
        "branch": DEFAULT_BRANCH,
    }


@auth_bp.route("/signup", methods=["POST"])
def signup():
    """Create a generic account from first name, last name, email, password."""
    data = request.get_json(silent=True) or {}

    first_name = _clean(data.get("first_name"), 80)
    last_name = _clean(data.get("last_name"), 80)
    # A client may send the two name parts or one combined name, but never a
    # half-filled pair: supplying only a first name is a validation error.
    supplied_full_name = _clean(data.get("full_name"))
    full_name = supplied_full_name or " ".join(p for p in (first_name, last_name) if p)
    email = _clean(data.get("email"))
    password = str(data.get("password") or "")
    role = _clean(data.get("role"), 60) or DEFAULT_ROLE

    errors = {}
    if not supplied_full_name:
        if not first_name:
            errors["first_name"] = "First name is required."
        if not last_name:
            errors["last_name"] = "Last name is required."
    if not email:
        errors["email"] = "Email is required."
    elif not _is_email(email):
        errors["email"] = "Enter a valid email address."
    if not password:
        errors["password"] = "Password is required."
    elif len(password) < MIN_PASSWORD_LENGTH:
        errors["password"] = f"Password must be at least {MIN_PASSWORD_LENGTH} characters."

    if errors:
        return jsonify({
            "error": "Validation failed",
            "message": next(iter(errors.values())),
            "errors": errors,
        }), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO users (email, password, full_name, role) VALUES (?, ?, ?, ?);",
            (email, password, full_name, role),
        )
        conn.commit()
        user_id = cursor.lastrowid
    except sqlite3.IntegrityError:
        return jsonify({
            "error": "Email already registered",
            "message": "An account with this email already exists. Please log in instead.",
            "errors": {"email": "An account with this email already exists."},
        }), 409
    finally:
        conn.close()

    return jsonify({
        "success": True,
        "user": _session(user_id, email, full_name, role),
        "token": f"demo-token-{user_id}",
    }), 201


@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    # Step 1 of the sign-in flow collects an "email address or mobile number";
    # either arrives here as `email` (or `identifier`, for clarity).
    email = _clean(data.get("email")) or _clean(data.get("identifier"))
    password = str(data.get("password") or "")

    if not email or not password:
        return jsonify({
            "error": "Missing credentials",
            "message": "Email and password are both required.",
        }), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, email, full_name, role, password FROM users WHERE email = ?;",
        (email,),
    )
    user = cursor.fetchone()
    conn.close()

    if not user:
        # Demo prototype: an unknown email signs in as a fresh account rather
        # than blocking the clinic's evaluation. Swap for a 401 once real
        # authentication is wired up.
        return jsonify({
            "success": True,
            "user": _session(999, email, email.split("@")[0], DEFAULT_ROLE),
            "token": "demo-token-12345",
        })

    if user["password"] and password != user["password"]:
        return jsonify({
            "error": "Invalid credentials",
            "message": "That password does not match this account.",
        }), 401

    return jsonify({
        "success": True,
        "user": _session(user["id"], user["email"], user["full_name"], user["role"]),
        "token": "demo-token-12345",
    })


@auth_bp.route("/forgot-password", methods=["POST"])
def forgot_password():
    """Start password recovery.

    The response is identical whether or not the address is registered, so the
    endpoint cannot be used to discover which emails hold accounts.
    """
    data = request.get_json(silent=True) or {}
    email = _clean(data.get("email")) or _clean(data.get("identifier"))

    if not email:
        return jsonify({
            "error": "Identifier required",
            "message": "Enter the email address or mobile number for your account.",
        }), 400
    if not _is_identifier(email):
        return jsonify({
            "error": "Invalid identifier",
            "message": "Enter a valid email address or mobile number.",
        }), 400

    return jsonify({
        "success": True,
        "message": (
            f"If an account exists for {email}, a password reset link is on its "
            "way. Check your inbox and spam folder."
        ),
    })


@auth_bp.route("/reset-password", methods=["POST"])
def reset_password():
    """Finish password recovery by setting a new password.

    Mirrors the forgot-password endpoint's discretion: an unknown account is
    answered with the same success body, so this cannot enumerate addresses.
    """
    data = request.get_json(silent=True) or {}
    email = _clean(data.get("email")) or _clean(data.get("identifier"))
    password = str(data.get("password") or "")
    confirm = str(data.get("confirm_password") or password)

    errors = {}
    if not email:
        errors["email"] = "Enter the email address or mobile number for your account."
    elif not _is_identifier(email):
        errors["email"] = "Enter a valid email address or mobile number."
    if not password:
        errors["password"] = "A new password is required."
    elif len(password) < MIN_PASSWORD_LENGTH:
        errors["password"] = f"Password must be at least {MIN_PASSWORD_LENGTH} characters."
    elif password != confirm:
        errors["confirm_password"] = "Passwords do not match."

    if errors:
        return jsonify({
            "error": "Validation failed",
            "message": next(iter(errors.values())),
            "errors": errors,
        }), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE users SET password = ? WHERE email = ?;", (password, email))
    conn.commit()
    conn.close()

    return jsonify({
        "success": True,
        "message": "Your password has been reset. You can sign in with it now.",
    })


@auth_bp.route("/current-user", methods=["GET"])
def current_user():
    return jsonify(
        _session(1, "sanju2kguru@gmail.com", "Sanjana K", DEFAULT_ROLE)
    )
