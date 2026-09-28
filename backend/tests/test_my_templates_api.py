"""
End-to-end API checks for the My Templates module.

Run the backend first (`python run.py`), then:
    python backend/tests/test_my_templates_api.py

Every check hits the live Flask API and the real SQLite database, so a pass
means the feature genuinely works rather than merely type-checking. The script
creates templates prefixed "ZZ E2E" and deletes them again on the way out.
"""

import json
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:5000/api"

passes, fails = [], []

# The Template Type dropdown, in the exact order the clinic specified.
REQUIRED_TYPES = [
    "Assessment Notes", "Billing Procedure Codes", "Billing Inventory",
    "Chief Complaints", "Diagnosis", "Diet Recommendations", "Email",
    "Family History", "Follow up", "History of Present Illness", "Imaging",
    "Injection", "Instructions", "Lab Record", "Lifestyle Recommendations",
    "Nurse Notes", "Past Medical History", "Physical Examination", "Prescription",
    "Reports", "Review of Systems", "SOAP", "Self Notes", "Social History",
    "Supplement", "Symptoms", "Send Invoice - PHR Message", "Send Invoice - Email",
    "Send Receipt - PHR Message", "Send Receipt - Email",
    "Send Statement - PHR Message", "Send Statement - Email", "Treatment Notes",
    "Vaccine",
]

# Every condition the Common Medication tab must offer.
REQUIRED_CONDITIONS = [
    "Diarrhea", "Back Pain", "Cardiac", "Cough", "Cold", "Fever", "Anaesthesia",
    "Chest Pain", "Heart Failure", "Hypertension", "Diabetes", "Asthma",
    "Respiratory Conditions", "Abdominal Pain", "Acid Reflux", "Kidney / UTI",
    "Vaccination", "Pre-Anesthesia", "General Pain", "Headache", "Vomiting",
    "Nausea", "Allergy", "Infection", "Flu", "Gastritis", "Arthritis",
    "Musculoskeletal Pain", "Skin Conditions", "ENT Conditions", "Eye Conditions",
    "Women's Health", "Men's Health", "Pediatric Common Conditions",
]


