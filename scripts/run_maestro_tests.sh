#!/usr/bin/env bash
# =============================================================================
# Maestro E2E Test Runner
# =============================================================================
# Starts the Android emulator, applies memory optimizations, and runs
# Maestro flows inside a memory-limited Docker container.
#
# Usage:
#   bash scripts/run_maestro_tests.sh              # Run all flows
#   bash scripts/run_maestro_tests.sh auth_login    # Run a single flow
#   bash scripts/run_maestro_tests.sh --no-docker   # Run without Docker (direct)
#   bash scripts/run_maestro_tests.sh --apk=/path/to/app.apk  # Use a specific APK
#
# Prerequisites:
#   - Android SDK with emulator (MaestroTest AVD)
#   - Docker (for containerized execution)
#   - Maestro CLI (fallback for --no-docker mode)
# =============================================================================

set -euo pipefail

# --- Configuration ---
EMULATOR_AVD="MaestroTest"
DOCKER_IMAGE="tavern-maestro-runner"
EMULATOR_BOOT_TIMEOUT=120

# Detect total system RAM (in GB) and adjust limits dynamically
TOTAL_RAM_GB=$(awk '/MemTotal/ {print int($2/1024/1024)}' /proc/meminfo 2>/dev/null || echo 16)
if [ "$TOTAL_RAM_GB" -ge 32 ]; then
    # High-spec environments (e.g. 64GB VM)
    MEMORY_LIMIT="8g"
    SWAP_LIMIT="8g"
    EMULATOR_MEM=4096
    MAX_HEAP_SIZE="4g"
else
    # Low-spec environments (e.g. standard developer machine)
    MEMORY_LIMIT="2g"
    SWAP_LIMIT="2g"
    EMULATOR_MEM=1536
    MAX_HEAP_SIZE="1g"
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MAESTRO_FLOWS_DIR="$PROJECT_ROOT/frontend/.maestro"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
ANDROID_SDK="${ANDROID_HOME:-$HOME/Android/Sdk}"
EMULATOR_BIN="$ANDROID_SDK/emulator/emulator"
ADB_BIN="$ANDROID_SDK/platform-tools/adb"

# --- Parse Arguments ---
USE_DOCKER=true
SPECIFIC_FLOW=""
CUSTOM_APK=""
for arg in "$@"; do
    case "$arg" in
        --no-docker) USE_DOCKER=false ;;
        --apk=*) CUSTOM_APK="${arg#--apk=}" ;;
        *) SPECIFIC_FLOW="$arg" ;;
    esac
done

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[maestro]${NC} $*"; }
ok()   { echo -e "${GREEN}[  ✓  ]${NC} $*"; }
warn() { echo -e "${YELLOW}[  !  ]${NC} $*"; }
err()  { echo -e "${RED}[  ✗  ]${NC} $*" >&2; }

# =============================================================================
# 1. CLEANUP — Remove stale Maestro temp artifacts from /tmp
# =============================================================================
cleanup_tmp() {
    log "Cleaning Maestro temp artifacts from /tmp..."
    local count
    count=$(find /tmp -maxdepth 1 \( -name "maestro-app*.apk" -o -name "maestro-server*.apk" -o -name "maestro-*" \) 2>/dev/null | wc -l)
    if [ "$count" -gt 0 ]; then
        find /tmp -maxdepth 1 \( -name "maestro-app*.apk" -o -name "maestro-server*.apk" -o -name "maestro-*" \) -delete 2>/dev/null || true
        ok "Removed $count stale Maestro artifact(s) from /tmp"
    else
        ok "No stale Maestro artifacts in /tmp"
    fi
}

# =============================================================================
# 2. SWAPPINESS — Reduce to 10 for better responsiveness
# =============================================================================
optimize_swappiness() {
    local current
    current=$(cat /proc/sys/vm/swappiness)
    if [ "$current" -gt 10 ]; then
        log "Reducing vm.swappiness from $current to 10..."
        if sudo -n sysctl vm.swappiness=10 >/dev/null 2>&1; then
            ok "vm.swappiness set to 10 (was $current)"
        else
            warn "Could not set vm.swappiness (requires sudo). Current: $current"
        fi
    else
        ok "vm.swappiness already at $current"
    fi
}

