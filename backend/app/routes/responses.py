from flask import Blueprint, request, jsonify
from ..database import get_db_connection

responses_bp = Blueprint("responses", __name__)

@responses_bp.route("/consultations", methods=["POST"])
@responses_bp.route("/responses", methods=["POST"])
@responses_bp.route("/template-responses", methods=["POST"])
def start_or_save_consultation():
    data = request.get_json() or {}
    patient_id = data.get("patient_id")
    template_id = data.get("template_id")
    doctor_name = data.get("doctor_name", "Sanjana K")
    status = data.get("status", "Completed")
    notes = data.get("notes", "")
    responses = data.get("responses", [])  # list of {component_id, component_label, response_value}

    if not template_id:
        return jsonify({"error": "template_id is required"}), 400

    conn = get_db_connection()
    cursor = conn.cursor()

    if patient_id:
        cursor.execute("SELECT id FROM patients WHERE id = ?;", (patient_id,))
        if not cursor.fetchone():
            patient_id = None

    if not patient_id:
        cursor.execute("SELECT id FROM patients ORDER BY id ASC LIMIT 1;")
        row = cursor.fetchone()
        if row:
            patient_id = row["id"]
        else:
            cursor.execute("""
                INSERT INTO patients (mrn, full_name, age, gender, condition_history)
                VALUES ('MRN-DEMO-001', 'Sundaram R', 58, 'Male', 'General Clinical Evaluation');
            """)
            patient_id = cursor.lastrowid

    cursor.execute("""
        INSERT INTO consultations (patient_id, template_id, doctor_name, status, notes)
        VALUES (?, ?, ?, ?, ?);
    """, (patient_id, template_id, doctor_name, status, notes))
    consultation_id = cursor.lastrowid

    for resp in responses:
        cursor.execute("""
            INSERT INTO template_responses (consultation_id, component_id, component_label, response_value)
            VALUES (?, ?, ?, ?);
        """, (
            consultation_id,
            resp.get("component_id", 0),
            resp.get("component_label", "Field"),
            str(resp.get("response_value", ""))
        ))

    conn.commit()
    conn.close()

    return jsonify({
        "success": True,
        "consultation_id": consultation_id,
        "message": "Template response saved successfully."
    }), 201

@responses_bp.route("/consultations", methods=["GET"])
@responses_bp.route("/responses", methods=["GET"])
@responses_bp.route("/template-responses", methods=["GET"])
def list_consultations():
    template_id = request.args.get("template_id")
    patient_id = request.args.get("patient_id")

    conn = get_db_connection()
    cursor = conn.cursor()

    query = """
        SELECT c.*, p.full_name as patient_name, p.mrn, t.name as template_name
        FROM consultations c
        JOIN patients p ON c.patient_id = p.id
        JOIN templates t ON c.template_id = t.id
    """
    params = []
    conditions = []
    if template_id:
        conditions.append("c.template_id = ?")
        params.append(template_id)
    if patient_id:
        conditions.append("c.patient_id = ?")
        params.append(patient_id)

    if conditions:
        query += " WHERE " + " AND ".join(conditions)

    query += " ORDER BY c.created_at DESC;"

    cursor.execute(query, tuple(params))
    rows = cursor.fetchall()

    consultations = []
    for r in rows:
        c_dict = dict(r)
        cursor.execute("""
            SELECT component_id, component_label, response_value, created_at
            FROM template_responses
            WHERE consultation_id = ?
            ORDER BY id ASC;
        """, (c_dict["id"],))
        c_dict["responses"] = [dict(resp) for resp in cursor.fetchall()]
        consultations.append(c_dict)

    conn.close()
    return jsonify(consultations)



@responses_bp.route("/consultations/<int:consultation_id>", methods=["GET"])
@responses_bp.route("/responses/<int:consultation_id>", methods=["GET"])
@responses_bp.route("/template-responses/<int:consultation_id>", methods=["GET"])
def get_consultation(consultation_id):
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT c.*, p.full_name as patient_name, p.mrn, t.name as template_name
        FROM consultations c
        JOIN patients p ON c.patient_id = p.id
        JOIN templates t ON c.template_id = t.id
        WHERE c.id = ?;
    """, (consultation_id,))
    c_row = cursor.fetchone()

    if not c_row:
        conn.close()
        return jsonify({"error": "Consultation not found"}), 404

    cursor.execute("""
        SELECT component_id, component_label, response_value, created_at
        FROM template_responses
        WHERE consultation_id = ?
        ORDER BY id ASC;
    """, (consultation_id,))
    resp_rows = cursor.fetchall()
    conn.close()

    return jsonify({
        "id": c_row["id"],
        "patient_id": c_row["patient_id"],
        "patient_name": c_row["patient_name"],
        "mrn": c_row["mrn"],
        "template_id": c_row["template_id"],
        "template_name": c_row["template_name"],
        "doctor_name": c_row["doctor_name"],
        "status": c_row["status"],
        "notes": c_row["notes"],
        "created_at": c_row["created_at"],
        "responses": [dict(r) for r in resp_rows]
    })


@responses_bp.route("/consultations/<int:consultation_id>", methods=["PUT"])
@responses_bp.route("/responses/<int:consultation_id>", methods=["PUT"])
@responses_bp.route("/template-responses/<int:consultation_id>", methods=["PUT"])
def update_consultation(consultation_id):
    data = request.get_json() or {}
    doctor_name = data.get("doctor_name")
    status = data.get("status")
    notes = data.get("notes")
    responses = data.get("responses")  # list of {component_id, component_label, response_value}

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT id FROM consultations WHERE id = ?;", (consultation_id,))
    if not cursor.fetchone():
        conn.close()
        return jsonify({"error": "Consultation not found"}), 404

    # Update consultation details
    if doctor_name is not None or status is not None or notes is not None:
        cursor.execute("""
            UPDATE consultations
            SET doctor_name = COALESCE(?, doctor_name),
                status = COALESCE(?, status),
                notes = COALESCE(?, notes)
            WHERE id = ?;
        """, (doctor_name, status, notes, consultation_id))

    # Replace responses if provided
    if responses is not None:
        cursor.execute("DELETE FROM template_responses WHERE consultation_id = ?;", (consultation_id,))
        for resp in responses:
            cursor.execute("""
                INSERT INTO template_responses (consultation_id, component_id, component_label, response_value)
                VALUES (?, ?, ?, ?);
            """, (
                consultation_id,
                resp.get("component_id", 0),
                resp.get("component_label", "Field"),
                str(resp.get("response_value", ""))
            ))

    conn.commit()
    conn.close()

    return jsonify({
        "success": True,
        "consultation_id": consultation_id,
        "message": "Consultation updated successfully."
    })


@responses_bp.route("/consultations/<int:consultation_id>", methods=["DELETE"])
@responses_bp.route("/responses/<int:consultation_id>", methods=["DELETE"])
@responses_bp.route("/template-responses/<int:consultation_id>", methods=["DELETE"])
def delete_consultation(consultation_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM consultations WHERE id = ?;", (consultation_id,))
    if not cursor.fetchone():
        conn.close()
        return jsonify({"error": "Consultation not found"}), 404

    cursor.execute("DELETE FROM consultations WHERE id = ?;", (consultation_id,))
    conn.commit()
    conn.close()

    return jsonify({
        "success": True,
        "message": f"Consultation #{consultation_id} deleted successfully."
    })

