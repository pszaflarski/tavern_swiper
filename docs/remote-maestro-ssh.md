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

### 2. Sync Code to the Remote VM
Commit your local changes and push them to your branch on GitHub, then SSH into the VM and pull them:
```bash
gcloud compute ssh peter@tau-ephemeral-instance \
  --zone=northamerica-northeast2-b \
  --project=tavern-swiper-dev \
  --command="cd ~/Documents/tavern_swiper && git pull"
```

---

### 3. Build the Emulator APK on the VM (Highmem Performance)
Since the VM runs in `n2-highmem-8` mode with 64 GB of RAM and 8 CPU cores, compiling the Android build on the VM is extremely fast and avoids consuming local host memory. 

Trigger the EAS local build on the VM using the `emulator` build profile (which automatically targets the x86_64 emulator architecture):
```bash
gcloud compute ssh peter@tau-ephemeral-instance \
  --zone=northamerica-northeast2-b \
  --project=tavern-swiper-dev \
  --command="cd ~/Documents/tavern_swiper/frontend && npx eas-cli build --platform android --profile emulator --local"
```
EAS will compile the application and output a file named like `build-*.apk` directly in the `frontend/` directory.

---

### 4. Run the Maestro Tests via SSH
Execute the Maestro test suite on the VM. The test runner script will automatically find the newly built APK in the `frontend/` directory:

```bash
gcloud compute ssh peter@tau-ephemeral-instance \
  --zone=northamerica-northeast2-b \
  --project=tavern-swiper-dev \
  --command="cd ~/Documents/tavern_swiper/frontend && bash ../scripts/run_maestro_tests.sh"
```

> [!NOTE]
> The `run_maestro_tests.sh` script automatically handles spinning up the AVD `MaestroTest` in headless mode (if not already running), cleaning up old artifacts, installing the newly compiled APK, running the Maestro runner inside a memory-limited Docker container (2GB RAM limit), and terminating the emulator on exit.

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
