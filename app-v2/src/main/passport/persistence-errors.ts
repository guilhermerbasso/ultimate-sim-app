export const PASSPORT_DOMAIN_ERROR_CODE = 'PERSISTENCE_DOMAIN_ERROR'
export const PASSPORT_HEALTH_ERROR_CODE = 'PERSISTENCE_HEALTH_ERROR'

export class PassportPersistenceDomainError extends Error {
  readonly code = PASSPORT_DOMAIN_ERROR_CODE
}

export function persistenceDomainError(message: string): PassportPersistenceDomainError {
  return new PassportPersistenceDomainError(message)
}

const HEALTH_ERROR_CODES = new Set([
  'PERSISTENCE_QUARANTINED',
  'EACCES',
  'EBUSY',
  'EIO',
  'EMFILE',
  'ENFILE',
  'ENOSPC',
  'EPERM',
  'EROFS',
  'ERR_SQLITE_ERROR'
])

export function classifyPersistenceWorkerError(error: unknown): string {
  const code = typeof (error as { code?: unknown })?.code === 'string'
    ? String((error as { code: string }).code)
    : ''
  if (code === PASSPORT_DOMAIN_ERROR_CODE) return PASSPORT_DOMAIN_ERROR_CODE
  if (
    HEALTH_ERROR_CODES.has(code) ||
    code.startsWith('SQLITE_') ||
    code.startsWith('ERR_SQLITE_')
  ) {
    return code || PASSPORT_HEALTH_ERROR_CODE
  }
  return PASSPORT_HEALTH_ERROR_CODE
}
