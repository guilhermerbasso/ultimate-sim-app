import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { App } from 'electron'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SerialDevicesStore } from './store'

describe('SerialDevicesStore identity migration', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(process.cwd(), 'serial-device-store-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('enriches a legacy path-bound record when explicit setup supplies observed identity', async () => {
    const store = new SerialDevicesStore({
      getPath: () => root
    } as unknown as App)
    const legacy = await store.upsert({
      id: 'legacy-iflag',
      path: 'COM7',
      label: 'Legacy iFlag',
      baud: 115200,
      autoConnect: true
    })
    const migrated = await store.upsert({
      id: 'legacy-iflag',
      path: 'COM11',
      label: 'Legacy iFlag',
      baud: 115200,
      autoConnect: true,
      vendorId: '0x2341',
      productId: '0043',
      serialNumber: 'IFLAG-001'
    })

    expect(store.list()).toHaveLength(1)
    expect(migrated.path).toBe('COM11')
    expect(migrated.vendorId).toBe('2341')
    expect(migrated.productId).toBe('0043')
    expect(migrated.serialNumber).toBe('IFLAG-001')
    expect(migrated.createdAt).toBe(legacy.createdAt)
  })
})