# =============================================================================
# 3. EMULATOR — Start if not running, wait for boot
# =============================================================================
start_emulator() {
    # Check if emulator is already running
    if "$ADB_BIN" devices 2>/dev/null | grep -q "emulator-"; then
        ok "Emulator already running"
        return 0
    fi

    log "Starting emulator: $EMULATOR_AVD..."

    # Verify AVD exists
    if ! "$EMULATOR_BIN" -list-avds 2>/dev/null | grep -q "^${EMULATOR_AVD}$"; then
        err "AVD '$EMULATOR_AVD' not found. Available AVDs:"
        "$EMULATOR_BIN" -list-avds 2>/dev/null || true
        exit 1
    fi

    # Launch emulator in background (headless for CI, windowed for local)
    "$EMULATOR_BIN" -avd "$EMULATOR_AVD" \
        -no-snapshot-save \
        -no-audio \
        -gpu auto \
        -memory "$EMULATOR_MEM" \
        &>/dev/null &

    EMULATOR_PID=$!
    log "Emulator PID: $EMULATOR_PID — waiting for boot..."

    # Wait for device to be online
    local elapsed=0
    while [ $elapsed -lt $EMULATOR_BOOT_TIMEOUT ]; do
        if "$ADB_BIN" shell getprop sys.boot_completed 2>/dev/null | grep -q "1"; then
            ok "Emulator booted in ${elapsed}s"
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
        printf "."
    done
    echo ""
    err "Emulator failed to boot within ${EMULATOR_BOOT_TIMEOUT}s"
    exit 1
}

# =============================================================================
# 4. ENSURE ADB SERVER — Make sure the ADB server is running on the host
# =============================================================================
ensure_adb_server() {
    log "Ensuring ADB server is running..."
    "$ADB_BIN" start-server 2>/dev/null
    ok "ADB server running on localhost:5037"
}

# =============================================================================
# 5. INSTALL APK — Install the app on the emulator before running tests
# =============================================================================
find_latest_apk() {
    # If user specified an APK, use that
    if [ -n "$CUSTOM_APK" ]; then
        if [ ! -f "$CUSTOM_APK" ]; then
            err "Specified APK not found: $CUSTOM_APK"
            exit 1
        fi
        echo "$CUSTOM_APK"
        return 0
    fi

    # Otherwise find the newest build-*.apk in the frontend directory
    local latest
    latest=$(ls -t "$FRONTEND_DIR"/build-*.apk 2>/dev/null | head -1)
    if [ -z "$latest" ]; then
        err "No APK found! Build one first with: eas build -p android --profile preview"
        err "Or specify a path with: --apk=/path/to/app.apk"
        exit 1
    fi
    echo "$latest"
}

install_apk() {
    local apk_path
    apk_path=$(find_latest_apk)
    local apk_name
    apk_name=$(basename "$apk_path")
    local apk_size
    apk_size=$(du -h "$apk_path" | cut -f1)

    log "Installing APK on emulator: $apk_name ($apk_size)..."

    # Check if the app is already installed and up-to-date
    if "$ADB_BIN" shell pm list packages 2>/dev/null | grep -q "com.tavernswiper.app"; then
        log "App already installed — reinstalling with -r flag..."
        if "$ADB_BIN" install -r -t "$apk_path" 2>&1 | tail -1 | grep -q "Success"; then
            ok "APK reinstalled successfully"
            return 0
        fi
    fi

    # Fresh install
    if "$ADB_BIN" install -t "$apk_path" 2>&1 | tail -1 | grep -q "Success"; then
        ok "APK installed successfully"
    else
        err "Failed to install APK: $apk_path"
        exit 1
    fi
}

# =============================================================================
# 6. DOCKER BUILD — Build the Maestro runner image (cached)
# =============================================================================
build_docker_image() {
    log "Building Maestro Docker image (cached layers reused)..."
    docker build \
        -t "$DOCKER_IMAGE" \
        -f "$SCRIPT_DIR/Dockerfile.maestro" \
        "$PROJECT_ROOT" \
        --quiet
    ok "Docker image '$DOCKER_IMAGE' ready"
}

