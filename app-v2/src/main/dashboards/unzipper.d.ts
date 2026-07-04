declare module 'unzipper' {
  import { Readable } from 'node:stream'
  import { Buffer } from 'node:buffer'

  export interface ZipFileEntry {
    path: string
    type?: string
    size?: number
    uncompressedSize?: number
    buffer(password?: string): Promise<Buffer>
    stream(password?: string): Readable
  }

  export interface ZipCentralDirectory {
    files: ZipFileEntry[]
  }

  export const Open: {
    file(path: string, options?: Record<string, unknown>): Promise<ZipCentralDirectory>
    buffer(buffer: Buffer, options?: Record<string, unknown>): Promise<ZipCentralDirectory>
  }

  const unzipper: {
    Open: typeof Open
  }
  export default unzipper
}
