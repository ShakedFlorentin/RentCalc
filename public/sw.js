// Offline support: the app shell and static files are cached; Supabase (data, auth, realtime) is never touched,
// because the app keeps its own copy of the data. Paths are relative to this file, so it works under /<repo>/.
// The build (vite.config.ts) fills in the file list and version below.
const VERSION = '/*VERSION*/dev'
const PRECACHE = /*PRECACHE*/[]
const SHELL = 'shell-' + VERSION
const TILES = 'tiles'
const MAX_TILES = 300
const NAV_TIMEOUT = 4000

const url = (p) => new URL(p, self.registration.scope).href

self.addEventListener('install', (e) => {
  // 'reload' skips the browser's HTTP cache so a fresh deploy is never precached half-stale
  e.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(PRECACHE.map((p) => new Request(url(p), { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (e) => {
  // only old shells go: 'tiles' and the page's saved booking documents live on
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const u = new URL(req.url)
  if (u.hostname.endsWith('tile.openstreetmap.org') || (u.hostname === 'server.arcgisonline.com' && u.pathname.includes('/tile/')))
    e.respondWith(tile(req))
  else if (u.origin !== self.location.origin) return
  else if (req.mode === 'navigate') e.respondWith(page(req))
  else e.respondWith(asset(e, req, u))
})

// Network first, so a deploy shows up on the next open; the cached page when the network is down or hangs
// (an eSIM with a bar of signal but no data would otherwise leave a blank screen for a minute).
async function page(req) {
  const cache = await caches.open(SHELL)
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, no) => setTimeout(() => no(new Error('slow')), NAV_TIMEOUT)),
    ])
    if (res.ok) cache.put(url('./'), res.clone())
    return res
  } catch {
    return (await cache.match(url('./'))) || Response.error()
  }
}

// Hashed build files never change, so the cache wins; media.json and the icons are served from the cache and
// refreshed in the background for next time.
async function asset(e, req, u) {
  const cache = await caches.open(SHELL)
  const hit = await cache.match(req)
  if (hit && u.pathname.includes('/assets/')) return hit
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone())
      return res
    })
    .catch(() => undefined)
  if (hit) {
    e.waitUntil(fresh)
    return hit
  }
  return (await fresh) || Response.error()
}

// Map tiles: whatever was viewed once works offline, up to MAX_TILES (oldest dropped first).
async function tile(req) {
  const cache = await caches.open(TILES)
  const hit = await cache.match(req.url)
  if (hit) return hit
  try {
    // <img> tiles arrive as opaque no-cors responses, which count for megabytes of quota each; OSM and Esri allow CORS
    const res = await fetch(req.url, { mode: 'cors' })
    if (res.ok) {
      await cache.put(req.url, res.clone())
      const keys = await cache.keys()
      for (const k of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) await cache.delete(k)
    }
    return res
  } catch {
    return Response.error()
  }
}
