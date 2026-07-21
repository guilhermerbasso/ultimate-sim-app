// WS-WIDGETS — renderer hook that keeps the latest AI-Engineer messages so the
// new `engineer-feed` / `engineerFeed` widgets (dashboard + overlay) can render a
// radio-style log WITHOUT each one wiring its own subscription. It merges the two
// engineer broadcasts onto ONE timeline:
//   • `engineer:answer`     → answers to a driver question (EngineerAnswer)
//   • `engineer:proactive`  → self-initiated per-sector call-outs (EngineerProactiveEvent)
//
// It rides the EXISTING `engineer:` preload prefix (no new channel) and is
// test/SSR-safe: it no-ops when `window.ipc` is unavailable (render harness) so a
// widget yesply shows its empty state instead of throwing. De-dups by id because
// the answer arrives both as an invoke-return and a broadcast.

import { useEffect, useState } from 'react'
import {
  ENGINEER_CHANNELS,
  type EngineerAnswer,
  type EngineerProactiveEvent
} from '../../../shared/engineer-ipc'
import type { CoachSeverity } from '../../../shared/coach'

/** One normalized item on the engineer feed timeline. */
export interface EngineerFeedItem {
  /** Stable id (de-dup). */
  id: string
  /** Epoch ms. */
  at: number
  /** The spoken/displayed message text. */
  text: string
  /** `answer` = reply to a question, `proactive` = self-initiated radio call. */
  source: 'answer' | 'proactive'
  /** Present for answers — the original question, for an optional Q: prefix. */
  question?: string
  /** Present for proactive call-outs — the 1-based sector. */
  sector?: number
  /** Present for proactive call-outs — drives severity colouring. */
  severity?: CoachSeverity
  /** Distinguishes findings from informational/no-data briefings. */
  eventType?: EngineerProactiveEvent['eventType']
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function engineerFeedScope(item: EngineerFeedItem): string {
  if (item.source !== 'proactive') return 'Resposta'
  if (item.eventType === 'quali-briefing' || item.eventType === 'insufficient-history') return 'Quali'
  if (item.eventType === 'race-status') return 'Race'
  if (item.sector !== undefined) return `Sector ${item.sector}`
  return 'Info'
}

/**
 * Subscribe to the engineer broadcasts and keep the most-recent `limit` messages
 * NEWEST-FIRST (index 0 = latest). Returns an empty array until the first message
 * arrives.
 */
export function useEngineerFeed(limit = 8): EngineerFeedItem[] {
  const [items, setItems] = useState<EngineerFeedItem[]>([])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.ipc) return
    const cap = Math.max(1, Math.floor(limit))
    // De-dup against the ids currently in the feed only. Rebuilt on every push so
    // it stays bounded to `cap` entries instead of growing for the whole session.
    let seen = new Set<string>()

    const push = (item: EngineerFeedItem): void => {
      if (!isText(item.text) || seen.has(item.id)) return
      setItems((prev) => {
        const next = [item, ...prev].sort((a, b) => b.at - a.at).slice(0, cap)
        seen = new Set(next.map((entry) => entry.id))
        return next
      })
    }

    const unsubAnswer = window.ipc.subscribe<EngineerAnswer>(ENGINEER_CHANNELS.answer, (a) => {
      if (!a) return
      push({ id: a.id, at: a.at, text: a.text, source: 'answer', question: a.question })
    })
    const unsubProactive = window.ipc.subscribe<EngineerProactiveEvent>(ENGINEER_CHANNELS.proactive, (e) => {
      if (!e) return
      push({
        id: e.id,
        at: e.at,
        text: e.text,
        source: 'proactive',
        sector: e.sector,
        severity: e.severity,
        eventType: e.eventType
      })
    })

    return () => {
      unsubAnswer()
      unsubProactive()
    }
  }, [limit])

  return items
}

/** Format an epoch-ms timestamp as a subtle HH:MM clock (24h). Empty for invalid. */
export function feedClock(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return ''
  const d = new Date(at)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}
