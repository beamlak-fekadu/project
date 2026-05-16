import type { OfflineQueueRecord } from '@/types/offline';

export const OFFLINE_DB_NAME = 'bmerms-offline';
export const OFFLINE_DB_VERSION = 2;
export const OFFLINE_ACTION_STORE = 'offline_actions';
export const OFFLINE_READ_CACHE_STORE = 'offline_read_cache';
export const OFFLINE_QUEUE_CHANGED_EVENT = 'bmerms:offline-queue-changed';
export const OFFLINE_CACHE_CHANGED_EVENT = 'bmerms:offline-cache-changed';

let dbPromise: Promise<IDBDatabase> | null = null;

export function isIndexedDbAvailable() {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

export function dispatchOfflineQueueChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OFFLINE_QUEUE_CHANGED_EVENT));
}

export function dispatchOfflineCacheChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OFFLINE_CACHE_CHANGED_EVENT));
}

function createActionStore(db: IDBDatabase) {
  const store = db.createObjectStore(OFFLINE_ACTION_STORE, { keyPath: 'client_action_id' });
  store.createIndex('sync_status', 'sync_status', { unique: false });
  store.createIndex('created_at', 'created_at', { unique: false });
  store.createIndex('action_type', 'action_type', { unique: false });
  store.createIndex('entity_type', 'entity_type', { unique: false });
  store.createIndex('asset_id', 'asset_id', { unique: false });
  store.createIndex('role_name', 'role_name', { unique: false });
}

function createReadCacheStore(db: IDBDatabase) {
  const store = db.createObjectStore(OFFLINE_READ_CACHE_STORE, { keyPath: 'storage_key' });
  store.createIndex('profile_id', 'profile_id', { unique: false });
  store.createIndex('cache_key', 'cache_key', { unique: false });
  store.createIndex('cached_at', 'cached_at', { unique: false });
  store.createIndex('role_name', 'role_name', { unique: false });
}

export function openOfflineDb(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new Error('IndexedDB is not available in this browser context'));
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = (event as IDBVersionChangeEvent).oldVersion;
      // v0 → v1 (fresh install): create the action queue store.
      // v1 → v2 (Phase 3): add the read cache store WITHOUT touching the
      // existing action queue store, so users that already have queued offline
      // actions keep them through the upgrade.
      if (!db.objectStoreNames.contains(OFFLINE_ACTION_STORE)) {
        createActionStore(db);
      }
      if (oldVersion < 2 && !db.objectStoreNames.contains(OFFLINE_READ_CACHE_STORE)) {
        createReadCacheStore(db);
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => reject(request.error ?? new Error('Failed to open offline database'));
    request.onblocked = () => reject(new Error('Offline database upgrade is blocked by another tab'));
  });

  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export async function putOfflineActionRecord(record: OfflineQueueRecord) {
  const db = await openOfflineDb();
  const transaction = db.transaction(OFFLINE_ACTION_STORE, 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore(OFFLINE_ACTION_STORE).put(record);
  await done;
}

export async function getOfflineActionRecord(id: string): Promise<OfflineQueueRecord | null> {
  const db = await openOfflineDb();
  const transaction = db.transaction(OFFLINE_ACTION_STORE, 'readonly');
  const done = transactionDone(transaction);
  const record = await requestToPromise<OfflineQueueRecord | undefined>(
    transaction.objectStore(OFFLINE_ACTION_STORE).get(id),
  );
  await done;
  return record ?? null;
}

export async function getAllOfflineActionRecords(): Promise<OfflineQueueRecord[]> {
  const db = await openOfflineDb();
  const transaction = db.transaction(OFFLINE_ACTION_STORE, 'readonly');
  const done = transactionDone(transaction);
  const records = await requestToPromise<OfflineQueueRecord[]>(
    transaction.objectStore(OFFLINE_ACTION_STORE).getAll(),
  );
  await done;
  return records;
}

export async function deleteOfflineActionRecord(id: string) {
  const db = await openOfflineDb();
  const transaction = db.transaction(OFFLINE_ACTION_STORE, 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore(OFFLINE_ACTION_STORE).delete(id);
  await done;
}

export async function clearOfflineActionRecordsByStatus(status: OfflineQueueRecord['sync_status']) {
  const db = await openOfflineDb();
  const transaction = db.transaction(OFFLINE_ACTION_STORE, 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore(OFFLINE_ACTION_STORE);
  const index = store.index('sync_status');
  const request = index.openCursor(IDBKeyRange.only(status));

  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error('Failed to clear offline action records'));
  });

  await done;
}

export type OfflineReadCacheRecord<T = unknown> = {
  storage_key: string;
  cache_key: string;
  profile_id: string;
  role_name: string;
  department_id: string | null;
  data: T;
  cached_at: string;
  expires_at: string | null;
  source_route: string | null;
  version: number;
};

export async function putOfflineReadCacheRecord<T>(record: OfflineReadCacheRecord<T>) {
  const db = await openOfflineDb();
  const transaction = db.transaction(OFFLINE_READ_CACHE_STORE, 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore(OFFLINE_READ_CACHE_STORE).put(record);
  await done;
}

export async function getOfflineReadCacheRecord<T>(storageKey: string): Promise<OfflineReadCacheRecord<T> | null> {
  const db = await openOfflineDb();
  const transaction = db.transaction(OFFLINE_READ_CACHE_STORE, 'readonly');
  const done = transactionDone(transaction);
  const value = await requestToPromise<OfflineReadCacheRecord<T> | undefined>(
    transaction.objectStore(OFFLINE_READ_CACHE_STORE).get(storageKey),
  );
  await done;
  return value ?? null;
}

export async function getAllOfflineReadCacheRecords(): Promise<OfflineReadCacheRecord[]> {
  const db = await openOfflineDb();
  const transaction = db.transaction(OFFLINE_READ_CACHE_STORE, 'readonly');
  const done = transactionDone(transaction);
  const records = await requestToPromise<OfflineReadCacheRecord[]>(
    transaction.objectStore(OFFLINE_READ_CACHE_STORE).getAll(),
  );
  await done;
  return records;
}

export async function deleteOfflineReadCacheRecord(storageKey: string) {
  const db = await openOfflineDb();
  const transaction = db.transaction(OFFLINE_READ_CACHE_STORE, 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore(OFFLINE_READ_CACHE_STORE).delete(storageKey);
  await done;
}

export async function clearOfflineReadCacheByProfile(profileId: string) {
  const db = await openOfflineDb();
  const transaction = db.transaction(OFFLINE_READ_CACHE_STORE, 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore(OFFLINE_READ_CACHE_STORE);
  const index = store.index('profile_id');
  const request = index.openCursor(IDBKeyRange.only(profileId));
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error('Failed to clear offline read cache'));
  });
  await done;
}

export async function clearAllOfflineReadCache() {
  const db = await openOfflineDb();
  const transaction = db.transaction(OFFLINE_READ_CACHE_STORE, 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore(OFFLINE_READ_CACHE_STORE).clear();
  await done;
}
