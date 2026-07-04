// Minimal ambient types for the untyped CJS deps used by the sherpa TTS engine.
// Kept local to src/main/tts so the rest of the app stays decoupled from them.

declare module 'seek-bzip' {
  import { Buffer } from 'node:buffer'
  // Decompress a complete bzip2 buffer. `multistream` concatenates all bzip2
  // streams in the input (default false). Returns the decompressed bytes.
  export function decode(data: Uint8Array, multistream?: boolean): Buffer
  const seekBzip: { decode: typeof decode }
  export default seekBzip
}
