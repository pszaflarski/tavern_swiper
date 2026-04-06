import subprocess
import requests
import os

PROJECT = "tavern-swiper-dev"
DATABASES = ["users-test", "profiles-test", "auth-test", "swipes-test", "messages-test", "discovery-test"]

token = subprocess.check_output(["gcloud", "auth", "print-access-token"]).decode("utf-8").strip()
headers = {"Authorization": f"Bearer {token}"}

for db in DATABASES:
    print(f"Cleaning {db}...")
    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/{db}/documents"
    resp = requests.get(url, headers=headers)
    if resp.status_code == 200:
        docs = resp.json().get("documents", [])
        for doc in docs:
            doc_name = doc["name"]
            del_resp = requests.delete(f"https://firestore.googleapis.com/v1/{doc_name}", headers=headers)
            print(f"  Deleted {doc_name}: {del_resp.status_code}")
    else:
        print(f"Failed to list {db}: {resp.status_code} {resp.text}")

print("Done")
