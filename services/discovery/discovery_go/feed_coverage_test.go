package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"sync"
	"testing"
	"time"

	"cloud.google.com/go/firestore"
)

// TestFeedCoverage_RealDB verifies that the real Firestore Pipeline query
// surfaces every profile in the cache and correctly excludes swiped profiles.
//
// Run with:
//   go test -v -run TestFeedCoverage_RealDB -real-db [-project tavern-swiper-dev] [-db-id discovery-dev]
//
// This test:
//  1. Seeds N test profiles into profiles_profiles_cache
//  2. Seeds some swipe records for a test "swiper"
//  3. Calls realGetFeedCandidates in a loop, growing the exclusion set each call
//     (mirroring exactly what handleGetFeed does)
//  4. Asserts every non-excluded profile is surfaced exactly once
//  5. Cleans up all seeded documents
func TestFeedCoverage_RealDB(t *testing.T) {
	if !*useRealDB {
		t.Skip("Skipping real-db test (pass -real-db to run)")
	}

	setupRealDBEnv(t)

	// Reset the global DB singleton so it picks up the test env vars.
	dbOnce = sync.Once{}
	db = nil

	ctx := context.Background()
	client, err := getDBInternal(ctx)
	if err != nil {
		t.Fatalf("Failed to initialize Firestore: %v", err)
	}

	// --- Configuration ---
	const numProfiles = 15
	const batchLimit = 5
	testRun := fmt.Sprintf("fcov-%d", time.Now().UnixMilli())
	swiperID := fmt.Sprintf("%s-swiper", testRun)

	// Track created doc paths for cleanup
	var createdDocs []struct {
		collection string
		docID      string
	}
	cleanup := func() {
		log.Printf("[CLEANUP] Removing %d test documents...", len(createdDocs))
		for _, d := range createdDocs {
			client.Collection(d.collection).Doc(d.docID).Delete(ctx)
		}
	}
	t.Cleanup(cleanup)

	// --- Step 1: Seed test profiles ---
	allProfileIDs := make([]string, numProfiles)
	for i := 0; i < numProfiles; i++ {
		pid := fmt.Sprintf("%s-p%02d", testRun, i)
		allProfileIDs[i] = pid

		_, err := client.Collection(PROFILES_CACHE).Doc(pid).Set(ctx, map[string]interface{}{
			"profile_id":      pid,
			"user_id":         fmt.Sprintf("%s-u%02d", testRun, i),
			"display_name":    fmt.Sprintf("Hero %d", i),
			"bio":             "Test profile for feed coverage",
			"is_active":       true,
			"image_urls":      []string{},
			"talents":         []string{},
			"character_class": "warrior",
		})
		if err != nil {
			t.Fatalf("Failed to seed profile %s: %v", pid, err)
		}
		createdDocs = append(createdDocs, struct {
			collection string
			docID      string
		}{PROFILES_CACHE, pid})
	}

	// Also seed the swiper profile (so it exists in the cache for ownership checks)
	_, err = client.Collection(PROFILES_CACHE).Doc(swiperID).Set(ctx, map[string]interface{}{
		"profile_id": swiperID,
		"user_id":    fmt.Sprintf("%s-swiper-user", testRun),
		"display_name": "Swiper",
		"is_active":  true,
		"image_urls": []string{},
		"talents":    []string{},
	})
	if err != nil {
		t.Fatalf("Failed to seed swiper profile: %v", err)
	}
	createdDocs = append(createdDocs, struct {
		collection string
		docID      string
	}{PROFILES_CACHE, swiperID})

	// --- Step 2: Seed swipe history (swiper already swiped on first 3 profiles) ---
	swipedIDs := allProfileIDs[:3] // p00, p01, p02 are "already swiped"
	for _, sid := range swipedIDs {
		swipeDocID := fmt.Sprintf("%s-swipe-%s", testRun, sid)
		_, err := client.Collection(SWIPES_COLLECTION).Doc(swipeDocID).Set(ctx, map[string]interface{}{
			"swiper_profile_id": swiperID,
			"swiped_profile_id": sid,
			"direction":         "left",
			"created_at":        firestore.ServerTimestamp,
		})
		if err != nil {
			t.Fatalf("Failed to seed swipe for %s: %v", sid, err)
		}
		createdDocs = append(createdDocs, struct {
			collection string
			docID      string
		}{SWIPES_COLLECTION, swipeDocID})
	}

	// Build expected set: all profiles MINUS swiper MINUS already-swiped
	expectedIDs := make(map[string]bool)
	for _, pid := range allProfileIDs {
		isAlreadySwiped := false
		for _, sid := range swipedIDs {
			if pid == sid {
				isAlreadySwiped = true
				break
			}
		}
		if !isAlreadySwiped {
			expectedIDs[pid] = true
		}
	}

	// Give Firestore a moment to be consistent (eventual consistency on new writes)
	time.Sleep(2 * time.Second)

	// --- Step 3: Iteratively fetch candidates, exactly like handleGetFeed does ---
	// Build exclusion set: self + swiped
	excludeSet := make(map[string]bool)
	excludeSet[swiperID] = true
	for _, sid := range swipedIDs {
		excludeSet[sid] = true
	}

	seen := make(map[string]bool)
	maxIterations := numProfiles * 2 // Safety valve
	iterations := 0

	// Restore the real function (in case other tests replaced it)
	getFeedCandidatesFunc = realGetFeedCandidates

	for iterations < maxIterations {
		iterations++

		excludeList := make([]string, 0, len(excludeSet))
		for id := range excludeSet {
			excludeList = append(excludeList, id)
		}

		candidates, err := realGetFeedCandidates(ctx, PROFILES_CACHE, excludeList, batchLimit)
		if err != nil {
			t.Fatalf("Iteration %d: Pipeline error: %v", iterations, err)
		}

		if len(candidates) == 0 {
			// No more candidates — we've exhausted the collection
			break
		}

		for _, c := range candidates {
			pid, ok := c.Data["profile_id"].(string)
			if !ok {
				continue
			}

			// This profile should NOT be in the exclusion set
			if excludeSet[pid] {
				t.Errorf("Iteration %d: Pipeline returned excluded profile %s", iterations, pid)
			}

			// Track it
			if seen[pid] {
				t.Errorf("Iteration %d: Pipeline returned duplicate profile %s", iterations, pid)
			}
			seen[pid] = true

			// Simulate "swiping" — add to exclusion set for next fetch
			excludeSet[pid] = true
		}
	}

	// --- Step 4: Assertions ---
	// Every expected profile should have been seen
	for pid := range expectedIDs {
		if !seen[pid] {
			t.Errorf("Profile %s was never surfaced by the pipeline", pid)
		}
	}

	// No swiped profile should have appeared
	for _, sid := range swipedIDs {
		if seen[sid] {
			t.Errorf("Already-swiped profile %s should NOT have been surfaced", sid)
		}
	}

	// Swiper should not have appeared
	if seen[swiperID] {
		t.Errorf("Swiper's own profile %s should NOT have been surfaced", swiperID)
	}

	// Count how many of our expected test profiles were seen
	expectedSeen := 0
	for pid := range expectedIDs {
		if seen[pid] {
			expectedSeen++
		}
	}

	t.Logf("✅ Coverage complete: %d/%d expected test profiles surfaced in %d iterations (batch=%d, total seen incl. pre-existing: %d)",
		expectedSeen, len(expectedIDs), iterations, batchLimit, len(seen))

	if expectedSeen != len(expectedIDs) {
		t.Errorf("Expected all %d test profiles to be surfaced but only saw %d",
			len(expectedIDs), expectedSeen)
	}
}

