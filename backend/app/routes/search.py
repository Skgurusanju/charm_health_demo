from flask import Blueprint, request, jsonify
from ..database import get_db_connection

search_bp = Blueprint("search", __name__)

# Clinical alias / synonym expansion for seamless condition searching
CONDITION_SYNONYMS = {
    "fever": ["fever", "pyrexia", "temperature", "chills", "infection", "febrile"],
    "vaccine": ["vaccine", "vaccination", "immunization", "inoculation"],
    "cardiac": ["cardiac", "heart", "chest pain", "angina", "eecp", "cad", "coronary", "arrhythmia", "palpitations", "edema", "failure", "ischemic"],
    "chest pain": ["chest pain", "angina", "cardiac", "ischemic", "eecp", "cad", "coronary"],
    "eecp": ["eecp", "counterpulsation", "refractory angina", "cardiac", "collateral", "ischemia"],
    "respiratory": ["respiratory", "cough", "asthma", "copd", "breath", "dyspnea", "wheezing", "sputum", "shortness of breath", "sob"],
    "cough": ["cough", "respiratory", "bronchitis", "asthma", "sputum"],
    "diarrhea": ["diarrhea", "loose stools", "gastroenteritis", "gi", "dehydration", "gastrointestinal"],
    "diabetes": ["diabetes", "sugar", "glucose", "hba1c", "glycemic", "diabetic", "foot"],
    "hypertension": ["hypertension", "bp", "blood pressure", "dash", "cardiac"],
    "thyroid": ["thyroid", "hypothyroidism", "hyperthyroidism", "tsh", "goiter"],
    "anesthesia": ["anesthesia", "pre-anesthesia", "preoperative", "asa", "airway", "mallampati"],
    "kidney": ["kidney", "renal", "uti", "ckd", "urinary", "proteinuria", "creatinine", "nephro"],
    "urinary": ["urinary", "uti", "dysuria", "kidney", "renal", "bladder"],
    "headache": ["headache", "migraine", "cephalea", "neurology"]
}

@search_bp.route("/search/templates", methods=["GET"])
def search_templates():
    q = request.args.get("q", "").strip().lower()
    if not q:
        # Return popular initial clinical templates
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, name, template_type, specialty, description, is_practice, is_library
            FROM templates
            ORDER BY
                CASE WHEN specialty IN ('Cardiac', 'EECP') THEN 0 ELSE 1 END,
                name ASC
            LIMIT 20;
        """)
        rows = cursor.fetchall()
        conn.close()
        return jsonify([dict(r) for r in rows])

    # Expand query using synonyms
    expanded_terms = {q}
    for condition_key, terms in CONDITION_SYNONYMS.items():
        if condition_key in q or any(t in q for t in terms):
            expanded_terms.update(terms)

    conn = get_db_connection()
    cursor = conn.cursor()

    # Search in templates
    cursor.execute("""
        SELECT id, name, template_type, specialty, description, is_practice, is_library
        FROM templates;
    """)
    all_templates = cursor.fetchall()
    conn.close()

    scored_results = []
    for t in all_templates:
        t_dict = dict(t)
        name_lower = t_dict["name"].lower()
        desc_lower = (t_dict["description"] or "").lower()
        spec_lower = t_dict["specialty"].lower()
        type_lower = t_dict["template_type"].lower()

        score = 0
        # Exact match
        if q == name_lower:
            score += 100
        elif q in name_lower:
            score += 50
        elif any(term in name_lower for term in expanded_terms):
            score += 35

        if q in spec_lower:
            score += 30
        elif any(term in spec_lower for term in expanded_terms):
            score += 20

        if q in desc_lower or any(term in desc_lower for term in expanded_terms):
            score += 15

        if q in type_lower:
            score += 10

        if score > 0:
            scored_results.append((score, t_dict))

    # Sort descending by relevance score
    scored_results.sort(key=lambda x: x[0], reverse=True)
    results = [item[1] for item in scored_results]

    return jsonify(results)
