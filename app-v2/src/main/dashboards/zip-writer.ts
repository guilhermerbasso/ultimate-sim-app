// Mini implementação de escritor ZIP usando apenas `node:zlib`. Suficiente para
// montar arquivos `.simhubdash` (sem criptografia, sem ZIP64). Estrutura
// referenciada do APPNOTE.TXT (PKWARE) — campos little-endian, sem encryption.
import { deflateRawSync } from 'node:zlib'
import { Buffer } from 'node:buffer'

interface ZipEntry {
  name: string
  data: Buffer
}

interface PreparedEntry {
  name: string
  uncompressed: Buffer
  compressed: Buffer
  crc32: number
  method: number
  offset: number
}

// CRC-32 (PKZIP) — tabela precomputada uma vez.
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ CRC32_TABLE[(c ^ buf[i]) & 0xff]
  }
  return (c ^ 0xffffffff) >>> 0
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    Math.floor(date.getSeconds() / 2) | (date.getMinutes() << 5) | (date.getHours() << 11)
  const dateField =
    date.getDate() | ((date.getMonth() + 1) << 5) | ((date.getFullYear() - 1980) << 9)
  return { time, date: dateField }
}

function buildLocalHeader(entry: PreparedEntry, dt: { time: number; date: number }): Buffer {
  const nameBuf = Buffer.from(entry.name, 'utf8')
  const buf = Buffer.alloc(30 + nameBuf.length)
  let o = 0
  buf.writeUInt32LE(0x04034b50, o); o += 4              // signature
  buf.writeUInt16LE(20, o); o += 2                       // version needed
  buf.writeUInt16LE(0x0800, o); o += 2                   // general purpose (UTF-8 names)
  buf.writeUInt16LE(entry.method, o); o += 2             // compression method
  buf.writeUInt16LE(dt.time, o); o += 2
  buf.writeUInt16LE(dt.date, o); o += 2
  buf.writeUInt32LE(entry.crc32, o); o += 4
  buf.writeUInt32LE(entry.compressed.length, o); o += 4
  buf.writeUInt32LE(entry.uncompressed.length, o); o += 4
  buf.writeUInt16LE(nameBuf.length, o); o += 2
  buf.writeUInt16LE(0, o); o += 2                        // extra field length
  nameBuf.copy(buf, o)
  return buf
}

function buildCentralHeader(entry: PreparedEntry, dt: { time: number; date: number }): Buffer {
  const nameBuf = Buffer.from(entry.name, 'utf8')
  const buf = Buffer.alloc(46 + nameBuf.length)
  let o = 0
  buf.writeUInt32LE(0x02014b50, o); o += 4              // signature
  buf.writeUInt16LE(20, o); o += 2                       // version made by
  buf.writeUInt16LE(20, o); o += 2                       // version needed
  buf.writeUInt16LE(0x0800, o); o += 2                   // general purpose
  buf.writeUInt16LE(entry.method, o); o += 2
  buf.writeUInt16LE(dt.time, o); o += 2
  buf.writeUInt16LE(dt.date, o); o += 2
  buf.writeUInt32LE(entry.crc32, o); o += 4
  buf.writeUInt32LE(entry.compressed.length, o); o += 4
  buf.writeUInt32LE(entry.uncompressed.length, o); o += 4
  buf.writeUInt16LE(nameBuf.length, o); o += 2
  buf.writeUInt16LE(0, o); o += 2                        // extra field length
  buf.writeUInt16LE(0, o); o += 2                        // comment length
  buf.writeUInt16LE(0, o); o += 2                        // disk number
  buf.writeUInt16LE(0, o); o += 2                        // internal file attrs
  buf.writeUInt32LE(0, o); o += 4                        // external file attrs
  buf.writeUInt32LE(entry.offset, o); o += 4
  nameBuf.copy(buf, o)
  return buf
}

function buildEndRecord(centralSize: number, centralOffset: number, count: number): Buffer {
  const buf = Buffer.alloc(22)
  let o = 0
  buf.writeUInt32LE(0x06054b50, o); o += 4
  buf.writeUInt16LE(0, o); o += 2
  buf.writeUInt16LE(0, o); o += 2
  buf.writeUInt16LE(count, o); o += 2
  buf.writeUInt16LE(count, o); o += 2
  buf.writeUInt32LE(centralSize, o); o += 4
  buf.writeUInt32LE(centralOffset, o); o += 4
  buf.writeUInt16LE(0, o); o += 2
  return buf
}

export function createZip(entries: ZipEntry[]): Buffer {
  const dt = dosDateTime(new Date())
  const prepared: PreparedEntry[] = []
  let offset = 0
  const chunks: Buffer[] = []

  for (const entry of entries) {
    const uncompressed = entry.data
    const compressed = deflateRawSync(uncompressed, { level: 6 })
    // Se a compressão não reduzir, armazena STORED (método 0).
    const useDeflate = compressed.length < uncompressed.length
    const prep: PreparedEntry = {
      name: entry.name,
      uncompressed,
      compressed: useDeflate ? compressed : uncompressed,
      crc32: crc32(uncompressed),
      method: useDeflate ? 8 : 0,
      offset
    }
    prepared.push(prep)
    const local = buildLocalHeader(prep, dt)
    chunks.push(local, prep.compressed)
    offset += local.length + prep.compressed.length
  }

  const centralOffset = offset
  const centralChunks: Buffer[] = []
  for (const prep of prepared) {
    const central = buildCentralHeader(prep, dt)
    centralChunks.push(central)
    offset += central.length
  }
  const centralSize = offset - centralOffset
  const end = buildEndRecord(centralSize, centralOffset, prepared.length)
  return Buffer.concat([...chunks, ...centralChunks, end])
}
