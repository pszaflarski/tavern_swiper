# Login with Google — Implementation Plan

Add a "Sign in with Google" button to the auth screen, using Firebase Authentication's Google provider. Google Sign-In is offered **alongside** the existing email/password form. Apple Sign-In is deferred to a future task.

## Decisions

| Question | Decision |
|---|---|
| Keep email/password? | ✅ Yes — Google is an additional option, not a replacement |
| Apple Sign-In? | ⏳ Deferred — will add later, not part of this task |
| Auto-populate display name? | ✅ Yes — set `full_name` from Google profile on first sign-in |
| Account linking? | ✅ Yes — if a user already has an email/password account and signs in with Google using the same email, link the Google provider to the existing account |

## Current Architecture Summary

| Layer | Current State |
|---|---|
| **Frontend auth** | `frontend/app/auth.tsx` — Email/password only via Firebase JS SDK (`signInWithEmailAndPassword` / `createUserWithEmailAndPassword`) |
| **Firebase config** | `frontend/lib/firebase.ts` — Standard web SDK init with platform-appropriate persistence |
| **Token flow** | Firebase ID token → `frontend/lib/api.ts` exchanges it for a Tavern JWT via `POST /auth/verify` |
| **Backend auth** | `services/auth_go/handlers.go` — `verifyTokenHandler` calls `authClient.VerifyIDToken()` (provider-agnostic) |
| **User creation** | `services/users_go/handlers.go` — `getMeHandler` auto-initializes user records (self-healing) |
| **Build target** | Android only (Expo SDK 54 + EAS, `com.tavernswiper.app`) |

## Important Notes

> [!IMPORTANT]
> **Backend needs zero changes for auth.** The `verifyTokenHandler` in `auth_go` calls `VerifyIDToken()` on the Firebase Admin SDK, which validates **any** Firebase ID token regardless of sign-in provider (email, Google, Apple, etc.). The Tavern JWT exchange and user auto-initialization flows are already provider-agnostic.

> [!WARNING]
> **Google Play Console requirement.** For production, Google Sign-In requires a **SHA-1 fingerprint** registered in the Firebase Console from your **production signing key** (the upload keystore at `frontend/upload-keystore.jks`). This also needs to be reflected in Google Cloud Console's OAuth consent screen. This is a manual console step, not a code change.

> [!WARNING]
> **Requires a native rebuild.** The `@react-native-google-signin/google-signin` package includes native modules. You'll need a new EAS build (can't use Expo Go or a cached APK).

---

## Proposed Changes

### Phase 0: Firebase Console Configuration (Manual)

Do this for **both** `tavern-swiper-dev` and `tavern-swiper-prod` Firebase projects:

1. Enable the **Google** sign-in provider in Firebase Console → Authentication → Sign-in method.
2. Add the **SHA-1 fingerprint** from `upload-keystore.jks` to the Android app settings.
   ```bash
   keytool -list -v -keystore frontend/upload-keystore.jks -alias upload
   ```
3. Download the `google-services.json` for **dev** → save as `frontend/google-services.dev.json`.
4. Download the `google-services.json` for **prod** → save as `frontend/google-services.prod.json`.
5. Note the **Web Client ID** from each project (Firebase Console → Authentication → Sign-in method → Google → Web client ID).

---

### Phase 1: Install Dependency

```bash
cd frontend && npm install @react-native-google-signin/google-signin
```

> [!NOTE]
> **Already done.** This was installed during the planning session.

---

### Phase 2: Convert `app.json` → `app.config.js`

To support multiple environments (dev/prod), convert the static `app.json` into a dynamic `app.config.js`. This allows us to swap the `googleServicesFile` path based on the EAS build profile.

The `app.config.js` should:
- Import the existing `app.json` as the base config
- Read the EAS build profile from the environment (EAS sets `APP_ENV` or you can key off `EXPO_PUBLIC_FIREBASE_PROJECT_ID`)
- Conditionally set `android.googleServicesFile` to `./google-services.prod.json` or `./google-services.dev.json`
- Append `@react-native-google-signin/google-signin` to the plugins array

```javascript
const baseConfig = require('./app.json');

module.exports = ({ config }) => {
  const isProd = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID === 'tavern-swiper-prod';

  return {
    ...baseConfig.expo,
    ...config,
    android: {
      ...baseConfig.expo.android,
      ...config.android,
      googleServicesFile: isProd
        ? './google-services.prod.json'
        : './google-services.dev.json',
    },
    plugins: [
      ...(baseConfig.expo.plugins || []),
      '@react-native-google-signin/google-signin',
    ],
  };
};
```

