#!/usr/bin/env python3
# scripts/backfill_to_bq.py
# Backfills existing Firestore documents into BigQuery CDC tables.

import sys
import uuid
import json
from datetime import datetime, timezone
from google.cloud import firestore
from google.cloud import bigquery
from google.cloud.firestore import DocumentReference, GeoPoint

class FirestoreJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        if isinstance(obj, DocumentReference):
            return obj.path
        if isinstance(obj, GeoPoint):
            return {"latitude": obj.latitude, "longitude": obj.longitude}
        return super().default(obj)

def get_active_project():
    import subprocess
    try:
        res = subprocess.run(["gcloud", "config", "get-value", "project"], capture_output=True, text=True, check=True)
        return res.stdout.strip()
    except Exception:
        return None

def backfill_collection(project_id, env, database_id, collection_name, dataset_name, table_name):
    print(f"📖 Reading from Firestore: db={database_id}, collection={collection_name}...")
    db = firestore.Client(project=project_id, database=database_id)
    bq_client = bigquery.Client(project=project_id)

    docs = list(db.collection(collection_name).stream())
    if not docs:
        print(f"ℹ️ No documents found in {collection_name} collection.")
        return

    print(f"✨ Found {len(docs)} documents. Writing to BigQuery {dataset_name}.{table_name}...")
    
    rows = []
    for doc in docs:
        doc_data = doc.to_dict()
        data_json = json.dumps(doc_data, cls=FirestoreJSONEncoder)
        
        # Use update_time or create_time metadata if available, otherwise now
        update_time = doc.update_time or datetime.now(timezone.utc)
        
        rows.append({
            "timestamp": update_time.isoformat(),
            "event_id": f"backfill-{uuid.uuid4()}",
            "document_name": f"projects/{project_id}/databases/{database_id}/documents/{collection_name}/{doc.id}",
            "document_id": doc.id,
            "operation": "IMPORT",
            "data": data_json,
            "old_data": "{}"
        })

    # Insert in batches
    table_ref = bq_client.dataset(dataset_name).table(table_name)
    errors = bq_client.insert_rows_json(table_ref, rows)
    if errors:
        print(f"❌ Failed to insert rows: {errors}")
        sys.exit(1)
    
    print(f"✅ Successfully backfilled {len(rows)} documents to {dataset_name}.{table_name}")

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 backfill_to_bq.py [dev|test|prod] [project_id]")
        sys.exit(1)

    env = sys.argv[1]
    project_id = sys.argv[2] if len(sys.argv) > 2 else get_active_project()

    if not project_id:
        print("❌ Error: Could not detect active gcloud project. Please specify it as second argument.")
        sys.exit(1)

    if env == "prod":
        print("⚠️ WARNING: This command will modify the PRODUCTION environment.")
        confirm = input("Are you sure you want to proceed with Prod backfill? (y/N) ")
        if confirm.lower() != 'y':
            print("Aborting.")
            sys.exit(1)

    print(f"🚀 Starting backfill to BigQuery for project: {project_id}, env: {env}")

    # Backfill Profiles
    backfill_collection(
        project_id=project_id,
        env=env,
        database_id=f"profiles-{env}",
        collection_name="profiles",
        dataset_name=f"profiles_analytics_{env}",
        table_name="profiles_cdc"
    )

    # Backfill Discovery (Matches)
    backfill_collection(
        project_id=project_id,
        env=env,
        database_id=f"discovery-{env}",
        collection_name="matches",
        dataset_name=f"discovery_analytics_{env}",
        table_name="matches_cdc"
    )

    # Backfill Messages (Matches Cache)
    backfill_collection(
        project_id=project_id,
        env=env,
        database_id=f"messages-{env}",
        collection_name="discovery_matches_cache",
        dataset_name=f"messages_analytics_{env}",
        table_name="matches_cdc"
    )

    # Backfill Users
    backfill_collection(
        project_id=project_id,
        env=env,
        database_id=f"users-{env}",
        collection_name="users",
        dataset_name=f"users_analytics_{env}",
        table_name="users_cdc"
    )

    # Backfill Discovery Profiles Cache
    backfill_collection(
        project_id=project_id,
        env=env,
        database_id=f"discovery-{env}",
        collection_name="profiles_profiles_cache",
        dataset_name=f"discovery_analytics_{env}",
        table_name="profiles_cache_cdc"
    )

    print("🏁 Backfill completed!")

if __name__ == "__main__":
    main()
