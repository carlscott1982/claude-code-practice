/* ============================================================
   Service worker — offline shell.

   Strategy: stale-while-revalidate for same-origin GETs. The app
   opens instantly from cache and picks up a new version in the
   background, which matters because a spending log gets opened in
   shop doorways with one bar of signal.

   Bump CACHE_VERSION whenever a shell file changes.
   ============================================================ */

const CACHE_VERSION = "spendlog-v1";

// Relative so the app works from a project path such as
// https://user.github.io/repo-name/ as well as from a domain root.
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "core.js",
  "app.js",
  "manifest.webmanifest",
  "icons/favicon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      // addAll is atomic: one 404 would leave the app half-cached, so
      // fall back to caching whatever does resolve.
      .then((cache) =>
        Promise.allSettled(SHELL.map((path) => cache.add(new Request(path, { cache: "reload" }))))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });

      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);

      if (cached) return cached;

      const fresh = await network;
      if (fresh) return fresh;

      // Offline with nothing cached for this exact URL: a navigation can
      // still be satisfied by the app shell, since routing is client-side.
      if (req.mode === "navigate") {
        const shell = await cache.match("index.html");
        if (shell) return shell;
      }

      return new Response("Offline and not cached.", {
        status: 503,
        headers: { "Content-Type": "text/plain" },
      });
    })
  );
});
