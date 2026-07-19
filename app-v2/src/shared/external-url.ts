export interface SanitizeHttpsUrlOptions {
  maxLength?: number
  stripHash?: boolean
  allowHash?: boolean
  allowSearch?: boolean
  allowCredentials?: boolean
  allowPort?: boolean
}

export function sanitizeHttpsUrl(value: unknown, options: SanitizeHttpsUrlOptions = {}): string {
  if (typeof value !== 'string') throw new Error('URL must be a string.')
  const raw = value.trim()
  const maxLength = options.maxLength ?? 500
  if (!raw || raw.length > maxLength) throw new Error('URL is empty or too long.')

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('URL is invalid.')
  }

  if (url.protocol !== 'https:') throw new Error('URL must use HTTPS.')
  if (options.allowCredentials === false && (url.username || url.password)) {
    throw new Error('URL credentials are not allowed.')
  }
  if (options.allowPort === false && url.port) throw new Error('URL ports are not allowed.')
  if (options.allowSearch === false && url.search) throw new Error('URL query parameters are not allowed.')
  if (options.stripHash) url.hash = ''
  else if (options.allowHash === false && url.hash) throw new Error('URL fragments are not allowed.')
  return url.toString()
}
