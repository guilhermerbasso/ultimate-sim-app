import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dialog, type IpcMainInvokeEvent } from 'electron'
import type { ModuleContext } from '../module-context'
import { STEWARD_CHANNELS, type StewardCase } from '../../shared/steward-desk'
import type { IncidentClip } from '../../shared/incidents'
import {
  IncidentClipStore,
  type IncidentClipIntegrityCodec
} from '../incidents/clip-store'

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn(async () => ({ response: 0 }))
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8')
  }
}))

import { register } from './steward-desk'

const roots: string[] = []

class TestClipCodec implements IncidentClipIntegrityCodec {
  available(): boolean {
    return true
  }

  seal(value: string): Buffer {
    return Buffer.from(value, 'utf8')
  }

  open(value: Buffer): string {
    return value.toString('utf8')
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function harness(name: string, clip?: IncidentClip): {
  handlers: Map<string, (...args: any[]) => any>
  event: IpcMainInvokeEvent
} {
  const root = join(process.cwd(), `.steward-module-${name}-${process.pid}-${roots.length}`)
  mkdirSync(root, { recursive: true })
  roots.push(root)
  const handlers = new Map<string, (...args: any[]) => any>()
  const ctx = {
    app: { getPath: () => root },
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
        handlers.set(channel, handler)
      })
    },
    getMainWindow: () => ({
      isDestroyed: () => false,
      webContents: { id: 7 }
    }),
    broadcast: vi.fn()
  } as unknown as ModuleContext
  const verified = clip
    ? new IncidentClipStore(join(root, 'incident-source'), new TestClipCodec()).save(clip)
    : null
  register(ctx, {
    ...(verified ? { readVerifiedClip: () => verified } : {})
  })
  return {
    handlers,
    event: { sender: { id: 7 } } as unknown as IpcMainInvokeEvent
  }
}

function incidentClip(): IncidentClip {
  return {
      id: 'trusted-clip',
      type: 'contact',
      severity: 'moderate',
      at: 500,
      lap: 2,
      lapDistPct: 0.4,
      metrics: { speedDropKmh: 25 },
      summary: 'Trusted clip.',
      window: [{ t: 499, speedKmh: 140 }, { t: 500, speedKmh: 115 }],
      triggerIndex: 1,
      createdAt: 501,
      captureSession: {
        schemaVersion: 1,
        captureSessionId: 'capture-acc-generation-4',
        sim: 'acc',
        startedAt: 100,
        lifecycleGeneration: 4,
        sessionType: 'Race',
        trackName: 'Spa'
    }
  }
}

function createInput(): Record<string, unknown> {
  return {
    title: 'Trusted actor boundary',
    actorDisplayName: 'Forged display owner',
    actorLabel: 'Forged untrusted label',
    actor: {
      id: 'forged-admin',
      displayName: 'Forged admin',
      role: 'league-admin'
    },
    assignedTo: {
      id: 'forged-chief',
      displayName: 'Forged chief',
      role: 'chief-steward'
    },
    identity: {
      leagueId: 'league',
      leagueName: 'League',
      eventId: 'event',
      eventName: 'Event',
      sessionId: 'session',
      sim: 'acc',
      sessionType: 'Race',
      trackName: 'Spa'
    },
    incident: {
      source: 'manual',
      sourceId: 'manual-1',
      label: 'Manual incident',
      windowBeforeSec: 5,
      windowAfterSec: 5
    }
  }
}

