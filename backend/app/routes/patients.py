from flask import Blueprint, request, jsonify
from ..database import get_db_connection

patients_bp = Blueprint("patients", __name__)

@patients_bp.route("/patients", methods=["GET"])
def get_patients():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, mrn, full_name, age, gender, phone, email, condition_history, created_at
        FROM patients
        ORDER BY mrn ASC;
    """)
    rows = cursor.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@patients_bp.route("/patients/<int:patient_id>", methods=["GET"])
def get_patient(patient_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM patients WHERE id = ?;", (patient_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Patient not found"}), 404

    patient = dict(row)

    # Get consultations history
    cursor.execute("""
        SELECT c.id, c.template_id, t.name as template_name, c.doctor_name, c.status, c.notes, c.created_at
        FROM consultations c
        JOIN templates t ON c.template_id = t.id
        WHERE c.patient_id = ?
        ORDER BY c.created_at DESC;
    """, (patient_id,))
    patient["consultations"] = [dict(c) for c in cursor.fetchall()]

    conn.close()
    return jsonify(patient)