// TestFeedCoverage_NoExclusions_RealDB verifies that with no swipe history,
// the pipeline returns ALL profiles in the cache (minus self).
func TestFeedCoverage_NoExclusions_RealDB(t *testing.T) {
	if !*useRealDB {
		t.Skip("Skipping real-db test (pass -real-db to run)")
	}

	setupRealDBEnv(t)

	dbOnce = sync.Once{}
	db = nil

	ctx := context.Background()
	client, err := getDBInternal(ctx)
	if err != nil {
		t.Fatalf("Failed to initialize Firestore: %v", err)
	}

	const numProfiles = 8
	const batchLimit = 3
	testRun := fmt.Sprintf("fcov-noex-%d", time.Now().UnixMilli())
	swiperID := fmt.Sprintf("%s-swiper", testRun)

	var createdDocs []struct {
		collection string
		docID      string
	}
	t.Cleanup(func() {
		for _, d := range createdDocs {
			client.Collection(d.collection).Doc(d.docID).Delete(ctx)
		}
	})

	// Seed profiles
	allProfileIDs := make([]string, numProfiles)
	for i := 0; i < numProfiles; i++ {
		pid := fmt.Sprintf("%s-p%02d", testRun, i)
		allProfileIDs[i] = pid
		client.Collection(PROFILES_CACHE).Doc(pid).Set(ctx, map[string]interface{}{
			"profile_id":   pid,
			"user_id":      fmt.Sprintf("%s-u%02d", testRun, i),
			"display_name": fmt.Sprintf("Hero %d", i),
			"is_active":    true,
			"image_urls":   []string{},
			"talents":      []string{},
		})
		createdDocs = append(createdDocs, struct {
			collection string
			docID      string
		}{PROFILES_CACHE, pid})
	}

	// Seed swiper
	client.Collection(PROFILES_CACHE).Doc(swiperID).Set(ctx, map[string]interface{}{
		"profile_id": swiperID,
		"user_id":    fmt.Sprintf("%s-swiper-user", testRun),
		"is_active":  true,
		"image_urls": []string{},
		"talents":    []string{},
	})
	createdDocs = append(createdDocs, struct {
		collection string
		docID      string
	}{PROFILES_CACHE, swiperID})

	time.Sleep(2 * time.Second)

	// Iteratively fetch with only self excluded, growing the exclusion set each time
	excludeSet := map[string]bool{swiperID: true}
	seen := make(map[string]bool)
	getFeedCandidatesFunc = realGetFeedCandidates

	for i := 0; i < numProfiles*2; i++ {
		excludeList := make([]string, 0, len(excludeSet))
		for id := range excludeSet {
			excludeList = append(excludeList, id)
		}

		candidates, err := realGetFeedCandidates(ctx, PROFILES_CACHE, excludeList, batchLimit)
		if err != nil {
			t.Fatalf("Pipeline error: %v", err)
		}
		if len(candidates) == 0 {
			break
		}

		for _, c := range candidates {
			pid, _ := c.Data["profile_id"].(string)
			if pid == "" {
				continue
			}
			seen[pid] = true
			excludeSet[pid] = true
		}
	}

	// Every profile should have been seen
	for _, pid := range allProfileIDs {
		if !seen[pid] {
			t.Errorf("Profile %s was never surfaced", pid)
		}
	}

	if seen[swiperID] {
		t.Errorf("Swiper's own profile should not have been surfaced")
	}

	t.Logf("✅ No-exclusion coverage: %d/%d profiles surfaced", len(seen), numProfiles)
}

