// @vitest-environment jsdom

import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STREAM_SOURCE_CHANNELS,
  type StreamSourceDescriptor
} from '../../../shared/stream-sources'
import {
  APP_NAVIGATE_EVENT,
  type AppNavigateDetail
} from '../lib/app-navigation'
import StreamingSourceManager from './StreamingSourceManager'

function source(
  id: string,
  patch: Partial<StreamSourceDescriptor> = {}
): StreamSourceDescriptor {
  return {
    kind: 'dashboard',
    id,
    label: id,
    eligible: true,
    reason: null,
    added: false,
    active: false,
    ...patch
  }
}

describe('StreamingSourceManager', () => {
  let catalog: StreamSourceDescriptor[]
  let invoke: ReturnType<typeof vi.fn>
  let listeners: Map<string, (payload: unknown) => void>
  let navigation: AppNavigateDetail[]

  beforeEach(() => {
    catalog = []
    listeners = new Map()
    navigation = []
    invoke = vi.fn(async (channel: string, request?: unknown) => {
      if (channel === STREAM_SOURCE_CHANNELS.list) return structuredClone(catalog)
      if (channel === STREAM_SOURCE_CHANNELS.add) {
        const ref = request as { kind: string; id: string }
        catalog = catalog.map((item) =>
          item.kind === ref.kind && item.id === ref.id ? { ...item, added: true } : item
        )
        return structuredClone(catalog)
      }
      if (channel === STREAM_SOURCE_CHANNELS.remove) {
        const ref = request as { kind: string; id: string }
        catalog = catalog.map((item) =>
          item.kind === ref.kind && item.id === ref.id
            ? { ...item, added: false, active: false }
            : item
        )
        return structuredClone(catalog)
      }
      return null
    })
    Object.defineProperty(window, 'ipc', {
      configurable: true,
      value: {
        invoke,
        subscribe: (channel: string, callback: (payload: unknown) => void) => {
          listeners.set(channel, callback)
          return () => {
            if (listeners.get(channel) === callback) listeners.delete(channel)
          }
        }
      }
    })
    window.addEventListener(APP_NAVIGATE_EVENT, handleNavigation)
  })

  afterEach(() => {
    window.removeEventListener(APP_NAVIGATE_EVENT, handleNavigation)
    cleanup()
  })

  function handleNavigation(event: Event): void {
    navigation.push((event as CustomEvent<AppNavigateDetail>).detail)
  }

  it('offers dashboard, Touch Controls, and refresh actions in the empty state', async () => {
    render(createElement(StreamingSourceManager, { language: 'en' }))

    expect(await screen.findByText('No saved streaming sources found')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open Dashboards' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Touch Controls' }))
    const refreshButtons = screen.getAllByRole('button', { name: 'Refresh' })
    fireEvent.click(refreshButtons.at(-1) as HTMLButtonElement)

    expect(navigation).toEqual([
      { viewId: 'dashboards' },
      { viewId: 'touch-controls' }
    ])
    await waitFor(() => {
      expect(invoke.mock.calls.filter(([channel]) => channel === STREAM_SOURCE_CHANNELS.list)).toHaveLength(2)
    })
  })

  it('searches states and sends only kind/id for add and active removal mutations', async () => {
    catalog = [
      source('dash-race', { label: 'Race dashboard' }),
      source('dash-hidden', {
        label: 'Hidden dashboard',
        eligible: false,
        reason: 'hidden',
        added: true
      }),
      source('touch-missing', {
        kind: 'touch',
        label: 'Old pit controls',
        eligible: false,
        reason: 'missing',
        added: true
      }),
      source('touch-active', {
        kind: 'touch',
        label: 'Live pit controls',
        added: true,
        active: true
      })
    ]
    render(createElement(StreamingSourceManager, { language: 'en' }))

    const race = await screen.findByText('Race dashboard')
    const raceItem = race.closest('li')
    expect(raceItem).not.toBeNull()
    fireEvent.click(within(raceItem as HTMLLIElement).getByRole('button', { name: 'Add to Streaming' }))
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(STREAM_SOURCE_CHANNELS.add, {
        kind: 'dashboard',
        id: 'dash-race'
      })
    })

    fireEvent.change(screen.getByLabelText('Search saved sources'), {
      target: { value: 'active' }
    })
    const active = await screen.findByText('Live pit controls')
    const activeItem = active.closest('li')
    expect(activeItem).not.toBeNull()
    fireEvent.click(within(activeItem as HTMLLIElement).getByRole('button', { name: 'Stop & remove' }))
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(STREAM_SOURCE_CHANNELS.remove, {
        kind: 'touch',
        id: 'touch-active'
      })
    })
    expect(screen.queryByText('Hidden dashboard')).toBeNull()
  })

  it('applies catalog broadcasts without remounting', async () => {
    catalog = [source('dash-race', { label: 'Race dashboard' })]
    const onSourcesChanged = vi.fn()
    render(createElement(StreamingSourceManager, { language: 'en', onSourcesChanged }))
    expect(await screen.findByText('Race dashboard')).toBeTruthy()

    act(() => {
      listeners.get(STREAM_SOURCE_CHANNELS.updated)?.([
        source('touch-pit', { kind: 'touch', label: 'Pit controls', added: true })
      ])
    })

    expect(await screen.findByText('Pit controls')).toBeTruthy()
    expect(screen.queryByText('Race dashboard')).toBeNull()
    expect(onSourcesChanged).toHaveBeenLastCalledWith([
      expect.objectContaining({ kind: 'touch', id: 'touch-pit', added: true })
    ])
  })
})
