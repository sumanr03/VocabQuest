/* VocabQuest offline support.
   When you change any file, bump the version below so phones pick up the update. */
const CACHE = "vocabquest-v6";
const SHELL = [
  "./",
  "./index.html",
  "./words.js",
  "./config.js",
  "./account.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];
/* Other sites whose files are safe to keep offline (fonts and the login library).
   Everything else from other sites (login, database, Stripe) always goes to the network. */
const CACHEABLE_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

/* Our own files: try the network first so updates (including config.js) apply straight away,
   and fall back to the saved copy when offline. Fonts and the login library: use the saved copy first. */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin && url.pathname.startsWith("/api/")) return;
  if (!sameOrigin && !CACHEABLE_HOSTS.includes(url.hostname)) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const fromNetwork = () => fetch(req).then((res) => {
        if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
        return res;
      });
      if (sameOrigin) {
        try { return await fromNetwork(); }
        catch (err) { return (await cache.match(req, { ignoreSearch: true })) || Response.error(); }
      }
      const cached = await cache.match(req);
      return cached || fromNetwork();
    })
  );
});