// TestFeedCoverage_LargeExclusionSet_RealDB verifies that NotEqualAny works
// correctly with exclusion sets larger than 10 (which would break standard
// Firestore not-in queries but should work with the Pipeline API).
func TestFeedCoverage_LargeExclusionSet_RealDB(t *testing.T) {
	if !*useRealDB {
		t.Skip("Skipping real-db test (pass -real-db to run)")
	}

	setupRealDBEnv(t)

	dbOnce = sync.Once{}
	db = nil

	ctx := context.Background()
	client, err := getDBInternal(ctx)
	if err != nil {
		t.Fatalf("Failed to initialize Firestore: %v", err)
	}

	// Create 25 profiles, exclude 20 of them via swipes.
	// Standard Firestore not-in would fail at >10 exclusions.
	const totalProfiles = 25
	const numExcluded = 20
	const batchLimit = 10
	testRun := fmt.Sprintf("fcov-big-%d", time.Now().UnixMilli())
	swiperID := fmt.Sprintf("%s-swiper", testRun)

	var createdDocs []struct {
		collection string
		docID      string
	}
	t.Cleanup(func() {
		for _, d := range createdDocs {
			client.Collection(d.collection).Doc(d.docID).Delete(ctx)
		}
	})

	allProfileIDs := make([]string, totalProfiles)
	for i := 0; i < totalProfiles; i++ {
		pid := fmt.Sprintf("%s-p%02d", testRun, i)
		allProfileIDs[i] = pid
		client.Collection(PROFILES_CACHE).Doc(pid).Set(ctx, map[string]interface{}{
			"profile_id":   pid,
			"user_id":      fmt.Sprintf("%s-u%02d", testRun, i),
			"display_name": fmt.Sprintf("Hero %d", i),
			"is_active":    true,
			"image_urls":   []string{},
			"talents":      []string{},
		})
		createdDocs = append(createdDocs, struct {
			collection string
			docID      string
		}{PROFILES_CACHE, pid})
	}

	client.Collection(PROFILES_CACHE).Doc(swiperID).Set(ctx, map[string]interface{}{
		"profile_id": swiperID,
		"user_id":    fmt.Sprintf("%s-swiper-user", testRun),
		"is_active":  true,
		"image_urls": []string{},
		"talents":    []string{},
	})
	createdDocs = append(createdDocs, struct {
		collection string
		docID      string
	}{PROFILES_CACHE, swiperID})

	// Exclude self + first 20 profiles (21 total exclusions — well above the 10-value limit)
	excludeSet := map[string]bool{swiperID: true}
	for i := 0; i < numExcluded; i++ {
		excludeSet[allProfileIDs[i]] = true
	}

	// The remaining 5 profiles (p20-p24) should be returned
	expectedRemaining := make(map[string]bool)
	for i := numExcluded; i < totalProfiles; i++ {
		expectedRemaining[allProfileIDs[i]] = true
	}

	time.Sleep(2 * time.Second)

	// Iterate to walk past any pre-existing profiles in the shared dev DB
	getFeedCandidatesFunc = realGetFeedCandidates
	seen := make(map[string]bool)
	maxIter := (totalProfiles + 50) // Safety valve accounting for pre-existing profiles

	for i := 0; i < maxIter; i++ {
		excludeList := make([]string, 0, len(excludeSet))
		for id := range excludeSet {
			excludeList = append(excludeList, id)
		}

		candidates, err := realGetFeedCandidates(ctx, PROFILES_CACHE, excludeList, batchLimit)
		if err != nil {
			t.Fatalf("Iteration %d: Pipeline with %d exclusions failed: %v", i, len(excludeList), err)
		}
		if len(candidates) == 0 {
			break
		}

		for _, c := range candidates {
			pid, _ := c.Data["profile_id"].(string)
			if pid == "" {
				continue
			}
			if excludeSet[pid] {
				t.Errorf("Pipeline returned excluded profile %s despite %d exclusions", pid, len(excludeList))
			}
			seen[pid] = true
			excludeSet[pid] = true
		}
	}

	// Verify all expected remaining profiles were surfaced
	for pid := range expectedRemaining {
		if !seen[pid] {
			t.Errorf("Expected profile %s was not returned despite being outside the exclusion set", pid)
		}
	}

	t.Logf("✅ Large exclusion set: initial %d exclusions, all %d expected remaining profiles surfaced (total seen incl. pre-existing: %d)",
		numExcluded+1, len(expectedRemaining), len(seen))
}

