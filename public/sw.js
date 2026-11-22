const APP_ID = "arbol-genealogico-del-rio-hall";
const CACHE_PREFIX = `atlas-cache-${APP_ID}-`;
const CACHE = `${CACHE_PREFIX}v3`;
const base = new URL("./", self.location.href);
const shell = [".", "manifest.webmanifest", "icons/family-icon.svg", "icons/family-icon-180.png", "icons/family-icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(Promise.all([caches.open(CACHE).then((cache) => cache.addAll(shell.map((path) => new URL(path, base)))), self.skipWaiting()]));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  const navigation = request.mode === "navigate";
  event.respondWith(fetch(request, { cache: "no-store" }).then((response) => {
    if (response.ok && url.pathname.startsWith(base.pathname)) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
    }
    return response;
  }).catch(async () => (await caches.match(request)) ?? (navigation ? caches.match(new URL(".", base)) : Response.error())));
});
