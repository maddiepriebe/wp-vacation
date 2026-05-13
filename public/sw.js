// Phase 1 no-op service worker. Required to be installable as a PWA on iOS
// and Android. Real caching strategy lands in Phase 6 via Serwist.
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Pass through to network. No caching.
});