# =============================================================================
# 7. RUN TESTS — Execute Maestro flows in memory-limited container
# =============================================================================
run_tests_docker() {
    log "Container memory limit: $MEMORY_LIMIT (swap: $SWAP_LIMIT)"

    if [ -n "$SPECIFIC_FLOW" ]; then
        local flow_target
        if [[ "$SPECIFIC_FLOW" == *.yaml ]]; then
            flow_target="$SPECIFIC_FLOW"
        else
            flow_target="${SPECIFIC_FLOW}.yaml"
        fi
        log "Running single flow: $flow_target"
        docker run --rm \
            --network=host \
            --memory="$MEMORY_LIMIT" \
            --memory-swap="$SWAP_LIMIT" \
            -v "$MAESTRO_FLOWS_DIR":/flows:ro \
            -e MAESTRO_CLI_NO_ANALYTICS=1 \
            -e MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true \
            "$DOCKER_IMAGE" \
            test "/flows/$flow_target"
    else
        run_flows_sequentially "docker"
    fi
}

run_tests_direct() {
    # Apply JVM memory limits in direct mode
    export JAVA_OPTS="${JAVA_OPTS:-} -Xmx${MAX_HEAP_SIZE} -Xms256m"
    export MAESTRO_CLI_NO_ANALYTICS=1
    export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true

    if [ -n "$SPECIFIC_FLOW" ]; then
        local flow_target
        if [[ "$SPECIFIC_FLOW" == *.yaml ]]; then
            flow_target="$MAESTRO_FLOWS_DIR/$SPECIFIC_FLOW"
        else
            flow_target="$MAESTRO_FLOWS_DIR/${SPECIFIC_FLOW}.yaml"
        fi
        log "Running single flow (direct): $flow_target"
        maestro test "$flow_target"
    else
        run_flows_sequentially "direct"
    fi
}

# =============================================================================
# SEQUENTIAL RUNNER — Execute each flow one at a time to avoid OOM
# =============================================================================
run_flows_sequentially() {
    local mode="$1"
    local passed=0
    local failed=0
    local failed_names=""
    local total=0

    # Collect all top-level .yaml flow files (not helpers)
    local flows=()
    for f in "$MAESTRO_FLOWS_DIR"/*.yaml; do
        [ -f "$f" ] || continue
        # Skip config.yaml
        [[ "$(basename "$f")" == "config.yaml" ]] && continue
        flows+=("$f")
    done
    total=${#flows[@]}

    log "Running $total flows sequentially (mode: $mode)"
    echo ""

    for flow in "${flows[@]}"; do
        local name
        name=$(basename "$flow" .yaml)
        log "[$((passed + failed + 1))/$total] Running: $name"

        local rc=0
        if [ "$mode" = "docker" ]; then
            docker run --rm \
                --network=host \
                --memory="$MEMORY_LIMIT" \
                --memory-swap="$SWAP_LIMIT" \
                -v "$MAESTRO_FLOWS_DIR":/flows:ro \
                -e MAESTRO_CLI_NO_ANALYTICS=1 \
                -e MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true \
                "$DOCKER_IMAGE" \
                test "/flows/$(basename "$flow")" || rc=$?
        else
            maestro test "$flow" || rc=$?
        fi

        if [ $rc -eq 0 ]; then
            ok "$name PASSED"
            passed=$((passed + 1))
        else
            err "$name FAILED (exit code: $rc)"
            failed=$((failed + 1))
            failed_names="$failed_names $name"
        fi
        echo ""
    done

    # Summary
    echo "============================================="
    echo "  Results: $passed passed, $failed failed (of $total)"
    echo "============================================="
    if [ $failed -gt 0 ]; then
        err "Failed flows:$failed_names"
        return 1
    fi
}

# =============================================================================
# MAIN
# =============================================================================
main() {
    echo ""
    echo "=============================================="
    echo "  ⚔️  Tavern Swiper — Maestro E2E Runner  ⚔️"
    echo "=============================================="
    echo ""

    # Pre-flight cleanup
    cleanup_tmp

    # System optimization
    optimize_swappiness

    # Emulator management
    ensure_adb_server
    start_emulator

    # Install the app
    install_apk

    # Run tests
    if [ "$USE_DOCKER" = true ]; then
        build_docker_image
        run_tests_docker
    else
        run_tests_direct
    fi

    # Post-run cleanup
    cleanup_tmp

    echo ""
    ok "Maestro test run complete!"
}

main
