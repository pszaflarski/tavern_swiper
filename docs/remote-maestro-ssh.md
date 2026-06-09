# Remote Maestro Testing via SSH on Ephemeral VM

This guide details how to leverage the remote x86_64 GCP instance (`tau-ephemeral-instance`) as a remote test runner via SSH to run automated Android Maestro tests. This avoids consuming local CPU/RAM resources and takes advantage of the VM's hardware-accelerated nested virtualization.

---

## E2E Testing Workflow

### 1. Resume the Remote VM
First, make sure the instance is spun up and running. From your local environment:
```bash
./scripts/manage_tau_instance.sh resume
```
Wait about 2 minutes for the boot process and the Tailscale service to initialize. You can verify it is active by checking the tailnet status:
```bash
tailscale status
```
Look for `tau-ephemeral-instance-1` (IP `100.126.229.101`).

---

### 2. Build the x86_64 APK Locally
To test on the remote x86_64 Android emulator, your APK must include the `x86_64` architecture. Build the local-variant APK with emulator architecture compatibility enabled:

```bash
cd frontend
# Set EAS build variable to target emulator architectures (arm64-v8a + x86_64)
EAS_BUILD_EMULATOR=true npm run build:local
```
This produces your test APK (usually located at `frontend/dist/` or `frontend/android/app/build/outputs/apk/release/app-release.apk`).

---

### 3. Transfer the APK to the Remote VM
Upload the compiled APK from your local machine to the remote VM using `gcloud compute scp`:

```bash
gcloud compute scp \
  /path/to/local/app-release.apk \
  peter@tau-ephemeral-instance:~/Documents/tavern_swiper/frontend/app-release.apk \
  --zone=northamerica-northeast2-b \
  --project=tavern-swiper-dev
```

---

### 4. Run the Maestro Tests via SSH
Connect to the remote VM via SSH and execute the Maestro test suite. 

You can execute this as a one-liner SSH command that starts the emulator, installs the uploaded APK, runs the tests, and shuts down the emulator:

```bash
gcloud compute ssh peter@tau-ephemeral-instance \
  --zone=northamerica-northeast2-b \
  --project=tavern-swiper-dev \
  --command="cd ~/Documents/tavern_swiper/frontend && bash ../scripts/run_maestro_tests.sh --apk ./app-release.apk"
```

> [!NOTE]
> The `run_maestro_tests.sh` script automatically handles spinning up the AVD `MaestroTest` in headless mode (if not already running), cleaning up old artifacts, running the Maestro runner inside a memory-limited Docker container (2GB RAM limit), and terminating the emulator on exit.

---

### 5. Retrieve Test Reports and Artifacts
If any tests fail, Maestro generates screenshots and reports. You can download these back to your local machine:

```bash
gcloud compute scp \
  peter@tau-ephemeral-instance:~/Documents/tavern_swiper/frontend/.maestro/tests/ \
  ./local-test-reports/ \
  --recurse \
  --zone=northamerica-northeast2-b \
  --project=tavern-swiper-dev
```

---

### 6. Suspend the Remote VM
Once testing is completed, suspend the VM to release GCE compute allocations and avoid ongoing billing:
```bash
./scripts/manage_tau_instance.sh suspend
```

---

## Advanced: Debugging and ADB Tunneling
If you need to connect your local development environment directly to the emulator running on the remote VM, you can tunnel ADB (Android Debug Bridge) port `5037` over SSH:

1. **Establish the SSH Tunnel**:
   ```bash
   ssh -L 5037:localhost:5037 peter@100.126.229.101
   ```
2. **Interact with the Remote Emulator Locally**:
   Now, any local commands like `adb devices` or `maestro studio` will transparently talk to the remote emulator over the secure tunnel.
