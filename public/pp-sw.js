/* Prime Physique service worker — makes /fitness work with no internet connection.
 *
 * Scope: /fitness (StoreBridge pages are never intercepted).
 * - App code (/assets/*, hashed + immutable): cache-first. Every built file listed in
 *   /pp-precache.json is cached up front, so pages never visited before still open offline.
 * - Page navigations under /fitness: network-first with a short timeout, falling back to the
 *   cached app shell (the client router then renders the requested page).
 * - Data never goes through here: it lives in IndexedDB on the device.
 */
const SHELL = "pp-shell-v1";
const ASSETS = "pp-assets-v1";
const SHELL_URLS = ["/fitness", "/pp-manifest.webmanifest", "/pp-icon-192.png", "/pp-icon-512.png", "/pp-icon-maskable-512.png", "/pp-apple-touch-icon.png", "/favicon.ico"];

async function precache() {
  const shell = await caches.open(SHELL);
  await Promise.all(
    SHELL_URLS.map((u) =>
      fetch(u, { cache: "no-cache" })
        .then((r) => (r.ok ? shell.put(u, r) : undefined))
        .catch(() => undefined),
    ),
  );
  let list = [];
  try {
    const r = await fetch("/pp-precache.json", { cache: "no-cache" });
    if (r.ok) list = await r.json();
  } catch {
    return; // offline or dev server: keep whatever is cached
  }
  const assets = await caches.open(ASSETS);
  const have = new Set((await assets.keys()).map((k) => new URL(k.url).pathname));
  await Promise.all(
    list
      .filter((u) => !have.has(u))
      .map((u) =>
        fetch(u)
          .then((r) => (r.ok ? assets.put(u, r) : undefined))
          .catch(() => undefined),
      ),
  );
  // Drop files from previous builds.
  const keep = new Set(list);
  if (keep.size) for (const k of await assets.keys()) if (!keep.has(new URL(k.url).pathname)) await assets.delete(k);
}

self.addEventListener("install", (e) => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("pp-") && k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page asks for a refresh on each online start, so new deployments are cached too.
self.addEventListener("message", (e) => {
  if (e.data === "pp-precache") e.waitUntil(precache());
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    if (!url.pathname.startsWith("/fitness")) return;
    e.respondWith(
      (async () => {
        const shell = await caches.open(SHELL);
        try {
          const res = await Promise.race([fetch(req), timeout(4000)]);
          if (res.ok) shell.put("/fitness", res.clone());
          return res;
        } catch {
          return (await shell.match("/fitness")) || new Response("Prime Physique is offline and has not been cached yet. Open it once while online.", { status: 503, headers: { "content-type": "text/plain" } });
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(
      (async () => {
        const assets = await caches.open(ASSETS);
        const hit = await assets.match(url.pathname);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) assets.put(url.pathname, res.clone());
        return res;
      })(),
    );
    return;
  }

  if (SHELL_URLS.includes(url.pathname)) {
    e.respondWith(
      (async () => {
        const shell = await caches.open(SHELL);
        const hit = await shell.match(url.pathname);
        const net = fetch(req)
          .then((r) => {
            if (r.ok) shell.put(url.pathname, r.clone());
            return r;
          })
          .catch(() => undefined);
        return hit || (await net) || new Response("", { status: 504 });
      })(),
    );
  }
});
