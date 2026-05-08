import pytest
import httpx
import asyncio
import os
from .helpers import register_user, create_profile, DISCOVERY_URL, PROFILES_URL


@pytest.mark.asyncio
async def test_feed_surfaces_all_profiles_and_excludes_swipes():
    """
    End-to-end Integration Test: Feed Coverage & Swipe Exclusion

    Validates that the discovery pipeline deterministically surfaces every
    eligible profile and never returns a profile that has been swiped.

    Steps:
      1. Create 6 users, each with a profile
      2. Wait for Pub/Sub propagation to the discovery cache
      3. As user A, fetch the discovery feed in batches (limit=2)
      4. After each batch, swipe LEFT on every returned profile
      5. Repeat until the feed returns empty
      6. Assert every non-A profile was seen exactly once
      7. Assert A's own profile never appeared
    """
    NUM_USERS = 6
    BATCH_LIMIT = 2

    async with httpx.AsyncClient(timeout=30.0) as client:
        # --- 1. Create users and profiles ---
        users = []
        for i in range(NUM_USERS):
            user = await register_user(client)
            pid = await create_profile(client, user["token"], f"CoverageHero-{i}")
            users.append({"user": user, "profile_id": pid})

        swiper = users[0]
        swiper_pid = swiper["profile_id"]
        swiper_headers = {"Authorization": f"Bearer {swiper['user']['token']}"}

        # All other profiles that should appear in swiper's feed
        expected_pids = {u["profile_id"] for u in users[1:]}

        # --- 2. Wait for Pub/Sub to propagate profiles to discovery cache ---
        print(f"\n⏳ Waiting 8s for Pub/Sub propagation of {NUM_USERS} profiles...")
        await asyncio.sleep(8)

        # --- 3 & 4. Iteratively fetch + swipe until feed is empty ---
        seen_pids = set()
        swiped_pids = set()
        max_iterations = NUM_USERS * 3  # Safety valve
        iteration = 0

        while iteration < max_iterations:
            iteration += 1

            resp = await client.get(
                f"{DISCOVERY_URL}/discovery/feed/{swiper_pid}?limit={BATCH_LIMIT}",
                headers=swiper_headers,
            )
            assert resp.status_code == 200, f"Feed fetch failed: {resp.text}"
            profiles = resp.json().get("profiles", [])

            if len(profiles) == 0:
                print(f"  📭 Feed empty after {iteration} iterations")
                break

            for p in profiles:
                pid = p["profile_id"]
                assert pid != swiper_pid, f"Swiper's own profile {pid} appeared in feed!"
                assert pid not in swiped_pids, (
                    f"Profile {pid} reappeared after being swiped! "
                    f"(iteration {iteration})"
                )
                seen_pids.add(pid)

                # Swipe left so it's excluded on next fetch
                swipe_resp = await client.post(
                    f"{DISCOVERY_URL}/discovery/swipe/",
                    headers=swiper_headers,
                    json={
                        "swiper_profile_id": swiper_pid,
                        "swiped_profile_id": pid,
                        "direction": "left",
                    },
                )
                assert swipe_resp.status_code == 201, f"Swipe failed: {swipe_resp.text}"
                swiped_pids.add(pid)

        # --- 5. Assertions ---
        # Every expected profile should have been surfaced
        missing = expected_pids - seen_pids
        assert len(missing) == 0, (
            f"These profiles were never surfaced: {missing}. "
            f"Seen: {seen_pids}"
        )

        # No unexpected profiles should have appeared (only our test profiles matter,
        # but other profiles from the shared dev DB may show up — we just care that
        # all expected ones were included)
        assert expected_pids.issubset(seen_pids), (
            f"Not all expected profiles were seen. "
            f"Expected: {expected_pids}, Seen: {seen_pids}"
        )

        print(
            f"\n✅ Feed coverage verified: {len(seen_pids)} profiles surfaced "
            f"({len(expected_pids)} expected) in {iteration} iterations "
            f"(batch={BATCH_LIMIT})"
        )


@pytest.mark.asyncio
async def test_feed_returns_no_swiped_profiles_after_full_sweep():
    """
    End-to-end Integration Test: Post-Exhaustion Feed Emptiness

    After swiping on ALL profiles, the feed should return an empty list.
    This specifically tests the pipeline's NotEqualAny with a growing
    exclusion set.
    """
    NUM_USERS = 4
    BATCH_LIMIT = 10

    async with httpx.AsyncClient(timeout=30.0) as client:
        users = []
        for i in range(NUM_USERS):
            user = await register_user(client)
            pid = await create_profile(client, user["token"], f"SweepHero-{i}")
            users.append({"user": user, "profile_id": pid})

        swiper = users[0]
        swiper_pid = swiper["profile_id"]
        swiper_headers = {"Authorization": f"Bearer {swiper['user']['token']}"}

        print(f"\n⏳ Waiting 8s for Pub/Sub propagation...")
        await asyncio.sleep(8)

        # Swipe on everything that appears
        for _ in range(NUM_USERS * 3):
            resp = await client.get(
                f"{DISCOVERY_URL}/discovery/feed/{swiper_pid}?limit={BATCH_LIMIT}",
                headers=swiper_headers,
            )
            profiles = resp.json().get("profiles", [])
            if not profiles:
                break

            for p in profiles:
                await client.post(
                    f"{DISCOVERY_URL}/discovery/swipe/",
                    headers=swiper_headers,
                    json={
                        "swiper_profile_id": swiper_pid,
                        "swiped_profile_id": p["profile_id"],
                        "direction": "left",
                    },
                )

        # Now the feed MUST be empty
        final_resp = await client.get(
            f"{DISCOVERY_URL}/discovery/feed/{swiper_pid}?limit={BATCH_LIMIT}",
            headers=swiper_headers,
        )
        assert final_resp.status_code == 200
        final_profiles = final_resp.json().get("profiles", [])

        # Filter to only our test profiles (shared DB may have others,
        # but our swiped profiles should definitely not reappear)
        our_pids = {u["profile_id"] for u in users}
        leaked = [p for p in final_profiles if p["profile_id"] in our_pids]
        assert len(leaked) == 0, (
            f"Swiped profiles leaked back into feed: "
            f"{[p['profile_id'] for p in leaked]}"
        )

        print(f"\n✅ Post-exhaustion feed correctly empty of test profiles")
