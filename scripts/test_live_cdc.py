#!/usr/bin/env python3
# scripts/test_live_cdc.py
# Tests the Firestore-to-BigQuery live CDC replication by creating a profile
# via the API and verifying its arrival in BigQuery.

import sys
import uuid
import time
import requests
from google.cloud import bigquery

def main():
    project_id = "tavern-swiper-dev"
    auth_url = "https://auth-dev-374390417125.us-central1.run.app"
    profiles_url = "https://profiles-dev-374390417125.us-central1.run.app"

    print("🚀 Starting Live CDC Verification Test...")

    # 1. Mint Token for Test User
    print("🔑 Minting user token...")
    uid = f"uid-{uuid.uuid4().hex[:12]}"
    email = f"cdc-test-{uuid.uuid4().hex[:8]}@example.com"
    mint_resp = requests.post(f"{auth_url}/auth/dev-mint", json={
        "uid": uid,
        "email": email,
        "role": "user"
    })
    if mint_resp.status_code != 200:
        print(f"❌ Mint failed: {mint_resp.text}")
        sys.exit(1)
    token = mint_resp.json()["token"]
    print("✅ Token minted successfully.")

    # 2. Create Profile via API
    print("✨ Creating profile via profiles API...")
    display_name = f"CDC-Tester-{uuid.uuid4().hex[:4]}"
    prof_resp = requests.post(
        f"{profiles_url}/profiles/",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "display_name": display_name,
            "bio": f"Profile for {display_name}",
            "gender": []
        }
    )
    if prof_resp.status_code != 201:
        print(f"❌ Profile creation failed: {prof_resp.text}")
        sys.exit(1)
    profile_id = prof_resp.json()["profile_id"]
    print(f"✅ Profile created successfully (ID: {profile_id}, Name: {display_name}).")

    # 3. Wait for Replication
    wait_time = 15
    print(f"⏳ Waiting {wait_time} seconds for Eventarc and BigQuery replication...")
    time.sleep(wait_time)

    # 4. Verify in BigQuery
    print("🔎 Querying BigQuery to verify replication...")
    bq_client = bigquery.Client(project=project_id)
    
    # Verify in Profiles Source
    print("🔎 Checking profiles_analytics_dev.profiles_cdc...")
    query_source = f"""
    SELECT document_id, JSON_VALUE(data, "$.display_name") AS display_name, operation
    FROM `profiles_analytics_dev.profiles_cdc`
    WHERE document_id = '{profile_id}'
    """
    res_source = list(bq_client.query(query_source).result())
    if len(res_source) == 0:
        print("❌ Error: Profile was not found in BigQuery profiles_cdc! Live CDC streaming is not working or is delayed.")
        sys.exit(1)
    
    row_source = res_source[0]
    print(f"   ✅ SUCCESS: Profile found in Profiles BQ (Op: {row_source.operation})")

    # Verify in Discovery Cache
    print("🔎 Checking discovery_analytics_dev.profiles_cache_cdc...")
    query_cache = f"""
    SELECT document_id, JSON_VALUE(data, "$.display_name") AS display_name, operation
    FROM `discovery_analytics_dev.profiles_cache_cdc`
    WHERE document_id = '{profile_id}'
    """
    res_cache = list(bq_client.query(query_cache).result())
    if len(res_cache) == 0:
        print("❌ Error: Profile was not found in BigQuery profiles_cache_cdc! Pub/Sub cache sync or CDC trigger is not working or is delayed.")
        sys.exit(1)
    
    row_cache = res_cache[0]
    print(f"   ✅ SUCCESS: Profile found in Discovery Cache BQ (Op: {row_cache.operation})")

    print("\n🎉 SUCCESS! Profile successfully streamed to both BigQuery tables in real-time:")
    print(f"   • Document ID:  {profile_id}")
    print(f"   • Display Name: {display_name}")
    print("\n🏁 Test completed successfully!")


if __name__ == "__main__":
    main()
