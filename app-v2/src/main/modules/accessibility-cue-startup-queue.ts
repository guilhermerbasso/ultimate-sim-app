import type { AlertEvent } from '../../shared/alerts'
import {
  cueSeverityPriority,
  cueRouteSemanticKey,
  semanticCueEventFromAlert
} from '../../shared/accessibility-cues'

interface QueuedAlert {
  event: AlertEvent
  key: string
  priority: number
  sequence: number
}

function semanticKey(event: AlertEvent): string {
  const semantic = semanticCueEventFromAlert(event)
  return cueRouteSemanticKey({
    source: semantic.source,
    eventId: semantic.id,
    messageKey: semantic.messageKey,
    context: semantic.context
  })
}

export class PendingAccessibilityCueQueue {
  private entries: QueuedAlert[] = []
  private sequence = 0
  private readonly maxEntries: number

  constructor(maxEntries = 32) {
    this.maxEntries = Math.max(1, maxEntries)
  }

  enqueue(event: AlertEvent): boolean {
    const priority = cueSeverityPriority(event.severity)
    const key = semanticKey(event)
    const existingIndex = this.entries.findIndex(
      (entry) => entry.key === key
    )
    if (existingIndex >= 0) {
      const existing = this.entries[existingIndex]
      if (priority < existing.priority) return false
      this.entries.splice(existingIndex, 1)
    }

    const queued: QueuedAlert = {
      event,
      key,
      priority,
      sequence: ++this.sequence
    }
    if (this.entries.length < this.maxEntries) {
      this.entries.push(queued)
      return true
    }

    const candidates = this.entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) =>
        priority >= 2 ? true : entry.priority < 2
      )
      .sort(
        (left, right) =>
          left.entry.priority - right.entry.priority ||
          left.entry.sequence - right.entry.sequence
      )
    const candidate = candidates[0]
    if (!candidate || candidate.entry.priority > priority) return false
    this.entries.splice(candidate.index, 1, queued)
    return true
  }

  drain(): AlertEvent[] {
    const drained = [...this.entries]
      .sort(
        (left, right) =>
          right.priority - left.priority ||
          left.sequence - right.sequence
      )
      .map((entry) => entry.event)
    this.entries = []
    return drained
  }

  clear(): void {
    this.entries = []
  }

  get size(): number {
    return this.entries.length
  }
}
