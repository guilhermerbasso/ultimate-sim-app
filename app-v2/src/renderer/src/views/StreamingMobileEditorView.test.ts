// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STREAM_PRESENTATION_CHANNELS,
  createStreamPresentationProfile,
  type StreamPresentationProfileListItem,
  type StreamPresentationSaveRequest,
  type StreamPresentationTargetDescriptor
} from '../../../shared/stream-presentation'
import {
  STREAM_SOURCE_CHANNELS,
  type StreamSourceDescriptor
} from '../../../shared/stream-sources'
import { STREAMING_CHANNELS } from '../../../shared/streaming'
import type { AppViewProps } from '../App'
import { APP_NAVIGATE_EVENT, type AppNavigateDetail } from '../lib/app-navigation'
import StreamingMobileEditorView from './StreamingMobileEditorView'

vi.mock('../stream-presentation/StreamPresentationRenderer', () => ({
  StreamPresentationRenderer: () => null
}))

const target: StreamPresentationTargetDescriptor = {
  kind: 'dashboard',
  id: 'dashboard-race',
  name: 'Race dashboard',
  revision: 'dashboard-revision-1',
  width: 1024,
  height: 600,
  itemCount: 0,
  hidden: false
}

function profileItem(revision: number, name = 'Phone race profile'): StreamPresentationProfileListItem {
  return {
    profile: {
      ...createStreamPresentationProfile(target, {
        id: 'profile-phone-race',
        name,
        now: 100
      }),
      revision,
      updatedAt: 100 + revision
    },
    target,
    targetState: 'current'
  }
}

describe('StreamingMobileEditorView integration', () => {
  let currentProfiles: StreamPresentationProfileListItem[]
  let listeners: Map<string, (payload: unknown) => void>
  let invoke: ReturnType<typeof vi.fn>
  let showToast: ReturnType<typeof vi.fn>
  let saveRequests: StreamPresentationSaveRequest[]
  let sources: StreamSourceDescriptor[]

  beforeEach(() => {
    currentProfiles = [profileItem(7)]
    listeners = new Map()
    showToast = vi.fn()
    saveRequests = []
    sources = [{
      kind: 'dashboard',
      id: target.id,
      label: target.name,
      eligible: true,
      reason: null,
      added: true,
      active: false
    }]
    invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === STREAM_SOURCE_CHANNELS.list) return structuredClone(sources)
      if (channel === STREAM_SOURCE_CHANNELS.add) {
        const request = args[0] as { kind: string; id: string }
        sources = sources.map((source) =>
          source.kind === request.kind && source.id === request.id
            ? { ...source, added: true }
            : source
        )
        return structuredClone(sources)
      }
      if (channel === STREAM_SOURCE_CHANNELS.remove) {
        const request = args[0] as { kind: string; id: string }
        sources = sources.map((source) =>
          source.kind === request.kind && source.id === request.id
            ? { ...source, added: false, active: false }
            : source
        )
        return structuredClone(sources)
      }
      if (channel === STREAM_PRESENTATION_CHANNELS.targets) return [target]
      if (channel === STREAM_PRESENTATION_CHANNELS.list) return structuredClone(currentProfiles)
      if (channel === 'app:dash:get') return null
      if (channel === STREAMING_CHANNELS.start) {
        return { presentationProfileId: currentProfiles[0]?.profile.id ?? null }
      }
      if (channel === STREAM_PRESENTATION_CHANNELS.save) {
        const request = args[0] as StreamPresentationSaveRequest
        saveRequests.push(structuredClone(request))
        const actualRevision = currentProfiles.find((item) => item.profile.id === request.profile.id)?.profile.revision ?? null
        if (request.expectedRevision !== actualRevision) {
          throw new Error(
            `STREAM_PRESENTATION_CONFLICT: profile ${request.profile.id} expected revision ${String(request.expectedRevision)}, current revision is ${String(actualRevision)}`
          )
        }
        const saved = {
          ...request.profile,
          revision: (actualRevision ?? 0) + 1,
          updatedAt: request.profile.updatedAt + 1
        }
        const item: StreamPresentationProfileListItem = { profile: saved, target, targetState: 'current' }
        currentProfiles = [item]
        return item
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
  })

  afterEach(cleanup)

  function renderEditor(): void {
    render(createElement(StreamingMobileEditorView, {
      showToast,
      language: 'en'
    } as unknown as AppViewProps))
  }

  it('starts a saved presentation profile through streaming:start', async () => {
    renderEditor()

    const start = await screen.findByRole(
      'button',
      { name: 'Start streaming' },
      { timeout: 5_000 }
    )
    expect((start as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(start)

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(STREAMING_CHANNELS.start, {
        presentationProfileId: 'profile-phone-race'
      })
    })
    expect(showToast).toHaveBeenCalledWith(
      'Streaming started with this presentation profile.',
      'success'
    )
  })

  it('uses the shared source manager and links directly back to Streaming', async () => {
    sources = [{
      kind: 'touch',
      id: 'touch-pit',
      label: 'Pit controls',
      eligible: true,
      reason: null,
      added: false,
      active: false
    }]
    const navigation: AppNavigateDetail[] = []
    const onNavigate = (event: Event): void => {
      navigation.push((event as CustomEvent<AppNavigateDetail>).detail)
    }
    window.addEventListener(APP_NAVIGATE_EVENT, onNavigate)
    try {
      renderEditor()

      expect(await screen.findByText('Manage streaming sources')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Add to Streaming' }))
      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith(STREAM_SOURCE_CHANNELS.add, {
          kind: 'touch',
          id: 'touch-pit'
        })
      })

      fireEvent.click(screen.getByRole('button', { name: 'Open Streaming' }))
      expect(navigation).toEqual([{ viewId: 'streaming' }])
    } finally {
      window.removeEventListener(APP_NAVIGATE_EVENT, onNavigate)
    }
  })

  it('keeps the dirty draft base revision so a concurrent broadcast is rejected', async () => {
    renderEditor()

    const name = await screen.findByLabelText('Profile name')
    fireEvent.change(name, { target: { value: 'My local edit' } })
    expect(screen.getByText('Unsaved changes')).toBeTruthy()

    currentProfiles = [profileItem(8, 'Concurrent remote edit')]
    act(() => {
      listeners.get(STREAM_PRESENTATION_CHANNELS.list)?.(structuredClone(currentProfiles))
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => expect(saveRequests).toHaveLength(1))
    expect(saveRequests[0].expectedRevision).toBe(7)
    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining('STREAM_PRESENTATION_CONFLICT'),
        'error'
      )
    })
    expect((screen.getByLabelText('Profile name') as HTMLInputElement).value).toBe('My local edit')
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
  })
})