> [!NOTE]
> This approach detects the environment using `EXPO_PUBLIC_FIREBASE_PROJECT_ID`, which is **already set** in your `eas.json` build profiles. No new environment variables are needed for the switching logic itself.

---

### Phase 3: Environment Variables

Add the Google OAuth **Web Client ID** to:

**`frontend/.env`** (local dev):
```
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<dev-web-client-id>
```

**`frontend/eas.json`** (add to existing `env` blocks):
```jsonc
// In "preview" → "env":
"EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID": "<dev-web-client-id>"

// In "production" → "env":
"EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID": "<prod-web-client-id>"
```

> [!NOTE]
> This is the **Web** client ID, not the Android client ID. The `@react-native-google-signin` library needs the web client ID to get an `idToken` that Firebase can verify.

---

### Phase 4: Google Sign-In Helper

Create `frontend/lib/googleAuth.ts` — a focused module that wraps the Google Sign-In flow, bridges it to Firebase, and handles account linking + display name population:

```typescript
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import {
  GoogleAuthProvider,
  signInWithCredential,
  linkWithCredential,
} from 'firebase/auth';
import { auth } from './firebase';
import { usersApi } from './api';

// Configure once at module load
GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
});

export async function signInWithGoogle(): Promise<void> {
  // 1. Check for Google Play Services
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  // 2. Trigger the native Google Sign-In UI
  const response = await GoogleSignin.signIn();
  const idToken = response.data?.idToken;

  if (!idToken) {
    throw new Error('No ID token received from Google');
  }

  // 3. Build Firebase credential from Google token
  const credential = GoogleAuthProvider.credential(idToken);

  // 4. Attempt sign-in — handle account linking if email already exists
  let userCred;
  try {
    userCred = await signInWithCredential(auth, credential);
  } catch (error: any) {
    if (error.code === 'auth/account-exists-with-different-credential') {
      // User already has an email/password account with this email.
      // If they are currently signed in, link the Google provider.
      if (auth.currentUser) {
        userCred = await linkWithCredential(auth.currentUser, credential);
      } else {
        throw new Error(
          'An account already exists with this email. Please sign in with your password first, then link Google from settings.'
        );
      }
    } else {
      throw error;
    }
  }

  // 5. For new users: auto-populate full_name from Google profile
  //    The users service self-heals (getMeHandler auto-creates the record),
  //    so we just need a follow-up PUT to set the display name.
  const isNewUser = userCred.additionalUserInfo?.isNewUser;
  if (isNewUser && userCred.user.displayName) {
    // Let the Tavern token exchange happen first (triggered by auth state change),
    // then update the user record with the display name.
    // Small delay to allow the self-healing getMeHandler to create the record.
    setTimeout(async () => {
      try {
        await usersApi.put('/users/me', {
          full_name: userCred.user.displayName,
        });
      } catch (e) {
        console.warn('[GoogleAuth] Failed to set display name:', e);
      }
    }, 2000);
  }
}

export { statusCodes };
```

> [!IMPORTANT]
> **Backend note on `full_name`:** The `UserCreate` struct in `users_go/models.go` does NOT include a `full_name` field, and `createUserHandler` does not write it to Firestore. Rather than modifying the backend create flow, we rely on the existing self-healing `getMeHandler` to create the user record, then do a follow-up `PUT /users/me` to set the display name. However, `UserUpdate` also currently only supports `is_premium` and `user_type`. **A small backend change to `UserUpdate` will be needed to accept `full_name`.** This is the only backend change required.

---

### Phase 5: Auth Screen UI

Modify `frontend/app/auth.tsx` to add a Google Sign-In button above the existing email/password form:

- Import `signInWithGoogle` and `statusCodes` from `googleAuth.ts`
- Add a `handleGoogleSignIn` handler that calls the function and maps errors
- Render a styled "Sign in with Google" button with the Google "G" icon
- Add an "or" divider between the Google button and the email/password form
- The existing email/password flow remains completely untouched

Rough layout:
```
┌─────────────────────────────┐
│        Sign In / Sign Up    │
│  subtitle text              │
│                             │
│  ┌──────────────────────┐   │
│  │ G  Sign in with Google│   │
│  └──────────────────────┘   │
│                             │
│  ──────── or ────────       │
│                             │
│  Email: [_______________]   │
│  Password: [____________]   │
│                             │
│  [    Enter Tavern      ]   │
│                             │
│  Toggle link                │
└─────────────────────────────┘
```

