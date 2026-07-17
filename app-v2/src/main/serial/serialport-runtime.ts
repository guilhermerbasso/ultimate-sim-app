import { createRequire } from 'node:module'
import type {
  ReadlineParser as ReadlineParserType,
  SerialPort as SerialPortType
} from 'serialport'

// Electron's ESM loader does not resolve a package whose JS/package.json live in
// app.asar.unpacked. Route SerialPort through the CommonJS resolver, which is ASAR-aware.
const runtimeRequire = createRequire(import.meta.url)
const serialport = runtimeRequire('serialport') as typeof import('serialport')

export const SerialPort = serialport.SerialPort
export type SerialPort = SerialPortType

export const ReadlineParser = serialport.ReadlineParser
export type ReadlineParser = ReadlineParserType
