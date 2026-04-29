# 🚀 Tavern Swiper — Production Deployment Plan

> **Goal:** Deploy all backend services and the frontend from a `prod` git branch to a new GCP project (`tavern-swiper-prod`) with fully isolated infrastructure.
>
> **Approach:** Firebase-first — create the Firebase project first, which auto-provisions the underlying GCP project with correctly bootstrapped service agents and IAM bindings.

---

## Current State (for reference)

| Aspect | Current Dev | Current Test |
|---|---|---|
| **GCP Project** | `tavern-swiper-dev` | `tavern-swiper-dev` (shared) |
| **Git Branch** | `dev` | `test` |
| **Service suffix** | `-dev` | `-test` |
| **Firestore DBs** | `*-dev` (auth-dev, discovery-dev, etc.) | `*-test` |
| **Pub/Sub topics** | `dev-*` | `test-*` |
| **GCS bucket** | `tavern-swiper-dev-media-dev` | `tavern-swiper-dev-media-test` |
| **Cloud Build triggers** | 16 triggers in `tavern-swiper-dev` | Same project |
| **Service Account** | `cicd-builder@tavern-swiper-dev` / `tavern-swiper-sa@tavern-swiper-dev` | Same |
| **Firebase** | `tavern-swiper-dev` Firebase project | Shared |
| **Cloud Build logs** | `gs://tavern-swiper-build-logs-dev` | Same bucket |

---

## Phase 1 — Firebase Project (creates GCP project automatically)

> [!IMPORTANT]
> Creating the Firebase project first is the recommended approach. Firebase will auto-create the underlying GCP project, enable core APIs (Identity Toolkit, Firestore, Storage), and provision all Firebase service agents (`firebase-adminsdk`, `firebase-rules@`, etc.) with correct IAM roles. This avoids the permission/bootstrapping issues that can occur when adding Firebase to an existing GCP project.

### 1.1 Create the Firebase project