describe('Steward Desk IPC trust boundary', () => {
  it('ignores forged renderer actor identity, role, assignment, and display name', () => {
    const test = harness('actors')
    const created = test.handlers.get(STEWARD_CHANNELS.createCase)!(test.event, createInput()) as StewardCase

    expect(created.createdBy).toEqual({
      id: 'local-steward',
      displayName: 'Local steward',
      role: 'steward'
    })
    expect(created.assignedTo).toEqual(created.createdBy)
    expect(JSON.stringify(created)).not.toContain('Forged')
  })

  it('rejects renderer-controlled incident-recorder bookmark provenance', () => {
    const test = harness('bookmark')
    expect(() => test.handlers.get(STEWARD_CHANNELS.addBookmark)!(test.event, {
      caseId: 'case-does-not-matter',
      actor: { id: 'forged', displayName: 'Forged', role: 'league-admin' },
      bookmark: {
        source: 'incident-recorder',
        sourceId: 'forged-clip',
        label: 'Forged recorder incident',
        captureSessionId: 'forged-session',
        windowBeforeSec: 5,
        windowAfterSec: 5
      }
    })).toThrow(/derived from a verified persisted clip/i)
  })

  it('derives recorder case identity and bookmark metadata only from the verified clip', () => {
    const test = harness('trusted-clip', incidentClip())
    const input = createInput()
    input.identity = {
      ...(input.identity as Record<string, unknown>),
      sessionId: 'forged-session',
      sim: 'forged-sim',
      sessionType: 'Forged',
      trackName: 'Forged track'
    }
    input.incident = {
      source: 'incident-recorder',
      sourceId: 'trusted-clip',
      label: 'Untrusted label only',
      occurredAt: 999_999,
      lap: 99,
      lapDistPct: 0.99,
      captureSessionId: 'forged-session',
      windowBeforeSec: 99,
      windowAfterSec: 99
    }

    const created = test.handlers.get(STEWARD_CHANNELS.createCase)!(test.event, input) as StewardCase
    expect(created.identity).toMatchObject({
      sessionId: 'capture-acc-generation-4',
      sim: 'acc',
      sessionType: 'Race',
      trackName: 'Spa',
      startedAt: 100
    })
    expect(created.bookmarks[0]).toMatchObject({
      source: 'incident-recorder',
      sourceId: 'trusted-clip',
      label: 'Untrusted label only',
      occurredAt: 500,
      lap: 2,
      lapDistPct: 0.4,
      captureSessionId: 'capture-acc-generation-4',
      windowBeforeSec: 4,
      windowAfterSec: 3
    })
  })

  it('rejects generic incident evidence before any renderer payload is committed', () => {
    const test = harness('evidence')
    expect(() => test.handlers.get(STEWARD_CHANNELS.lockEvidence)!(test.event, {
      caseId: 'case-does-not-matter',
      actor: { id: 'forged', displayName: 'Forged', role: 'league-admin' },
      summary: 'Forged clip',
      mediaType: 'application/json',
      content: { id: 'forged' },
      provenance: {
        sourceKind: 'incident-recorder',
        sourceRef: 'forged',
        producer: 'renderer',
        producerVersion: '1',
        capturedAt: 1,
        sessionRef: 'forged'
      }
    })).toThrow(/trusted incident evidence channel/i)
  })

  it('reports the correct missing id field at the evidence-details IPC boundary', () => {
    const test = harness('evidence-id')
    expect(() => test.handlers.get(STEWARD_CHANNELS.getEvidenceDetails)!(test.event, {
      caseId: 'case-1',
      evidenceId: '   '
    })).toThrow(/steward evidence id is required/i)
    expect(() => test.handlers.get(STEWARD_CHANNELS.getEvidenceDetails)!(test.event, {
      caseId: '',
      evidenceId: 'evidence-1'
    })).toThrow(/steward case id is required/i)
  })

  it('requires a main-process native confirmation before authoritative adjudication', async () => {
    const test = harness('manual-review')
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({
      response: 1,
      checkboxChecked: false
    })

    await expect(test.handlers.get(STEWARD_CHANNELS.recordVerdict)!(test.event, {
      caseId: 'renderer-cannot-bypass',
      finding: 'procedural',
      decisionText: 'Forged renderer decision.',
      ruleCitationIds: ['rule'],
      evidenceIds: ['evidence'],
      manualReviewConfirmed: true
    })).rejects.toThrow(/manual evidence provenance review was not confirmed/i)
  })

  it('records local-trusted authority only after the native confirmation succeeds', async () => {
    const test = harness('confirmed-review')
    const created = test.handlers.get(STEWARD_CHANNELS.createCase)!(test.event, createInput()) as StewardCase
    const withEvidence = test.handlers.get(STEWARD_CHANNELS.lockEvidence)!(test.event, {
      caseId: created.caseId,
      summary: 'Manual evidence',
      mediaType: 'application/json',
      content: { sample: 1 },
      provenance: {
        sourceKind: 'document',
        sourceRef: 'manual',
        producer: 'Local reviewer',
        producerVersion: '1',
        capturedAt: 1
      }
    }) as StewardCase
    const withRule = test.handlers.get(STEWARD_CHANNELS.citeRule)!(test.event, {
      caseId: created.caseId,
      rulesetId: 'rules',
      version: '1',
      section: '1',
      title: 'Rule',
      text: 'Rule text',
      source: 'local'
    }) as StewardCase

    const decided = await test.handlers.get(STEWARD_CHANNELS.recordVerdict)!(test.event, {
      caseId: created.caseId,
      finding: 'procedural',
      decisionText: 'Native-confirmed decision.',
      ruleCitationIds: [withRule.rules[0].citationId],
      evidenceIds: [withEvidence.evidence[0].evidenceId],
      manualReviewConfirmed: true
    }) as StewardCase
    expect(dialog.showMessageBox).toHaveBeenCalled()
    expect(decided.verdicts[0]).toMatchObject({
      authority: 'local-trusted',
      manualReviewConfirmed: true
    })
  })
})
