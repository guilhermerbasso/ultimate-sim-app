// @vitest-environment jsdom
// Regression coverage for audit P1-18 (c) virtualisation and (d) a measured listener
// budget.
//
// The inert render contract already proved the galleries make zero IPC calls. That is a
// different claim from the DOM cost: every one of the 423 catalog thumbnails still built
// its full React/SVG tree on mount, whether or not it was anywhere near the viewport.
// These tests measure it — they count live thumbnails and global listener registrations
// with a controllable IntersectionObserver, rather than asserting it by inspection.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, Fragment, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { WidgetMini } from './widget-catalog'
import { ALL_VARIANTS } from './widget-catalog-data'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CARD_COUNT = 40

/**
 * Budget for global listener registrations while a gallery page is mounted. The point of
 * the budget is that it must NOT scale with the number of cards: 40 cards may not cost 40
 * window/document listeners.
 */
const GLOBAL_LISTENER_BUDGET = 8

interface ObserverRecord {
  node: Element
  fire: () => void
  disconnected: boolean
}

let observers: ObserverRecord[] = []
let root: Root | null = null
let host: HTMLDivElement | null = null
let windowListeners = 0
let documentListeners = 0

class ControllableIntersectionObserver {
  private readonly records: ObserverRecord[] = []

  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(node: Element): void {
    const record: ObserverRecord = {
      node,
      disconnected: false,
      fire: () => {
        this.callback(
          [{ isIntersecting: true, target: node } as unknown as IntersectionObserverEntry],
          this as unknown as IntersectionObserver
        )
      }
    }
    this.records.push(record)
    observers.push(record)
  }

  unobserve(): void {}

  disconnect(): void {
    for (const record of this.records) record.disconnected = true
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

function liveThumbnails(): number {
  return host?.querySelectorAll('[data-widget-preview-live="true"]').length ?? 0
}

function containers(): number {
  return host?.querySelectorAll('[data-widget-preview="true"]').length ?? 0
}

function mountCards(count: number): void {
  const variants = ALL_VARIANTS.slice(0, count)
  host = document.createElement('div')
  document.body.appendChild(host)
  const created = createRoot(host)
  root = created
  act(() => {
    created.render(
      createElement(
        Fragment,
        null,
        variants.map((variant) => createElement(WidgetMini, { key: variant.id, variant }))
      )
    )
  })
}

beforeEach(() => {
  observers = []
  windowListeners = 0
  documentListeners = 0
  const realWindowAdd = window.addEventListener.bind(window)
  const realDocumentAdd = document.addEventListener.bind(document)
  vi.spyOn(window, 'addEventListener').mockImplementation((...args: Parameters<typeof realWindowAdd>) => {
    windowListeners += 1
    realWindowAdd(...args)
  })
  vi.spyOn(document, 'addEventListener').mockImplementation((...args: Parameters<typeof realDocumentAdd>) => {
    documentListeners += 1
    realDocumentAdd(...args)
  })
  ;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    ControllableIntersectionObserver
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  if (host) host.remove()
  host = null
  vi.restoreAllMocks()
  delete (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver
})

describe('gallery thumbnail virtualisation', () => {
  it('mounts card containers but no thumbnails until they scroll into view', () => {
    mountCards(CARD_COUNT)

    expect(containers(), 'every card container should still be laid out').toBe(CARD_COUNT)
    expect(liveThumbnails(), 'off-screen cards must not build their thumbnail').toBe(0)
    expect(observers.length, 'every card should be observed exactly once').toBe(CARD_COUNT)
  })

  it('mounts only the thumbnails that actually intersect', () => {
    mountCards(CARD_COUNT)
    const visible = observers.slice(0, 3)

    act(() => {
      for (const record of visible) record.fire()
    })

    expect(liveThumbnails()).toBe(3)
    expect(containers()).toBe(CARD_COUNT)
  })

  it('keeps a thumbnail mounted once seen and stops observing it', () => {
    mountCards(CARD_COUNT)
    const first = observers[0]

    act(() => first.fire())

    expect(liveThumbnails()).toBe(1)
    expect(first.disconnected, 'a card that has been seen should stop observing').toBe(true)
  })

  it('stays inside the global listener budget regardless of card count', () => {
    mountCards(CARD_COUNT)

    const total = windowListeners + documentListeners
    expect(total, `global listeners (${total}) exceeded the budget for ${CARD_COUNT} cards`)
      .toBeLessThanOrEqual(GLOBAL_LISTENER_BUDGET)
    // The real invariant: the cost must not be per-card.
    expect(total).toBeLessThan(CARD_COUNT)
  })

  it('disconnects every observer on unmount', () => {
    mountCards(CARD_COUNT)
    expect(observers.length).toBe(CARD_COUNT)
    expect(observers.some((record) => record.disconnected)).toBe(false)

    act(() => root!.unmount())
    root = null

    expect(observers.every((record) => record.disconnected), 'observers leaked after unmount').toBe(true)
  })

  it('renders everything where IntersectionObserver is unavailable', () => {
    delete (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver
    mountCards(6)

    expect(liveThumbnails()).toBe(6)
    expect(observers.length).toBe(0)
  })
})
