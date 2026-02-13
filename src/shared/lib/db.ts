const DB_NAME = 'wingman';
const STORE_NAME = 'store';

let dbInstance: IDBDatabase | null = null;

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME);
    
    request.onerror = () => reject(request.error);
    
    request.onsuccess = () => {
      dbInstance = request.result;
      
      dbInstance.onclose = () => {
        dbInstance = null;
      };
      
      resolve(dbInstance);
    };
    
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
  });
}

export function closeDB(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export async function setValue(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  const transaction = db.transaction([STORE_NAME], 'readwrite');
  const objectStore = transaction.objectStore(STORE_NAME);
  
  const item = {
    key,
    value: JSON.stringify(value)
  };
  
  return new Promise<void>((resolve, reject) => {
    const putRequest = objectStore.put(item);
    putRequest.onsuccess = () => resolve();
    putRequest.onerror = () => reject(putRequest.error);
  });
}

export async function getValue<T = unknown>(key: string): Promise<T | undefined> {
  const db = await openDB();
  const transaction = db.transaction([STORE_NAME], 'readonly');
  const objectStore = transaction.objectStore(STORE_NAME);
  
  return new Promise<T | undefined>((resolve, reject) => {
    const getRequest = objectStore.get(key);
    getRequest.onsuccess = () => {
      const result = getRequest.result;
      if (result) {
        try {
          resolve(JSON.parse(result.value));
        } catch (error) {
          console.error('Error parsing JSON value for key:', key, error);
          resolve(undefined);
        }
      } else {
        resolve(undefined);
      }
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

export async function deleteValue(key: string): Promise<void> {
  const db = await openDB();
  const transaction = db.transaction([STORE_NAME], 'readwrite');
  const objectStore = transaction.objectStore(STORE_NAME);
  
  return new Promise<void>((resolve, reject) => {
    const deleteRequest = objectStore.delete(key);
    deleteRequest.onsuccess = () => resolve();
    deleteRequest.onerror = () => reject(deleteRequest.error);
  });
}

export function clearDB(): Promise<void> {
  return new Promise((resolve, reject) => {
    closeDB();
    const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
    deleteRequest.onsuccess = () => resolve();
    deleteRequest.onerror = () => reject(deleteRequest.error);
  });
}

export async function getStorageUsage(): Promise<{
  totalSize: number;
  entries: Array<{ key: string; size: number }>;
}> {
  const db = await openDB();
  const transaction = db.transaction([STORE_NAME], 'readonly');
  const objectStore = transaction.objectStore(STORE_NAME);
  
  return new Promise((resolve, reject) => {
    const getAllRequest = objectStore.getAll();
    
    getAllRequest.onsuccess = () => {
      const results = getAllRequest.result;
      let totalSize = 0;
      const entries: Array<{ key: string; size: number }> = [];
      
      results.forEach((item: { key: string; value: string }) => {
        // Calculate approximate size in bytes
        const size = new Blob([item.value]).size;
        totalSize += size;
        entries.push({ key: item.key, size });
      });
      
      resolve({ totalSize, entries });
    };
    
    getAllRequest.onerror = () => reject(getAllRequest.error);
  });
}