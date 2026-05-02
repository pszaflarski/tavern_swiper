# Setup New Environment in a New GCP Project

Use this workflow when creating a brand new environment (e.g., `staging`, `prod`) backed by its own Firebase/GCP project. This workflow captures the exact sequence used to set up `tavern-swiper-prod` and the lessons learned.

## Prerequisites
- `gcloud` CLI authenticated (`gcloud auth login`)
- `firebase` CLI authenticated (`firebase login`)
- Billing account available to link
- Existing dev environment working as reference

## Variables
Replace these throughout the workflow:

| Variable | Example | Description |
|---|---|---|
| `ENV_NAME` | `prod` | Environment name (used in DB names, branch names, trigger suffixes) |
| `PROJECT_ID` | `tavern-swiper-prod` | New GCP project ID |
| `DISPLAY_NAME` | `Tavern Swiper Prod` | Human-readable project name |
| `DEV_PROJECT_ID` | `tavern-swiper-dev` | Existing dev project (for reference/comparison) |
| `GITHUB_OWNER` | `pszaflarski` | GitHub repo owner |
| `GITHUB_REPO` | `tavern_swiper` | GitHub repo name |

---

## Phase 1 — Create Firebase Project & Web App

```bash
# 1.1 Create the Firebase project (auto-creates GCP project)
firebase projects:create $PROJECT_ID --display-name "$DISPLAY_NAME"

# 1.2 Create the Firebase web app (for frontend auth)
firebase apps:create WEB "$DISPLAY_NAME Web" --project $PROJECT_ID

# 1.3 Get the SDK config — SAVE THIS OUTPUT
firebase apps:sdkconfig WEB <APP_ID_FROM_STEP_1.2> --project $PROJECT_ID
```

Save these values from the SDK config output:
- `apiKey` → used as `_FIREBASE_API_KEY` and `_FIREBASE_WEB_API_KEY`
- `messagingSenderId` → used as `_FIREBASE_MESSAGING_SENDER_ID`
- `appId` → used as `_FIREBASE_APP_ID`

### 1.4 Enable Firebase Auth
1. Go to: `https://console.firebase.google.com/project/$PROJECT_ID/authentication/providers`
2. Enable **Email/Password** provider
3. Enable **Google** provider:
   - Set **Public-facing name for project** (e.g., "Tavern Swiper (Prod)")
   - Select a **Support email** (your Google account email)
   - Click **Save** — this auto-generates the Web Client ID and secret

---

## Phase 2 — Billing & APIs

```bash
# 2.1 Link billing (must be done in browser)
# https://console.cloud.google.com/billing/projects

# 2.2 Enable required APIs
gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  firestore.googleapis.com \
  pubsub.googleapis.com \
  storage.googleapis.com \
  --project=$PROJECT_ID
```

---

## Phase 3 — Firestore Databases

> [!IMPORTANT]
> **Free Tier Optimization**: The Firestore free tier (50k reads, 20k writes/day, 1GB storage) applies to exactly ONE database per project. When you delete `(default)`, the next database created inherits the free tier. Create your most active database first.

> [!IMPORTANT]
> **Location is permanent**: Once a database is created, its location cannot be changed. Use `nam5` (US multi-region) for production reliability or `us-central1` (regional) for lowest latency/cost.

```bash
# 3.1 Delete the auto-created default database
gcloud firestore databases delete --database="(default)" --project=$PROJECT_ID --quiet

# 3.2 Create discovery FIRST (claims the free tier)
gcloud firestore databases create \
  --database=discovery-$ENV_NAME \
  --location=nam5 \
  --type=firestore-native \
  --project=$PROJECT_ID

# 3.3 Create the remaining service databases
for DB in auth-$ENV_NAME users-$ENV_NAME profiles-$ENV_NAME messages-$ENV_NAME; do
  gcloud firestore databases create \
    --database="$DB" \
    --location=nam5 \
    --type=firestore-native \
    --project=$PROJECT_ID
done
```

### Verify
```bash
gcloud firestore databases list --project=$PROJECT_ID
# Confirm: discovery-$ENV_NAME shows freeTier: true
```

---

## Phase 4 — Cloud Storage

```bash
gcloud storage buckets create gs://$PROJECT_ID-media-$ENV_NAME \
  --project=$PROJECT_ID \
  --location=us-central1 \
  --uniform-bucket-level-access
```

