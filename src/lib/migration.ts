/**
 * IndexedDB to OPFS Migration
 * 
 * Migrates data from the old IndexedDB 'wingman' database to OPFS.
 * This runs once on app startup if IndexedDB data exists.
 */

import { migrateChat } from './v1Migration';
import * as opfs from './opfs';
import type { Chat } from '../types/chat';
import type { Repository } from '../types/repository';
import type { Image } from '../types/renderer';

// Old IndexedDB constants
const OLD_DB_NAME = 'wingman';
const OLD_STORE_NAME = 'store';

// Migration flag key in OPFS
const MIGRATION_COMPLETE_FLAG = 'migration_complete.flag';

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
 */
async function migrateChats(): Promise<void> {
  console.log('[Migration] Migrating chats...');
  
  const oldChats = await readOldValue<Chat[]>('chats');
  if (!oldChats || !Array.isArray(oldChats)) {
    console.log('[Migration] No chats to migrate');
    return;
  }
  
  console.log(`[Migration] Found ${oldChats.length} chats`);
  
  const indexEntries: opfs.IndexEntry[] = [];
  
  for (const oldChat of oldChats) {
    try {
      // Apply chat format migration
      const chat = migrateChat(oldChat);
      
      // Extract blobs and store in new folder structure
      const stored = await opfs.extractChatBlobs(chat);
      await opfs.writeJson(`chats/${chat.id}/chat.json`, stored);
      
      // Migrate artifacts if present
      if (oldChat.artifacts && typeof oldChat.artifacts === 'object') {
        await opfs.saveArtifacts(chat.id, oldChat.artifacts);
      }
      
      indexEntries.push({
        id: chat.id,
        title: chat.title,
        updated: stored.updated || new Date().toISOString(),
      });
      
      console.log(`[Migration] Migrated chat: ${chat.id}`);
    } catch (error) {
      console.error(`[Migration] Failed to migrate chat ${oldChat.id}:`, error);
    }
  }
  
  // Write index
  await opfs.writeIndex('chats', indexEntries);
  console.log(`[Migration] Chats migration complete: ${indexEntries.length} chats`);
}

/**
 * Migrate repositories from IndexedDB to OPFS.
 */
async function migrateRepositories(): Promise<void> {
  console.log('[Migration] Migrating repositories...');
  
  const oldRepos = await readOldValue<Repository[]>('repositories');
  if (!oldRepos || !Array.isArray(oldRepos)) {
    console.log('[Migration] No repositories to migrate');
    return;
  }
  
  console.log(`[Migration] Found ${oldRepos.length} repositories`);
  
  const indexEntries: opfs.IndexEntry[] = [];
  
  for (const repo of oldRepos) {
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
      
      console.log(`[Migration] Migrated repository: ${repo.id}`);
    } catch (error) {
      console.error(`[Migration] Failed to migrate repository ${repo.id}:`, error);
    }
  }
  
  // Write index
  await opfs.writeIndex('repositories', indexEntries);
  console.log(`[Migration] Repositories migration complete: ${indexEntries.length} repositories`);
}

/**
 * Migrate images from IndexedDB to OPFS.
 */
async function migrateImages(): Promise<void> {
  console.log('[Migration] Migrating images...');
  
  const oldImages = await readOldValue<Image[]>('images');
  if (!oldImages || !Array.isArray(oldImages)) {
    console.log('[Migration] No images to migrate');
    return;
  }
  
  console.log(`[Migration] Found ${oldImages.length} images`);
  
  const indexEntries: opfs.IndexEntry[] = [];
  
  for (const image of oldImages) {
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
      
      console.log(`[Migration] Migrated image: ${image.id}`);
    } catch (error) {
      console.error(`[Migration] Failed to migrate image ${image.id}:`, error);
    }
  }
  
  // Write index
  await opfs.writeIndex('images', indexEntries);
  console.log(`[Migration] Images migration complete: ${indexEntries.length} images`);
}

/**
 * Migrate bridge servers from IndexedDB to OPFS.
 */
async function migrateBridge(): Promise<void> {
  console.log('[Migration] Migrating bridge servers...');
  
  const servers = await readOldValue('bridge');
  if (!servers) {
    console.log('[Migration] No bridge servers to migrate');
    return;
  }
  
  await opfs.writeJson('bridge.json', servers);
  console.log('[Migration] Bridge servers migration complete');
}

/**
 * Migrate profile settings from IndexedDB to OPFS.
 */
async function migrateProfile(): Promise<void> {
  console.log('[Migration] Migrating profile...');
  
  const profile = await readOldValue('profile');
  if (!profile) {
    console.log('[Migration] No profile to migrate');
    return;
  }
  
  await opfs.writeJson('profile.json', profile);
  console.log('[Migration] Profile migration complete');
}

/**
 * Migrate skills from IndexedDB to OPFS.
 */
async function migrateSkills(): Promise<void> {
  console.log('[Migration] Migrating skills...');
  
  const skills = await readOldValue('skills');
  if (!skills) {
    console.log('[Migration] No skills to migrate');
    return;
  }
  
  await opfs.writeJson('skills.json', skills);
  console.log('[Migration] Skills migration complete');
}

/**
 * Run the full migration from IndexedDB to OPFS.
 * Should be called once on app startup.
 */
export async function runMigration(): Promise<void> {
  // Check if already migrated
  if (await isMigrationComplete()) {
    console.log('[Migration] Already complete, skipping');
    return;
  }
  
  // Check if there's anything to migrate
  if (!await hasOldDatabase()) {
    console.log('[Migration] No old database found, marking complete');
    await markMigrationComplete();
    return;
  }
  
  console.log('[Migration] Starting IndexedDB to OPFS migration...');
  
  try {
    // Migrate all data types
    await migrateChats();
    await migrateRepositories();
    await migrateImages();
    await migrateBridge();
    await migrateProfile();
    await migrateSkills();
    
    // Delete old database
    console.log('[Migration] Deleting old IndexedDB...');
    await deleteOldDatabase();
    
    // Mark complete
    await markMigrationComplete();
    
    console.log('[Migration] Migration complete!');
  } catch (error) {
    console.error('[Migration] Migration failed:', error);
    throw error;
  }
}
