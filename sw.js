/* ═══════════════════════════════════════════════════════════════
   FluentPath — Service Worker
   ─────────────────────────────────────────────────────────────
   Strategies:
     - App shell (HTML, CSS, JS): cache-first, update in background
     - API GET requests: stale-while-revalidate (serve cache, refresh)
     - API POST requests: try network, queue in IndexedDB on failure
     - Google Fonts: cache-first (long-lived)
   ═══════════════════════════════════════════════════════════════ */

var CACHE_VERSION = 'fp-v11'; // bumped to ship the reset_token frontend fix
// App shell paths are relative to the service worker's location (project root).
// This works on both GitHub Pages (/fluentpath/sw.js) and localhost (/sw.js).
// STUDENT-scoped: only the student site's files. The teacher dashboard lives in
// a separate repo (teacher.fluentpath.ca); its service worker is generated from
// this file by scripts/sync-shared.mjs. (Effective on next CACHE_VERSION bump.)
var APP_SHELL = [
  './',
  './index.html',
  './src/student-initial-test.html',
  './src/student-course.html',
  './src/scripts/config.js',
  './src/scripts/api.js',
  './src/scripts/utils.js',
  './src/scripts/checkpoint.js',
  './src/scripts/hub.js',
  './src/scripts/student-test.js',
  './src/scripts/student-lesson.js',
  './src/scripts/call-request.js',
  './src/scripts/password-reset.js',
  './src/scripts/i18n.js',
  './src/styles/theme.css',
  './src/styles/mobile.css',
  './src/styles/hub.css',
  './src/styles/student-test.css',
  './src/styles/student-lesson.css',
];

var API_CACHE = 'fp-api-v5';
var POST_QUEUE_DB = 'fp-post-queue';
var POST_QUEUE_STORE = 'requests';

// ── INSTALL: pre-cache app shell ────────────────────────

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.addAll(APP_SHELL).catch(function (err) {
        console.warn('[SW] Some app shell files failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// ── ACTIVATE: clean old caches ──────────────────────────

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) { return k !== CACHE_VERSION && k !== API_CACHE; })
          .map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// ── FETCH: routing by request type ──────────────────────

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);

  // Skip non-GET/non-POST, chrome-extension, etc.
  if (event.request.method !== 'GET' && event.request.method !== 'POST') return;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // ── POST requests: try network, queue on failure ──
  if (event.request.method === 'POST') {
    event.respondWith(handlePost(event.request));
    return;
  }

  // ── Google Fonts: cache-first (they rarely change) ──
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(event.request, CACHE_VERSION));
    return;
  }

  // ── API requests (Apps Script) — pass through to network ──
  // Apps Script uses 302 redirects which can cause issues with SW caching.
  // Let all API calls go directly to the network without SW interception.
  if (url.hostname.includes('script.google.com')) {
    return; // don't call event.respondWith — browser handles it normally
  }

  // ── App shell (local files) ──
  if (url.origin === self.location.origin) {
    // HTML pages use network-first so users always get fresh content when online
    if (event.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
      event.respondWith(networkFirst(event.request, CACHE_VERSION));
    } else {
      // CSS, JS, etc. use cache-first (they change less frequently)
      event.respondWith(cacheFirst(event.request, CACHE_VERSION));
    }
    return;
  }
});

// ── STRATEGIES ──────────────────────────────────────────

function networkFirst(request, cacheName) {
  return fetch(request).then(function (response) {
    if (response.ok) {
      var clone = response.clone();
      caches.open(cacheName).then(function (cache) { cache.put(request, clone); });
    }
    return response;
  }).catch(function () {
    // Network failed — try cache
    return caches.match(request).then(function (cached) {
      return cached || new Response('Offline — please reconnect and try again.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' },
      });
    });
  });
}

function cacheFirst(request, cacheName) {
  return caches.match(request).then(function (cached) {
    if (cached) return cached;
    return fetch(request).then(function (response) {
      if (response.ok) {
        var clone = response.clone();
        caches.open(cacheName).then(function (cache) { cache.put(request, clone); });
      }
      return response;
    });
  }).catch(function () {
    // Offline and not in cache — return a basic fallback
    return new Response('Offline — please reconnect and try again.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

function staleWhileRevalidate(request) {
  return caches.open(API_CACHE).then(function (cache) {
    return cache.match(request).then(function (cached) {
      var fetchPromise = fetch(request).then(function (response) {
        if (response.ok) {
          // Only cache successful API responses (skip error JSON like { error: "..." })
          var cacheClone = response.clone();
          var checkClone = response.clone();
          checkClone.text().then(function (text) {
            try {
              var body = JSON.parse(text);
              if (body.error) return; // don't cache error responses
            } catch (e) { /* not JSON — cache it */ }
            cache.put(request, cacheClone);
          }).catch(function () { cache.put(request, cacheClone); });
        }
        return response;
      }).catch(function () {
        // Network failed — return cached or error
        return cached || new Response(JSON.stringify({ error: 'Offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      // Return cached immediately if available, otherwise wait for network
      return cached || fetchPromise;
    });
  });
}

// ── POST QUEUE (IndexedDB) ──────────────────────────────

function openPostQueue() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open(POST_QUEUE_DB, 1);
    req.onupgradeneeded = function (e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains(POST_QUEUE_STORE)) {
        db.createObjectStore(POST_QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = function (e) { resolve(e.target.result); };
    req.onerror = function (e) { reject(e.target.error); };
  });
}

function queuePost(url, body, contentType) {
  return openPostQueue().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(POST_QUEUE_STORE, 'readwrite');
      tx.objectStore(POST_QUEUE_STORE).add({
        url: url,
        body: body,
        contentType: contentType,
        timestamp: Date.now(),
      });
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function (e) { reject(e.target.error); };
    });
  });
}

function replayQueue() {
  return openPostQueue().then(function (db) {
    return new Promise(function (resolve) {
      var tx = db.transaction(POST_QUEUE_STORE, 'readwrite');
      var store = tx.objectStore(POST_QUEUE_STORE);
      var getAll = store.getAll();
      getAll.onsuccess = function () {
        var items = getAll.result || [];
        if (items.length === 0) { resolve(0); return; }
        var replayed = 0;
        var chain = Promise.resolve();
        items.forEach(function (item) {
          chain = chain.then(function () {
            return fetch(item.url, {
              method: 'POST',
              headers: { 'Content-Type': item.contentType },
              body: item.body,
            }).then(function () {
              store.delete(item.id);
              replayed++;
            }).catch(function () {
              // Still offline — leave in queue
            });
          });
        });
        chain.then(function () { resolve(replayed); });
      };
    });
  });
}

function handlePost(request) {
  var clonedRequest = request.clone();
  return fetch(request).catch(function () {
    // Network failed — queue the POST for later
    return clonedRequest.text().then(function (body) {
      return queuePost(
        clonedRequest.url,
        body,
        clonedRequest.headers.get('Content-Type') || 'application/x-www-form-urlencoded'
      ).then(function () {
        return new Response(JSON.stringify({ result: 'queued', message: 'Saved offline — will sync when connection returns.' }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        });
      });
    });
  });
}

// ── ONLINE EVENT: replay queued POSTs ───────────────────

self.addEventListener('message', function (event) {
  if (event.data === 'replay-queue') {
    replayQueue().then(function (count) {
      if (count > 0) {
        self.clients.matchAll().then(function (clients) {
          clients.forEach(function (client) {
            client.postMessage({ type: 'queue-replayed', count: count });
          });
        });
      }
    });
  }
});
