'use client';

import { useState, useEffect, useCallback } from 'react';
import { offlineStorage, type SyncStatus } from '../lib/offline-storage';

/**
 * React hook for monitoring offline status and sync state
 */
export function useOfflineStatus() {
  const [status, setStatus] = useState<SyncStatus>({
    isOnline: true,
    pendingChanges: 0,
    lastSyncAt: null,
    syncInProgress: false,
  });
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    async function init() {
      try {
        await offlineStorage.init();
        unsubscribe = offlineStorage.onStatusChange(setStatus);
        setIsInitialized(true);
      } catch (error) {
        console.error('Failed to initialize offline storage:', error);
        setIsInitialized(true);
      }
    }

    init();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  const sync = useCallback(async () => {
    return offlineStorage.attemptSync();
  }, []);

  return {
    ...status,
    isInitialized,
    sync,
  };
}

/**
 * React hook for caching documents offline
 */
export function useOfflineDocument(documentId: string | null) {
  const [isCached, setIsCached] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!documentId) {
      setIsLoading(false);
      return;
    }

    async function checkCache() {
      try {
        await offlineStorage.init();
        const cached = await offlineStorage.getCachedDocument(documentId!);
        setIsCached(!!cached);
      } catch (error) {
        console.error('Failed to check document cache:', error);
      } finally {
        setIsLoading(false);
      }
    }

    checkCache();
  }, [documentId]);

  const cacheDocument = useCallback(
    async (doc: {
      id: string;
      repositoryId: string;
      path: string;
      title: string;
      content: string;
      type: string;
      version: number;
    }) => {
      try {
        await offlineStorage.init();
        await offlineStorage.cacheDocument(doc);
        setIsCached(true);
      } catch (error) {
        console.error('Failed to cache document:', error);
        throw error;
      }
    },
    []
  );

  const removeFromCache = useCallback(async () => {
    if (!documentId) return;
    try {
      await offlineStorage.init();
      await offlineStorage.removeCachedDocument(documentId);
      setIsCached(false);
    } catch (error) {
      console.error('Failed to remove document from cache:', error);
      throw error;
    }
  }, [documentId]);

  return {
    isCached,
    isLoading,
    cacheDocument,
    removeFromCache,
  };
}
