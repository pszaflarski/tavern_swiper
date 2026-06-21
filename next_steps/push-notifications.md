# Push Notifications Service Verification

> **Status**: Deployed to `dev` environment
> **Branch**: `dev`
> **Context**: The `notifications_go` microservice is live on Cloud Run, the frontend is integrated with the `expo-notifications` package, and GCP Pub/Sub subscriptions are wired to deliver push notifications when matches or messages occur.

## Next Steps: Credentials & Verification

Now that the code is merged and live on the `dev` branch, follow these steps to upload the Google Service Account credentials to Expo and test the notification pipeline.

### 1. Link Dev FCM Credentials in Expo Console (One-time Setup)

To allow Expo's servers to dispatch push payloads to your Android dev builds, you need to upload your Firebase Dev credentials:

1. **Download the Key from Firebase Dev Console**:
   - Open the [Firebase Console](https://console.firebase.google.com/) and click on **`tavern-swiper-dev`**.
   - Click the ⚙️ gear icon in the left sidebar next to "Project Overview" and select **Project settings**.
   - Navigate to the **Service accounts** tab.
   - Click the blue **Generate new private key** button at the bottom of the page, then click **Generate key** to download the `.json` file to your computer.

2. **Upload the Key to Expo Dashboard**:
   - Open the [Expo Credentials Page](https://expo.dev/accounts/peterjac0b/projects/tavern-swiper/credentials/android/com.tavernswiper.app) in your web browser.
   - Click on the **`com.tavernswiper.app`** App Identifier link.
   - Scroll down to the **Service Credentials** card (below the Keystore section) and find the **FCM V1 Service Account Key** section.
   - Click **Add key** (or **Edit / Upload JSON**) and select the `.json` file you just downloaded.
   - Click **Save**.
   - *Optional:* You can now safely delete the `.json` file from your local computer.

### 2. Verify Locally Against Dev Cloud Services

Since the backend is fully deployed on Cloud Run, you can run the mobile client locally but point it at the live `dev` services to trigger real push notifications:

1. **Point your Frontend to Dev Environment**:
   In the root directory, switch the API router configuration to Dev:
   ```bash
   bash scripts/switch_env.sh dev
   ```

2. **Start the Expo Server**:
   ```bash
   cd frontend
   npx expo start
   ```

3. **Install & Run on Device**:
   - Open the app on a physical Android device (via the Expo Go app) or an Android emulator with Google Play Services.
   - Log in using a test account, and tap **Allow** when the OS prompts you for push notifications permissions.
   - The app will automatically generate the Expo push token and register it with the live `notifications-dev` service.

4. **Trigger a Notification**:
   - Match with one of the seeded bots (like **Lira** or **Grogmar**).
   - Start chatting with them. When the bot sends an AI reply, it publishes to Pub/Sub, routing a push notification directly to your phone!
