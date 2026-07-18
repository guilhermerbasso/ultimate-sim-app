const CACHE_NAME = 'ultimate-sim-receiver-v2-shell-1'
const CORE = ['./manifest.webmanifest', './icon.svg', './bootstrap.js']

async function cacheSafeResponse(request, response, navigation) {
  let cached = response.clone()
  if (navigation) {
    const headers = new Headers(cached.headers)
    headers.delete('set-cookie')
    headers.delete('set-cookie2')
    headers.set('Cache-Control', 'private, no-cache')
    cached = new Response(await cached.blob(), {
      status: cached.status,
      statusText: cached.statusText,
      headers
    })
  }
  await (await caches.open(CACHE_NAME)).put(request, cached)
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search) return
  if (/\/receiver\/v2\/(?:pair|status|ws)$/.test(url.pathname)) return

  const cacheableAsset = ['script', 'style', 'font', 'image', 'manifest'].includes(request.destination)
  const receiverNavigation = request.mode === 'navigate' && /\/receiver\/v2\/?$/.test(url.pathname)
  if (!cacheableAsset && !receiverNavigation) return

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          event.waitUntil(cacheSafeResponse(request, response, receiverNavigation))
        }
        return response
      })
      .catch(async () => {
        const cached = await caches.match(request)
        if (cached) return cached
        if (receiverNavigation) {
          const fallback = await caches.match(new URL('./', self.registration.scope).toString())
          if (fallback) return fallback
        }
        throw new Error('Receiver asset is unavailable offline.')
      })
  )
})
