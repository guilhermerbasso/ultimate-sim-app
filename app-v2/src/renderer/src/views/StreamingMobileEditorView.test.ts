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
import { STREAMING_CHANNELS } from '../../../shared/streaming'
import type { AppViewProps } from '../App'
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

  beforeEach(() => {
    currentProfiles = [profileItem(7)]
    listeners = new Map()
    showToast = vi.fn()
    saveRequests = []
    invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
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

    const start = await screen.findByRole('button', { name: 'Start streaming' })
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