---

## Phase 5 — Pub/Sub Topics

```bash
gcloud pubsub topics create $ENV_NAME-profiles-profile-events-v1 --project=$PROJECT_ID
gcloud pubsub topics create $ENV_NAME-discovery-match-events-v1 --project=$PROJECT_ID
```

> [!NOTE]
> Push subscriptions are created AFTER the first deploy (Phase 10), once Cloud Run URLs are known.

---

## Phase 6 — IAM & Service Accounts

### 6.1 Runtime Service Account
```bash
gcloud iam service-accounts create tavern-swiper-sa \
  --display-name="Tavern Swiper Runtime SA" \
  --project=$PROJECT_ID

SA="tavern-swiper-sa@$PROJECT_ID.iam.gserviceaccount.com"
for ROLE in \
  roles/datastore.user \
  roles/storage.objectAdmin \
  roles/pubsub.publisher \
  roles/pubsub.subscriber \
  roles/firebase.sdkAdminServiceAgent \
  roles/run.invoker; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SA" \
    --role="$ROLE" \
    --quiet
done
```

### 6.2 CI/CD Builder Service Account
```bash
gcloud iam service-accounts create cicd-builder \
  --display-name="CI/CD Builder" \
  --project=$PROJECT_ID

BUILDER="cicd-builder@$PROJECT_ID.iam.gserviceaccount.com"
for ROLE in \
  roles/cloudbuild.builds.builder \
  roles/run.admin \
  roles/iam.serviceAccountUser \
  roles/artifactregistry.admin; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$BUILDER" \
    --role="$ROLE" \
    --quiet
done
```

---

## Phase 7 — Secrets

```bash
# Generate a unique JWT secret for this environment
openssl rand -base64 32
# SAVE THIS VALUE — you will need it for the trigger creation script
```

> [!WARNING]
> **Never reuse secrets across environments.** Each environment must have its own JWT_SECRET.

---

## Phase 8 — Git Branch

```bash
git checkout -b $ENV_NAME
git push origin $ENV_NAME
```

---

## Phase 9 — Cloud Build Triggers

### 9.1 Connect GitHub repo (BROWSER STEP)

> [!IMPORTANT]
> This step MUST be done in the browser before triggers can be created via CLI.

1. Open: `https://console.cloud.google.com/cloud-build/triggers;region=global/connect?project=<PROJECT_NUMBER>`
2. Select **GitHub (Cloud Build GitHub App)**
3. Authenticate and select `$GITHUB_OWNER/$GITHUB_REPO`
4. Confirm the connection

### 9.2 Create triggers via script

Update `scripts/create_prod_triggers.sh` with the new environment's values, then run it.

> [!CAUTION]
> **Critical lesson learned**: The `_DIR_NAME` substitution variable must be the **basename only** (e.g., `auth_go`), NOT the full path (`services/auth_go`). The `cloudbuild.yaml` files already prepend `services/` via `dir: 'services/$_DIR_NAME'`. Getting this wrong results in `services/services/auth_go` which doesn't exist.

> [!CAUTION]
> **Frontend trigger**: The frontend trigger should NOT include `_DIR_NAME` in its substitutions. The frontend `cloudbuild.yaml` hardcodes `dir: 'frontend'` and does not use `_DIR_NAME`. Including it is harmless but creates environment drift.

### 9.3 Verify zero drift

Always compare new triggers against dev to ensure structural parity:

```bash
# Export both
gcloud beta builds triggers list --project=$DEV_PROJECT_ID --format=json > /tmp/dev_triggers.json
gcloud beta builds triggers list --project=$PROJECT_ID --format=json > /tmp/new_triggers.json

# Compare: filename, includedFiles, substitution keys, _DIR_NAME, _SERVICE_NAME, serviceAccount pattern
# All should be IDENTICAL except for environment-specific values
```

---

## Phase 10 — First Deploy

### 10.1 Trigger all builds
```bash
for TRIGGER in $(gcloud beta builds triggers list --project=$PROJECT_ID --format="value(name)"); do
  gcloud beta builds triggers run "$TRIGGER" --branch=$ENV_NAME --project=$PROJECT_ID
done
```

> [!NOTE]
> The **frontend build will likely fail** on the first run because it tries to look up backend Cloud Run URLs that don't exist yet. Once the backend services finish deploying, re-trigger the frontend build.

