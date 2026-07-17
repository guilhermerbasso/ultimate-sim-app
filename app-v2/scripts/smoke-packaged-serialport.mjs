import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

try {
  const anchor = resolve(
    process.argv[2] ??
      'dist-win/win-unpacked/resources/app.asar/out/main/index.js'
  )
  const runtimeRequire = createRequire(pathToFileURL(anchor))
  const serialport = runtimeRequire('serialport')

  if (
    typeof serialport?.SerialPort !== 'function' ||
    typeof serialport.SerialPort.list !== 'function' ||
    typeof serialport?.ReadlineParser !== 'function'
  ) {
    throw new Error('Packaged SerialPort exports are unavailable')
  }

  console.log('[smoke-packaged-serialport] packaged SerialPort resolved')
} catch (error) {
  console.error(error)
  process.exit(1)
}