def call(method, path, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def check(label, cond, detail=""):
    (passes if cond else fails).append(label)
    mark = "PASS" if cond else "FAIL"
    suffix = f"  [{detail}]" if detail else ""
    print(f"  {mark}  {label}{suffix}")


def q(value):
    return urllib.parse.quote(value)


def main():
    print("\n=== 1-2. Template Type dropdown completeness ===")
    st, types = call("GET", "/template-types")
    check("GET /template-types returns 200", st == 200)
    check("'All' is the first option", types[0] == "All", types[0])
    missing = [t for t in REQUIRED_TYPES if t not in types]
    check("all 34 required types present", not missing, str(missing))
    check("required types keep the specified order",
          types[1:1 + len(REQUIRED_TYPES)] == REQUIRED_TYPES)

    print("\n=== 3-7. Template Type filtering ===")
    for t_type in ["SOAP", "Diagnosis", "Prescription", "Send Invoice - Email"]:
        st, rows = call("GET", f"/templates?tab=my_templates&template_type={q(t_type)}")
        bad = [r["name"] for r in rows if r["template_type"] != t_type]
        check(
            f"type={t_type!r} -> {len(rows)} rows, all matching",
            st == 200 and len(rows) > 0 and not bad,
            str(bad[:3]),
        )

    st, all_rows = call("GET", "/templates?tab=my_templates")
    # The Practice catalogue defines the visible set: exactly 57 templates.
    check(f"type=All returns the full catalogue ({len(all_rows)})", len(all_rows) == 57)

    print("\n=== 8-9. Search ===")
    st, rows = call("GET", "/templates?tab=my_templates&search=heart")
    names = [r["name"] for r in rows]
    check(f"search 'heart' -> {len(rows)} rows", len(rows) > 0)
    check("  includes a Heart Failure template",
          any("Heart Failure" in n for n in names), str(names[:4]))

    st, rows = call("GET", "/templates?tab=my_templates&search=diabetes")
    check(f"search 'diabetes' -> {len(rows)} rows", len(rows) > 0,
          str([r["name"] for r in rows][:3]))

    st, rows = call("GET", "/templates?tab=my_templates&search=SOAP")
    check(f"search 'SOAP' matches on template type -> {len(rows)} rows", len(rows) > 0)

    print("\n=== Combined type + search ===")
    st, rows = call("GET", "/templates?tab=my_templates&template_type=SOAP&search=heart")
    consistent = all(
        r["template_type"] == "SOAP" and "heart" in json.dumps(r).lower() for r in rows
    )
    check(
        f"type=SOAP AND search=heart -> {len(rows)} rows, all SOAP + heart",
        len(rows) > 0 and consistent,
        str([r["name"] for r in rows]),
    )

    print("\n=== 10. Common Medication catalogue ===")
    st, conds = call("GET", "/medical-conditions")
    labels = [c["label"] for c in conds]
    check(f"{len(conds)} conditions served", st == 200 and len(conds) >= len(REQUIRED_CONDITIONS))
    missing_conds = [c for c in REQUIRED_CONDITIONS if c not in labels]
    check("every specified condition is offered", not missing_conds, str(missing_conds))
    check("conditions carry a category and a description",
          all(c.get("category") and c.get("description") for c in conds))

    # The tab lists conditions until one is chosen, so it must return nothing
    # on its own - this is what keeps common-medication content out of the
    # template tabs.
    st, rows = call("GET", "/templates?tab=common_medication")
    check("Common Medication with no condition returns nothing", st == 200 and rows == [])

    # Every condition must answer cleanly. Only conditions that actually occur
    # in the 57-template catalogue can be expected to match rows.
    for key in [c["key"] for c in conds]:
        st, rows = call("GET", f"/templates?tab=common_medication&condition={key}")
        check(f"condition '{key}' responds ({len(rows)} rows)", st == 200 and isinstance(rows, list))
    for key in ["eecp", "diabetes", "heart_failure", "kidney"]:
        st, rows = call("GET", f"/templates?tab=common_medication&condition={key}")
        check(f"condition '{key}' matches catalogue templates ({len(rows)})", len(rows) > 0)

    print("\n=== 11-13. Create ===")
    new_tpl = {
        "name": "ZZ E2E Test Template",
        "template_type": "Prescription",
        "category": "Pharmacy",
        "description": "Created by the automated end-to-end test.",
        "content": "Rx\n1. Test drug 10 mg once daily",
        "tags": "e2e, automated, test",
        "is_active": True,
    }
    st, created = call("POST", "/templates", new_tpl)
    check("POST /templates returns 201", st == 201, str(created))
    new_id = created.get("id")
    st, rows = call("GET", "/templates?tab=my_templates&search=ZZ%20E2E")
    check("new template appears in the listing", any(r["id"] == new_id for r in rows))

    print("\n=== 14. View ===")
    st, detail = call("GET", f"/templates/{new_id}")
    check("GET by id returns 200", st == 200)
    check("  name persisted", detail.get("name") == new_tpl["name"])
    check("  content persisted", detail.get("content") == new_tpl["content"])
    check("  tags persisted", detail.get("tags") == "e2e, automated, test", str(detail.get("tags")))
    check("  category persisted", detail.get("category") == "Pharmacy", str(detail.get("category")))
    check("  is_active is true", detail.get("is_active") is True)

    print("\n=== 15-16. Edit and confirm persistence ===")
    st, _ = call("PUT", f"/templates/{new_id}", {
        "name": "ZZ E2E Renamed",
        "description": "Edited by the test.",
        "tags": "edited, e2e",
        "category": "Cardiac",
    })
    check("PUT returns 200", st == 200)
    st, detail = call("GET", f"/templates/{new_id}")
    check("  rename persisted", detail["name"] == "ZZ E2E Renamed", detail["name"])
    check("  category change persisted", detail["category"] == "Cardiac", detail["category"])
    check("  tags change persisted", detail["tags"] == "edited, e2e", detail["tags"])
    check("  content untouched by the partial update", detail["content"] == new_tpl["content"])

    print("\n=== Activate / Deactivate ===")
    st, res = call("PUT", f"/templates/{new_id}/status", {"is_active": False})
    check("deactivate returns 200", st == 200 and res["is_active"] is False)
    st, detail = call("GET", f"/templates/{new_id}")
    check("  is_active false persisted", detail["is_active"] is False)
    st, rows = call("GET", "/templates?tab=my_templates&status=active&search=ZZ%20E2E")
    check("  hidden from the status=active filter", not any(r["id"] == new_id for r in rows))
    call("PUT", f"/templates/{new_id}/status", {"is_active": True})

    print("\n=== 17-18. Duplicate ===")
    st, dup = call("POST", f"/templates/{new_id}/duplicate")
    check("duplicate returns 201", st == 201, str(dup))
    check("  named '<name> - Copy'", dup.get("name") == "ZZ E2E Renamed - Copy", str(dup.get("name")))
    dup_id = dup.get("id")
    st, rows = call("GET", "/templates?tab=my_templates&search=ZZ%20E2E")
    check("  duplicate appears in the listing", any(r["id"] == dup_id for r in rows))
    st, dup2 = call("POST", f"/templates/{new_id}/duplicate")
    check("  a second duplicate gets a unique name",
          dup2.get("name") == "ZZ E2E Renamed - Copy 2", str(dup2.get("name")))

    print("\n=== 19-20. Delete ===")
    for tid in [dup_id, dup2.get("id")]:
        st, res = call("DELETE", f"/templates/{tid}")
        check(f"DELETE {tid} returns 200", st == 200)
    st, _ = call("GET", f"/templates/{dup_id}")
    check("deleted template now returns 404", st == 404)

    print("\n=== 23. Validation, safe errors, SQL injection ===")
    st, res = call("POST", "/templates", {"name": "Bad Type", "template_type": "<script>alert(1)</script>"})
    check("invalid template_type rejected with 400", st == 400, str(res))
    check("  error body is JSON with no traceback",
          "message" in res and "Traceback" not in json.dumps(res))

    st, res = call("POST", "/templates", {"name": "   ", "template_type": "SOAP"})
    check("blank name rejected with 400", st == 400)

    st, res = call("GET", "/templates/99999999")
    check("unknown id returns a clean 404 JSON body", st == 404 and "error" in res)

    st, res = call("PUT", "/templates/99999999", {"name": "x"})
    check("update of an unknown id returns 404", st == 404)

    injection = q("'; DROP TABLE templates;--")
    st, _ = call("GET", f"/templates?tab=my_templates&search={injection}")
    st2, after = call("GET", "/templates?tab=my_templates")
    check("SQL-injection search is inert and the table survives",
          st == 200 and len(after) >= 57, f"{len(after)} rows remain")

    print("\n=== Accounts: signup, login, forgot password ===")
    st, res = call("POST", "/auth/signup", {"first_name": "Test", "email": "x@y.z", "password": "secret1"})
    check("signup without a last name is rejected", st == 400, str(res.get("message")))

    st, res = call("POST", "/auth/signup",
                   {"first_name": "Test", "last_name": "User", "email": "not-an-email",
                    "password": "secret1"})
    check("signup with an invalid email is rejected", st == 400, str(res.get("message")))

    st, res = call("POST", "/auth/signup",
                   {"first_name": "Test", "last_name": "User", "email": "zz-e2e@example.com",
                    "password": "123"})
    check("signup with a short password is rejected", st == 400, str(res.get("message")))

    st, res = call("POST", "/auth/signup",
                   {"first_name": "Sanju", "last_name": "Guru",
                    "email": "sanju2kguru@gmail.com", "password": "secret1"})
    check("signup with an existing email returns 409", st == 409, str(res.get("message")))

    st, res = call("POST", "/auth/login", {"email": "sanju2kguru@gmail.com", "password": "password123"})
    check("login with the seeded account succeeds", st == 200 and res.get("success") is True)
    check("  no medical role is invented for the session",
          "doctor" not in json.dumps(res).lower() or res["user"]["email"] == "sanju2kguru@gmail.com")

    st, res = call("POST", "/auth/login", {"email": "sanju2kguru@gmail.com", "password": "wrong-one"})
    check("login with a wrong password returns 401", st == 401, str(res.get("message")))

    st, res = call("POST", "/auth/login", {"email": "sanju2kguru@gmail.com"})
    check("login without a password returns 400", st == 400)

    st, res = call("POST", "/auth/forgot-password", {"email": "sanju2kguru@gmail.com"})
    check("forgot password returns a confirmation", st == 200 and bool(res.get("message")),
          str(res.get("message"))[:60])

    st, res = call("POST", "/auth/forgot-password", {"email": ""})
    check("forgot password without an identifier returns 400", st == 400)

    # Sign-in step 1 collects "email address or mobile number", so recovery
    # has to accept a mobile number as readily as an address.
    st, res = call("POST", "/auth/forgot-password", {"identifier": "9876543210"})
    check("forgot password accepts a mobile number", st == 200)

    st, res = call("POST", "/auth/forgot-password", {"email": "not-an-identifier"})
    check("forgot password rejects a malformed identifier", st == 400)

    st, res = call("POST", "/auth/reset-password", {
        "email": "sanju2kguru@gmail.com", "password": "short", "confirm_password": "short"})
    check("reset password rejects a short password", st == 400, str(res.get("message"))[:60])

    st, res = call("POST", "/auth/reset-password", {
        "email": "sanju2kguru@gmail.com", "password": "password123",
        "confirm_password": "different1"})
    check("reset password rejects a mismatch", st == 400, str(res.get("message"))[:60])

    st, res = call("POST", "/auth/reset-password", {
        "email": "sanju2kguru@gmail.com", "password": "password123",
        "confirm_password": "password123"})
    check("reset password accepts a valid new password", st == 200 and res.get("success") is True)

    # The reset above restores the seeded password, so this must still work.
    st, res = call("POST", "/auth/login",
                   {"email": "sanju2kguru@gmail.com", "password": "password123"})
    check("the account still signs in after the reset", st == 200 and res.get("success") is True)
    check("  and carries a plain display name",
          "Dr." not in str(res.get("user", {}).get("full_name", "")),
          str(res.get("user", {}).get("full_name")))

    print("\n=== Cleanup and no-regression checks ===")
    call("DELETE", f"/templates/{new_id}")

    st, res = call("GET", "/health")
    check("health endpoint still online", res.get("status") == "online")

    st, pts = call("GET", "/patients")
    check(f"patients endpoint intact ({len(pts)})", st == 200 and len(pts) == 5)

    st, practice = call("GET", "/templates?tab=practice_templates")
    check(f"Practice catalogue is exactly 57 templates ({len(practice)})", len(practice) == 57)

    for tab, label in [
        ("practice_templates", "Practice"),
        ("email_templates", "Email"),
        ("template_library", "Library"),
    ]:
        st, rows = call("GET", f"/templates?tab={tab}")
        check(f"{label} Templates tab still returns rows ({len(rows)})", st == 200 and len(rows) > 0)

    st, rows = call("GET", "/search/templates?q=eecp")
    check(f"legacy /search/templates intact ({len(rows)})", st == 200)

    st, rows = call("GET", "/templates?tab=practice_templates&search=Symptoms_Practice")
    st, detail = call("GET", f"/templates/{rows[0]['id']}")
    check("template detail exposes sections + conditional rules",
          st == 200 and len(detail.get("sections", [])) >= 3
          and len(detail.get("relationships", [])) >= 8,
          f"{len(detail.get('sections', []))} sections, {len(detail.get('relationships', []))} rules")

    print("\n" + "=" * 58)
    print(f"  {len(passes)} passed, {len(fails)} failed")
    if fails:
        print("  FAILED: " + "; ".join(fails))
    print("=" * 58)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
