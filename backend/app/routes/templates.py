import json
from flask import Blueprint, request, jsonify
from ..database import get_db_connection, DEFAULT_OWNER_EMAIL
from ..template_types import (
    TEMPLATE_TYPES,
    LEGACY_TEMPLATE_TYPES,
    MEDICAL_CATEGORIES,
    MEDICAL_CONDITIONS,
    dropdown_template_types,
    dropdown_categories,
    normalize_template_type,
    normalize_category,
    condition_keywords,
)

templates_bp = Blueprint("templates", __name__)

# Columns returned by the list endpoint. Kept explicit so a future column
# never leaks to the client by accident.
LIST_COLUMNS = """
    t.id, t.name, t.template_type, t.specialty, t.category, t.description,
    t.tags, t.is_active, t.is_practice, t.is_library, t.created_by,
    t.owner_email, t.created_at, t.updated_at
"""

MAX_NAME_LENGTH = 160
MAX_DESCRIPTION_LENGTH = 2000
MAX_TAGS_LENGTH = 500
MAX_CONTENT_LENGTH = 200000

SPECIALTIES = ["All"] + list(MEDICAL_CATEGORIES)


def _clean_text(value, max_length, default=""):
    """Trim and hard-cap any free-text field before it reaches SQLite."""
    if value is None:
        return default
    text = str(value).strip()
    return text[:max_length]


def _normalize_tags(value):
    """Accept either a list or a comma-separated string; store as CSV."""
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        parts = [str(v).strip() for v in value]
    else:
        parts = [p.strip() for p in str(value).split(",")]
    seen, unique = set(), []
    for part in parts:
        if part and part.lower() not in seen:
            seen.add(part.lower())
            unique.append(part[:40])
    return ", ".join(unique)[:MAX_TAGS_LENGTH]


def _as_bool_int(value, default=1):
    if value is None:
        return default
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, (int, float)):
        return 1 if value else 0
    return 1 if str(value).strip().lower() in ("1", "true", "yes", "active", "on") else 0


def _row_to_template(row, cursor):
    """Shape a templates row for the API, attaching role permissions."""
    data = dict(row)
    data["is_active"] = bool(data.get("is_active", 1))
    data["tags"] = data.get("tags") or ""
    data["tags_list"] = [t.strip() for t in data["tags"].split(",") if t.strip()]
    data["category"] = data.get("category") or data.get("specialty") or "General Medicine"

    cursor.execute("SELECT role_name FROM template_permissions WHERE template_id = ?;", (data["id"],))
    roles = [p["role_name"] for p in cursor.fetchall()]
    data["roles_list"] = roles
    data["accessible_to"] = ", ".join(roles) if roles else "All Roles"
    return data


# ---------------------------------------------------------------------------
# Reference data - the frontend dropdowns are driven by these endpoints
# ---------------------------------------------------------------------------

@templates_bp.route("/template-types", methods=["GET"])
def get_template_types():
    """Flat ordered list for the Template Type dropdown ('All' first)."""
    return jsonify(dropdown_template_types())


@templates_bp.route("/template-types/meta", methods=["GET"])
def get_template_types_meta():
    """Grouped view so the UI can render canonical vs legacy separately."""
    return jsonify({
        "all_label": "All",
        "types": TEMPLATE_TYPES,
        "legacy_types": LEGACY_TEMPLATE_TYPES,
    })


@templates_bp.route("/template-categories", methods=["GET"])
def get_template_categories():
    return jsonify(dropdown_categories())


@templates_bp.route("/medical-conditions", methods=["GET"])
def get_medical_conditions():
    """Condition catalogue backing the Common Medication tab.

    `keywords` stays server-side - the client only needs what it renders.
    """
    return jsonify([
        {
            "key": c["key"],
            "label": c["label"],
            "category": c.get("category", "General Medicine"),
            "description": c.get("description", ""),
        }
        for c in MEDICAL_CONDITIONS
    ])


@templates_bp.route("/specialties", methods=["GET"])
def get_specialties():
    return jsonify(SPECIALTIES)


# ---------------------------------------------------------------------------
# Template listing
# ---------------------------------------------------------------------------

