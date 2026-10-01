/**
 * App-shell service worker (F3): lets the page itself load with no network.
 * Board data doesn't go through here. It lives in IndexedDB and syncs over the WebSocket.
 *
 * Strategy: network first, cache as fallback. Online you always get the latest build;
 * offline you get the last one you loaded. Every URL of the app (any ?board=) is served
 * the same index.html, cached under "/".
 */
const CACHE = "kanban-shell-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add("/")));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/boards")) return;

  const key = request.mode === "navigate" ? "/" : request;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(request);
        if (response.ok) void cache.put(key, response.clone());
        return response;
      } catch {
        return (await cache.match(key)) ?? Response.error();
      }
    })(),
  );
});
