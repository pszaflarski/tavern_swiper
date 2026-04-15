import os
import firebase_admin
from firebase_admin import credentials
from google.cloud import firestore

# Maintenance Ritual: Repair Discovery Cache
# Iterates through 'profiles_profiles_cache' and ensures 'image_urls' and 'talents'
# are valid arrays, not 'null'.

def repair():
    db_id = os.environ.get("FIRESTORE_DATABASE_ID", "discovery")
    print(f"🔧 Starting Repair Ritual on database [{db_id}]...")
    
    db = firestore.Client(database=db_id)
    collection = "profiles_profiles_cache"
    
    docs = db.collection(collection).stream()
    count = 0
    fixed = 0
    
    for doc in docs:
        count += 1
        data = doc.to_dict()
        needs_fix = False
        updates = {}
        
        # Check image_urls
        if "image_urls" not in data or data["image_urls"] is None:
            updates["image_urls"] = []
            needs_fix = True
            
        # Check talents
        if "talents" not in data or data["talents"] is None:
            updates["talents"] = []
            needs_fix = True
            
        if needs_fix:
            doc.reference.update(updates)
            fixed += 1
            print(f"  ✅ Fixed Profile ID: {doc.id}")
            
    print(f"🏁 Ritual Complete. Scanned: {count}, Transmuted: {fixed}.")

if __name__ == "__main__":
    repair()