### 10.2 Monitor builds
```bash
gcloud builds list --project=$PROJECT_ID --limit=10 \
  --format="table(id,status,substitutions._SERVICE_NAME)"
```

### 10.3 Wire Pub/Sub push subscriptions
Once all backend services are deployed, get their URLs and create the subscriptions:

```bash
# Get the subscriber URLs
DISC_SUB_URL=$(gcloud run services describe discovery-subscriber-$ENV_NAME \
  --platform managed --region us-central1 --project $PROJECT_ID \
  --format 'value(status.url)')

MSG_SUB_URL=$(gcloud run services describe messages-subscriber-$ENV_NAME \
  --platform managed --region us-central1 --project $PROJECT_ID \
  --format 'value(status.url)')

# Create push subscriptions
gcloud pubsub subscriptions create $ENV_NAME-discovery-subscriber-sub \
  --topic=$ENV_NAME-profiles-profile-events-v1 \
  --push-endpoint="$DISC_SUB_URL/HandleProfileEvent" \
  --project=$PROJECT_ID

gcloud pubsub subscriptions create $ENV_NAME-messages-subscriber-sub \
  --topic=$ENV_NAME-discovery-match-events-v1 \
  --push-endpoint="$MSG_SUB_URL/" \
  --project=$PROJECT_ID
```

### 10.4 Re-trigger frontend build
```bash
gcloud beta builds triggers run frontend-$ENV_NAME-deploy \
  --branch=$ENV_NAME --project=$PROJECT_ID
```

---

## Phase 11 — Bootstrap Root Admin

```bash
ROOT_EMAIL="admin@tavernswiper.com" ROOT_PASSWORD="<SECURE_PASSWORD>" \
  python3 scripts/create_root_admin.py $ENV_NAME
```

> [!NOTE]
> If adding a new environment, you must first add it to the `PROJECT_MAP` in both `scripts/create_root_admin.py` and `scripts/sync_root_admin.py`.

---

## Phase 12 — Update Frontend Config

Update `frontend/eas.json` with the real Cloud Run URLs and Firebase credentials for the new environment.

```bash
# Get all service URLs
for SVC in auth users profiles discovery messages; do
  echo "$SVC: $(gcloud run services describe $SVC-$ENV_NAME \
    --platform managed --region us-central1 --project $PROJECT_ID \
    --format 'value(status.url)')"
done
```

---

## Phase 13 — Google Sign-In Configuration

Google Sign-In requires per-environment Firebase Console configuration and a `google-services.json` file for the Android native build.

### 13.1 Register Android App (if not already done)