@templates_bp.route("/templates", methods=["GET"])
def get_templates():
    tab = request.args.get("tab", "my_templates")
    template_type = request.args.get("template_type", "All")
    category = request.args.get("category", "All")
    specialty = request.args.get("specialty", "All")
    condition = request.args.get("condition", "").strip()
    search_query = request.args.get("search", "").strip()
    status = request.args.get("status", "all").strip().lower()
    owner = _clean_text(request.args.get("owner"), 160) or DEFAULT_OWNER_EMAIL

    conn = get_db_connection()
    cursor = conn.cursor()

    query = f"SELECT {LIST_COLUMNS} FROM templates t WHERE 1=1"
    params = []

    # The dedicated Email Templates tab owns type='Email'; the clinical tabs
    # hide it unless the user explicitly picks Email in the type dropdown.
    requested_type = normalize_template_type(template_type) if template_type != "All" else None
    hide_email = requested_type != "Email"

    if tab == "my_templates":
        query += " AND t.is_practice = 1 AND (t.owner_email = ? OR t.owner_email IS NULL OR t.owner_email = '')"
        params.append(owner)
        if hide_email:
            query += " AND t.template_type != 'Email'"
    elif tab == "practice_templates":
        query += " AND t.is_practice = 1"
        if hide_email:
            query += " AND t.template_type != 'Email'"
    elif tab == "email_templates":
        query += " AND t.template_type = 'Email'"
    elif tab == "template_library":
        query += " AND t.is_library = 1"
    elif tab == "common_medication":
        # Condition templates view: lists all clinical condition templates.
        if hide_email:
            query += " AND t.template_type != 'Email'"

    if requested_type:
        query += " AND t.template_type = ?"
        params.append(requested_type)

    if category and category != "All":
        query += " AND (t.category = ? OR t.specialty = ?)"
        params.extend([category, category])

    if specialty and specialty != "All":
        query += " AND t.specialty = ?"
        params.append(specialty)

    if status == "active":
        query += " AND t.is_active = 1"
    elif status == "inactive":
        query += " AND t.is_active = 0"

    # Common Medication condition: OR across every keyword mapped to it.
    keywords = condition_keywords(condition)
    if keywords:
        clauses = []
        for word in keywords:
            clauses.append(
                "(LOWER(t.name) LIKE ? OR LOWER(IFNULL(t.description,'')) LIKE ?"
                " OR LOWER(IFNULL(t.tags,'')) LIKE ? OR LOWER(IFNULL(t.category,'')) LIKE ?"
                " OR LOWER(t.specialty) LIKE ?)"
            )
            params.extend([f"%{word.lower()}%"] * 5)
        query += " AND (" + " OR ".join(clauses) + ")"
    elif condition:
        # An unknown condition key falls back to a plain text match, not a 400.
        term = f"%{condition.lower()}%"
        query += (" AND (LOWER(t.name) LIKE ? OR LOWER(IFNULL(t.description,'')) LIKE ?"
                  " OR LOWER(IFNULL(t.tags,'')) LIKE ?)")
        params.extend([term, term, term])

    # Free-text search spans name, type, category, description and tags.
    if search_query:
        term = f"%{search_query.lower()}%"
        query += (" AND (LOWER(t.name) LIKE ? OR LOWER(t.template_type) LIKE ?"
                  " OR LOWER(IFNULL(t.category,'')) LIKE ? OR LOWER(t.specialty) LIKE ?"
                  " OR LOWER(IFNULL(t.description,'')) LIKE ? OR LOWER(IFNULL(t.tags,'')) LIKE ?)")
        params.extend([term] * 6)

    query += " ORDER BY t.name COLLATE NOCASE ASC;"

    cursor.execute(query, params)
    rows = cursor.fetchall()
    results = [_row_to_template(r, cursor) for r in rows]

    conn.close()
    return jsonify(results)


