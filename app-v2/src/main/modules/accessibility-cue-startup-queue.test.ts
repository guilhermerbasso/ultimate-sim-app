import { describe, expect, it } from 'vitest'
import type {
  AlertEvent,
  AlertEventContext,
  AlertSeverity,
  AlertType
} from '../../shared/alerts'
import { PendingAccessibilityCueQueue } from './accessibility-cue-startup-queue'

function event(
  id: string,
  type: AlertType,
  severity: AlertSeverity,
  context?: AlertEventContext
): AlertEvent {
  return {
    id,
    type,
    severity,
    message: id,
    timestamp: Number(id.replace(/\D/g, '')) || 1,
    context
  }
}

const warningA = () =>
  event('warning-1', 'flag', 'warning', { flag: 'yellow' })
const warningB = () =>
  event('warning-2', 'tyrePressure', 'warning', {
    corner: 'lf',
    direction: 'low'
  })
const warningC = () =>
  event('warning-3', 'tyreTemp', 'warning', { corner: 'rf' })
const criticalFuel = () =>
  event('critical-1', 'lowFuel', 'critical', { remaining: 1 })

describe('PendingAccessibilityCueQueue', () => {
  it('never evicts a critical cue for a warning overflow', () => {
    const queue = new PendingAccessibilityCueQueue(3)
    queue.enqueue(criticalFuel())
    queue.enqueue(warningA())
    queue.enqueue(warningB())
    queue.enqueue(warningC())

    expect(queue.drain().map((item) => item.id)).toEqual([
      'critical-1',
      'warning-2',
      'warning-3'
    ])
  })

  it('admits a critical overflow by evicting the oldest lowest-priority warning', () => {
    const queue = new PendingAccessibilityCueQueue(3)
    queue.enqueue(warningA())
    queue.enqueue(warningB())
    queue.enqueue(warningC())
    queue.enqueue(criticalFuel())

    expect(queue.drain().map((item) => item.id)).toEqual([
      'critical-1',
      'warning-2',
      'warning-3'
    ])
  })

  it('semantic-dedupes repeats and retains the newest event', () => {
    const queue = new PendingAccessibilityCueQueue(3)
    queue.enqueue(warningA())
    queue.enqueue({
      ...warningA(),
      id: 'warning-9',
      message: 'newest'
    })

    expect(queue.size).toBe(1)
    expect(queue.drain()).toEqual([
      expect.objectContaining({ id: 'warning-9', message: 'newest' })
    ])
  })

  it('drops a warning when every bounded slot is critical', () => {
    const queue = new PendingAccessibilityCueQueue(2)
    queue.enqueue(criticalFuel())
    queue.enqueue(event('critical-2', 'incidentLimit', 'critical', {
      remaining: 0
    }))

    expect(queue.enqueue(warningA())).toBe(false)
    expect(queue.drain().map((item) => item.id)).toEqual([
      'critical-1',
      'critical-2'
    ])
  })
})
