import { cleanup } from '../scripts/cleanup-test-dbs';

async function globalSetup() {
  console.log('🧹 [Global Setup] Clearing test databases (single run for all tests)...');
  try {
    await cleanup();
    console.log('✅ [Global Setup] Cleanup complete.');
  } catch (error: any) {
    console.error('❌ [Global Setup] Cleanup failed:', error.message);
    // Don't throw — let tests attempt to run even if cleanup had issues
  }
}

export default globalSetup;
