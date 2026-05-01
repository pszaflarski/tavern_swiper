#!/bin/bash
# scripts/apply-indexes.sh
# Applies Firestore index configurations for Enterprise Edition.
# In Enterprise, both single-field and multi-field indexes are created via 'composite create'.

set -e

ENV=${1:-"dev"}
PROJECT=$(gcloud config get-value project)

echo "🚀 Applying Firestore indexes for environment: $ENV (Project: $PROJECT)"

# Mapping of services to their base database names
declare -A SERVICES
SERVICES=(
  ["profiles_go"]="profiles"
  ["discovery_go"]="discovery"
  ["messages_go"]="messages"
  ["users_go"]="users"
)

# Helper function to create an index
create_index() {
  local db=$1
  local coll=$2
  local fields=$3 # format: "field1:order,field2:order" or "field1:array"
  
  echo "  🏗️  Creating index: $coll ($fields)"
  
  local cmd="gcloud firestore indexes composite create --database=$db --collection-group=$coll"
  
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
  
  # Run in background
  $cmd --quiet &
}

for svc in "${!SERVICES[@]}"; do
  DB_BASE=${SERVICES[$svc]}
  DB_ID="${DB_BASE}-${ENV}"
  
  echo "📦 Service: $svc -> Database: $DB_ID"

  case $svc in
    "profiles_go")
      create_index "$DB_ID" "profiles" "user_id:ASCENDING"
      create_index "$DB_ID" "profiles" "user_id:DESCENDING"
      create_index "$DB_ID" "profiles" "is_active:ASCENDING"
      create_index "$DB_ID" "profiles" "is_active:DESCENDING"
      create_index "$DB_ID" "profiles" "user_id:ASCENDING,is_active:ASCENDING"
      ;;
    "discovery_go")
      create_index "$DB_ID" "swipes" "swiper_profile_id:ASCENDING"
      create_index "$DB_ID" "swipes" "swiped_profile_id:ASCENDING"
      create_index "$DB_ID" "swipes" "direction:ASCENDING"
      create_index "$DB_ID" "matches" "profiles:CONTAINS"
      create_index "$DB_ID" "swipes" "swiper_profile_id:ASCENDING,swiped_profile_id:ASCENDING,direction:ASCENDING"
      ;;
    "messages_go")
      create_index "$DB_ID" "conversations" "participants_key:ASCENDING"
      create_index "$DB_ID" "profile_conversations" "profile_id:ASCENDING"
      create_index "$DB_ID" "discovery_matches_cache" "profile_ids:CONTAINS"
      ;;
    "users_go")
      create_index "$DB_ID" "users" "user_type:ASCENDING"
      ;;
  esac
done

wait
echo "✅ All index creation requests submitted."
