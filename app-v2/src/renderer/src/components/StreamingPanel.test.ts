// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '../../../shared/settings'
import { DEFAULT_APP_SETTINGS } from '../../../shared/settings'
import { STREAM_SOURCE_CHANNELS, type StreamSourceDescriptor } from '../../../shared/stream-sources'
import { STREAMING_CHANNELS } from '../../../shared/streaming'
import { APP_NAVIGATE_EVENT, type AppNavigateDetail } from '../lib/app-navigation'
import StreamingPanel from './StreamingPanel'

describe('StreamingPanel source management integration', () => {
  let invoke: ReturnType<typeof vi.fn>
  let navigation: AppNavigateDetail[]

  beforeEach(() => {
    navigation = []
    let sources: StreamSourceDescriptor[] = [{
      kind: 'dashboard',
      id: 'dash-race',
      label: 'Race dashboard',
      eligible: true,
      reason: null,
      added: true,
      active: false
    }]
    const settings: AppSettings = {
      ...structuredClone(DEFAULT_APP_SETTINGS),
      streamTargets: {
        schemaVersion: 1,
        profiles: [{
          id: 'profile-race',
          kind: 'dashboard',
          sourceId: 'dash-race',
          label: 'OBS race feed'
        }],
        selectedProfileId: 'profile-race'
      }
    }
    const status = {
      profile: 'general',
      running: false,
      layoutId: 'dash-race',
      layoutKind: 'dashboard',
      streamSafe: true,
      accessMode: 'local',
      lanEnabled: false,
      autoTunnelEnabled: false,
      autoTunnelAvailable: false,
      interactive: false,
      warning: null
    }
    invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === STREAM_SOURCE_CHANNELS.list) return structuredClone(sources)
      if (channel === STREAM_SOURCE_CHANNELS.remove) {
        const ref = args[0] as { kind: string; id: string }
        sources = sources.map((source) =>
          source.kind === ref.kind && source.id === ref.id
            ? { ...source, added: false, active: false }
            : source
        )
        settings.streamTargets = {
          schemaVersion: 1,
          profiles: settings.streamTargets.profiles.filter((profile) =>
            profile.kind !== ref.kind || profile.sourceId !== ref.id
          ),
          selectedProfileId: null
        }
        return structuredClone(sources)
      }
      if (channel === 'app:getSettings') return structuredClone(settings)
      if (channel === 'app:setSettings') {
        settings.streamTargets = structuredClone((args[0] as { streamTargets: AppSettings['streamTargets'] }).streamTargets)
        return structuredClone(settings)
      }
      if (channel === STREAMING_CHANNELS.status) return { ...status }
      if (channel === STREAMING_CHANNELS.start) return { ...status, running: true }
      return null
    })
    Object.defineProperty(window, 'ipc', {
      configurable: true,
      value: {
        invoke,
        subscribe: () => () => undefined
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

  it('renders the shared manager, starts only the added source, and links to Mobile Editor', async () => {
    render(createElement(StreamingPanel, { language: 'en' }))

    expect(await screen.findByText('Manage streaming sources')).toBeTruthy()
    expect(await screen.findByText('OBS race feed')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Start streaming' }))
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(STREAMING_CHANNELS.start, expect.objectContaining({
        layoutKind: 'dashboard',
        layoutId: 'dash-race'
      }))
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open Mobile Stream Editor' }))
    expect(navigation).toEqual([{ viewId: 'streaming-mobile-editor' }])
  })

  it('routes deletion of the final alias through the dedicated source removal contract', async () => {
    render(createElement(StreamingPanel, { language: 'en' }))
    expect(await screen.findByText('OBS race feed')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(STREAM_SOURCE_CHANNELS.remove, {
        kind: 'dashboard',
        id: 'dash-race'
      })
    })
    expect(invoke).not.toHaveBeenCalledWith(
      'app:setSettings',
      expect.objectContaining({
        streamTargets: expect.objectContaining({ profiles: [] })
      })
    )
  })
})