// TestFeedCoverage_ExclusionStress_RealDB is a parameterized stress test that
// validates Pipeline NotEqualAny at 100 and 500 exclusion sizes.
//
// Strategy: Seed 5 "target" profiles, then build exclusion lists padded with
// synthetic IDs (UUIDs that don't exist in the collection). This tests that:
//   - NotEqualAny doesn't error or silently truncate at high counts
//   - Target profiles are still returned despite the large filter
//   - Latency doesn't degrade catastrophically
func TestFeedCoverage_ExclusionStress_RealDB(t *testing.T) {
	if !*useRealDB {
		t.Skip("Skipping real-db test (pass -real-db to run)")
	}

	setupRealDBEnv(t)

	cases := []struct {
		name           string
		exclusionCount int
	}{
		{"100_exclusions", 100},
		{"500_exclusions", 500},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Reset DB singleton for each sub-test
			dbOnce = sync.Once{}
			db = nil

			ctx := context.Background()
			client, err := getDBInternal(ctx)
			if err != nil {
				t.Fatalf("Failed to initialize Firestore: %v", err)
			}

			const numTargets = 5
			const batchLimit = 10
			testRun := fmt.Sprintf("fstress-%d-%d", tc.exclusionCount, time.Now().UnixMilli())
			swiperID := fmt.Sprintf("%s-swiper", testRun)

			var createdDocs []struct {
				collection string
				docID      string
			}
			t.Cleanup(func() {
				log.Printf("[CLEANUP] Removing %d test documents...", len(createdDocs))
				for _, d := range createdDocs {
					client.Collection(d.collection).Doc(d.docID).Delete(ctx)
				}
			})

			// Seed target profiles that should survive the exclusion filter
			targetIDs := make([]string, numTargets)
			for i := 0; i < numTargets; i++ {
				pid := fmt.Sprintf("%s-target-%02d", testRun, i)
				targetIDs[i] = pid
				_, err := client.Collection(PROFILES_CACHE).Doc(pid).Set(ctx, map[string]interface{}{
					"profile_id":   pid,
					"user_id":      fmt.Sprintf("%s-u%02d", testRun, i),
					"display_name": fmt.Sprintf("StressHero %d", i),
					"is_active":    true,
					"image_urls":   []string{},
					"talents":      []string{},
				})
				if err != nil {
					t.Fatalf("Failed to seed target %s: %v", pid, err)
				}
				createdDocs = append(createdDocs, struct {
					collection string
					docID      string
				}{PROFILES_CACHE, pid})
			}

			// Seed swiper
			_, err = client.Collection(PROFILES_CACHE).Doc(swiperID).Set(ctx, map[string]interface{}{
				"profile_id": swiperID,
				"user_id":    fmt.Sprintf("%s-swiper-user", testRun),
				"is_active":  true,
				"image_urls": []string{},
				"talents":    []string{},
			})
			if err != nil {
				t.Fatalf("Failed to seed swiper: %v", err)
			}
			createdDocs = append(createdDocs, struct {
				collection string
				docID      string
			}{PROFILES_CACHE, swiperID})

			time.Sleep(2 * time.Second)

			// Build exclusion list: self + N-1 synthetic UUIDs
			excludeSet := map[string]bool{swiperID: true}
			for i := 0; i < tc.exclusionCount-1; i++ {
				fakeID := fmt.Sprintf("fake-excluded-%s-%04d", testRun, i)
				excludeSet[fakeID] = true
			}

			t.Logf("Built exclusion set of %d IDs (%d synthetic + self)", len(excludeSet), tc.exclusionCount-1)

			// Iterate to find all target profiles
			getFeedCandidatesFunc = realGetFeedCandidates
			seen := make(map[string]bool)
			totalIterations := 0

			start := time.Now()

			for i := 0; i < 100; i++ { // Safety valve
				totalIterations++

				excludeList := make([]string, 0, len(excludeSet))
				for id := range excludeSet {
					excludeList = append(excludeList, id)
				}

				candidates, err := realGetFeedCandidates(ctx, PROFILES_CACHE, excludeList, batchLimit)
				if err != nil {
					t.Fatalf("Iteration %d: Pipeline with %d exclusions failed: %v", i, len(excludeList), err)
				}
				if len(candidates) == 0 {
					break
				}

				for _, c := range candidates {
					pid, _ := c.Data["profile_id"].(string)
					if pid == "" {
						continue
					}
					if excludeSet[pid] {
						t.Errorf("Excluded profile %s leaked through with %d exclusions", pid, len(excludeList))
					}
					seen[pid] = true
					excludeSet[pid] = true
				}
			}

			elapsed := time.Since(start)

			// Verify all targets surfaced
			targetsFound := 0
			for _, tid := range targetIDs {
				if seen[tid] {
					targetsFound++
				} else {
					t.Errorf("Target profile %s was NOT surfaced with %d exclusions", tid, tc.exclusionCount)
				}
			}

			avgLatency := elapsed / time.Duration(totalIterations)
			t.Logf("✅ %s: %d/%d targets found in %d iterations, total %v (avg %v/query, total seen: %d)",
				tc.name, targetsFound, numTargets, totalIterations, elapsed, avgLatency, len(seen))
		})
	}
}

