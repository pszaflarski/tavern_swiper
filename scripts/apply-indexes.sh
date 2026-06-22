#!/bin/bash
# scripts/apply-indexes.sh
# Applies Firestore index configurations for Enterprise Edition.
# In Enterprise, both single-field and multi-field indexes are created via 'composite create'.
#
# IDEMPOTENT: If an index already exists, gcloud returns ALREADY_EXISTS — we catch that
# and print a skip message instead of failing.

# NOTE: no 'set -e' — we handle errors per-index gracefully

ENV=${1:-"dev"} # [dev|test|prod]
PROJECT=$(gcloud config get-value project)

echo "🚀 Applying Firestore indexes for environment: $ENV (Project: $PROJECT)"

# Mapping of services to their base database names
declare -A SERVICES
SERVICES=(
  ["profiles_go"]="profiles"
  ["discovery_go"]="discovery"
  ["messages_go"]="messages"
  ["users_go"]="users"
  ["bots_go"]="bots"
  ["quests_go"]="quests"
  ["characters_go"]="characters"
  ["notifications_go"]="notifications"
)

# Track results
CREATED=0
SKIPPED=0
FAILED=0

# Helper function to create an index (idempotent)
create_index() {
  local db=$1
  local coll=$2
  local fields=$3 # format: "field1:order,field2:order" or "field1:array"
  
  local cmd="gcloud firestore indexes composite create --database=$db --collection-group=$coll --async"
  
  # Split fields by comma
  IFS=',' read -ra ADDR <<< "$fields"
  for i in "${ADDR[@]}"; do
    IFS=':' read -ra PARTS <<< "$i"
    local fpath=${PARTS[0]}
    local fconfig=${PARTS[1]}
    
    if [[ "$fconfig" == "CONTAINS" ]]; then
      cmd="$cmd --field-config=field-path=$fpath,array-config=CONTAINS"
    else
      cmd="$cmd --field-config=field-path=$fpath,order=${fconfig,,}"
    fi
  done
  
  # Run and handle already-exists gracefully
  output=$($cmd --quiet 2>&1) && {
    echo "    ✅ $coll ($fields)"
    CREATED=$((CREATED+1))
  } || {
    if echo "$output" | grep -qi "already exists"; then
      echo "    ⏭️  $coll ($fields) — already exists"
      SKIPPED=$((SKIPPED+1))
    else
      echo "    ❌ $coll ($fields) — FAILED: $output"
      FAILED=$((FAILED+1))
    fi
  }
}

