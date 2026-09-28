import urllib.request
import json

def test_endpoints():
    base = "http://127.0.0.1:5000"
    
    # 1. Health
    req = urllib.request.urlopen(f"{base}/api/health")
    health = json.loads(req.read())
    print("1. Health Check:", health.get("status"), "-", health.get("service"))
    
    # 2. Login
    login_data = json.dumps({"email": "sanju2kguru@gmail.com", "password": "password123"}).encode('utf-8')
    req = urllib.request.Request(f"{base}/api/auth/login", data=login_data, headers={"Content-Type": "application/json"})
    login = json.loads(urllib.request.urlopen(req).read())
    print("2. Login Check:", login["user"]["full_name"], f"({login['user']['role']})")
    
    # 3. Patients
    req = urllib.request.urlopen(f"{base}/api/patients")
    patients = json.loads(req.read())
    print(f"3. Patients Check: {len(patients)} demo patients seeded (Top: {patients[0]['full_name']} - {patients[0]['mrn']})")
    
    # 4. Practice Templates
    req = urllib.request.urlopen(f"{base}/api/templates?tab=practice_templates")
    practice = json.loads(req.read())
    print(f"4. Practice Templates Check: {len(practice)} templates available")
    
    # 5. Search Templates
    req = urllib.request.urlopen(f"{base}/api/search/templates?q=chest")
    search_res = json.loads(req.read())
    print(f"5. Search 'chest': {len(search_res)} found (Top: {search_res[0]['name']})")
    
    # 6. Template Details & Horizontal Relationships
    req = urllib.request.urlopen(f"{base}/api/templates/1")
    tpl1 = json.loads(req.read())
    print(f"6. Template 1: '{tpl1['name']}' with {len(tpl1.get('relationships', []))} horizontal pathway links")
    for r in tpl1.get('relationships', []):
        print(f"   Link: '{r.get('parent_label')}' = '{r.get('trigger_value')}' -> '{r.get('child_label')}'")
        
    # 7. Save Consultation
    consult_payload = json.dumps({
        "patient_id": patients[0]["id"],
        "template_id": 1,
        "doctor_name": "Dr. Sanju Guru, MD",
        "notes": "Chest pain triage via horizontal clinical pathway progressive disclosure",
        "responses": [
            {"component_id": 1, "component_label": "Chest Pain Present?", "response_value": "Yes"},
            {"component_id": 2, "component_label": "Pain Severity Level", "response_value": "Severe"},
            {"component_id": 3, "component_label": "Clinical Classification", "response_value": "With Exertion"}
        ]
    }).encode('utf-8')
    req = urllib.request.Request(f"{base}/api/responses", data=consult_payload, headers={"Content-Type": "application/json"})
    save_res = json.loads(urllib.request.urlopen(req).read())
    print(f"7. Save Consultation: ID #{save_res.get('consultation_id')} - {save_res.get('message')}")
    
    # 8. Retrieve Consultation
    req = urllib.request.urlopen(f"{base}/api/responses/{save_res['consultation_id']}")
    retrieved = json.loads(req.read())
    print(f"8. Retrieved Saved Consultation for {retrieved.get('patient_name')}: {len(retrieved.get('responses', []))} responses verified")

if __name__ == "__main__":
    test_endpoints()