@templates_bp.route("/templates/<int:template_id>", methods=["GET"])
def get_template_details(template_id):
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM templates WHERE id = ?;", (template_id,))
    t_row = cursor.fetchone()
    if not t_row:
        conn.close()
        return jsonify({"error": "Template not found"}), 404

    template = _row_to_template(t_row, cursor)
    template["content"] = t_row["content"] if "content" in t_row.keys() else ""
    template["roles"] = template["roles_list"]

    # Sections
    cursor.execute("SELECT * FROM template_sections WHERE template_id = ? ORDER BY order_index ASC;", (template_id,))
    section_rows = cursor.fetchall()

    sections = []
    for s_row in section_rows:
        sec = dict(s_row)
        cursor.execute("SELECT * FROM template_components WHERE section_id = ? ORDER BY order_index ASC;", (sec["id"],))
        comp_rows = cursor.fetchall()

        components = []
        for c_row in comp_rows:
            comp = dict(c_row)
            comp["column_count"] = comp.get("column_count") or 3
            if comp.get("config"):
                try:
                    comp["config"] = json.loads(comp["config"])
                except Exception:
                    pass
            cursor.execute(
                "SELECT * FROM template_options WHERE component_id = ? ORDER BY order_index ASC;",
                (comp["id"],),
            )
            options = []
            for opt in cursor.fetchall():
                o = dict(opt)
                # Normalise the nesting flags so the viewer never has to
                # guard against NULLs coming from pre-migration rows.
                o["parent_option_id"] = o.get("parent_option_id")
                o["is_selected"] = bool(o.get("is_selected"))
                o["is_expandable"] = bool(o.get("is_expandable"))
                options.append(o)
            comp["options"] = options
            components.append(comp)

        sec["components"] = components
        sections.append(sec)

    template["sections"] = sections

    # Relationships (Horizontal Hierarchy)
    cursor.execute("""
        SELECT r.id, r.parent_component_id, r.trigger_value, r.child_component_id,
               pc.label as parent_label, cc.label as child_label
        FROM template_relationships r
        JOIN template_components pc ON r.parent_component_id = pc.id
        JOIN template_components cc ON r.child_component_id = cc.id
        WHERE r.template_id = ?;
    """, (template_id,))
    template["relationships"] = [dict(rel) for rel in cursor.fetchall()]

    conn.close()
    return jsonify(template)


# ---------------------------------------------------------------------------
# Create / update / delete
# ---------------------------------------------------------------------------

def _write_options(cursor, comp_id, options, parent_option_id=None):
    """Insert a component's options, recursing into any nested `children`.

    Accepts either a plain string, or a dict with `option_label` plus the
    optional `is_selected` / `is_expandable` / `children` keys used by the
    hierarchical checkbox trees.
    """
    for o_idx, opt in enumerate(options or []):
        if isinstance(opt, dict):
            label = opt.get("option_label", "")
            value = opt.get("option_value") or label
            selected = 1 if opt.get("is_selected") else 0
            children = opt.get("children") or []
            expandable = 1 if (opt.get("is_expandable") or children) else 0
        else:
            label = str(opt)
            value = label
            selected = 0
            children = []
            expandable = 0

        cursor.execute("""
            INSERT INTO template_options (component_id, option_label, option_value, order_index,
                                          parent_option_id, is_selected, is_expandable)
            VALUES (?, ?, ?, ?, ?, ?, ?);
        """, (
            comp_id,
            _clean_text(label, 300),
            _clean_text(value, 300),
            o_idx,
            parent_option_id,
            selected,
            expandable,
        ))
        new_option_id = cursor.lastrowid

        if children:
            _write_options(cursor, comp_id, children, new_option_id)


def _write_sections(cursor, template_id, sections, relationships):
    """(Re)write the section/component/option/relationship tree for a template."""
    tag_to_id = {}
    for s_idx, sec in enumerate(sections):
        cursor.execute("""
            INSERT INTO template_sections (template_id, title, category, order_index, column_layout)
            VALUES (?, ?, ?, ?, ?);
        """, (
            template_id,
            _clean_text(sec.get("title"), 120, f"Section {s_idx + 1}"),
            _clean_text(sec.get("category"), 40, "Subjective"),
            s_idx,
            sec.get("column_layout", 1),
        ))
        sec_id = cursor.lastrowid

        for c_idx, comp in enumerate(sec.get("components", [])):
            try:
                columns = int(comp.get("column_count") or 3)
            except (TypeError, ValueError):
                columns = 3
            columns = max(1, min(columns, 4))
            config_val = comp.get("config")
            if isinstance(config_val, (dict, list)):
                config_val = json.dumps(config_val)
            elif config_val is not None:
                config_val = str(config_val)

            cursor.execute("""
                INSERT INTO template_components (section_id, component_type, label, placeholder,
                                                 is_required, default_value, order_index,
                                                 column_count, help_text, config)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """, (
                sec_id,
                _clean_text(comp.get("component_type"), 40, "Text Field"),
                _clean_text(comp.get("label"), 300, "Question"),
                _clean_text(comp.get("placeholder"), 300),
                1 if comp.get("is_required") else 0,
                comp.get("default_value"),
                c_idx,
                columns,
                _clean_text(comp.get("help_text"), 300),
                config_val,
            ))
            comp_id = cursor.lastrowid
            if comp.get("id"):
                tag_to_id[str(comp["id"])] = comp_id

            _write_options(cursor, comp_id, comp.get("options", []))

    for rel in (relationships or []):
        p_id = tag_to_id.get(str(rel.get("parent_component_id")), rel.get("parent_component_id"))
        c_id = tag_to_id.get(str(rel.get("child_component_id")), rel.get("child_component_id"))
        if p_id and c_id:
            cursor.execute("""
                INSERT INTO template_relationships (template_id, parent_component_id, trigger_value, child_component_id)
                VALUES (?, ?, ?, ?);
            """, (template_id, p_id, _clean_text(rel.get("trigger_value"), 300), c_id))


