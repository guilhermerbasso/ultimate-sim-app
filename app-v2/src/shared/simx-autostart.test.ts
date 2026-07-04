import { describe, expect, it } from 'vitest'
import { resolveSimXPort } from './simx-autostart'
import type { PortInfo } from './ipc'

const port = (path: string, isSimX = false): PortInfo => ({ path, isSimX })

describe('resolveSimXPort', () => {
  it('returns null when there are no ports', () => {
    expect(resolveSimXPort([], 'COM3')).toBeNull()
    expect(resolveSimXPort([], null)).toBeNull()
  })

  it('prefers the last-connected port when still present (even if isSimX is false)', () => {
    const ports = [port('COM1', true), port('COM7', false)]
    // COM7 was the SIM-X last time though its descriptor heuristic is false.
    expect(resolveSimXPort(ports, 'COM7')).toBe('COM7')
  })

  it('falls back to the first isSimX port when the last port is gone', () => {
    const ports = [port('COM1', false), port('COM5', true), port('COM9', true)]
    expect(resolveSimXPort(ports, 'COM7')).toBe('COM5')
  })

  it('still prefers the remembered port over a different isSimX port (lastPort is the stronger signal)', () => {
    const ports = [port('COM7', false), port('COM5', true)]
    expect(resolveSimXPort(ports, 'COM7')).toBe('COM7')
  })

  it('keeps the last port when it is itself the detected SIM-X', () => {
    const ports = [port('COM7', true), port('COM5', true)]
    expect(resolveSimXPort(ports, 'COM7')).toBe('COM7')
  })

  it('keeps the last port over a different isSimX port (avoids mis-picking another Leonardo board)', () => {
    // A maker rig can have several Leonardo/Pro-Micro boards that all trip isSimX; the
    // remembered port is the stronger signal, so it wins.
    const ports = [port('COM7', false), port('COM5', false)]
    expect(resolveSimXPort(ports, 'COM7')).toBe('COM7')
  })

  it('uses the isSimX detection when there is no last port', () => {
    expect(resolveSimXPort([port('COM1', false), port('COM4', true)], null)).toBe('COM4')
  })

  it('returns null when nothing matches and there is no usable last port', () => {
    expect(resolveSimXPort([port('COM1', false), port('COM2', false)], 'COM9')).toBeNull()
    expect(resolveSimXPort([port('COM1', false)], null)).toBeNull()
  })
})
