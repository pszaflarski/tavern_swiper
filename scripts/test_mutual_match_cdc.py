#!/usr/bin/env python3
# scripts/test_mutual_match_cdc.py
# Automates a mutual swipe match between two test profiles using the REST APIs,
# and verifies that the match records successfully replicate to BigQuery CDC tables.

import sys
import uuid
import time
import requests
from google.cloud import bigquery

def main():
    project_id = "tavern-swiper-dev"
    auth_url = "https://auth-dev-374390417125.us-central1.run.app"
    profiles_url = "https://profiles-dev-374390417125.us-central1.run.app"
    discovery_url = "https://discovery-dev-374390417125.us-central1.run.app"

    print("🚀 Starting Mutual Match CDC Verification Test...")

    # 1. Mint token and create profile for User 1
    print("🔑 Minting token for User 1...")
    uid1 = f"uid-u1-{uuid.uuid4().hex[:8]}"
    email1 = f"match-u1-{uuid.uuid4().hex[:4]}@example.com"
    mint_resp1 = requests.post(f"{auth_url}/auth/dev-mint", json={"uid": uid1, "email": email1, "role": "user"})
    if mint_resp1.status_code != 200:
        print(f"❌ User 1 mint failed: {mint_resp1.text}")
        sys.exit(1)
    token1 = mint_resp1.json()["token"]

    print("✨ Creating Profile 1...")
    name1 = f"Match-P1-{uuid.uuid4().hex[:4]}"
    prof_resp1 = requests.post(
        f"{profiles_url}/profiles/",
        headers={"Authorization": f"Bearer {token1}"},
        json={"display_name": name1, "bio": f"Bio for {name1}", "gender": []}
    )
    if prof_resp1.status_code != 201:
        print(f"❌ Profile 1 creation failed: {prof_resp1.text}")
        sys.exit(1)
    profile_id1 = prof_resp1.json()["profile_id"]
    print(f"✅ Profile 1 created: {profile_id1} ({name1})")

    # 2. Mint token and create profile for User 2
    print("🔑 Minting token for User 2...")
    uid2 = f"uid-u2-{uuid.uuid4().hex[:8]}"
    email2 = f"match-u2-{uuid.uuid4().hex[:4]}@example.com"
    mint_resp2 = requests.post(f"{auth_url}/auth/dev-mint", json={"uid": uid2, "email": email2, "role": "user"})
    if mint_resp2.status_code != 200:
        print(f"❌ User 2 mint failed: {mint_resp2.text}")
        sys.exit(1)
    token2 = mint_resp2.json()["token"]

    print("✨ Creating Profile 2...")
    name2 = f"Match-P2-{uuid.uuid4().hex[:4]}"
    prof_resp2 = requests.post(
        f"{profiles_url}/profiles/",
        headers={"Authorization": f"Bearer {token2}"},
        json={"display_name": name2, "bio": f"Bio for {name2}", "gender": []}
    )
    if prof_resp2.status_code != 201:
        print(f"❌ Profile 2 creation failed: {prof_resp2.text}")
        sys.exit(1)
    profile_id2 = prof_resp2.json()["profile_id"]
    print(f"✅ Profile 2 created: {profile_id2} ({name2})")

    # 3. Wait for Pub/Sub cache synchronization
    wait_sync = 10
    print(f"⏳ Waiting {wait_sync} seconds for profiles to cache in Discovery boundary...")
    time.sleep(wait_sync)

    # 4. User 1 swipes Right on User 2
    print(f"👉 User 1 ({profile_id1}) swipes RIGHT on User 2 ({profile_id2})...")
    swipe_resp1 = requests.post(
        f"{discovery_url}/discovery/swipe/",
        headers={"Authorization": f"Bearer {token1}"},
        json={
            "swiper_profile_id": profile_id1,
            "swiped_profile_id": profile_id2,
            "direction": "right"
        }
    )
    if swipe_resp1.status_code != 201:
        print(f"❌ Swipe 1 failed: {swipe_resp1.text}")
        sys.exit(1)
    print("✅ Swipe 1 recorded successfully.")

    # 5. User 2 swipes Right on User 1 (Mutual Match!)
    print(f"👉 User 2 ({profile_id2}) swipes RIGHT on User 1 ({profile_id1})...")
    swipe_resp2 = requests.post(
        f"{discovery_url}/discovery/swipe/",
        headers={"Authorization": f"Bearer {token2}"},
        json={
            "swiper_profile_id": profile_id2,
            "swiped_profile_id": profile_id1,
            "direction": "right"
        }
    )
    if swipe_resp2.status_code != 201:
        print(f"❌ Swipe 2 failed: {swipe_resp2.text}")
        sys.exit(1)
    
    match_data = swipe_resp2.json()
    match_id = match_data.get("match_id")
    if not match_id:
        print("❌ Error: Swipe completed but no match_id was returned in response!")
        sys.exit(1)
    
    print(f"🎉 MUTUAL MATCH DETECTED! Match ID: {match_id}")

    # 6. Wait for replication to BigQuery
    wait_bq = 15
    print(f"⏳ Waiting {wait_bq} seconds for Eventarc & BigQuery replication...")
    time.sleep(wait_bq)

    # 7. Query BigQuery tables
    bq_client = bigquery.Client(project=project_id)

    # Check Discovery Matches table
    print("🔎 Verifying in Discovery BigQuery CDC table...")
    query_discovery = f"""
    SELECT document_id, operation, timestamp
    FROM `discovery_analytics_dev.matches_cdc`
    WHERE document_id = '{match_id}'
    """
    res_disc = list(bq_client.query(query_discovery).result())
    if len(res_disc) == 0:
        print("❌ Error: Match was not found in Discovery BQ table matches_cdc!")
        sys.exit(1)
    row_disc = res_disc[0]
    print(f"   ✅ SUCCESS: Match found in Discovery BQ (Op: {row_disc.operation}, Time: {row_disc.timestamp})")

    # Check Messages Matches Cache table
    print("🔎 Verifying in Messages Cache BigQuery CDC table...")
    query_messages = f"""
    SELECT document_id, operation, timestamp
    FROM `messages_analytics_dev.matches_cdc`
    WHERE document_id = '{match_id}'
    """
    res_msg = list(bq_client.query(query_messages).result())
    if len(res_msg) == 0:
        print("❌ Error: Match was not found in Messages BQ table matches_cdc!")
        sys.exit(1)
    row_msg = res_msg[0]
    print(f"   ✅ SUCCESS: Match found in Messages BQ (Op: {row_msg.operation}, Time: {row_msg.timestamp})")

    print("\n🏁 Mutual Match CDC test completed successfully!")

if __name__ == "__main__":
    main()
