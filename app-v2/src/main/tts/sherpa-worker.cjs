'use strict'

// Out-of-process sherpa-onnx VITS synthesizer.
//
// Why a SEPARATE PROCESS (and not a worker_thread): sherpa-onnx statically links
// onnxruntime, whose native kernels can hard-crash (0xC0000005 ACCESS_VIOLATION,
// e.g. unsupported SIMD) on low-end CPUs. worker_threads share the SAME process,
// so a native segfault there would still take down the whole Electron app —
// strictly worse than the old piper.exe child. Running synth in a child process
// (spawned with ELECTRON_RUN_AS_NODE=1 → the Electron binary behaving as plain
// Node) means a native crash kills ONLY this child: the main process sees a
// non-zero exit / signal, increments the per-voice crash count, and falls back to
// an OS voice. No asar support is assumed here — every path required at runtime is
// passed in already resolved to the asar-UNPACKED location.
//
// Protocol: read ONE JSON job from stdin, synth, write a 16-bit PCM mono WAV to
// `outWavPath`, exit 0. On ANY failure, log to stderr and exit non-zero.
//
// Job shape:
//   { sherpaEntry, nativeDir, modelPath, tokensPath, dataDir,
//     text, outWavPath, speakerId, speed }

const fs = require('node:fs')

// The neural addon can throw on a later tick (e.g. a native completion), which
// would otherwise print Node's default fatal trace with no context. Surface it
// through fail() so the parent gets a clean non-zero exit + a useful reason.
process.on('uncaughtException', (error) => {
  fail(`uncaught: ${error && error.message ? error.message : String(error)}`)
})
process.on('unhandledRejection', (error) => {
  fail(`unhandled rejection: ${error && error.message ? error.message : String(error)}`)
})

function fail(message) {
  process.stderr.write(`[sherpa-worker] ${message}\n`)
  process.exit(1)
}

// Float32 [-1,1] mono → 16-bit PCM WAV Buffer. Mirrors encodeWavFromFloat32 in
// sherpa.ts so the bytes the renderer receives are identical to the old in-process
// path (44-byte canonical header + PCM data).
function encodeWavFromFloat32(samples, sampleRate) {
  const numFrames = samples.length
  const bytesPerSample = 2
  const blockAlign = bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = numFrames * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataSize, 40)

  let offset = 44
  for (let i = 0; i < numFrames; i++) {
    let s = samples[i]
    if (s > 1) s = 1
    else if (s < -1) s = -1
    const v = s < 0 ? s * 0x8000 : s * 0x7fff
    buffer.writeInt16LE(v | 0, offset)
    offset += 2
  }
  return buffer
}

// Prepend the platform native package dir to the OS library search path so the
// engine's dependent shared libs (onnxruntime / sherpa-onnx-c-api) resolve when
// loaded from an asar-unpacked node_modules. Mirrors augmentLibrarySearchPath in
// sherpa.ts; no-op when already present.
function augmentLibrarySearchPath(nativeDir) {
  if (!nativeDir) return
  const sep = process.platform === 'win32' ? ';' : ':'
  const envVar =
    process.platform === 'win32'
      ? 'PATH'
      : process.platform === 'darwin'
        ? 'DYLD_LIBRARY_PATH'
        : 'LD_LIBRARY_PATH'
  const current = process.env[envVar] || ''
  if (!current.split(sep).includes(nativeDir)) {
    process.env[envVar] = current ? `${nativeDir}${sep}${current}` : nativeDir
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      data += chunk
    })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}

async function main() {
  const raw = await readStdin()
  let job
  try {
    job = JSON.parse(raw)
  } catch (error) {
    return fail(`invalid job JSON: ${error && error.message ? error.message : String(error)}`)
  }

  const { sherpaEntry, nativeDir, modelPath, tokensPath, dataDir, text, outWavPath, speakerId, speed } =
    job || {}
  if (!sherpaEntry || !modelPath || !tokensPath || !dataDir || !outWavPath) {
    return fail('missing required job fields')
  }

  augmentLibrarySearchPath(nativeDir)

  let sherpa
  try {
    sherpa = require(sherpaEntry)
  } catch (error) {
    return fail(`cannot load sherpa-onnx-node: ${error && error.message ? error.message : String(error)}`)
  }

  let tts
  try {
    tts = new sherpa.OfflineTts({
      model: {
        vits: { model: modelPath, tokens: tokensPath, dataDir },
        numThreads: 1,
        provider: 'cpu',
        debug: false
      },
      maxNumSentences: 1
    })
  } catch (error) {
    return fail(`OfflineTts init failed: ${error && error.message ? error.message : String(error)}`)
  }

  let audio
  try {
    // enableExternalBuffer:false makes sherpa COPY the samples into a normal
    // V8-owned Float32Array. The default (true) returns an EXTERNAL ArrayBuffer,
    // which Node 24 / Electron rejects with "External buffers are not allowed",
    // crashing this worker (→ OS-voice fallback). This is THE neural-TTS fix.
    const req = {
      text: String(text == null ? '' : text),
      sid: Number(speakerId ?? 0),
      speed: Number(speed ?? 1.0),
      enableExternalBuffer: false
    }
    audio = typeof tts.generateAsync === 'function' ? await tts.generateAsync(req) : tts.generate(req)
  } catch (error) {
    return fail(`generate failed: ${error && error.message ? error.message : String(error)}`)
  }

  if (!audio || !audio.samples || audio.samples.length === 0) {
    return fail('engine returned no audio')
  }

  let wav
  try {
    wav = encodeWavFromFloat32(audio.samples, audio.sampleRate)
  } catch (error) {
    return fail(`wav encode failed: ${error && error.message ? error.message : String(error)}`)
  }

  // Write to a sibling .part then atomically rename so the main process never reads
  // a half-written WAV.
  try {
    fs.writeFileSync(`${outWavPath}.part`, wav)
    fs.renameSync(`${outWavPath}.part`, outWavPath)
  } catch (error) {
    return fail(`cannot write wav: ${error && error.message ? error.message : String(error)}`)
  }

  process.exit(0)
}

main().catch((error) => fail(error && error.message ? error.message : String(error)))
