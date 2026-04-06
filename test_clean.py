from google.cloud import firestore
import traceback
try:
    db = firestore.Client(project="tavern-swiper-dev", database="users-test")
    docs = list(db.collection("users").stream())
    print(f"Found {len(docs)} users.")
    for doc in docs:
        doc.reference.delete()
    print("Done clearing users-test")
except Exception as e:
    print(e)
    traceback.print_exc()
