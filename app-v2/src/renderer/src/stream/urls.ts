export function streamBaseUrlFrom(href: string): URL {
  const current = new URL(href)
  const match = current.pathname.match(/^(.*\/)obs\/[^/]+$/)
  const pathname = match?.[1] ?? '/'
  return new URL(pathname, current.origin)
}

export function streamBaseUrl(): URL {
  return streamBaseUrlFrom(window.location.href)
}

export function streamEndpoint(path: string): URL {
  return new URL(path.replace(/^\/+/, ''), streamBaseUrl())
}
