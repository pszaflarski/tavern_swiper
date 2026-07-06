#!/usr/bin/env bash

# ==============================================================================
# Script Name: manage_tau_instance.sh
# Description: Automates the lifecycle of an ephemeral ARM64 (Tau T2A) VM.
#              Supports suspending (snapshot -> export -> delete) and
#              resuming (import image -> create VM -> cleanup image).
# ==============================================================================

set -euo pipefail

# ------------------------------------------------------------------------------
# 1. Parameterization (Configure or override via Env Vars)
# ------------------------------------------------------------------------------
PROJECT_ID="${PROJECT_ID:-tavern-swiper-dev}"
ZONE="${ZONE:-northamerica-northeast2-b}"
INSTANCE_NAME="${INSTANCE_NAME:-tau-ephemeral-instance}"
GCS_BUCKET_PATH="${GCS_BUCKET_PATH:-gs://tavern-swiper-vm-backups}"
MACHINE_TYPE="${MACHINE_TYPE:-n2-highmem-8}"
BOOT_DISK_SIZE="${BOOT_DISK_SIZE:-100GB}"
EXPORT_ZONE="${EXPORT_ZONE:-northamerica-northeast2-b}"

# ------------------------------------------------------------------------------
# 2. Logging Helpers
# ------------------------------------------------------------------------------
log_info() {
  echo -e "[INFO] $(date +'%Y-%m-%d %H:%M:%S') - $1"
}

log_error() {
  echo -e "[ERROR] $(date +'%Y-%m-%d %H:%M:%S') - $1" >&2
}

# ------------------------------------------------------------------------------
# 3. Usage Guide
# ------------------------------------------------------------------------------
usage() {
  cat <<EOF
Usage: $0 [suspend|resume]

Modes:
  suspend  Safely stop instance, export boot disk to GCS as tar.gz, and delete VM.
  resume   Reconstitute image from GCS (ARM64), boot a new VM, and purge the image.

Configuration Variables (set at top of script or export as env vars):
  PROJECT_ID        : $PROJECT_ID
  ZONE              : $ZONE
  INSTANCE_NAME     : $INSTANCE_NAME
  GCS_BUCKET_PATH   : $GCS_BUCKET_PATH
  MACHINE_TYPE      : $MACHINE_TYPE
  BOOT_DISK_SIZE    : $BOOT_DISK_SIZE
  EXPORT_ZONE       : $EXPORT_ZONE
EOF
  exit 1
}

