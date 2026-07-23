// @vitest-environment jsdom

import { createElement } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OBS_LOCAL_CHANNELS,
  OBS_LOCAL_PROTOCOL_VERSION,
  type ObsLocalStatus
} from '../../../shared/obs-local'
import {
  STREAM_SOURCE_CHANNELS,
  type StreamSourceDescriptor
} from '../../../shared/stream-sources'
import ObsLocalPanel from './ObsLocalPanel'

const offlineStatus: ObsLocalStatus = {
  protocolVersion: OBS_LOCAL_PROTOCOL_VERSION,
  feed: {
    running: false,
    url: null,
    bindAddress: null,
    port: null,
    portMode: null,
    allowedLayoutIds: [],
    readOnly: true,
    clients: 0,
    health: 'offline'
  },
  control: {
    state: 'offline',
    health: 'offline',
    endpoint: null,
    loopback: true,
    explicitNonLoopback: false,
    currentProgramScene: null,
    sceneAllowlist: [],
    handshake: null,
    missingCapabilities: [],
    manualOverride: false,
    lastHealthAtMs: null,
    healthAgeMs: null,
    lastTimeline: null,
    lastError: null,
    metrics: {
      connectAttempts: 0,
      connectSuccesses: 0,
      connectFailures: 0,
      healthChecks: 0,
      healthFailures: 0,
      commandsAccepted: 0,
      commandsDenied: 0,
      commandsRateLimited: 0,
      replayRejects: 0,
      wrongSceneRejects: 0,
      staleHealthRejects: 0,
      offlineRejects: 0,
      capabilityRejects: 0,
      transportFailures: 0,
      latency: { samples: 0, lastMs: null, p95Ms: null, maxMs: null }
    }
  }
}

function source(id: string, patch: Partial<StreamSourceDescriptor> = {}): StreamSourceDescriptor {
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

describe('ObsLocalPanel source catalog', () => {
  let listeners: Map<string, (payload: unknown) => void>

  beforeEach(() => {
    listeners = new Map()
    Object.defineProperty(window, 'ipc', {
      configurable: true,
      value: {
        invoke: vi.fn(async (channel: string) => {
          if (channel === OBS_LOCAL_CHANNELS.status) return structuredClone(offlineStatus)
          if (channel === STREAM_SOURCE_CHANNELS.list) {
            return [
              source('dash-added', { label: 'Added dashboard', added: true }),
              source('dash-unadded', { label: 'Unadded dashboard' }),
              source('dash-hidden', {
                label: 'Hidden dashboard',
                eligible: false,
                reason: 'hidden',
                added: true
              })
            ]
          }
          return null
        }),
        subscribe: (channel: string, callback: (payload: unknown) => void) => {
          listeners.set(channel, callback)
          return () => {
            if (listeners.get(channel) === callback) listeners.delete(channel)
          }
        }
      }
    })
  })

  afterEach(cleanup)

  it('offers only added, eligible dashboards and refreshes from catalog broadcasts', async () => {
    render(createElement(ObsLocalPanel, { language: 'en' }))

    const selector = await screen.findByLabelText('Allowlisted dashboard')
    await waitFor(() => {
      expect(Array.from((selector as HTMLSelectElement).options).map((option) => option.text)).toEqual([
        'Added dashboard'
      ])
    })

    act(() => {
      listeners.get(STREAM_SOURCE_CHANNELS.updated)?.([
        source('dash-next', { label: 'Next dashboard', added: true })
      ])
    })

    expect(Array.from((selector as HTMLSelectElement).options).map((option) => option.text)).toEqual([
      'Next dashboard'
    ])
  })
})
