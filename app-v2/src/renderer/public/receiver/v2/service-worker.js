const CACHE_PREFIX = 'ultimate-sim-receiver-v2-'
const CACHE_NAME = `${CACHE_PREFIX}shell-2`
const CORE = ['./manifest.webmanifest', './icon.svg', './bootstrap.js']
const MAX_PRECACHE_RESOURCES = 256

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

function attribute(tag, name) {
  return new RegExp(`\\b${name}\\s*=\\s*(['"])(.*?)\\1`, 'i').exec(tag)?.[2] ?? null
}

function resourceUrl(value, base) {
  const trimmed = value.trim()
  if (!trimmed || /^(?:data:|blob:|javascript:|#)/i.test(trimmed)) return null
  const url = new URL(trimmed, base)
  url.hash = ''
  if (url.origin !== self.location.origin || url.search) return null
  return url
}

function htmlResources(html, documentUrl) {
  const baseTag = html.match(/<base\b[^>]*>/i)?.[0]
  const baseHref = baseTag ? attribute(baseTag, 'href') : null
  const baseUrl = baseHref ? new URL(baseHref, documentUrl) : documentUrl
  const resources = []
  for (const match of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const tag = match[0]
    if (match[1].toLowerCase() === 'script') {
      const src = attribute(tag, 'src')
      const resolved = src ? resourceUrl(src, baseUrl) : null
      if (resolved) resources.push(resolved)
      continue
    }
    const rel = (attribute(tag, 'rel') ?? '').toLowerCase()
    if (!/\b(?:stylesheet|modulepreload|preload|icon|manifest)\b/.test(rel)) continue
    const href = attribute(tag, 'href')
    const resolved = href ? resourceUrl(href, baseUrl) : null
    if (resolved) resources.push(resolved)
  }
  return resources
}

function moduleDependencies(source, baseUrl) {
  const javascript = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const values = new Set()
  for (const pattern of [
    /\b(?:import|export)\s*(?:[^;'"`]*?\sfrom\s*)?["']((?:\.{1,2}\/|\/)[^"']+)["']/g,
    /\bimport\s*\(\s*["']((?:\.{1,2}\/|\/)[^"']+)["']\s*\)/g,
    /\bnew\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g
  ]) {
    for (const match of javascript.matchAll(pattern)) values.add(match[1])
  }
  return [...values].map((value) => resourceUrl(value, baseUrl)).filter(Boolean)
}

function cssDependencies(source, baseUrl) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const values = new Set()
  for (const match of css.matchAll(/@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?/gi)) values.add(match[2])
  for (const match of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) values.add(match[2])
  return [...values].map((value) => resourceUrl(value, baseUrl)).filter(Boolean)
}

async function cacheResourceGraph(initialResources) {
  const cache = await caches.open(CACHE_NAME)
  const queue = [...initialResources]
  const seen = new Set()
  while (queue.length > 0) {
    const url = queue.shift()
    const key = url.toString()
    if (seen.has(key)) continue
    seen.add(key)
    if (seen.size > MAX_PRECACHE_RESOURCES) throw new Error('Receiver precache graph exceeded its bound.')

    const request = new Request(url, { credentials: 'same-origin', cache: 'no-cache' })
    const response = await fetch(request)
    if (!response.ok) throw new Error(`Receiver precache failed for ${url.pathname}: HTTP ${response.status}`)
    const contentType = String(response.headers.get('content-type') ?? '')
    const source = /javascript|ecmascript|text\/css/i.test(contentType)
      ? await response.clone().text()
      : ''
    await cacheSafeResponse(request, response, false)
    if (/javascript|ecmascript/i.test(contentType)) queue.push(...moduleDependencies(source, url))
    else if (/text\/css/i.test(contentType)) queue.push(...cssDependencies(source, url))
  }
  return cache
}

async function cacheReceiverShell() {
  const cache = await caches.open(CACHE_NAME)
  await cache.addAll(CORE)
  const shellUrl = new URL('./', self.registration.scope)
  const shellRequest = new Request(shellUrl, { credentials: 'same-origin', cache: 'no-cache' })
  const shellResponse = await fetch(shellRequest)
  if (!shellResponse.ok) throw new Error(`Receiver shell precache failed: HTTP ${shellResponse.status}`)
  const html = await shellResponse.clone().text()
  await cacheSafeResponse(shellRequest, shellResponse, true)
  await cacheResourceGraph(htmlResources(html, shellUrl))
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheReceiverShell())
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
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
        const cache = await caches.open(CACHE_NAME)
        const cached = await cache.match(request)
        if (cached) return cached
        if (receiverNavigation) {
          const fallback = await cache.match(new URL('./', self.registration.scope).toString())
          if (fallback) return fallback
        }
        throw new Error('Receiver asset is unavailable offline.')
      })
  )
})