Error mapping for the Google button:
- `statusCodes.SIGN_IN_CANCELLED` → silently ignore (user backed out)
- `statusCodes.IN_PROGRESS` → silently ignore (already signing in)
- `statusCodes.PLAY_SERVICES_NOT_AVAILABLE` → "Google Play Services are required"
- `auth/account-exists-with-different-credential` → "Sign in with your password first, then link Google"
- All others → generic "Google sign-in failed" message

---

### Phase 6: Logout Flow

Modify the logout function in `frontend/hooks/useUser.ts` to also sign out of Google:

```typescript
// In the logout function, add before auth.signOut():
import { GoogleSignin } from '@react-native-google-signin/google-signin';

// Inside logout():
try {
  await GoogleSignin.signOut();
} catch (e) {
  // Not signed in with Google — ignore
}
await auth.signOut();
```

This ensures the Google account picker shows up again on the next sign-in attempt, rather than auto-selecting the previous account.

---

### Phase 7: Gitignore

Add `google-services.*.json` to `frontend/.gitignore` to prevent committing Firebase config files:

```
# Firebase config (per-environment)
google-services.*.json
```

---

## Summary of File Changes

| File | Action | Description |
|---|---|---|
| `frontend/package.json` | MODIFY | Add `@react-native-google-signin/google-signin` dependency (already done) |
| `frontend/app.config.js` | NEW | Dynamic config to switch between dev/prod `google-services.json` |
| `frontend/app.json` | KEEP | Stays as-is — `app.config.js` imports it as the base |
| `frontend/lib/googleAuth.ts` | NEW | Google Sign-In helper with account linking + display name (already created) |
| `frontend/app/auth.tsx` | MODIFY | Add Google button + "or" divider to auth screen |
| `frontend/hooks/useUser.ts` | MODIFY | Add `GoogleSignin.signOut()` to the logout flow |
| `frontend/.env` | MODIFY | Add `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` |
| `frontend/eas.json` | MODIFY | Add Web Client ID to preview + production env blocks |
| `frontend/.gitignore` | MODIFY | Add `google-services.*.json` |
| `frontend/google-services.dev.json` | NEW | Downloaded from Firebase Console (not committed) |
| `frontend/google-services.prod.json` | NEW | Downloaded from Firebase Console (not committed) |
| `services/users_go/models.go` | MODIFY | Add `FullName` field to `UserUpdate` struct |
| `services/users_go/handlers.go` | MODIFY | Handle `full_name` in `updateMeHandler` |

## Backend Change (Minor)

The only backend change is adding `full_name` support to the user update flow:

**`services/users_go/models.go`** — add to `UserUpdate`:
```go
type UserUpdate struct {
    IsPremium *bool     `json:"is_premium,omitempty"`
    UserType  *UserType `json:"user_type,omitempty"`
    FullName  *string   `json:"full_name,omitempty"`  // NEW
}
```

**`services/users_go/handlers.go`** — add to `updateMeHandler`:
```go
if body.FullName != nil {
    updates = append(updates, firestore.Update{Path: "full_name", Value: *body.FullName})
}
```

---

## Verification Plan

### Pre-build Steps (Manual)
1. Enable Google provider in Firebase Console for both `tavern-swiper-dev` and `tavern-swiper-prod`
2. Add SHA-1 fingerprint to Android app config in both projects
3. Download `google-services.json` for both projects
4. Save as `google-services.dev.json` and `google-services.prod.json` in `frontend/`
5. Create `app.config.js` (Phase 2)
6. Copy the Web Client IDs into `.env` and `eas.json`

### Automated Tests
- Existing auth tests should still pass (email/password flow unchanged)
- Add a unit test for `googleAuth.ts` mocking `GoogleSignin` and `signInWithCredential`
- Add a test for the account-linking path (mock `auth/account-exists-with-different-credential` error)

### Integration Testing
- Run a new EAS build (`eas build --profile preview --local`)
- Install the APK on a device/emulator
- **New user flow:** Tap "Sign in with Google" → account picker → lands in app with user record + `full_name` populated
- **Existing email user flow:** Tap "Sign in with Google" with same email → account links → same UID preserved
- **Email/password flow:** Still works exactly as before
- Verify logout clears the Google session properly (`GoogleSignin.signOut()`)
