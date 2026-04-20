# Firestore `array-contains` Query Example (Go)

This example demonstrates how to correctly use the `array-contains` operator in the Cloud Firestore Go SDK to query a collection where a field is an array of values.

## Prerequisites

1.  A Google Cloud project with Firestore enabled.
2.  Go 1.25+ installed locally.
3.  Authenticated to Google Cloud (`gcloud auth application-default login`).
4.  Data in the `discovery_matches_cache` collection.

## How to Populate Data

To see this example in action, you should first populate your Firestore database with some match data. You can use the existing profile swipe example:

> [!TIP]
> Make sure to activate your virtual environment before running the Python script.

```bash
# From the root of the tavern_swiper repository
source .venv/bin/activate
python3 examples/profile_swipe/swipe_demo.py
```

This will create profiles and matching entries in the cache.

## Running the Example

1.  Set the required environment variables:

    ```bash
    export GOOGLE_CLOUD_PROJECT="your-project-id"
    export FIRESTORE_DATABASE_ID="messages-dev" # Or "(default)"
    export PROFILE_ID="one-of-the-profile-ids-from-the-match"
    ```

2.  Run the Go script:

    ```bash
    cd examples/go_match_query
    # Option A: Practical quick-start
    ./run_demo.sh

    # Option B: Manual control
    export GOOGLE_CLOUD_PROJECT="your-project-id"
    go run main.go
    ```

## Why `array-contains`?

In this project, the `discovery_matches_cache` documents have a `profile_ids` field which is an array (e.g., `["p1", "p2"]`). To find if a specific profile is part of any match, we use:

```go
client.Collection("discovery_matches_cache").
    Where("profile_ids", "array-contains", profileID).
    Documents(ctx)
```

**Note:** Using `"array_contains"` (with an underscore) will result in a runtime error or silent failure depending on the SDK version, as the official operator string is hyphenated.