@templates_bp.route("/templates", methods=["POST"])
def create_template():
    data = request.get_json(silent=True) or {}

    name = _clean_text(data.get("name"), MAX_NAME_LENGTH)
    if not name:
        return jsonify({"error": "Template name is required"}), 400

    template_type = normalize_template_type(data.get("template_type"))
    if template_type is None:
        return jsonify({
            "error": "Invalid template type",
            "message": f"'{data.get('template_type')}' is not a recognised template type.",
        }), 400

    category = normalize_category(data.get("category") or data.get("specialty"))
    description = _clean_text(data.get("description"), MAX_DESCRIPTION_LENGTH)
    content = _clean_text(data.get("content"), MAX_CONTENT_LENGTH)
    tags = _normalize_tags(data.get("tags"))
    is_active = _as_bool_int(data.get("is_active"), 1)
    owner_email = _clean_text(data.get("owner_email"), 160) or DEFAULT_OWNER_EMAIL
    created_by = _clean_text(data.get("created_by"), 160) or "Sanjana K"
    roles = data.get("roles") or ["Physician", "Physician Assistant"]
    sections = data.get("sections") or []
    relationships = data.get("relationships") or []

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        INSERT INTO templates (name, template_type, specialty, category, description,
                               content, tags, is_active, is_practice, is_library,
                               created_by, owner_email)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?);
    """, (name, template_type, category, category, description, content, tags,
          is_active, created_by, owner_email))
    new_template_id = cursor.lastrowid

    for r_name in roles:
        cursor.execute("INSERT INTO template_permissions (template_id, role_name) VALUES (?, ?);",
                       (new_template_id, _clean_text(r_name, 60)))

    _write_sections(cursor, new_template_id, sections, relationships)

    conn.commit()
    conn.close()

    return jsonify({
        "success": True,
        "id": new_template_id,
        "message": f"Template '{name}' created successfully",
    }), 201


@templates_bp.route("/templates/<int:template_id>", methods=["PUT"])
def update_template(template_id):
    data = request.get_json(silent=True) or {}

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT id FROM templates WHERE id = ?;", (template_id,))
    if not cursor.fetchone():
        conn.close()
        return jsonify({"error": "Template not found"}), 404

    name = _clean_text(data.get("name"), MAX_NAME_LENGTH, None) if "name" in data else None
    if "name" in data and not name:
        conn.close()
        return jsonify({"error": "Template name cannot be empty"}), 400

    template_type = None
    if "template_type" in data and data.get("template_type"):
        template_type = normalize_template_type(data.get("template_type"))
        if template_type is None:
            conn.close()
            return jsonify({
                "error": "Invalid template type",
                "message": f"'{data.get('template_type')}' is not a recognised template type.",
            }), 400

    category = None
    if "category" in data or "specialty" in data:
        category = normalize_category(data.get("category") or data.get("specialty"))

    description = _clean_text(data.get("description"), MAX_DESCRIPTION_LENGTH) if "description" in data else None
    content = _clean_text(data.get("content"), MAX_CONTENT_LENGTH) if "content" in data else None
    tags = _normalize_tags(data.get("tags")) if "tags" in data else None
    is_active = _as_bool_int(data.get("is_active")) if "is_active" in data else None

    cursor.execute("""
        UPDATE templates
        SET name = COALESCE(?, name),
            template_type = COALESCE(?, template_type),
            specialty = COALESCE(?, specialty),
            category = COALESCE(?, category),
            description = COALESCE(?, description),
            content = COALESCE(?, content),
            tags = COALESCE(?, tags),
            is_active = COALESCE(?, is_active),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?;
    """, (name, template_type, category, category, description, content, tags, is_active, template_id))

    roles = data.get("roles")
    if roles is not None:
        cursor.execute("DELETE FROM template_permissions WHERE template_id = ?;", (template_id,))
        for r_name in roles:
            cursor.execute("INSERT INTO template_permissions (template_id, role_name) VALUES (?, ?);",
                           (template_id, _clean_text(r_name, 60)))

    sections = data.get("sections")
    if sections is not None:
        cursor.execute("DELETE FROM template_relationships WHERE template_id = ?;", (template_id,))
        cursor.execute("DELETE FROM template_sections WHERE template_id = ?;", (template_id,))
        _write_sections(cursor, template_id, sections, data.get("relationships"))

    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "Template updated successfully"})


@templates_bp.route("/templates/<int:template_id>/status", methods=["PUT"])
def set_template_status(template_id):
    """Activate / deactivate a template without touching its content."""
    data = request.get_json(silent=True) or {}
    is_active = _as_bool_int(data.get("is_active"), 1)

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM templates WHERE id = ?;", (template_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Template not found"}), 404

    cursor.execute(
        "UPDATE templates SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;",
        (is_active, template_id),
    )
    conn.commit()
    conn.close()

    state = "activated" if is_active else "deactivated"
    return jsonify({
        "success": True,
        "is_active": bool(is_active),
        "message": f"Template '{row['name']}' {state}.",
    })


@templates_bp.route("/templates/<int:template_id>", methods=["DELETE"])
def delete_template(template_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM templates WHERE id = ?;", (template_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Template not found"}), 404

    cursor.execute("DELETE FROM templates WHERE id = ?;", (template_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": f"Template '{row['name']}' deleted successfully."})


def _copy_option_tree(cursor, rows, new_comp_id):
    """Re-insert a component's option rows under `new_comp_id`, depth-first.

    Walking children-of-parent rather than relying on row order means a tree
    of any depth is reproduced with its parent links remapped correctly.
    """
    by_parent = {}
    for row in rows:
        by_parent.setdefault(row["parent_option_id"], []).append(row)

    def insert_level(old_parent_id, new_parent_id):
        for row in by_parent.get(old_parent_id, []):
            cursor.execute("""
                INSERT INTO template_options (component_id, option_label, option_value, order_index,
                                              parent_option_id, is_selected, is_expandable)
                VALUES (?, ?, ?, ?, ?, ?, ?);
            """, (
                new_comp_id, row["option_label"], row["option_value"], row["order_index"],
                new_parent_id, row["is_selected"], row["is_expandable"],
            ))
            insert_level(row["id"], cursor.lastrowid)

    insert_level(None, None)


def _unique_copy_name(cursor, base_name):
    """'Chest Pain' -> 'Chest Pain - Copy' -> 'Chest Pain - Copy 2' -> ..."""
    candidate = f"{base_name} - Copy"[:MAX_NAME_LENGTH]
    suffix = 2
    while True:
        cursor.execute("SELECT 1 FROM templates WHERE name = ? LIMIT 1;", (candidate,))
        if not cursor.fetchone():
            return candidate
        candidate = f"{base_name} - Copy {suffix}"[:MAX_NAME_LENGTH]
        suffix += 1


@templates_bp.route("/templates/<int:template_id>/duplicate", methods=["POST"])
def duplicate_template(template_id):
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM templates WHERE id = ?;", (template_id,))
    orig = cursor.fetchone()
    if not orig:
        conn.close()
        return jsonify({"error": "Template not found"}), 404

    new_name = _unique_copy_name(cursor, orig["name"])
    cursor.execute("""
        INSERT INTO templates (name, template_type, specialty, category, description,
                               content, tags, is_active, is_practice, is_library,
                               created_by, owner_email)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?);
    """, (
        new_name, orig["template_type"], orig["specialty"], orig["category"],
        orig["description"], orig["content"], orig["tags"], orig["is_active"],
        "Sanjana K", orig["owner_email"] or DEFAULT_OWNER_EMAIL,
    ))
    new_id = cursor.lastrowid

    cursor.execute("SELECT role_name FROM template_permissions WHERE template_id = ?;", (template_id,))
    for perm in cursor.fetchall():
        cursor.execute("INSERT INTO template_permissions (template_id, role_name) VALUES (?, ?);",
                       (new_id, perm["role_name"]))

    cursor.execute("SELECT * FROM template_sections WHERE template_id = ? ORDER BY order_index ASC;", (template_id,))
    old_sections = cursor.fetchall()
    old_to_new_comp = {}

    for sec in old_sections:
        cursor.execute("""
            INSERT INTO template_sections (template_id, title, category, order_index, column_layout)
            VALUES (?, ?, ?, ?, ?);
        """, (new_id, sec["title"], sec["category"], sec["order_index"], sec["column_layout"]))
        new_sec_id = cursor.lastrowid

        cursor.execute("SELECT * FROM template_components WHERE section_id = ? ORDER BY order_index ASC;", (sec["id"],))
        for comp in cursor.fetchall():
            cursor.execute("""
                INSERT INTO template_components (section_id, component_type, label, placeholder,
                                                 is_required, default_value, order_index,
                                                 column_count, help_text, config)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """, (new_sec_id, comp["component_type"], comp["label"], comp["placeholder"],
                  comp["is_required"], comp["default_value"], comp["order_index"],
                  comp["column_count"], comp["help_text"], comp["config"] if "config" in comp.keys() else None))
            new_comp_id = cursor.lastrowid
            old_to_new_comp[comp["id"]] = new_comp_id

            # Copy options depth-first so nested trees of any depth survive
            # the duplicate with their hierarchy intact.
            cursor.execute(
                "SELECT * FROM template_options WHERE component_id = ? ORDER BY order_index ASC;",
                (comp["id"],),
            )
            _copy_option_tree(cursor, [dict(o) for o in cursor.fetchall()], new_comp_id)

    cursor.execute("SELECT * FROM template_relationships WHERE template_id = ?;", (template_id,))
    for rel in cursor.fetchall():
        new_p = old_to_new_comp.get(rel["parent_component_id"])
        new_c = old_to_new_comp.get(rel["child_component_id"])
        if new_p and new_c:
            cursor.execute("""
                INSERT INTO template_relationships (template_id, parent_component_id, trigger_value, child_component_id)
                VALUES (?, ?, ?, ?);
            """, (new_id, new_p, rel["trigger_value"], new_c))

    conn.commit()
    conn.close()
    return jsonify({
        "success": True,
        "id": new_id,
        "name": new_name,
        "message": f"Duplicated as '{new_name}'",
    }), 201


@templates_bp.route("/templates/<int:template_id>/share", methods=["POST"])
def share_template(template_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM templates WHERE id = ?;", (template_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Template not found"}), 404

    cursor.execute("UPDATE templates SET is_library = 1 WHERE id = ?;", (template_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "Template successfully shared to Template Library."})


@templates_bp.route("/templates/<int:template_id>/import", methods=["POST"])
def import_template(template_id):
    owner = _clean_text((request.get_json(silent=True) or {}).get("owner_email"), 160) or DEFAULT_OWNER_EMAIL

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM templates WHERE id = ?;", (template_id,))
    orig = cursor.fetchone()
    if not orig:
        conn.close()
        return jsonify({"error": "Template not found"}), 404

    cursor.execute("UPDATE templates SET is_practice = 1, owner_email = ? WHERE id = ?;", (owner, template_id))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": f"Template '{orig['name']}' imported into My Templates."})


@templates_bp.route("/templates/<int:template_id>/roles", methods=["PUT"])
def update_template_roles(template_id):
    data = request.get_json(silent=True) or {}
    roles = data.get("roles", [])

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM templates WHERE id = ?;", (template_id,))
    if not cursor.fetchone():
        conn.close()
        return jsonify({"error": "Template not found"}), 404

    cursor.execute("DELETE FROM template_permissions WHERE template_id = ?;", (template_id,))
    for r_name in roles:
        cursor.execute("INSERT INTO template_permissions (template_id, role_name) VALUES (?, ?);",
                       (template_id, _clean_text(r_name, 60)))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "Template roles updated successfully."})


@templates_bp.route("/templates/<int:template_id>/default-values", methods=["PUT"])
def update_template_default_values(template_id):
    data = request.get_json(silent=True) or {}
    defaults = data.get("defaults", {})

    conn = get_db_connection()
    cursor = conn.cursor()
    for comp_id, val in defaults.items():
        # Scope the update to this template so a forged component id from the
        # client cannot rewrite defaults belonging to another template.
        cursor.execute("""
            UPDATE template_components
            SET default_value = ?
            WHERE id = ?
              AND section_id IN (SELECT id FROM template_sections WHERE template_id = ?);
        """, (val, comp_id, template_id))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "Default values updated successfully."})
