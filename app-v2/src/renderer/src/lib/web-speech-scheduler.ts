export interface WebSpeechAdapter {
  speak(utterance: SpeechSynthesisUtterance): void
  cancel(): void
}

export interface WebSpeechScheduleRequest {
  channel: string
  generation: number
  semanticKey: string
  priority: number
  utterance: SpeechSynthesisUtterance
}

interface ScheduledSpeech extends WebSpeechScheduleRequest {
  sequence: number
  resolve: (spoken: boolean) => void
  settled: boolean
}

export class WebSpeechScheduler {
  private pending: ScheduledSpeech[] = []
  private current: ScheduledSpeech | null = null
  private sequence = 0

  constructor(
    private readonly adapter: WebSpeechAdapter,
    private readonly maxPending = 8
  ) {}

  enqueue(request: WebSpeechScheduleRequest): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const scheduled: ScheduledSpeech = {
        ...request,
        priority: Math.max(0, request.priority),
        sequence: ++this.sequence,
        resolve,
        settled: false
      }
      const pendingMatch = this.pending.find(
        (item) =>
          item.channel === scheduled.channel &&
          item.semanticKey === scheduled.semanticKey
      )
      if (
        (pendingMatch &&
          scheduled.generation < pendingMatch.generation) ||
        (this.current?.channel === scheduled.channel &&
          this.current.semanticKey === scheduled.semanticKey &&
          scheduled.generation <= this.current.generation)
      ) {
        this.settle(scheduled, false)
        return
      }
      this.dropPending(
        (item) =>
          item.channel === scheduled.channel &&
          item.semanticKey === scheduled.semanticKey
      )
      if (
        this.current &&
        scheduled.priority > this.current.priority
      ) {
        this.cancelCurrent(false)
      }
      this.pending.push(scheduled)
      this.sortAndBound()
      this.drain()
    })
  }

  cancelChannel(channel: string): void {
    this.dropPending((item) => item.channel === channel)
    if (this.current?.channel === channel) this.cancelCurrent()
  }

  cancelAll(): void {
    this.dropPending(() => true)
    if (this.current) this.cancelCurrent()
  }

  private sortAndBound(): void {
    this.pending.sort(
      (left, right) =>
        right.priority - left.priority ||
        left.sequence - right.sequence
    )
    if (this.pending.length <= this.maxPending) return
    const dropped = this.pending.splice(this.maxPending)
    for (const item of dropped) this.settle(item, false)
  }

  private dropPending(predicate: (item: ScheduledSpeech) => boolean): void {
    const retained: ScheduledSpeech[] = []
    for (const item of this.pending) {
      if (predicate(item)) this.settle(item, false)
      else retained.push(item)
    }
    this.pending = retained
  }

  private cancelCurrent(continueDraining = true): void {
    const current = this.current
    if (!current) return
    this.current = null
    current.utterance.onend = null
    current.utterance.onerror = null
    this.adapter.cancel()
    this.settle(current, false)
    if (continueDraining) this.drain()
  }

  private drain(): void {
    if (this.current) return
    const next = this.pending.shift()
    if (!next) return
    this.current = next
    const done = (spoken: boolean): void => {
      if (this.current === next) this.current = null
      this.settle(next, spoken)
      this.drain()
    }
    next.utterance.onend = () => done(true)
    next.utterance.onerror = () => done(false)
    try {
      this.adapter.speak(next.utterance)
    } catch {
      done(false)
    }
  }

  private settle(item: ScheduledSpeech, spoken: boolean): void {
    if (item.settled) return
    item.settled = true
    item.resolve(spoken)
  }
}

let sharedScheduler: WebSpeechScheduler | null = null

export function getSharedWebSpeechScheduler(): WebSpeechScheduler | null {
  if (
    typeof window === 'undefined' ||
    typeof window.speechSynthesis === 'undefined' ||
    typeof SpeechSynthesisUtterance === 'undefined'
  ) {
    return null
  }
  if (!sharedScheduler) {
    sharedScheduler = new WebSpeechScheduler({
      speak: (utterance) => window.speechSynthesis.speak(utterance),
      cancel: () => window.speechSynthesis.cancel()
    })
  }
  return sharedScheduler
}