for svc in "${!SERVICES[@]}"; do
  DB_BASE=${SERVICES[$svc]}
  DB_ID="${DB_BASE}-${ENV}"
  
  echo ""
  echo "📦 Service: $svc -> Database: $DB_ID"

  case $svc in
    "profiles_go")
      # --- profiles collection ---
      create_index "$DB_ID" "profiles" "user_id:ASCENDING"
      create_index "$DB_ID" "profiles" "user_id:DESCENDING"
      create_index "$DB_ID" "profiles" "is_active:ASCENDING"
      create_index "$DB_ID" "profiles" "is_active:DESCENDING"
      create_index "$DB_ID" "profiles" "user_id:ASCENDING,is_active:ASCENDING"
      # --- tags collection ---
      create_index "$DB_ID" "tags" "slug:ASCENDING"
      create_index "$DB_ID" "tags" "category:ASCENDING"
      create_index "$DB_ID" "tags" "name:ASCENDING"
      create_index "$DB_ID" "tags" "name_lower:ASCENDING"
      create_index "$DB_ID" "tags" "multi_select:ASCENDING"
      create_index "$DB_ID" "tags" "status:ASCENDING"
      create_index "$DB_ID" "tags" "status:ASCENDING,created_at:DESCENDING"
      create_index "$DB_ID" "tags" "category:ASCENDING,name_lower:ASCENDING"
      create_index "$DB_ID" "tags" "category:ASCENDING,name:ASCENDING"
      ;;
    "discovery_go")
      create_index "$DB_ID" "swipes" "swiper_profile_id:ASCENDING"
      create_index "$DB_ID" "swipes" "swiped_profile_id:ASCENDING"
      create_index "$DB_ID" "swipes" "direction:ASCENDING"
      create_index "$DB_ID" "profiles_profiles_cache" "is_active:ASCENDING"
      create_index "$DB_ID" "matches" "profiles:CONTAINS"
      create_index "$DB_ID" "swipes" "swiper_profile_id:ASCENDING,swiped_profile_id:ASCENDING,direction:ASCENDING"
      create_index "$DB_ID" "swipes" "direction:ASCENDING,created_at:ASCENDING"
      ;;
    "messages_go")
      create_index "$DB_ID" "conversations" "participants_key:ASCENDING"
      create_index "$DB_ID" "profile_conversations" "profile_id:ASCENDING"
      create_index "$DB_ID" "messages" "created_at:ASCENDING"
      create_index "$DB_ID" "discovery_matches_cache" "profile_ids:CONTAINS"
      ;;
    "users_go")
      create_index "$DB_ID" "users" "user_type:ASCENDING"
      create_index "$DB_ID" "users" "is_deleted:ASCENDING"
      create_index "$DB_ID" "users" "user_type:ASCENDING,is_deleted:ASCENDING"
      ;;
    "bots_go")
      create_index "$DB_ID" "bot_users" "slug:ASCENDING"
      create_index "$DB_ID" "bot_profiles" "bot_user_id:ASCENDING"
      create_index "$DB_ID" "bot_profiles" "profile_id:ASCENDING"
      create_index "$DB_ID" "bot_profiles" "behavior_type:ASCENDING"
      ;;
    "quests_go")
      create_index "$DB_ID" "quest_status" "user_id:ASCENDING"
      create_index "$DB_ID" "quest_status" "profile_id:ASCENDING"
      create_index "$DB_ID" "quest_status" "status:ASCENDING"
      create_index "$DB_ID" "quest_status" "user_id:ASCENDING,status:ASCENDING"
      create_index "$DB_ID" "quest_status" "profile_id:ASCENDING,status:ASCENDING"
      create_index "$DB_ID" "user_inventory" "user_id:ASCENDING"
      create_index "$DB_ID" "user_inventory" "user_id:ASCENDING,quantity:DESCENDING"
      ;;
    "characters_go")
      # --- characters collection ---
      create_index "$DB_ID" "characters" "fandom:CONTAINS"
      create_index "$DB_ID" "characters" "race:CONTAINS"
      create_index "$DB_ID" "characters" "gender:CONTAINS"
      create_index "$DB_ID" "characters" "status:ASCENDING"
      create_index "$DB_ID" "characters" "status:DESCENDING"
      # --- images collection ---
      create_index "$DB_ID" "images" "character_id:ASCENDING"
      create_index "$DB_ID" "images" "artist_handle:ASCENDING"
      # --- character_tags collection ---
      create_index "$DB_ID" "character_tags" "slug:ASCENDING"
      create_index "$DB_ID" "character_tags" "category:ASCENDING"
      create_index "$DB_ID" "character_tags" "name:ASCENDING"
      create_index "$DB_ID" "character_tags" "name_lower:ASCENDING"
      create_index "$DB_ID" "character_tags" "category:ASCENDING,name_lower:ASCENDING"
      create_index "$DB_ID" "character_tags" "category:ASCENDING,name:ASCENDING"
      ;;
    "notifications_go")
      create_index "$DB_ID" "notifications_tokens" "user_id:ASCENDING"
      ;;
  esac
done

echo ""
echo "🏁 Index apply complete: ✅ $CREATED created, ⏭️ $SKIPPED already existed, ❌ $FAILED failed."