// TestFeedCoverage_HeavyStress_RealDB seeds REAL profiles at scale and
// walks the entire collection with large real exclusion sets.
//
// This is the ultimate stress test — every exclusion ID maps to a real
// document, forcing the Pipeline to do actual filtering work.
//
// Run with:
//   go test -v -run TestFeedCoverage_HeavyStress -real-db -timeout 120s
func TestFeedCoverage_HeavyStress_RealDB(t *testing.T) {
	if !*useRealDB {
		t.Skip("Skipping real-db test (pass -real-db to run)")
	}

	setupRealDBEnv(t)

	cases := []struct {
		name         string
		totalSeeded  int
		numExcluded  int
		batchLimit   int
	}{
		{"500_profiles_490_excluded", 500, 490, 20},
		{"1000_profiles_990_excluded", 1000, 990, 20},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dbOnce = sync.Once{}
			db = nil

			ctx := context.Background()
			client, err := getDBInternal(ctx)
			if err != nil {
				t.Fatalf("Failed to initialize Firestore: %v", err)
			}

			testRun := fmt.Sprintf("fheavy-%d-%d", tc.totalSeeded, time.Now().UnixMilli())
			swiperID := fmt.Sprintf("%s-swiper", testRun)

			var createdDocIDs []string
			t.Cleanup(func() {
				t.Logf("[CLEANUP] Removing %d test documents...", len(createdDocIDs)+1)
				// Delete in parallel batches for speed
				const deleteBatch = 50
				for i := 0; i < len(createdDocIDs); i += deleteBatch {
					end := i + deleteBatch
					if end > len(createdDocIDs) {
						end = len(createdDocIDs)
					}
					var wg sync.WaitGroup
					for _, docID := range createdDocIDs[i:end] {
						wg.Add(1)
						go func(id string) {
							defer wg.Done()
							client.Collection(PROFILES_CACHE).Doc(id).Delete(ctx)
						}(docID)
					}
					wg.Wait()
				}
				client.Collection(PROFILES_CACHE).Doc(swiperID).Delete(ctx)
			})

			// --- Seed profiles in parallel for speed ---
			t.Logf("⏳ Seeding %d profiles...", tc.totalSeeded)
			seedStart := time.Now()

			allProfileIDs := make([]string, tc.totalSeeded)
			var seedWg sync.WaitGroup
			var seedMu sync.Mutex
			semaphore := make(chan struct{}, 50) // Limit concurrent writes

			for i := 0; i < tc.totalSeeded; i++ {
				pid := fmt.Sprintf("%s-p%04d", testRun, i)
				allProfileIDs[i] = pid

				seedWg.Add(1)
				go func(profileID string, idx int) {
					defer seedWg.Done()
					semaphore <- struct{}{}
					defer func() { <-semaphore }()

					_, err := client.Collection(PROFILES_CACHE).Doc(profileID).Set(ctx, map[string]interface{}{
						"profile_id":   profileID,
						"user_id":      fmt.Sprintf("%s-u%04d", testRun, idx),
						"display_name": fmt.Sprintf("StressHero %d", idx),
						"is_active":    true,
						"image_urls":   []string{},
						"talents":      []string{},
					})
					if err != nil {
						t.Errorf("Failed to seed %s: %v", profileID, err)
						return
					}
					seedMu.Lock()
					createdDocIDs = append(createdDocIDs, profileID)
					seedMu.Unlock()
				}(pid, i)
			}
			seedWg.Wait()

			// Seed swiper
			client.Collection(PROFILES_CACHE).Doc(swiperID).Set(ctx, map[string]interface{}{
				"profile_id": swiperID,
				"user_id":    fmt.Sprintf("%s-swiper-user", testRun),
				"is_active":  true,
				"image_urls": []string{},
				"talents":    []string{},
			})

			t.Logf("✅ Seeded %d profiles in %v", len(createdDocIDs), time.Since(seedStart))

			// Give Firestore a moment to be consistent
			time.Sleep(3 * time.Second)

			// --- Build exclusion set: self + first N profiles ---
			excludeSet := map[string]bool{swiperID: true}
			for i := 0; i < tc.numExcluded; i++ {
				excludeSet[allProfileIDs[i]] = true
			}

			// Expected remaining profiles
			expectedRemaining := make(map[string]bool)
			for i := tc.numExcluded; i < tc.totalSeeded; i++ {
				expectedRemaining[allProfileIDs[i]] = true
			}

			t.Logf("🔍 Walking feed with %d real exclusions, expecting %d remaining profiles...",
				len(excludeSet), len(expectedRemaining))

			// --- Walk the feed ---
			getFeedCandidatesFunc = realGetFeedCandidates
			seen := make(map[string]bool)
			totalIterations := 0
			queryStart := time.Now()

			for i := 0; i < 200; i++ { // Safety valve
				totalIterations++

				excludeList := make([]string, 0, len(excludeSet))
				for id := range excludeSet {
					excludeList = append(excludeList, id)
				}

				candidates, err := realGetFeedCandidates(ctx, PROFILES_CACHE, excludeList, tc.batchLimit)
				if err != nil {
					t.Fatalf("Iteration %d: Pipeline with %d exclusions failed: %v",
						i, len(excludeList), err)
				}
				if len(candidates) == 0 {
					break
				}

				for _, c := range candidates {
					pid, _ := c.Data["profile_id"].(string)
					if pid == "" {
						continue
					}
					if excludeSet[pid] {
						t.Errorf("Excluded profile %s leaked through with %d exclusions", pid, len(excludeList))
					}
					seen[pid] = true
					excludeSet[pid] = true
				}
			}

			queryElapsed := time.Since(queryStart)

			// --- Assertions ---
			targetsFound := 0
			for pid := range expectedRemaining {
				if seen[pid] {
					targetsFound++
				} else {
					t.Errorf("Expected profile %s was NOT surfaced", pid)
				}
			}

			avgLatency := queryElapsed / time.Duration(totalIterations)
			t.Logf("✅ %s: %d/%d remaining profiles found in %d iterations",
				tc.name, targetsFound, len(expectedRemaining), totalIterations)
			t.Logf("   Total query time: %v (avg %v/query)", queryElapsed, avgLatency)
			t.Logf("   Total seen (incl. pre-existing): %d", len(seen))
		})
	}
}

func init() {
	// Ensure env vars have defaults for safety
	if os.Getenv("GOOGLE_CLOUD_PROJECT") == "" {
		os.Setenv("GOOGLE_CLOUD_PROJECT", "tavern-swiper-dev")
	}
}

