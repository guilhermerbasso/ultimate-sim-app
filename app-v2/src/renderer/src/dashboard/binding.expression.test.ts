import { afterEach, describe, expect, it } from 'vitest'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import {
  applyExpressionResultCacheUpdate,
  applyOutputValueCacheUpdate,
  clearDynamicBindingCaches,
  resolveBinding
} from './binding'

describe('exact expression and iRacing binding caches', () => {
  afterEach(() => clearDynamicBindingCaches())

  it('resolves expressions by stable expr:#id and removes stale id/name entries on tombstone', () => {
    applyExpressionResultCacheUpdate('expr-1', { name: 'Old name', value: 42 })
    expect(resolveBinding('expr:#expr-1', null).text).toBe('42')
    expect(resolveBinding('expr:Old name', null).text).toBe('42')

    applyExpressionResultCacheUpdate('expr-1', { name: 'New name', value: 43 })
    expect(resolveBinding('expr:#expr-1', null).text).toBe('43')
    expect(resolveBinding('expr:Old name', null).text).toBe('—')

    applyExpressionResultCacheUpdate('expr-1', { name: 'New name', value: null, deleted: true })
    expect(resolveBinding('expr:#expr-1', null).text).toBe('—')
    expect(resolveBinding('expr:New name', null).text).toBe('—')
  })

  it('clears routed value caches when a route deletion tombstone arrives', () => {
    applyOutputValueCacheUpdate({ routeId: 'route-1', name: 'exact', value: '77', raw: 77 })
    expect(resolveBinding('var:exact', null).text).toBe('77')

    applyOutputValueCacheUpdate({ routeId: 'route-1', name: 'exact', value: '', deleted: true })
    expect(resolveBinding('var:exact', null).text).toBe('—')
  })

  it('resolves an exact mapped ir variable without a publish-name fallback', () => {
    const snapshot = { speedKmh: 123 } as TelemetrySnapshot
    expect(resolveBinding('ir:Speed', snapshot).numeric).toBe(123)
    expect(resolveBinding('ir:VelocityX', snapshot).text).toBe('—')
  })
})
