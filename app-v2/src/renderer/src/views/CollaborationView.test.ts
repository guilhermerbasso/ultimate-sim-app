// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  COLLABORATION_CHANNELS,
  type CollaborationDocumentView,
  type CollaborationWorkspaceState
} from '../../../shared/local-collaboration'
import type { AppViewProps } from '../App'
import CollaborationView from './CollaborationView'

const actor = {
  id: 'actor-local',
  displayName: 'Local owner',
  deviceId: 'device-local',
  publicKey: 'test-public-key'
}

function document(id: string, title: string): CollaborationDocumentView {
  return {
    id,
    kind: 'race-notes',
    title,
    createdAt: 1,
    revision: `revision-${id}`,
    heads: [],
    data: { title },
    changeCount: 1,
    tombstoneCount: 0,
    conflicts: [],
    history: []
  }
}

const alpha = document('alpha', 'Alpha plan')
const beta = document('beta', 'Beta plan')
const workspace: CollaborationWorkspaceState = {
  status: {
    authority: 'local-primary',
    transport: 'in-memory-mock-only',
    networkEnabled: false,
    online: true,
    localActor: actor,
    documentCount: 2,
    peerCount: 0,
    pendingChangeCount: 0,
    quarantineCount: 0,
    lastSavedAt: 1
  },
  documents: [alpha, beta].map((item) => ({
    id: item.id,
    kind: item.kind,
    title: item.title,
    revision: item.revision,
    changeCount: item.changeCount,
    conflictCount: 0,
    updatedAt: 1
  })),
  peers: [],
  quarantine: []
}

describe('CollaborationView async selection', () => {
  let pending: Map<string, (value: CollaborationDocumentView) => void>

  beforeEach(() => {
    pending = new Map()
    Object.defineProperty(window, 'ipc', {
      configurable: true,
      value: {
        invoke: vi.fn((channel: string, ...args: unknown[]) => {
          if (channel === COLLABORATION_CHANNELS.state) return Promise.resolve(workspace)
          if (channel === COLLABORATION_CHANNELS.getDocument) {
            return new Promise<CollaborationDocumentView>((resolve) => {
              pending.set(String(args[0]), resolve)
            })
          }
          return Promise.resolve(null)
        }),
        subscribe: vi.fn(() => () => {})
      }
    })
  })

  afterEach(cleanup)

  it('ignores an older document load that resolves after the new selection', async () => {
    render(createElement(CollaborationView, {
      showToast: vi.fn()
    } as unknown as AppViewProps))

    await waitFor(() => expect(pending.has(alpha.id)).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: /Beta plan/ }))
    await waitFor(() => expect(pending.has(beta.id)).toBe(true))

    await act(async () => {
      pending.get(beta.id)?.(beta)
    })
    await screen.findByDisplayValue('Beta plan')

    await act(async () => {
      pending.get(alpha.id)?.(alpha)
    })
    await waitFor(() => {
      expect((screen.getByDisplayValue('Beta plan') as HTMLInputElement).value).toBe('Beta plan')
    })
    expect(screen.queryByDisplayValue('Alpha plan')).toBeNull()
  })
})
