---
description: Fully reset the test environment and reseed with sample profiles.
---
# Reset and Seed Test Environment

This workflow performs a deep purge of the `-test` environment (Firestore + Firebase Auth) and then re-provisions a Root Admin followed by the full set of sample profiles.

// turbo-all
1. Purge the existing test data (Firestore & Firebase Auth)
   ```bash
   # ALWAYS use the root .venv for script execution
   source .venv/bin/activate && python3 scripts/clear_system.py test
   ```

2. Provision the Root Admin account via the API
   ```bash
   source .venv/bin/activate && python3 scripts/create_root_admin.py test
   ```

3. Seed the sample profiles from `sample_profiles/profiles.csv`
   ```bash
   # The script now automatically discovers Cloud Run URLs for 'test'
   source .venv/bin/activate && python3 scripts/seed_profiles.py test
   ```
