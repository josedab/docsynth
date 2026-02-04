/**
 * DocSynth Service Worker
 *
 * Provides offline-first functionality with intelligent caching strategies:
 * - Static assets: Cache-first
 * - API data: Network-first with cache fallback
 * - Documents: Stale-while-revalidate
 */

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `docsynth-static-${CACHE_VERSION}`;
const DATA_CACHE = `docsynth-data-${CACHE_VERSION}`;
const DOC_CACHE = `docsynth-docs-${CACHE_VERSION}`;

// Static assets to pre-cache
const STATIC_ASSETS = [
  '/',
  '/dashboard',
  '/dashboard/documents',
  '/dashboard/repositories',
  '/offline.html',
  '/manifest.json',
];

// API endpoints that should be cached
const CACHEABLE_API_PATTERNS = [
  /\/api\/documents\//,
  /\/api\/repositories\//,
  /\/api\/analytics\//,
];

// Install event - pre-cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] Pre-caching static assets');
      return cache.addAll(STATIC_ASSETS.filter((url) => !url.includes('undefined')));
    }).then(() => {
      self.skipWaiting();
    })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('docsynth-') && ![STATIC_CACHE, DATA_CACHE, DOC_CACHE].includes(name))
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      self.clients.claim();
    })
  );
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip external requests
  if (!url.origin.includes(self.location.origin)) {
    return;
  }

  // API requests: Network-first with cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstWithCache(request, DATA_CACHE));
    return;
  }

  // Document content: Stale-while-revalidate
  if (url.pathname.includes('/documents/') && !url.pathname.includes('/edit')) {
    event.respondWith(staleWhileRevalidate(request, DOC_CACHE));
    return;
  }

  // Static assets: Cache-first
  event.respondWith(cacheFirst(request, STATIC_CACHE));
});

// Cache-first strategy
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    // Return offline page for navigation requests
    if (request.mode === 'navigate') {
      const offlinePage = await cache.match('/offline.html');
      if (offlinePage) {
        return offlinePage;
      }
    }
    throw error;
  }
}

// Network-first with cache fallback
async function networkFirstWithCache(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      console.log('[SW] Serving cached response for:', request.url);
      return cachedResponse;
    }

    // Return a synthetic offline response for API requests
    return new Response(
      JSON.stringify({
        success: false,
        offline: true,
        error: { code: 'OFFLINE', message: 'You are currently offline' },
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

// Stale-while-revalidate strategy
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  const fetchPromise = fetch(request).then((networkResponse) => {
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  }).catch(() => null);

  return cachedResponse || fetchPromise;
}

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-documents') {
    event.waitUntil(syncDocuments());
  }
});

async function syncDocuments() {
  try {
    // Get pending changes from IndexedDB
    const pendingChanges = await getPendingChanges();

    for (const change of pendingChanges) {
      try {
        await fetch(change.url, {
          method: change.method,
          headers: change.headers,
          body: change.body,
        });
        await removePendingChange(change.id);
      } catch (error) {
        console.error('[SW] Failed to sync change:', change.id, error);
      }
    }
  } catch (error) {
    console.error('[SW] Sync failed:', error);
  }
}

// IndexedDB helpers for pending changes
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('docsynth-offline', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pending-changes')) {
        db.createObjectStore('pending-changes', { keyPath: 'id', autoIncrement: true });
      }
    };
  });
}

async function getPendingChanges() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending-changes', 'readonly');
    const store = tx.objectStore('pending-changes');
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function removePendingChange(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending-changes', 'readwrite');
    const store = tx.objectStore('pending-changes');
    const request = store.delete(id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

// Push notification support
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();

  const options = {
    body: data.body || 'You have a new notification',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    data: data.url,
    actions: [
      { action: 'view', title: 'View' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'DocSynth', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'view' && event.notification.data) {
    event.waitUntil(
      clients.openWindow(event.notification.data)
    );
  }
});

console.log('[SW] Service worker loaded');
