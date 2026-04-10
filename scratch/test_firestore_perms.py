from google.cloud import firestore
import os

project = "tavern-swiper-dev"
database = "users-test"

print(f"Testing Firestore access to {project}/{database}...")
try:
    db = firestore.Client(project=project, database=database)
    collections = list(db.collections())
    print(f"Successfully connected! Found {len(collections)} collections.")
    for coll in collections:
        print(f" - {coll.id}")
except Exception as e:
    print(f"FAILED: {e}")
