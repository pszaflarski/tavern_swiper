# infra/

Infrastructure and operational configuration files for Cloud Build triggers.

## Files

| File | Description |
| :--- | :--- |
| `trigger.yaml` | Example Cloud Build trigger definition (used as template for `gcloud builds triggers import`). |
| `new_trigger.yaml` | Template for creating new Cloud Build triggers. |
| `trigger_export.yaml` | Exported trigger config (reference/backup). |
| `triggers.json` | Full export of all Cloud Build triggers for the project. |
| `update_docker.py` | Script to update Docker Compose configs programmatically. |

## Usage

These files are primarily used for:
- Recreating Cloud Build triggers on a new project (`gcloud builds triggers import --source=trigger.yaml`)
- Auditing the current trigger configuration
- Bulk-updating trigger substitution variables via `scripts/update_triggers_substitutions.sh`

Most developers will never need to modify these files directly.
