/**
 * Offline Storage Module
 *
 * Provides IndexedDB-based storage for offline-first functionality:
 * - Document caching
 * - Pending changes queue
 * - Sync status tracking
 */

const DB_NAME = 'docsynth-offline';
const DB_VERSION = 1;

interface CachedDocument {
  id: string;
  repositoryId: string;
  path: string;
  title: string;
  content: string;
  type: string;
  version: number;
  cachedAt: number;
  lastAccessed: number;
}

interface PendingChange {
  id?: number;
  type: 'create' | 'update' | 'delete';
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  createdAt: number;
  retries: number;
}

interface SyncStatus {
  lastSyncAt: number | null;
  pendingChanges: number;
  isOnline: boolean;
  syncInProgress: boolean;
}

class OfflineStorage {
  private db: IDBDatabase | null = null;
  private syncStatus: SyncStatus = {
    lastSyncAt: null,
    pendingChanges: 0,
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    syncInProgress: false,
  };
  private listeners: Set<(status: SyncStatus) => void> = new Set();

  async init(): Promise<void> {
    if (typeof indexedDB === 'undefined') {
      console.warn('IndexedDB not available');
      return;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        this.db = request.result;
        this.setupOnlineListener();
        this.updatePendingCount();
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Documents store
        if (!db.objectStoreNames.contains('documents')) {
          const docStore = db.createObjectStore('documents', { keyPath: 'id' });
          docStore.createIndex('repositoryId', 'repositoryId', { unique: false });
          docStore.createIndex('cachedAt', 'cachedAt', { unique: false });
        }

        // Pending changes store
        if (!db.objectStoreNames.contains('pending-changes')) {
          const changeStore = db.createObjectStore('pending-changes', { keyPath: 'id', autoIncrement: true });
          changeStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // Sync metadata store
        if (!db.objectStoreNames.contains('sync-metadata')) {
          db.createObjectStore('sync-metadata', { keyPath: 'key' });
        }
      };
    });
  }

  private setupOnlineListener(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('online', () => {
      this.syncStatus.isOnline = true;
      this.notifyListeners();
      this.attemptSync();
    });

    window.addEventListener('offline', () => {
      this.syncStatus.isOnline = false;
      this.notifyListeners();
    });
  }

  // Document caching
  async cacheDocument(doc: Omit<CachedDocument, 'cachedAt' | 'lastAccessed'>): Promise<void> {
    if (!this.db) return;

    const cachedDoc: CachedDocument = {
      ...doc,
      cachedAt: Date.now(),
      lastAccessed: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('documents', 'readwrite');
      const store = tx.objectStore('documents');
      const request = store.put(cachedDoc);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getCachedDocument(id: string): Promise<CachedDocument | null> {
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('documents', 'readwrite');
      const store = tx.objectStore('documents');
      const request = store.get(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const doc = request.result;
        if (doc) {
          // Update last accessed
          doc.lastAccessed = Date.now();
          store.put(doc);
        }
        resolve(doc || null);
      };
    });
  }

  async getCachedDocumentsByRepo(repositoryId: string): Promise<CachedDocument[]> {
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('documents', 'readonly');
      const store = tx.objectStore('documents');
      const index = store.index('repositoryId');
      const request = index.getAll(repositoryId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  }

  async getAllCachedDocuments(): Promise<CachedDocument[]> {
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('documents', 'readonly');
      const store = tx.objectStore('documents');
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  }

  async removeCachedDocument(id: string): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('documents', 'readwrite');
      const store = tx.objectStore('documents');
      const request = store.delete(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async clearOldCache(maxAgeDays: number = 30): Promise<number> {
    if (!this.db) return 0;

    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('documents', 'readwrite');
      const store = tx.objectStore('documents');
      const index = store.index('cachedAt');
      const range = IDBKeyRange.upperBound(cutoff);
      const request = index.openCursor(range);

      let deletedCount = 0;
      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          deletedCount++;
          cursor.continue();
        } else {
          resolve(deletedCount);
        }
      };
    });
  }

  // Pending changes queue
  async queueChange(change: Omit<PendingChange, 'id' | 'createdAt' | 'retries'>): Promise<number> {
    if (!this.db) return -1;

    const pendingChange: PendingChange = {
      ...change,
      createdAt: Date.now(),
      retries: 0,
    };

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('pending-changes', 'readwrite');
      const store = tx.objectStore('pending-changes');
      const request = store.add(pendingChange);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.updatePendingCount();
        resolve(request.result as number);
      };
    });
  }

  async getPendingChanges(): Promise<PendingChange[]> {
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('pending-changes', 'readonly');
      const store = tx.objectStore('pending-changes');
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  }

  async removePendingChange(id: number): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('pending-changes', 'readwrite');
      const store = tx.objectStore('pending-changes');
      const request = store.delete(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.updatePendingCount();
        resolve();
      };
    });
  }

  async updatePendingChangeRetries(id: number, retries: number): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('pending-changes', 'readwrite');
      const store = tx.objectStore('pending-changes');
      const getRequest = store.get(id);
      getRequest.onerror = () => reject(getRequest.error);
      getRequest.onsuccess = () => {
        const change = getRequest.result;
        if (change) {
          change.retries = retries;
          store.put(change);
        }
        resolve();
      };
    });
  }

  private async updatePendingCount(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve) => {
      const tx = this.db!.transaction('pending-changes', 'readonly');
      const store = tx.objectStore('pending-changes');
      const request = store.count();
      request.onsuccess = () => {
        this.syncStatus.pendingChanges = request.result;
        this.notifyListeners();
        resolve();
      };
    });
  }

  // Sync functionality
  async attemptSync(): Promise<{ success: number; failed: number }> {
    if (!this.syncStatus.isOnline || this.syncStatus.syncInProgress) {
      return { success: 0, failed: 0 };
    }

    this.syncStatus.syncInProgress = true;
    this.notifyListeners();

    let success = 0;
    let failed = 0;

    try {
      const changes = await this.getPendingChanges();

      for (const change of changes) {
        try {
          const response = await fetch(change.url, {
            method: change.method,
            headers: change.headers,
            body: change.body,
          });

          if (response.ok) {
            await this.removePendingChange(change.id!);
            success++;
          } else if (response.status >= 400 && response.status < 500) {
            // Client error - remove from queue
            await this.removePendingChange(change.id!);
            failed++;
          } else {
            // Server error - retry later
            await this.updatePendingChangeRetries(change.id!, change.retries + 1);
            failed++;
          }
        } catch (error) {
          await this.updatePendingChangeRetries(change.id!, change.retries + 1);
          failed++;
        }
      }

      this.syncStatus.lastSyncAt = Date.now();
    } finally {
      this.syncStatus.syncInProgress = false;
      await this.updatePendingCount();
      this.notifyListeners();
    }

    return { success, failed };
  }

  // Status listeners
  onStatusChange(callback: (status: SyncStatus) => void): () => void {
    this.listeners.add(callback);
    callback(this.syncStatus);
    return () => this.listeners.delete(callback);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener({ ...this.syncStatus });
    }
  }

  getStatus(): SyncStatus {
    return { ...this.syncStatus };
  }

  // Register service worker
  async registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      console.warn('Service workers not supported');
      return null;
    }

    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
      });

      console.log('Service worker registered:', registration.scope);

      // Request background sync permission
      if ('sync' in registration) {
        try {
          await (registration as any).sync.register('sync-documents');
        } catch (e) {
          console.log('Background sync not available');
        }
      }

      return registration;
    } catch (error) {
      console.error('Service worker registration failed:', error);
      return null;
    }
  }
}

// Singleton instance
export const offlineStorage = new OfflineStorage();

// React hook for offline status
export function useOfflineStatus() {
  if (typeof window === 'undefined') {
    return {
      isOnline: true,
      pendingChanges: 0,
      lastSyncAt: null,
      syncInProgress: false,
    };
  }

  // This would need to be implemented with React useState/useEffect
  return offlineStorage.getStatus();
}

export type { CachedDocument, PendingChange, SyncStatus };
