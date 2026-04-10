import google.auth
from google.cloud import firestore
import os

print(f"ENV GOOGLE_APPLICATION_CREDENTIALS: {os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')}")
print(f"ENV GOOGLE_CLOUD_PROJECT: {os.environ.get('GOOGLE_CLOUD_PROJECT')}")

credentials, project = google.auth.default()
print(f"Project: {project}")
print(f"Credentials Type: {type(credentials)}")

if hasattr(credentials, 'service_account_email'):
    print(f"Service Account Email: {credentials.service_account_email}")

try:
    db = firestore.Client(project=project, database=os.environ.get("FIRESTORE_DATABASE_ID"))
    print(f"Testing access to database: {db._database}")
    collections = list(db.collections())
    print(f"Success! Found {len(collections)} collections.")
except Exception as e:
    print(f"FAILURE: {e}")
