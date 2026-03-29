import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Firestore, Query } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';

dotenv.config();

const PROJECT_ID = 'tavern-swiper-dev';
const DATABASE_IDS = [
  'auth-test',
  'profiles-test',
  'discovery-test',
  'swipes-test',
  'messages-test',
  'users-test',
];

// Initialize with default app
initializeApp({
  projectId: PROJECT_ID,
});

async function deleteCollection(db: Firestore, collectionPath: string, batchSize: number) {
  const collectionRef = db.collection(collectionPath);
  const query = collectionRef.orderBy('__name__').limit(batchSize);

  return new Promise<void>((resolve, reject) => {
    deleteQueryBatch(db, query, resolve).catch(reject);
  });
}

async function deleteQueryBatch(db: Firestore, query: Query, resolve: () => void) {
  const snapshot = await query.get();

  const batchSize = snapshot.size;
  if (batchSize === 0) {
    resolve();
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();

  process.nextTick(() => {
    deleteQueryBatch(db, query, resolve);
  });
}

async function cleanup() {
  console.log(`\n🧹 Starting cleanup for project: ${PROJECT_ID}`);

  for (const dbId of DATABASE_IDS) {
    console.log(`  Checking database: ${dbId}...`);
    try {
      const db = getFirestore(dbId);
      const collections = await db.listCollections();
      
      if (collections.length === 0) {
        console.log(`    ✅ No collections in ${dbId}`);
        continue;
      }

      for (const collection of collections) {
        console.log(`    🗑️ Deleting collection: ${collection.id} in ${dbId}...`);
        await deleteCollection(db, collection.id, 500);
      }
      console.log(`    ✅ Finished ${dbId}`);
    } catch (error: any) {
      if (error.code === 5 || error.message.includes('not found') || error.message.includes('not exist')) {
        console.warn(`    ⚠️ Database ${dbId} not found or not accessible. Skipping.`);
      } else {
        console.error(`    ❌ Error cleaning up ${dbId}:`, error.message);
      }
    }
  }

  console.log('🏁 Cleanup complete.\n');
}

if (require.main === module) {
  cleanup().catch(console.error);
}

export { cleanup };
