#!/bin/bash
while ! gcloud firestore databases describe --database=quests-dev --project=tavern-swiper-dev &>/dev/null; do
    echo "Waiting for quests-dev..."
    sleep 5
done
echo "DB is ready! Seeding..."
.venv/bin/python3 scripts/seed_quests.py dev
