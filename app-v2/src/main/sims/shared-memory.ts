import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export type SharedMemoryHandle = {
  view: any | null
  close(): void
}

export type SharedMemoryBufferHandle = {
  view: Buffer | null
  close(): void
}

export function loadKoffi(): any | null {
  try {
    return require('koffi')
  } catch {
    return null
  }
}

export function openSharedMemory(koffi: any, name: string, struct: any): SharedMemoryHandle | null {
  if (process.platform !== 'win32') return null
  try {
    const kernel32 = koffi.load('kernel32.dll')
    const OpenFileMappingW = kernel32.func('OpenFileMappingW', 'void*', ['uint32', 'bool', 'str16'])
    const MapViewOfFile = kernel32.func('MapViewOfFile', 'void*', ['void*', 'uint32', 'uint32', 'uint32', 'size_t'])
    const UnmapViewOfFile = kernel32.func('UnmapViewOfFile', 'bool', ['void*'])
    const CloseHandle = kernel32.func('CloseHandle', 'bool', ['void*'])
    const FILE_MAP_READ = 0x0004
    const handle = OpenFileMappingW(FILE_MAP_READ, false, name)
    if (!handle) return null
    const pointer = MapViewOfFile(handle, FILE_MAP_READ, 0, 0, 0)
    if (!pointer) {
      CloseHandle(handle)
      return null
    }

    return {
      get view(): any {
        try {
          return koffi.decode(pointer, struct)
        } catch {
          return null
        }
      },
      close(): void {
        UnmapViewOfFile(pointer)
        CloseHandle(handle)
      }
    }
  } catch {
    return null
  }
}

export function openSharedMemoryBuffer(
  koffi: any,
  name: string,
  byteLength: number
): SharedMemoryBufferHandle | null {
  if (process.platform !== 'win32' || !Number.isSafeInteger(byteLength) || byteLength <= 0) return null
  try {
    const kernel32 = koffi.load('kernel32.dll')
    const OpenFileMappingW = kernel32.func('OpenFileMappingW', 'void*', ['uint32', 'bool', 'str16'])
    const MapViewOfFile = kernel32.func('MapViewOfFile', 'void*', ['void*', 'uint32', 'uint32', 'uint32', 'size_t'])
    const UnmapViewOfFile = kernel32.func('UnmapViewOfFile', 'bool', ['void*'])
    const CloseHandle = kernel32.func('CloseHandle', 'bool', ['void*'])
    const FILE_MAP_READ = 0x0004
    const handle = OpenFileMappingW(FILE_MAP_READ, false, name)
    if (!handle) return null
    const pointer = MapViewOfFile(handle, FILE_MAP_READ, 0, 0, byteLength)
    if (!pointer) {
      CloseHandle(handle)
      return null
    }
    return {
      get view(): Buffer | null {
        try {
          return Buffer.from(koffi.decode(pointer, 'uint8_t', byteLength))
        } catch {
          return null
        }
      },
      close(): void {
        UnmapViewOfFile(pointer)
        CloseHandle(handle)
      }
    }
  } catch {
    return null
  }
}

export function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function optionalNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function msToSeconds(value: unknown): number | undefined {
  const n = optionalNum(value)
  return n === undefined ? undefined : n / 1000
}

export function bool(value: unknown): boolean {
  return value === true || value === 1
}

export function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value.replace(/\0.*$/, '').trim() || undefined
  if (Array.isArray(value)) return value.map((char) => typeof char === 'number' ? String.fromCharCode(char) : '').join('').replace(/\0.*$/, '').trim() || undefined
  return undefined
}
