import pytest
import os
import asyncio
import uuid
import httpx
from .helpers import register_user, create_profile, PROFILES_URL, DISCOVERY_URL
from google.cloud import bigquery

@pytest.mark.asyncio
async def test_profile_creation_cdc_replicates_to_bigquery():
    """Verify that creating a profile via REST API replicates to BigQuery profiles_cdc table via Eventarc CDC."""
    if os.getenv("IS_LOCAL") == "1":
        pytest.skip("Skipping BigQuery CDC verification in local mode")

    env_name = os.getenv("ENV_NAME", os.getenv("ENV", "dev"))
    project_id = "tavern-swiper-prod" if env_name == "prod" else "tavern-swiper-dev"

    async with httpx.AsyncClient(timeout=30.0) as client:
        user_ctx = await register_user(client)
        display_name = f"CDC-Hero-{uuid.uuid4().hex[:6]}"
        profile_id = await create_profile(client, user_ctx["token"], display_name)

        bq_client = bigquery.Client(project=project_id)
        dataset_id = f"profiles_analytics_{env_name}"
        table_id = f"{project_id}.{dataset_id}.profiles_cdc"

        query = f"""
            SELECT document_id, operation, data
            FROM `{table_id}`
            WHERE document_id = @profile_id
            LIMIT 1
        """
        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("profile_id", "STRING", profile_id)
            ]
        )

        found = False
        for _ in range(15):
            try:
                results = list(bq_client.query(query, job_config=job_config).result())
                if results:
                    row = results[0]
                    assert row["document_id"] == profile_id
                    assert display_name in row["data"]
                    found = True
                    break
            except Exception as e:
                pass
            await asyncio.sleep(2)

        assert found, f"Profile {profile_id} was not replicated to BigQuery {table_id} within timeout"

@pytest.mark.asyncio
async def test_mutual_match_cdc_replicates_to_bigquery():
    """Verify that a mutual swipe match replicates to BigQuery matches_cdc table."""
    if os.getenv("IS_LOCAL") == "1":
        pytest.skip("Skipping BigQuery CDC verification in local mode")

    env_name = os.getenv("ENV_NAME", os.getenv("ENV", "dev"))
    project_id = "tavern-swiper-prod" if env_name == "prod" else "tavern-swiper-dev"

    async with httpx.AsyncClient(timeout=30.0) as client:
        u1 = await register_user(client)
        u2 = await register_user(client)
        
        p1_id = await create_profile(client, u1["token"], f"CDC-Match1-{uuid.uuid4().hex[:4]}")
        p2_id = await create_profile(client, u2["token"], f"CDC-Match2-{uuid.uuid4().hex[:4]}")

        # Wait 5s for profile cache propagation to discovery
        await asyncio.sleep(5)

        # 2. Swipe RIGHT on each other
        s1 = await client.post(
            f"{DISCOVERY_URL}/discovery/swipe/",
            headers={"Authorization": f"Bearer {u1['token']}"},
            json={"swiper_profile_id": p1_id, "swiped_profile_id": p2_id, "direction": "right"}
        )
        assert s1.status_code == 201

        s2 = await client.post(
            f"{DISCOVERY_URL}/discovery/swipe/",
            headers={"Authorization": f"Bearer {u2['token']}"},
            json={"swiper_profile_id": p2_id, "swiped_profile_id": p1_id, "direction": "right"}
        )
        assert s2.status_code == 201
        
        swipe_data = s2.json()
        match_id = swipe_data.get("match_id") or swipe_data.get("id")
        assert match_id is not None, f"Expected match_id in swipe response: {swipe_data}"

        # 3. Poll BigQuery for match replication
        bq_client = bigquery.Client(project=project_id)
        dataset_id = f"discovery_analytics_{env_name}"
        table_id = f"{project_id}.{dataset_id}.matches_cdc"

        query = f"""
            SELECT document_id, operation
            FROM `{table_id}`
            WHERE document_id = @match_id
            LIMIT 1
        """
        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("match_id", "STRING", match_id)
            ]
        )

        found = False
        for _ in range(15):
            try:
                results = list(bq_client.query(query, job_config=job_config).result())
                if results:
                    found = True
                    break
            except Exception:
                pass
            await asyncio.sleep(2)

        assert found, f"Match {match_id} was not replicated to BigQuery {table_id} within timeout"