1. Go to **[Firebase Console → $PROJECT_ID → Project Settings → General](https://console.firebase.google.com/project/$PROJECT_ID/settings/general)**
2. Click **Add app** → select **Android**
3. Fill in:
   - **Android package name**: `com.tavernswiper.app`
   - **App nickname**: `Tavern Swiper Android` (optional)
   - **Debug signing certificate SHA-1**: paste your upload keystore SHA-1 (see below)
4. Click **Register app**

### 13.2 Add SHA-1 Fingerprint

The SHA-1 fingerprint tells Google that sign-in requests are legitimately from our app.

```bash
# Get the SHA-1 from your upload keystore
keytool -list -v -keystore frontend/upload-keystore.jks | grep SHA1
```

> [!TIP]
> If you don't know the alias, run without `-alias` — it will list all entries.

1. Go to **Firebase Console → Project Settings → General → Your apps → Android app**
2. Click **Add fingerprint** → paste the SHA-1 string
3. Click **Save**

> [!WARNING]
> **Play Store builds**: If the app is distributed through Google Play, Google re-signs your AAB with their own key. You must ALSO add the Play signing SHA-1 from **Google Play Console → Setup → App signing → "App signing key certificate"** to Firebase. Without this, Google Sign-In fails with `DEVELOPER_ERROR (code 10)` on Play Store installs.

### 13.3 Download `google-services.json`

> [!IMPORTANT]
> You must download this file **after** enabling the Google provider (Phase 1.4 step 3) so that it contains the populated `oauth_client` entries. If `oauth_client` is empty in the file, Google Sign-In was not enabled properly.

1. Go to **Firebase Console → $PROJECT_ID → Project Settings → General**
2. Scroll to **Your apps** → find the Android app (`com.tavernswiper.app`)
3. Click **Download `google-services.json`**
4. Save as `frontend/google-services.$ENV_NAME.json`

The `app.config.js` already switches between `google-services.dev.json` and `google-services.prod.json` based on the `EXPO_PUBLIC_FIREBASE_PROJECT_ID` environment variable.

### 13.4 Add Web Client ID to `eas.json`

From the downloaded `google-services.$ENV_NAME.json`, find the `client_id` with **`client_type: 3`** (the Web client).

Add it to the environment's build profile in `frontend/eas.json`:

```jsonc
// In the new env's "env" block:
"EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID": "<web-client-id-from-google-services.json>"
```

> [!NOTE]
> This is the **Web** client ID, not the Android client ID. The `@react-native-google-signin` library needs the Web client ID to get an `idToken` that Firebase can verify.

### 13.5 Verify the Configuration

You can verify the file is correct by inspecting the `oauth_client` array:

```bash
jq '.client[0].oauth_client' frontend/google-services.$ENV_NAME.json
```

You should see entries with both `client_type: 1` (Android) and `client_type: 3` (Web).

---

## Phase 14 — Smoke Test

| # | Check | Command |
|---|---|---|
| 1 | All services SERVING | `gcloud run services list --project=$PROJECT_ID` |
| 2 | Health endpoints | `curl <AUTH_URL>/auth/health` |
| 3 | Firestore DBs exist | `gcloud firestore databases list --project=$PROJECT_ID` |
| 4 | Pub/Sub wired | `gcloud pubsub subscriptions list --project=$PROJECT_ID` |
| 5 | Root admin login | Use the admin credentials via the app or API |
| 6 | Frontend loads | Visit the app Cloud Run URL in a browser |
| 7 | Google Sign-In (web) | Run `npm run web` in `frontend/`, click "Continue with Google" |
| 8 | Google Sign-In (native) | Build APK via `eas build --profile preview --local`, install and test |

---

## Common Pitfalls & Lessons Learned

### 1. `_DIR_NAME` must be basename only
**Wrong**: `_DIR_NAME=services/auth_go` → resolves to `services/services/auth_go`
**Right**: `_DIR_NAME=auth_go` → resolves to `services/auth_go`

### 2. Firestore location is permanent
You cannot change a database's location after creation. Decide between regional (`us-central1`) and multi-region (`nam5`) before creating.

### 3. Free tier goes to the first DB created
Delete `(default)` first, then create your most-used database to claim the free tier. Verify with `freeTier: true` in the creation output.

### 4. Firebase Auth must be enabled manually
There is no CLI command to enable Email/Password auth. This must be done in the Firebase Console.

### 5. Frontend needs backend URLs to exist
The frontend `cloudbuild.yaml` dynamically looks up backend Cloud Run URLs. If the backends haven't been deployed yet, the frontend build will fail. Always deploy backends first.

### 6. GitHub repo must be connected per-project
Each GCP project needs its own GitHub connection in Cloud Build. This is a browser-only step — there is no CLI equivalent.

### 7. Scripts need PROJECT_MAP updates
When adding a new environment, update the `PROJECT_MAP` dictionary in:
- `scripts/create_root_admin.py`
- `scripts/sync_root_admin.py`
- Any other scripts that reference project IDs

### 8. Never reuse secrets across environments
Always generate a fresh `JWT_SECRET` for each environment using `openssl rand -base64 32`.

### 9. Verify trigger parity
After creating triggers for a new environment, always run a structural comparison against dev to catch drift before triggering builds.

### 10. Google Sign-In requires SHA-1 fingerprint per environment
Without the SHA-1 fingerprint registered in Firebase Console, Google Sign-In fails with `DEVELOPER_ERROR (code 10)`. The same `upload-keystore.jks` SHA-1 can be used across dev and prod Firebase projects, but Play Store builds need the additional Play signing SHA-1.

### 11. Download `google-services.json` AFTER enabling Google provider
If you download the file before enabling the Google Sign-In provider, the `oauth_client` array will be empty and the native Google Sign-In SDK will silently fail. Always re-download after making Firebase Console changes.

### 12. `google-services.*.json` is gitignored
These files are in `frontend/.gitignore`. Each developer/environment must download their own copy from the Firebase Console. The `app.config.js` dynamically selects the correct file based on `EXPO_PUBLIC_FIREBASE_PROJECT_ID`.
