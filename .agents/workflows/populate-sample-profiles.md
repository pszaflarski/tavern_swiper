---
description: Populate a test user profile with authentic sample images from the local repository using the REST API.
---

# Populate Sample Profile Data

Use this workflow to ingest sample profile assets (images, etc.) into a test user's profile in the active environment. This replaces mock data with real assets from the `sample profiles/` directory.

### Prerequisites
- The test user must already exist in the `auth` service.
- A profile with the matching `display_name` must already exist in the `profiles` service.
- You **MUST** use the project's virtual environment.

### Steps

// turbo
1. Ensure the virtual environment is ready:
   ```bash
   .venv/bin/python3 -m pip install httpx
   ```

// turbo
2. Run the ingestion script for the target user (e.g., Valerius):
   ```bash
   .venv/bin/python3 scripts/populate-valerius.py
   ```

3. Verify the results in the browser:
   - Navigate to `http://localhost:8081/profiles`.
   - Log in as the test user.
   - Confirm the 6 images appear in the 3x2 grid.

### Customization
To populate a different user, create a copy of `scripts/populate-valerius.py` and update the `EMAIL`, `PASSWORD`, and `IMAGE_FILES` constants to match the new sample data.
