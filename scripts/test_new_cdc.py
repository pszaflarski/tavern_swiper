#!/usr/bin/env python3
# scripts/test_new_cdc.py
# Tests the new Firestore-to-BigQuery live CDC replication for users and messages matches cache.

import sys
import uuid
import time
from google.cloud import firestore
from google.cloud import bigquery

def test_users_cdc(project_id, env):
    print("🔑 Testing Users CDC...")
    db = firestore.Client(project=project_id, database=f"users-{env}")
    user_id = f"test-user-{uuid.uuid4().hex[:8]}"
    email = f"test-user-{uuid.uuid4().hex[:4]}@example.com"
    doc_ref = db.collection("users").document(user_id)
    
    print(f"   • Creating test user document in Firestore (ID: {user_id})...")
    doc_ref.set({
        "email": email,
        "role": "user",
        "created_at": firestore.SERVER_TIMESTAMP
    })
    
    wait_time = 15
    print(f"   • Waiting {wait_time} seconds for replication...")
    time.sleep(wait_time)
    
    print("   • Querying BigQuery to verify...")
    bq_client = bigquery.Client(project=project_id)
    query = """
    SELECT document_id, JSON_VALUE(data, "$.email") AS email, operation
    FROM `users_analytics_{env}.users_cdc`
    WHERE document_id = '{user_id}'
    """.replace("{env}", env).replace("{user_id}", user_id)
    
    query_job = bq_client.query(query)
    results = list(query_job.result())
    
    # Clean up Firestore document
    print("   • Cleaning up Firestore test user document...")
    doc_ref.delete()
    
    if len(results) == 0:
        print("   ❌ Error: User was not found in BigQuery users_cdc!")
        return False
        
    row = results[0]
    print("   ✅ SUCCESS! User successfully replicated to BigQuery:")
    print(f"      • Document ID:  {row.document_id}")
    print(f"      • Email:        {row.email}")
    print(f"      • Operation:    {row.operation}")
    return True

def test_messages_cdc(project_id, env):
    print("💬 Testing Messages Matches Cache CDC...")
    db = firestore.Client(project=project_id, database=f"messages-{env}")
    match_id = f"test-match-{uuid.uuid4().hex[:8]}"
    doc_ref = db.collection("discovery_matches_cache").document(match_id)
    
    print(f"   • Creating test match cache document in Firestore (ID: {match_id})...")
    doc_ref.set({
        "match_id": match_id,
        "profile_ids": ["profile-a", "profile-b"],
        "created_at": firestore.SERVER_TIMESTAMP
    })
    
    wait_time = 15
    print(f"   • Waiting {wait_time} seconds for replication...")
    time.sleep(wait_time)
    
    print("   • Querying BigQuery to verify...")
    bq_client = bigquery.Client(project=project_id)
    query = """
    SELECT document_id, JSON_VALUE(data, "$.match_id") AS match_id, operation
    FROM `messages_analytics_{env}.matches_cdc`
    WHERE document_id = '{match_id}'
    """.replace("{env}", env).replace("{match_id}", match_id)
    
    query_job = bq_client.query(query)
    results = list(query_job.result())
    
    # Clean up Firestore document
    print("   • Cleaning up Firestore test match document...")
    doc_ref.delete()
    
    if len(results) == 0:
        print("   ❌ Error: Match cache doc was not found in BigQuery matches_cdc!")
        return False
        
    row = results[0]
    print("   ✅ SUCCESS! Match cache successfully replicated to BigQuery:")
    print(f"      • Document ID:  {row.document_id}")
    print(f"      • Match ID:     {row.match_id}")
    print(f"      • Operation:    {row.operation}")
    return True

def main():
    project_id = "tavern-swiper-dev"
    env = "dev"
    
    print("🚀 Starting Live CDC Verification for Users and Messages...")
    
    users_ok = test_users_cdc(project_id, env)
    print()
    messages_ok = test_messages_cdc(project_id, env)
    
    print()
    if users_ok and messages_ok:
        print("🎉 All live CDC replications verified successfully!")
        sys.exit(0)
    else:
        print("❌ Verification failed.")
        sys.exit(1)

if __name__ == "__main__":
    main()