if [ $# -ne 1 ]; then
  usage
fi

MODE="$1"

# ------------------------------------------------------------------------------
# 4. Normalization and URI Generation
# ------------------------------------------------------------------------------
# Strip trailing slashes
GCS_BUCKET_PATH="${GCS_BUCKET_PATH%/}"
# Ensure gs:// prefix
if [[ ! "$GCS_BUCKET_PATH" =~ ^gs:// ]]; then
  GCS_BUCKET_PATH="gs://${GCS_BUCKET_PATH}"
fi
GCS_TARBALL_URI="${GCS_BUCKET_PATH}/${INSTANCE_NAME}.tar.gz"

# ------------------------------------------------------------------------------
# 5. Core Pipeline Logic
# ------------------------------------------------------------------------------
case "$MODE" in
  suspend)
    log_info "Initiating SUSPEND pipeline for instance '${INSTANCE_NAME}' in project '${PROJECT_ID}'..."

    # Check if instance exists
    INSTANCE_EXISTS=true
    INSTANCE_STATUS=$(gcloud compute instances describe "$INSTANCE_NAME" \
      --zone="$ZONE" \
      --project="$PROJECT_ID" \
      --format="value(status)" 2>/dev/null) || INSTANCE_EXISTS=false

    if [ "$INSTANCE_EXISTS" = "false" ]; then
      # Check if GCS backup already exists
      GCS_EXISTS=true
      gcloud storage objects describe "$GCS_TARBALL_URI" --project="$PROJECT_ID" >/dev/null 2>&1 || \
      gsutil stat "$GCS_TARBALL_URI" >/dev/null 2>&1 || \
      GCS_EXISTS=false

      if [ "$GCS_EXISTS" = "true" ]; then
        log_info "Instance '${INSTANCE_NAME}' does not exist, but backup tarball exists at '${GCS_TARBALL_URI}'."
        log_info "SUSPEND completed (already suspended)."
        exit 0
      else
        log_error "Instance '${INSTANCE_NAME}' does not exist and no backup found at '${GCS_TARBALL_URI}'."
        exit 1
      fi
    fi

    # 1. Stop instance if it's running
    if [ "$INSTANCE_STATUS" != "TERMINATED" ]; then
      log_info "Instance status is '${INSTANCE_STATUS}'. Stopping instance safely using ACPI shutdown..."
      gcloud compute instances stop "$INSTANCE_NAME" \
        --zone="$ZONE" \
        --project="$PROJECT_ID" \
        --quiet
      log_info "Instance stopped successfully."
    else
      log_info "Instance is already stopped (TERMINATED)."
    fi

    # 2. Get the boot disk name
    log_info "Retrieving boot disk name for '${INSTANCE_NAME}'..."
    BOOT_DISK=$(gcloud compute instances describe "$INSTANCE_NAME" \
      --zone="$ZONE" \
      --project="$PROJECT_ID" \
      --format="value(disks[0].source)" | awk -F/ '{print $NF}')

    if [ -z "$BOOT_DISK" ]; then
      log_error "Could not retrieve the boot disk name for instance '${INSTANCE_NAME}'."
      exit 1
    fi
    log_info "Boot disk found: '${BOOT_DISK}'"

    # 3. Create temporary image from the stopped boot disk
    TEMP_IMAGE_NAME=$(echo "${INSTANCE_NAME}-temp-$(date +%s)" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g')
    log_info "Creating temporary image '${TEMP_IMAGE_NAME}' from disk '${BOOT_DISK}'..."
    
    # Pre-clean just in case a conflicting image exists
    gcloud compute images delete "$TEMP_IMAGE_NAME" --project="$PROJECT_ID" --quiet >/dev/null 2>&1 || true

    gcloud compute images create "$TEMP_IMAGE_NAME" \
      --source-disk="$BOOT_DISK" \
      --source-disk-zone="$ZONE" \
      --project="$PROJECT_ID" \
      --quiet
    log_info "Temporary image created successfully."

    # 4. Remove any existing object in the destination URI to avoid conflicts
    if gcloud storage objects describe "$GCS_TARBALL_URI" --project="$PROJECT_ID" >/dev/null 2>&1 || gsutil stat "$GCS_TARBALL_URI" >/dev/null 2>&1; then
      log_info "Removing existing backup file at '${GCS_TARBALL_URI}' before exporting..."
      gcloud storage rm "$GCS_TARBALL_URI" --project="$PROJECT_ID" >/dev/null 2>&1 || gsutil rm -f "$GCS_TARBALL_URI" >/dev/null 2>&1 || true
    fi

    # 5. Export the temporary image to GCS
    log_info "Exporting image '${TEMP_IMAGE_NAME}' to '${GCS_TARBALL_URI}' using export zone '${EXPORT_ZONE}'..."
    gcloud compute images export \
      --image="$TEMP_IMAGE_NAME" \
      --destination-uri="$GCS_TARBALL_URI" \
      --project="$PROJECT_ID" \
      --zone="$EXPORT_ZONE"
    log_info "Export completed successfully. Tarball saved to '${GCS_TARBALL_URI}'."

    # 6. Clean up temporary image
    log_info "Cleaning up temporary image '${TEMP_IMAGE_NAME}' from registry..."
    gcloud compute images delete "$TEMP_IMAGE_NAME" \
      --project="$PROJECT_ID" \
      --quiet
    log_info "Temporary image deleted."

    # 7. Delete Compute Instance and its boot disk
    log_info "Deleting Compute instance '${INSTANCE_NAME}' and its attached boot disk..."
    gcloud compute instances delete "$INSTANCE_NAME" \
      --zone="$ZONE" \
      --project="$PROJECT_ID" \
      --delete-disks=all \
      --quiet
    log_info "Compute resources purged successfully. SUSPEND pipeline complete."
    ;;

  resume)
    log_info "Initiating RESUME pipeline for instance '${INSTANCE_NAME}' in project '${PROJECT_ID}'..."

    # Check if instance already exists
    INSTANCE_EXISTS=true
    INSTANCE_STATUS=$(gcloud compute instances describe "$INSTANCE_NAME" \
      --zone="$ZONE" \
      --project="$PROJECT_ID" \
      --format="value(status)" 2>/dev/null) || INSTANCE_EXISTS=false

    if [ "$INSTANCE_EXISTS" = "true" ]; then
      if [ "$INSTANCE_STATUS" = "RUNNING" ]; then
        log_info "Instance '${INSTANCE_NAME}' already exists and is RUNNING. Nothing to do."
        exit 0
      else
        log_info "Instance '${INSTANCE_NAME}' exists but is stopped (status: '${INSTANCE_STATUS}'). Starting..."
        gcloud compute instances start "$INSTANCE_NAME" \
          --zone="$ZONE" \
          --project="$PROJECT_ID" \
          --quiet
        log_info "Instance started successfully."
        exit 0
      fi
    fi

    # Check if GCS backup tarball exists
    GCS_EXISTS=true
    gcloud storage objects describe "$GCS_TARBALL_URI" --project="$PROJECT_ID" >/dev/null 2>&1 || \
    gsutil stat "$GCS_TARBALL_URI" >/dev/null 2>&1 || \
    GCS_EXISTS=false

    if [ "$GCS_EXISTS" = "false" ]; then
      log_error "Backup tarball not found at '${GCS_TARBALL_URI}'. Cannot resume instance."
      exit 1
    fi
    log_info "Backup tarball verified at '${GCS_TARBALL_URI}'."

    # 1. Create temporary restore image with nested virtualization license
    RESTORE_IMAGE_NAME=$(echo "${INSTANCE_NAME}-restore-$(date +%s)" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g')
    log_info "Creating restore image '${RESTORE_IMAGE_NAME}' from GCS tarball..."

    # Pre-clean just in case a conflicting image exists
    gcloud compute images delete "$RESTORE_IMAGE_NAME" --project="$PROJECT_ID" --quiet >/dev/null 2>&1 || true

    gcloud compute images create "$RESTORE_IMAGE_NAME" \
      --source-uri="$GCS_TARBALL_URI" \
      --guest-os-features="UEFI_COMPATIBLE,GVNIC" \
      --project="$PROJECT_ID" \
      --quiet
    log_info "Restore image created successfully."

    # 2. Spin up new x86_64 instance using the restore image
    log_info "Spinning up new x86_64 instance '${INSTANCE_NAME}' (Machine Type: '${MACHINE_TYPE}', Disk Size: '${BOOT_DISK_SIZE}') from image '${RESTORE_IMAGE_NAME}'..."
    gcloud compute instances create "$INSTANCE_NAME" \
      --zone="$ZONE" \
      --machine-type="$MACHINE_TYPE" \
      --image="$RESTORE_IMAGE_NAME" \
      --boot-disk-size="$BOOT_DISK_SIZE" \
      --enable-nested-virtualization \
      --project="$PROJECT_ID" \
      --quiet
    log_info "Instance created and started successfully."

    # 3. Clean up the restore image resource from registry
    log_info "Cleaning up restore image '${RESTORE_IMAGE_NAME}' from registry..."
    gcloud compute images delete "$RESTORE_IMAGE_NAME" \
      --project="$PROJECT_ID" \
      --quiet
    log_info "Restore image resource deleted. RESUME pipeline complete."
    ;;

  *)
    log_error "Unknown mode: '$MODE'"
    usage
    ;;
esac
