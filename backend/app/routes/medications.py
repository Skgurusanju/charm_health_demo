import json
from flask import Blueprint, request, jsonify
from ..database import get_db_connection

medications_bp = Blueprint("medications", __name__)

@medications_bp.route("/medications", methods=["GET"])
def get_medications():
    condition = request.args.get("condition", "").strip().lower()
    search = request.args.get("search", "").strip().lower()
    category = request.args.get("category", "").strip()

    conn = get_db_connection()
    cursor = conn.cursor()

    query = "SELECT * FROM medication_references WHERE 1=1"
    params = []

    if condition and condition != "all":
        query += " AND (LOWER(condition_key) = ? OR LOWER(condition_name) LIKE ?)"
        params.extend([condition, f"%{condition}%"])

    if category and category != "All":
        query += " AND category = ?"
        params.append(category)

    if search:
        query += """ AND (
            LOWER(medication_name) LIKE ? OR
            LOWER(generic_name) LIKE ? OR
            LOWER(condition_name) LIKE ? OR
            LOWER(category) LIKE ? OR
            LOWER(IFNULL(instructions, '')) LIKE ? OR
            LOWER(IFNULL(notes, '')) LIKE ?
        )"""
        p = f"%{search}%"
        params.extend([p, p, p, p, p, p])

    query += " ORDER BY condition_name ASC, medication_name ASC;"
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()

    return jsonify([dict(r) for r in rows])


@medications_bp.route("/medications/<int:med_id>", methods=["GET"])
def get_medication(med_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM medication_references WHERE id = ?;", (med_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "Medication record not found"}), 404
    return jsonify(dict(row))


@medications_bp.route("/medications", methods=["POST"])
def create_medication():
    data = request.get_json() or {}
    condition_key = (data.get("condition_key") or "general").strip().lower()
    condition_name = (data.get("condition_name") or "General Medicine").strip()
    category = (data.get("category") or "General Medicine").strip()
    medication_name = (data.get("medication_name") or "").strip()
    generic_name = (data.get("generic_name") or medication_name).strip()

    if not medication_name:
        return jsonify({"error": "Medication name is required"}), 400

    form = data.get("form", "Tablet")
    strength = data.get("strength", "")
    route = data.get("route", "Oral")
    frequency = data.get("frequency", "Once daily")
    duration = data.get("duration", "5 days")
    instructions = data.get("instructions", "")
    notes = data.get("notes", "")

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO medication_references (
            condition_key, condition_name, category, medication_name, generic_name,
            form, strength, route, frequency, duration, instructions, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    """, (
        condition_key, condition_name, category, medication_name, generic_name,
        form, strength, route, frequency, duration, instructions, notes
    ))
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return jsonify({
        "success": True,
        "id": new_id,
        "message": f"Medication reference '{medication_name}' added successfully."
    }), 201


@medications_bp.route("/medications/<int:med_id>", methods=["PUT"])
def update_medication(med_id):
    data = request.get_json() or {}
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT id FROM medication_references WHERE id = ?;", (med_id,))
    if not cursor.fetchone():
        conn.close()
        return jsonify({"error": "Medication record not found"}), 404

    cursor.execute("""
        UPDATE medication_references
        SET condition_key = COALESCE(?, condition_key),
            condition_name = COALESCE(?, condition_name),
            category = COALESCE(?, category),
            medication_name = COALESCE(?, medication_name),
            generic_name = COALESCE(?, generic_name),
            form = COALESCE(?, form),
            strength = COALESCE(?, strength),
            route = COALESCE(?, route),
            frequency = COALESCE(?, frequency),
            duration = COALESCE(?, duration),
            instructions = COALESCE(?, instructions),
            notes = COALESCE(?, notes)
        WHERE id = ?;
    """, (
        data.get("condition_key"),
        data.get("condition_name"),
        data.get("category"),
        data.get("medication_name"),
        data.get("generic_name"),
        data.get("form"),
        data.get("strength"),
        data.get("route"),
        data.get("frequency"),
        data.get("duration"),
        data.get("instructions"),
        data.get("notes"),
        med_id
    ))
    conn.commit()
    conn.close()

    return jsonify({
        "success": True,
        "message": "Medication reference updated successfully."
    })


@medications_bp.route("/medications/<int:med_id>", methods=["DELETE"])
def delete_medication(med_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT medication_name FROM medication_references WHERE id = ?;", (med_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Medication record not found"}), 404

    med_name = row["medication_name"]
    cursor.execute("DELETE FROM medication_references WHERE id = ?;", (med_id,))
    conn.commit()
    conn.close()

    return jsonify({
        "success": True,
        "message": f"Medication reference '{med_name}' deleted."
    })
