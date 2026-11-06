const CACHE = "memory-cabin-v5";
const ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "data/questions.js",
  "data/mech.js",
  "js/core.js",
  "js/app.js",
  "assets/icon.svg",
  "assets/mech/q1-fe-c-regions.png",
  "assets/mech/q2-fe-c-points.png",
  "assets/mech/q3-cct-cooling.png",
  "assets/mech/q4-cct-cooling.png",
  "manifest.webmanifest"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put("index.html", copy));
      return response;
    }).catch(() => caches.match("index.html")));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => {
    const fresh = fetch(event.request).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
      return response;
    }).catch(() => cached);
    return cached || fresh;
  }));
});