Via the [Firebase Console](https://console.firebase.google.com/):

1. Click **Add project**
2. Name it `tavern-swiper-prod` (this will also be the GCP project ID)
3. Choose your billing plan (Blaze — pay as you go, required for Cloud Run)
4. Enable or disable Google Analytics as desired
5. Click **Create project**

Or via CLI:
```bash
firebase projects:create tavern-swiper-prod --display-name "Tavern Swiper Prod"
```

### 1.2 Create a Firebase Web App (for frontend auth)
```bash
firebase apps:create WEB "Tavern Swiper Prod Web" --project tavern-swiper-prod
```

This outputs the new **Firebase config**. **Save all of these values — they replace the dev values everywhere:**
- `apiKey` — replaces `AIzaSyCLDTIuGwoRcGLF1woXC6I1644-jSSXjNk`
- `authDomain` — `tavern-swiper-prod.firebaseapp.com`
- `projectId` — `tavern-swiper-prod`
- `storageBucket` — `tavern-swiper-prod.firebasestorage.app`
- `messagingSenderId` — replaces `374390417125`
- `appId` — replaces `1:374390417125:web:ec1e664137daa9df11960c`

### 1.3 Configure Firebase Authentication
- In Firebase Console → **Authentication → Sign-in method**
- Enable **Email/Password** (and any other providers you use)
- Note: the Firebase Web API Key is auto-generated and visible in **Project Settings → General**

### 1.4 (Optional) Create a Firebase Android App
If you want a separate Firebase app registration for the native mobile build:
```bash
firebase apps:create ANDROID "Tavern Swiper Prod Android" \
  --package-name com.tavernswiper.app \
  --project tavern-swiper-prod
```
Download the `google-services.json` for the prod build.

---

## Phase 2 — GCP Project Configuration (on the Firebase-created project)

The Firebase project auto-created the GCP project `tavern-swiper-prod`. Now enable the **additional** GCP APIs that Firebase doesn't set up:

### 2.1 Link billing (if not already on Blaze plan)
```bash
gcloud billing projects link tavern-swiper-prod \
  --billing-account=<BILLING_ACCOUNT_ID>
```

### 2.2 Enable additional APIs
Firebase already enabled: `firestore.googleapis.com`, `storage.googleapis.com`, `identitytoolkit.googleapis.com`, `firebase.googleapis.com`

You still need:
```bash
gcloud services enable --project=tavern-swiper-prod \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  pubsub.googleapis.com \
  containerregistry.googleapis.com \
  iam.googleapis.com \
  secretmanager.googleapis.com
```

---

## Phase 3 — Firestore Databases

Firebase auto-created the **default** `(default)` Firestore database. You need the **named** databases matching the per-service convention:

```bash
for DB in auth-prod users-prod profiles-prod discovery-prod messages-prod; do
  gcloud firestore databases create \
    --database="$DB" \
    --location=nam5 \
    --type=firestore-native \
    --project=tavern-swiper-prod
done
```

> [!TIP]
> Use `nam5` (us-central) for Firestore location to keep latency low with Cloud Run in `us-central1`.

### 3.1 Firestore Security Rules & Indexes
- Export indexes from dev: `gcloud firestore indexes composite list --database=<DB_ID> --project=tavern-swiper-dev`
- Recreate them in prod for each database.
- Apply any Firestore security rules if using direct client access (currently all access is through backend services).

---

## Phase 4 — Cloud Storage

### 4.1 Create the media bucket
```bash
gcloud storage buckets create gs://tavern-swiper-prod-media-prod \
  --project=tavern-swiper-prod \
  --location=us-central1 \
  --uniform-bucket-level-access
```

### 4.2 Set CORS policy (if the frontend reads images directly)
Apply the same CORS policy currently on `tavern-swiper-dev-media-dev`.

---

## Phase 5 — Pub/Sub

### 5.1 Create topics
```bash
gcloud pubsub topics create prod-profiles-profile-events-v1 --project=tavern-swiper-prod
gcloud pubsub topics create prod-discovery-match-events-v1 --project=tavern-swiper-prod
```

### 5.2 Create push subscriptions
These will be wired **after** the Cloud Run services are deployed (need the service URLs). The subscriptions are:

| Subscription | Topic | Push Endpoint |
|---|---|---|
| `prod-discovery-subscriber-sub` | `prod-profiles-profile-events-v1` | `https://discovery-subscriber-prod-<hash>.a.run.app/HandleProfileEvent` |
| `prod-messages-subscriber-sub` | `prod-discovery-match-events-v1` | `https://messages-subscriber-prod-<hash>.a.run.app/` |

> [!NOTE]
> The push endpoints are only known after the first Cloud Run deployment. Plan to create subscriptions as a post-deploy step (Phase 12).

---

## Phase 6 — IAM & Service Accounts

### 6.1 Create the runtime service account
```bash
gcloud iam service-accounts create tavern-swiper-sa \
  --display-name="Tavern Swiper Runtime SA" \
  --project=tavern-swiper-prod
```

Grant roles:
```bash
SA="tavern-swiper-sa@tavern-swiper-prod.iam.gserviceaccount.com"
for ROLE in \
  roles/datastore.user \
  roles/storage.objectAdmin \
  roles/pubsub.publisher \
  roles/pubsub.subscriber \
  roles/firebase.sdkAdminServiceAgent \
  roles/run.invoker; do
  gcloud projects add-iam-policy-binding tavern-swiper-prod \
    --member="serviceAccount:$SA" \
    --role="$ROLE"
done
```

### 6.2 Create the CI/CD builder service account
```bash
gcloud iam service-accounts create cicd-builder \
  --display-name="CI/CD Builder" \
  --project=tavern-swiper-prod
```

Grant roles:
```bash
BUILDER="cicd-builder@tavern-swiper-prod.iam.gserviceaccount.com"
for ROLE in \
  roles/cloudbuild.builds.builder \
  roles/run.admin \
  roles/storage.admin \
  roles/iam.serviceAccountUser \
  roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding tavern-swiper-prod \
    --member="serviceAccount:$BUILDER" \
    --role="$ROLE"
done
```

### 6.3 Allow Cloud Build to act as the runtime SA
```bash
gcloud iam service-accounts add-iam-policy-binding \
  tavern-swiper-sa@tavern-swiper-prod.iam.gserviceaccount.com \
  --member="serviceAccount:cicd-builder@tavern-swiper-prod.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser" \
  --project=tavern-swiper-prod
```

---

## Phase 7 — Cloud Build Logs Bucket

```bash
gcloud storage buckets create gs://tavern-swiper-build-logs-prod \
  --project=tavern-swiper-prod \
  --location=us-central1
```

Grant the builder write access:
```bash
gcloud storage buckets add-iam-policy-binding gs://tavern-swiper-build-logs-prod \
  --member="serviceAccount:cicd-builder@tavern-swiper-prod.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
```

---

## Phase 8 — Secrets Management

> [!WARNING]
> Production **must not** reuse dev secrets. Generate new values for prod.

| Secret | Dev Value | Prod Action |
|---|---|---|
| `JWT_SECRET` | `super-secret-tavern-key-123` | Generate a cryptographically random secret |
| `FIREBASE_WEB_API_KEY` | `AIzaSyCLDTIuGwoRcGLF1woXC6I1644-jSSXjNk` | Use the new prod Firebase key from Phase 1.2 |

**Option A — Inline env vars (current approach):** Continue passing secrets via `--update-env-vars` in cloudbuild, but with prod-specific values in the trigger substitutions.

**Option B — Secret Manager (recommended for prod):** Store secrets in GCP Secret Manager and reference them in Cloud Run:
```bash
echo -n "$(openssl rand -base64 32)" | \
  gcloud secrets create JWT_SECRET --data-file=- --project=tavern-swiper-prod

gcloud run services update <service>-prod \
  --update-secrets=JWT_SECRET=JWT_SECRET:latest
```

---

## Phase 9 — Git Branch Strategy

### 9.1 Create the `prod` branch
```
dev → (merge PR) → test → (merge PR) → prod
```

The `prod` branch will be a **protected branch** that only receives merges from `test` (or from `main` if you rename `test` → `main`).

### 9.2 Branch protection rules (GitHub)
- Require PR reviews before merging into `prod`
- Require status checks to pass (Cloud Build on `test`)
- No force pushes
- No deletions

---

## Phase 10 — Cloud Build Triggers (in `tavern-swiper-prod`)

> [!IMPORTANT]
> These triggers live in the **new** `tavern-swiper-prod` project, not in `tavern-swiper-dev`. You must connect the GitHub repo to this new project first.

### 10.1 Connect GitHub repo to the new project
In the Cloud Build console for `tavern-swiper-prod`:
1. Go to **Triggers → Manage repositories**
2. Connect `pszaflarski/tavern_swiper`

### 10.2 Create triggers

Create one trigger per service, all watching `^prod$` branch. Here's the full list:

| Trigger Name | cloudbuild.yaml | Included Files | Key Substitutions |
|---|---|---|---|
| `auth-prod-deploy` | `services/auth_go/cloudbuild.yaml` | `services/auth_go/**` | `_DB_ID=auth-prod`, `_ENV_NAME=prod`, `_ENV_SUFFIX=-prod`, `_DIR_NAME=auth_go`, `_SERVICE_NAME=auth`, `_FIREBASE_WEB_API_KEY=<PROD_KEY>`, `_USERS_DB_ID=users-prod` |
| `users-prod-deploy` | `services/users_go/cloudbuild.yaml` | `services/users_go/**` | `_DB_ID=users-prod`, `_ENV_NAME=prod`, `_ENV_SUFFIX=-prod`, `_DIR_NAME=users_go`, `_SERVICE_NAME=users` |
| `profiles-prod-deploy` | `services/profiles_go/cloudbuild.yaml` | `services/profiles_go/**` | `_DB_ID=profiles-prod`, `_ENV_NAME=prod`, `_ENV_SUFFIX=-prod`, `_DIR_NAME=profiles_go`, `_SERVICE_NAME=profiles` |
| `discovery-prod-deploy` | `services/discovery_go/cloudbuild.yaml` | `services/discovery_go/**` | `_DB_ID=discovery-prod`, `_ENV_NAME=prod`, `_ENV_SUFFIX=-prod`, `_DIR_NAME=discovery_go`, `_SERVICE_NAME=discovery` |
| `messages-prod-deploy` | `services/messages_go/cloudbuild.yaml` | `services/messages_go/**` | `_DB_ID=messages-prod`, `_ENV_NAME=prod`, `_ENV_SUFFIX=-prod`, `_DIR_NAME=messages_go`, `_SERVICE_NAME=messages` |
| `discovery-subscriber-prod-deploy` | `services/discovery_subscriber/cloudbuild.yaml` | `services/discovery_subscriber/**` | `_DB_ID=discovery-prod`, `_ENV_NAME=prod`, `_ENV_SUFFIX=-prod`, `_DIR_NAME=discovery_subscriber`, `_SERVICE_NAME=discovery-subscriber` |
| `messages-subscriber-prod-deploy` | `services/messages_subscriber/cloudbuild.yaml` | `services/messages_subscriber/**` | `_DB_ID=messages-prod`, `_ENV_NAME=prod`, `_ENV_SUFFIX=-prod`, `_DIR_NAME=messages_subscriber`, `_SERVICE_NAME=messages-subscriber` |
| `frontend-prod-deploy` | `frontend/cloudbuild.yaml` | `frontend/**` | `_ENV_NAME=prod`, `_ENV_SUFFIX=-prod`, `_SERVICE_NAME=app` |

Each trigger uses:
- `serviceAccount: projects/tavern-swiper-prod/serviceAccounts/cicd-builder@tavern-swiper-prod.iam.gserviceaccount.com`
- Branch filter: `^prod$`

---

## Phase 11 — Code Changes Required

### 11.1 `cloudbuild.yaml` updates (all services)

The existing cloudbuild files have some **hardcoded** references that need to be parameterized:

| File | Hardcoded Value | Change |
|---|---|---|
| [auth_go/cloudbuild.yaml](file:///home/peter/Documents/tavern_swiper/services/auth_go/cloudbuild.yaml#L33) | `tavern-swiper-sa@$PROJECT_ID` | ✅ Already uses `$PROJECT_ID` — no change needed |
| [auth_go/cloudbuild.yaml](file:///home/peter/Documents/tavern_swiper/services/auth_go/cloudbuild.yaml#L40) | `gs://tavern-swiper-build-logs-dev` | ❌ **Change to** `gs://tavern-swiper-build-logs-$_ENV_NAME` or pass as substitution |
| [profiles_go/cloudbuild.yaml](file:///home/peter/Documents/tavern_swiper/services/profiles_go/cloudbuild.yaml#L41) | `gs://tavern-swiper-build-logs-dev` | ❌ Same fix |
| [frontend/cloudbuild.yaml](file:///home/peter/Documents/tavern_swiper/frontend/cloudbuild.yaml#L63-L68) | Hardcoded Firebase config (API key, sender ID, app ID) | ❌ **Parameterize** using substitutions (`$_FIREBASE_API_KEY`, etc.) |
| [frontend/cloudbuild.yaml](file:///home/peter/Documents/tavern_swiper/frontend/cloudbuild.yaml#L99) | `gs://tavern-swiper-build-logs-dev` | ❌ Same fix |

#### Recommended changes to `cloudbuild.yaml` files:

**Option A — Substitution variable for logs bucket:**
```yaml
# At the bottom of each cloudbuild.yaml, replace:
logsBucket: "gs://tavern-swiper-build-logs-dev"
# With:
logsBucket: "gs://tavern-swiper-build-logs-$_ENV_NAME"
```
Then add `_ENV_NAME` to each trigger's substitutions (already done for most).

**Option B — Use `CLOUD_LOGGING_ONLY` for all (simpler):**
```yaml
options:
  logging: CLOUD_LOGGING_ONLY
```
This avoids needing the GCS bucket at all (the subscriber cloudbuild files already do this).

#### Frontend cloudbuild — parameterize Firebase config:

```diff
# frontend/cloudbuild.yaml — Step 3
-          --build-arg EXPO_PUBLIC_FIREBASE_API_KEY=AIzaSyCLDTIuGwoRcGLF1woXC6I1644-jSSXjNk \
+          --build-arg EXPO_PUBLIC_FIREBASE_API_KEY=$_FIREBASE_API_KEY \
-          --build-arg EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=374390417125 \
+          --build-arg EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$_FIREBASE_MESSAGING_SENDER_ID \
-          --build-arg EXPO_PUBLIC_FIREBASE_APP_ID=1:374390417125:web:ec1e664137daa9df11960c \
+          --build-arg EXPO_PUBLIC_FIREBASE_APP_ID=$_FIREBASE_APP_ID \
```

Then add `_FIREBASE_API_KEY`, `_FIREBASE_MESSAGING_SENDER_ID`, and `_FIREBASE_APP_ID` to the trigger substitutions for **all** environments (dev, test, prod).

### 11.2 `eas.json` — Add a prod-pointing profile

```json
{
  "build": {
    "production": {
      "autoIncrement": true,
      "environment": "production",
      "distribution": "store",
      "env": {
        "EXPO_PUBLIC_AUTH_URL": "https://auth-prod-<HASH>.a.run.app",
        "EXPO_PUBLIC_PROFILES_URL": "https://profiles-prod-<HASH>.a.run.app",
        "EXPO_PUBLIC_DISCOVERY_URL": "https://discovery-prod-<HASH>.a.run.app",
        "EXPO_PUBLIC_MESSAGES_URL": "https://messages-prod-<HASH>.a.run.app",
        "EXPO_PUBLIC_USERS_URL": "https://users-prod-<HASH>.a.run.app",
        "EXPO_PUBLIC_FIREBASE_API_KEY": "<PROD_FIREBASE_KEY>",
        "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN": "tavern-swiper-prod.firebaseapp.com",
        "EXPO_PUBLIC_FIREBASE_PROJECT_ID": "tavern-swiper-prod",
        "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET": "tavern-swiper-prod.firebasestorage.app",
        "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID": "<PROD_SENDER_ID>",
        "EXPO_PUBLIC_FIREBASE_APP_ID": "<PROD_APP_ID>"
      },
      "android": {
        "buildType": "app-bundle"
      }
    }
  }
}
```

> [!NOTE]
> The Cloud Run URLs won't be known until after the first deployment. Update these after Phase 12.

### 11.3 `scripts/switch_env.sh` — Add `prod` option

Update the script to accept `prod` as an environment and point to `tavern-swiper-prod` project:
```bash
if [[ "$ENV" == "prod" ]]; then
    PROJECT_ID="tavern-swiper-prod"
    SUFFIX="-prod"
fi
```

### 11.4 `setup-eas-env.sh` — Update for prod values

The script currently hardcodes all dev URLs and Firebase config. For prod, it needs to use the prod values.

---

## Phase 12 — First Deployment (Bootstrap)

Since triggers fire on push to `prod`, the first deployment needs a manual push:

```bash
# 1. Create and push the prod branch
git checkout test
git checkout -b prod
git push origin prod
```

This will trigger all Cloud Build triggers in `tavern-swiper-prod`. After all services deploy:

```bash
# 2. Get the service URLs
for SVC in auth users profiles discovery messages discovery-subscriber messages-subscriber app; do
  echo "$SVC: $(gcloud run services describe ${SVC}-prod \
    --platform managed --region us-central1 \
    --project tavern-swiper-prod \
    --format 'value(status.url)')"
done
```

```bash
# 3. Create Pub/Sub push subscriptions with real URLs
DISC_SUB_URL="<discovery-subscriber-prod URL>"
MSG_SUB_URL="<messages-subscriber-prod URL>"

gcloud pubsub subscriptions create prod-discovery-subscriber-sub \
  --topic=prod-profiles-profile-events-v1 \
  --push-endpoint="${DISC_SUB_URL}/HandleProfileEvent" \
  --ack-deadline=60 \
  --project=tavern-swiper-prod

gcloud pubsub subscriptions create prod-messages-subscriber-sub \
  --topic=prod-discovery-match-events-v1 \
  --push-endpoint="${MSG_SUB_URL}/" \
  --ack-deadline=60 \
  --project=tavern-swiper-prod
```

---

## Phase 13 — (Optional) Custom Domain & SSL

If you want a custom domain for the prod frontend:

```bash
gcloud run domain-mappings create \
  --service=app-prod \
  --domain=app.tavernswiper.com \
  --region=us-central1 \
  --project=tavern-swiper-prod
```

Then add the DNS records Google provides.

---

## Phase 14 — Verification Runbook

### Smoke tests after first prod deploy

| # | Check | Command / Action |
|---|---|---|
| 1 | All Cloud Run services are `SERVING` | `gcloud run services list --project=tavern-swiper-prod` |
| 2 | Health endpoints respond | `curl https://auth-prod-<hash>.a.run.app/auth/health` (repeat for all services) |
| 3 | Firestore databases exist | `gcloud firestore databases list --project=tavern-swiper-prod` |
| 4 | Pub/Sub topics & subs exist | `gcloud pubsub topics list --project=tavern-swiper-prod` |
| 5 | Create a test user via auth | `curl -X POST https://auth-prod-<hash>.a.run.app/auth/register ...` |
| 6 | Pub/Sub flow works | Create a profile → verify discovery-subscriber processes the event |
| 7 | Frontend web loads | Visit `https://app-prod-<hash>.a.run.app` |
| 8 | Mobile app connects | Build with `eas build --profile production` and verify login |

---

## Summary Checklist

- [ ] **Phase 1** — Create Firebase project (auto-creates GCP project), register web app, configure Auth
- [ ] **Phase 2** — Link billing, enable additional GCP APIs (Cloud Run, Cloud Build, Pub/Sub, etc.)
- [ ] **Phase 3** — Firestore named databases (5 databases)
- [ ] **Phase 4** — GCS media bucket
- [ ] **Phase 5** — Pub/Sub topics (subscriptions after deploy)
- [ ] **Phase 6** — Service accounts + IAM bindings
- [ ] **Phase 7** — Build logs bucket
- [ ] **Phase 8** — Generate & store prod secrets (JWT, API keys)
- [ ] **Phase 9** — Create `prod` branch with protection rules
- [ ] **Phase 10** — Cloud Build triggers (8 triggers in new project)
- [ ] **Phase 11** — Code changes (parameterize hardcoded values)
- [ ] **Phase 12** — Bootstrap first deploy + wire Pub/Sub subscriptions
- [ ] **Phase 13** — (Optional) Custom domain
- [ ] **Phase 14** — Smoke test everything
