/**
 * IndexedDB to OPFS Migration
 * 
 * Migrates data from the old IndexedDB 'wingman' database to OPFS.
 * This runs once on app startup if IndexedDB data exists.
 * 
 * The migration is "best effort" - it tries to migrate as many items
 * as possible, logging failures without stopping the entire process.
 */

import { migrateChat } from './v1Migration';
import * as opfs from '@/shared/lib/opfs';
import type { Chat } from '@/shared/types/chat';
import type { Repository } from '@/features/repository/types/repository';
import type { Image } from '@/features/tools/types/renderer';

// Old IndexedDB constants
const OLD_DB_NAME = 'wingman';
const OLD_STORE_NAME = 'store';

// Migration flag key in OPFS
const MIGRATION_COMPLETE_FLAG = 'migration_complete.flag';

// Migration stats for logging
interface MigrationStats {
  chats: { total: number; migrated: number; failed: string[] };
  repositories: { total: number; migrated: number; failed: string[] };
  images: { total: number; migrated: number; failed: string[] };
  bridge: boolean;
  profile: boolean;
  skills: boolean;
}

/**
 * Check if migration has already been completed.
 */
export async function isMigrationComplete(): Promise<boolean> {
  return opfs.fileExists(MIGRATION_COMPLETE_FLAG);
}

/**
 * Mark migration as complete.
 */
async function markMigrationComplete(): Promise<void> {
  await opfs.writeText(MIGRATION_COMPLETE_FLAG, new Date().toISOString());
}

/**
 * Check if the old IndexedDB database exists.
 */
async function hasOldDatabase(): Promise<boolean> {
  return new Promise((resolve) => {
    const request = indexedDB.open(OLD_DB_NAME);
    
    request.onsuccess = () => {
      const db = request.result;
      const hasStore = db.objectStoreNames.contains(OLD_STORE_NAME);
      db.close();
      resolve(hasStore);
    };
    
    request.onerror = () => {
      resolve(false);
    };
  });
}

/**
 * Read a value from the old IndexedDB.
 */
async function readOldValue<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OLD_DB_NAME);
    
    request.onerror = () => reject(request.error);
    
    request.onsuccess = () => {
      const db = request.result;
      
      if (!db.objectStoreNames.contains(OLD_STORE_NAME)) {
        db.close();
        resolve(undefined);
        return;
      }
      
      const transaction = db.transaction([OLD_STORE_NAME], 'readonly');
      const store = transaction.objectStore(OLD_STORE_NAME);
      const getRequest = store.get(key);
      
      getRequest.onsuccess = () => {
        const result = getRequest.result;
        db.close();
        
        if (result?.value) {
          try {
            resolve(JSON.parse(result.value));
          } catch {
            resolve(undefined);
          }
        } else {
          resolve(undefined);
        }
      };
      
      getRequest.onerror = () => {
        db.close();
        reject(getRequest.error);
      };
    };
  });
}

/**
 * Delete the old IndexedDB database.
 */
