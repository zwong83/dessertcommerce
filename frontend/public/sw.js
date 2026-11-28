const CACHE_PREFIX = "gather-dessert-public-offline-";
const CACHE_NAME = CACHE_PREFIX + "v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const response = await fetch(OFFLINE_URL, { cache: "reload", credentials: "omit" });
    if (!response.ok) throw new Error("Offline page unavailable");
    const cache = await caches.open(CACHE_NAME);
    await cache.put(OFFLINE_URL, response);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  // Never intercept API requests, mutations, assets or third-party traffic.
  if (request.method !== "GET" || request.mode !== "navigate" || url.origin !== self.location.origin
    || url.pathname === "/api" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/")) return;
  event.respondWith(fetch(request).catch(async () => {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(OFFLINE_URL) ?? new Response("You are offline. Reconnect and reload to continue.", {
      status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }));
});
