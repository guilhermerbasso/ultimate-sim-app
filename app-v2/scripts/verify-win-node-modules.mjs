import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  statSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { getRawHeader } from '@electron/asar'

const unpackedApp = process.argv[2]
  ? resolve(process.argv[2])
  : join(process.cwd(), 'dist-win', 'win-unpacked')
const resources = join(unpackedApp, 'resources')
const archive = join(resources, 'app.asar')
const unpacked = join(resources, 'app.asar.unpacked')

function fail(message) {
  console.error(`[verify-win-node-modules] ERROR: ${message}`)
  process.exit(1)
}

if (!existsSync(archive)) fail(`missing archive: ${archive}`)

function readArchivedFile(relative) {
  const raw = getRawHeader(archive)
  let node = raw.header
  for (const segment of relative.split('/')) {
    node = node?.files?.[segment]
    if (!node) fail(`missing packaged ASAR entry: ${relative}`)
  }
  if (node.unpacked) fail(`expected packed ASAR entry, found unpacked: ${relative}`)

  const buffer = Buffer.alloc(node.size)
  const fd = openSync(archive, 'r')
  try {
    readSync(fd, buffer, 0, node.size, 8 + raw.headerSize + Number(node.offset))
  } finally {
    closeSync(fd)
  }

  if (node.integrity?.hash) {
    const actual = createHash('sha256').update(buffer).digest('hex')
    if (actual !== node.integrity.hash) {
      fail(`ASAR integrity mismatch for ${relative}`)
    }
  }
  return buffer
}

const unpackedSerialportFiles = [
  'node_modules/serialport/package.json',
  'node_modules/serialport/dist/index.js',
  'node_modules/@serialport/bindings-cpp/package.json',
  'node_modules/@serialport/bindings-cpp/dist/index.js'
]

for (const relative of unpackedSerialportFiles) {
  const file = join(unpacked, relative)
  if (!existsSync(file) || statSync(file).size <= 0) {
    fail(`missing unpacked SerialPort runtime file: ${relative}`)
  }
}

const nativeBinding = join(
  unpacked,
  'node_modules',
  '@serialport',
  'bindings-cpp',
  'prebuilds',
  'win32-x64',
  'node.napi.node'
)

if (!existsSync(nativeBinding) || statSync(nativeBinding).size <= 0) {
  fail(`missing unpacked Windows x64 SerialPort binding: ${nativeBinding}`)
}

const mainBundle = readArchivedFile('out/main/index.js').toString('utf8')
if (
  /\bfrom\s*["']serialport["']/.test(mainBundle) ||
  /\bimport\s*\(\s*["']serialport["']\s*\)/.test(mainBundle)
) {
  fail('packaged main bundle still contains a direct ESM import from serialport')
}
if (
  !mainBundle.includes('createRequire') ||
  !/runtimeRequire\(["']serialport["']\)/.test(mainBundle)
) {
  fail('packaged main bundle does not contain the ASAR-aware SerialPort CommonJS bridge')
}

console.log('[verify-win-node-modules] SerialPort CommonJS bridge and native package verified')
