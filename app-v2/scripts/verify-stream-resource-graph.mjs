import { existsSync, readFileSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

const rendererRoot = resolve('out', 'renderer')
const htmlPath = resolve(rendererRoot, 'stream.html')
const documentUrl = new URL('http://127.0.0.1/obs/resource-graph-smoke')

if (!existsSync(htmlPath)) throw new Error(`Missing built stream document: ${htmlPath}`)

function attribute(tag, name) {
  return new RegExp(`\\b${name}\\s*=\\s*(['"])(.*?)\\1`, 'i').exec(tag)?.[2] ?? null
}

function resourceUrl(value, base) {
  const trimmed = value.trim()
  if (!trimmed || /^(?:data:|blob:|javascript:|#)/i.test(trimmed)) return null
  const url = new URL(trimmed, base)
  const prefixedBasePath = base.pathname.startsWith('/assets/')
    ? `/public/overlay${base.pathname}`
    : '/public/overlay/'
  const prefixedUrl = new URL(trimmed, new URL(prefixedBasePath, base.origin))
  url.hash = ''
  if (url.origin !== documentUrl.origin) throw new Error(`Built stream references an external resource: ${url}`)
  if (!url.pathname.startsWith('/assets/')) throw new Error(`Built stream resource escaped the root asset route: ${url}`)
  if (!prefixedUrl.pathname.startsWith('/public/overlay/assets/')) {
    throw new Error(`Built stream resource does not preserve a manual public path prefix: ${trimmed}`)
  }
  if (url.searchParams.has('token') || url.searchParams.has('password')) throw new Error(`Built resource URL contains an authentication secret: ${url}`)
  if (/\/obs\/assets\//.test(url.pathname)) throw new Error(`Built stream resource resolves under /obs instead of /assets: ${url}`)
  return url
}

function moduleDependencies(source, base) {
  const javascript = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const values = new Set()
  for (const pattern of [
    /\b(?:import|export)\s*(?:[^;'"]*?\sfrom\s*)?["']((?:\.{1,2}\/|\/)[^"']+)["']/g,
    /\bimport\s*\(\s*["']((?:\.{1,2}\/|\/)[^"']+)["']\s*\)/g,
    /\bnew\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g
  ]) {
    for (const match of javascript.matchAll(pattern)) values.add(match[1])
  }
  return [...values].map((value) => resourceUrl(value, base)).filter(Boolean)
}

function cssDependencies(source, base) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const values = new Set()
  for (const match of css.matchAll(/@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?/gi)) values.add(match[2])
  for (const match of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) values.add(match[2])
  return [...values].map((value) => resourceUrl(value, base)).filter(Boolean)
}

function diskPath(url) {
  const decoded = decodeURIComponent(url.pathname).replace(/^\/+/, '')
  const target = resolve(rendererRoot, ...decoded.split('/'))
  const rel = relative(rendererRoot, target)
  if (!rel || rel.startsWith('..') || rel.includes(`..${sep}`)) throw new Error(`Resource escaped renderer root: ${url}`)
  return target
}

const html = readFileSync(htmlPath, 'utf8')
const baseTag = html.match(/<base\b[^>]*>/i)?.[0]
const baseHref = baseTag ? attribute(baseTag, 'href') : null
if (!baseHref) throw new Error('Built stream.html is missing its root-routing <base href="../">.')
if (new URL(baseHref, 'https://stream.example.test/public/overlay/obs/resource-graph-smoke').pathname !== '/public/overlay/') {
  throw new Error(`Built stream base href does not preserve a public path prefix: ${baseHref}`)
}
const baseUrl = new URL(baseHref, documentUrl)
const queue = []

for (const match of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
  const tag = match[0]
  if (match[1].toLowerCase() === 'script') {
    const src = attribute(tag, 'src')
    const resolved = src ? resourceUrl(src, baseUrl) : null
    if (resolved) queue.push(resolved)
    continue
  }
  const rel = (attribute(tag, 'rel') ?? '').toLowerCase()
  if (!/\b(?:stylesheet|modulepreload|preload|icon)\b/.test(rel)) continue
  const href = attribute(tag, 'href')
  const resolved = href ? resourceUrl(href, baseUrl) : null
  if (resolved) queue.push(resolved)
}

const seen = new Set()
let javascriptCount = 0
let cssCount = 0
while (queue.length > 0) {
  const url = queue.shift()
  if (seen.has(url.toString())) continue
  seen.add(url.toString())
  const target = diskPath(url)
  if (!existsSync(target) || !statSync(target).isFile()) throw new Error(`Missing built stream resource ${url.pathname}: ${target}`)
  const extension = url.pathname.toLowerCase().split('.').pop()
  if (extension === 'js' || extension === 'mjs' || extension === 'cjs') {
    javascriptCount += 1
    queue.push(...moduleDependencies(readFileSync(target, 'utf8'), url))
  } else if (extension === 'css') {
    cssCount += 1
    queue.push(...cssDependencies(readFileSync(target, 'utf8'), url))
  }
}

if (javascriptCount === 0 || cssCount === 0) {
  throw new Error(`Incomplete built stream graph: ${javascriptCount} JavaScript, ${cssCount} CSS resources.`)
}

console.log(`Verified stream resource graph: ${seen.size} files (${javascriptCount} JavaScript, ${cssCount} CSS).`)