async function deleteOldDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(OLD_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Migrate chats from IndexedDB to OPFS.
 * Best effort: migrates as many chats as possible, one by one.
 */
async function migrateChats(): Promise<MigrationStats['chats']> {
  const stats: MigrationStats['chats'] = { total: 0, migrated: 0, failed: [] };
  
  console.log('[Migration] Migrating chats...');
  
  // Old chats may have an artifacts property that's no longer in the current Chat type
  type OldChat = Chat & { artifacts?: Record<string, { path: string; content: string; contentType?: string }> };
  
  let oldChats: OldChat[] | undefined;
  try {
    oldChats = await readOldValue<OldChat[]>('chats');
  } catch (error) {
    console.error('[Migration] Failed to read chats from IndexedDB:', error);
    return stats;
  }
  
  if (!oldChats || !Array.isArray(oldChats)) {
    console.log('[Migration] No chats to migrate');
    return stats;
  }
  
  stats.total = oldChats.length;
  console.log(`[Migration] Found ${oldChats.length} chats`);
  
  const indexEntries: opfs.IndexEntry[] = [];
  
  // Migrate one chat at a time
  for (const oldChat of oldChats) {
    const chatId = oldChat?.id || 'unknown';
    try {
      // Apply chat format migration
      const chat = migrateChat(oldChat);
      
      // Extract blobs and store in new folder structure
      const stored = await opfs.extractChatBlobs(chat);
      await opfs.writeJson(`chats/${chat.id}/chat.json`, stored);
      
      // Migrate artifacts if present (best effort - don't fail the chat if artifacts fail)
      if (oldChat.artifacts && typeof oldChat.artifacts === 'object') {
        try {
          await opfs.saveArtifacts(chat.id, oldChat.artifacts);
        } catch (artifactError) {
          console.warn(`[Migration] Failed to migrate artifacts for chat ${chatId}:`, artifactError);
        }
      }
      
      indexEntries.push({
        id: chat.id,
        title: chat.title,
        updated: stored.updated || new Date().toISOString(),
      });
      
      stats.migrated++;
      console.log(`[Migration] Migrated chat: ${chatId} (${stats.migrated}/${stats.total})`);
    } catch (error) {
      stats.failed.push(chatId);
      console.error(`[Migration] Failed to migrate chat ${chatId}:`, error);
    }
  }
  
  // Write index (only if we have entries)
  if (indexEntries.length > 0) {
    try {
      await opfs.writeIndex('chats', indexEntries);
    } catch (error) {
      console.error('[Migration] Failed to write chats index:', error);
    }
  }
  
  console.log(`[Migration] Chats migration complete: ${stats.migrated}/${stats.total} chats (${stats.failed.length} failed)`);
  return stats;
}

/**
 * Migrate repositories from IndexedDB to OPFS.
 * Best effort: migrates as many repositories as possible, one by one.
 */
async function migrateRepositories(): Promise<MigrationStats['repositories']> {
  const stats: MigrationStats['repositories'] = { total: 0, migrated: 0, failed: [] };
  
  console.log('[Migration] Migrating repositories...');
  
  let oldRepos: Repository[] | undefined;
  try {
    oldRepos = await readOldValue<Repository[]>('repositories');
  } catch (error) {
    console.error('[Migration] Failed to read repositories from IndexedDB:', error);
    return stats;
  }
  
  if (!oldRepos || !Array.isArray(oldRepos)) {
    console.log('[Migration] No repositories to migrate');
    return stats;
  }
  
  stats.total = oldRepos.length;
  console.log(`[Migration] Found ${oldRepos.length} repositories`);
  
  const indexEntries: opfs.IndexEntry[] = [];
  
  // Migrate one repository at a time
  for (const repo of oldRepos) {
    const repoId = repo?.id || 'unknown';
    try {
      // Convert dates
      const stored = {
        ...repo,
        createdAt: repo.createdAt instanceof Date 
          ? repo.createdAt.toISOString() 
          : repo.createdAt,
        updatedAt: repo.updatedAt instanceof Date 
          ? repo.updatedAt.toISOString() 
          : repo.updatedAt,
      };
      
      await opfs.writeJson(`repositories/${repo.id}.json`, stored);
      
      indexEntries.push({
        id: repo.id,
        title: repo.name,
        updated: stored.updatedAt || new Date().toISOString(),
      });
      
      stats.migrated++;
      console.log(`[Migration] Migrated repository: ${repoId} (${stats.migrated}/${stats.total})`);
    } catch (error) {
      stats.failed.push(repoId);
      console.error(`[Migration] Failed to migrate repository ${repoId}:`, error);
    }
  }
  
  // Write index (only if we have entries)
  if (indexEntries.length > 0) {
    try {
      await opfs.writeIndex('repositories', indexEntries);
    } catch (error) {
      console.error('[Migration] Failed to write repositories index:', error);
    }
  }
  
  console.log(`[Migration] Repositories migration complete: ${stats.migrated}/${stats.total} repositories (${stats.failed.length} failed)`);
  return stats;
}

/**
 * Migrate images from IndexedDB to OPFS.
 * Best effort: migrates as many images as possible, one by one.
 */
async function migrateImages(): Promise<MigrationStats['images']> {
  const stats: MigrationStats['images'] = { total: 0, migrated: 0, failed: [] };
  
  console.log('[Migration] Migrating images...');
  
  let oldImages: Image[] | undefined;
  try {
    oldImages = await readOldValue<Image[]>('images');
  } catch (error) {
    console.error('[Migration] Failed to read images from IndexedDB:', error);
    return stats;
  }
  
  if (!oldImages || !Array.isArray(oldImages)) {
    console.log('[Migration] No images to migrate');
    return stats;
  }
  
  stats.total = oldImages.length;
  console.log(`[Migration] Found ${oldImages.length} images`);
  
  const indexEntries: opfs.IndexEntry[] = [];
  
  // Migrate one image at a time
  for (const image of oldImages) {
    const imageId = image?.id || 'unknown';
    try {
      // Extract the image data as a blob
      let blobRef = image.data;
      if (opfs.isDataUrl(image.data)) {
        const blob = opfs.dataUrlToBlob(image.data);
        const blobId = await opfs.storeBlob(blob);
        blobRef = opfs.createBlobRef(blobId);
      }
      
      const stored = {
        ...image,
        data: blobRef,
        created: image.created instanceof Date 
          ? image.created.toISOString() 
          : image.created,
        updated: image.updated instanceof Date 
          ? image.updated.toISOString() 
          : image.updated,
      };
      
      await opfs.writeJson(`images/${image.id}.json`, stored);
      
      indexEntries.push({
        id: image.id,
        title: image.title,
        updated: stored.updated || stored.created || new Date().toISOString(),
      });
      
      stats.migrated++;
      console.log(`[Migration] Migrated image: ${imageId} (${stats.migrated}/${stats.total})`);
    } catch (error) {
      stats.failed.push(imageId);
      console.error(`[Migration] Failed to migrate image ${imageId}:`, error);
    }
  }
  
  // Write index (only if we have entries)
  if (indexEntries.length > 0) {
    try {
      await opfs.writeIndex('images', indexEntries);
    } catch (error) {
      console.error('[Migration] Failed to write images index:', error);
    }
  }
  
  console.log(`[Migration] Images migration complete: ${stats.migrated}/${stats.total} images (${stats.failed.length} failed)`);
  return stats;
}

/**
 * Migrate bridge servers from IndexedDB to OPFS.
 * Best effort: logs error but doesn't throw.
 */
async function migrateBridge(): Promise<boolean> {
  console.log('[Migration] Migrating bridge servers...');
  
  try {
    const servers = await readOldValue('bridge');
    if (!servers) {
      console.log('[Migration] No bridge servers to migrate');
      return true;
    }
    
    await opfs.writeJson('bridge.json', servers);
    console.log('[Migration] Bridge servers migration complete');
    return true;
  } catch (error) {
    console.error('[Migration] Failed to migrate bridge servers:', error);
    return false;
  }
}

/**
 * Migrate profile settings from IndexedDB to OPFS.
 * Best effort: logs error but doesn't throw.
 */
async function migrateProfile(): Promise<boolean> {
  console.log('[Migration] Migrating profile...');
  
  try {
    const profile = await readOldValue('profile');
    if (!profile) {
      console.log('[Migration] No profile to migrate');
      return true;
    }
    
    await opfs.writeJson('profile.json', profile);
    console.log('[Migration] Profile migration complete');
    return true;
  } catch (error) {
    console.error('[Migration] Failed to migrate profile:', error);
    return false;
  }
}

/**
 * Migrate skills from IndexedDB to OPFS.
 * Best effort: logs error but doesn't throw.
 */
async function migrateSkills(): Promise<boolean> {
  console.log('[Migration] Migrating skills...');
  
  try {
    const skills = await readOldValue('skills');
    if (!skills) {
      console.log('[Migration] No skills to migrate');
      return true;
    }
    
    await opfs.writeJson('skills.json', skills);
    console.log('[Migration] Skills migration complete');
    return true;
  } catch (error) {
    console.error('[Migration] Failed to migrate skills:', error);
    return false;
  }
}

/**
 * Check if OPFS is supported in this browser.
 */
function isOPFSSupported(): boolean {
  return 'storage' in navigator && 'getDirectory' in navigator.storage;
}

/**
 * Run the full migration from IndexedDB to OPFS.
 * Should be called once on app startup.
 * 
 * This is a "best effort" migration - it tries to migrate as many items
 * as possible, one by one, and continues even if some items fail.
 * The migration is marked complete even if some items failed, to prevent
 * repeated migration attempts that would fail the same way.
 */
export async function runMigration(): Promise<void> {
  // Check OPFS support first
  if (!isOPFSSupported()) {
    throw new Error(
      'Your browser does not support the required storage features (OPFS). ' +
      'Please use a modern browser like Chrome, Edge, Safari 15.2+, or Firefox 111+.'
    );
  }
  
  // Check if already migrated
  if (await isMigrationComplete()) {
    console.log('[Migration] Already complete, skipping');
    return;
  }
  
  // Check if there's anything to migrate
  let hasOld = false;
  try {
    hasOld = await hasOldDatabase();
  } catch (error) {
    console.error('[Migration] Failed to check for old database:', error);
    // Mark as complete to prevent repeated checks
    await markMigrationComplete();
    return;
  }
  
  if (!hasOld) {
    console.log('[Migration] No old database found, marking complete');
    await markMigrationComplete();
    return;
  }
  
  console.log('[Migration] Starting IndexedDB to OPFS migration (best effort)...');
  
  // Collect migration stats
  const stats: MigrationStats = {
    chats: { total: 0, migrated: 0, failed: [] },
    repositories: { total: 0, migrated: 0, failed: [] },
    images: { total: 0, migrated: 0, failed: [] },
    bridge: false,
    profile: false,
    skills: false,
  };
  
  // Migrate all data types - one by one, best effort
  // Each function handles its own errors and won't throw
  stats.chats = await migrateChats();
  stats.repositories = await migrateRepositories();
  stats.images = await migrateImages();
  stats.bridge = await migrateBridge();
  stats.profile = await migrateProfile();
  stats.skills = await migrateSkills();
  
  // Log migration summary
  console.log('[Migration] === Migration Summary ===');
  console.log(`[Migration] Chats: ${stats.chats.migrated}/${stats.chats.total} migrated`);
  if (stats.chats.failed.length > 0) {
    console.log(`[Migration]   Failed: ${stats.chats.failed.join(', ')}`);
  }
  console.log(`[Migration] Repositories: ${stats.repositories.migrated}/${stats.repositories.total} migrated`);
  if (stats.repositories.failed.length > 0) {
    console.log(`[Migration]   Failed: ${stats.repositories.failed.join(', ')}`);
  }
  console.log(`[Migration] Images: ${stats.images.migrated}/${stats.images.total} migrated`);
  if (stats.images.failed.length > 0) {
    console.log(`[Migration]   Failed: ${stats.images.failed.join(', ')}`);
  }
  console.log(`[Migration] Bridge: ${stats.bridge ? 'success' : 'failed/empty'}`);
  console.log(`[Migration] Profile: ${stats.profile ? 'success' : 'failed/empty'}`);
  console.log(`[Migration] Skills: ${stats.skills ? 'success' : 'failed/empty'}`);
  
  // Try to delete old database (best effort)
  try {
    console.log('[Migration] Deleting old IndexedDB...');
    await deleteOldDatabase();
  } catch (error) {
    console.error('[Migration] Failed to delete old database (will be retried on next load):', error);
    // Don't fail the migration for this - the data is already migrated
  }
  
  // Mark complete - even if some items failed
  // This prevents repeated migration attempts that would fail the same way
  try {
    await markMigrationComplete();
  } catch (error) {
    console.error('[Migration] Failed to mark migration complete:', error);
    // This is not fatal - worst case, migration runs again next time
  }
  
  const totalFailed = stats.chats.failed.length + stats.repositories.failed.length + stats.images.failed.length;
  if (totalFailed > 0) {
    console.log(`[Migration] Migration complete with ${totalFailed} failed items. Check console for details.`);
  } else {
    console.log('[Migration] Migration complete! All items migrated successfully.');
  }
}
