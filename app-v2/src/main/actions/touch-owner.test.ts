import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TouchSemanticActionRequest } from '../../shared/touch-panel'
import {
  executeTouchSemanticCleanupAction,
  executeTouchSemanticAction,
  hasTouchSemanticActionRuntime,
  registerTouchSemanticActionRuntime,
  releaseTouchSemanticActionOwner
} from './touch-owner'

const request: TouchSemanticActionRequest = {
  action: { kind: 'keyboard', command: { mode: 'hold', keys: ['V'] } },
  phase: 'begin',
  token: 'radio:main',
  zone: 'main'
}

let unregister: (() => Promise<void>) | null = null

afterEach(async () => {
  await unregister?.().catch(() => undefined)
  unregister = null
})

describe('Touch semantic runtime ownership', () => {
  it('registers an in-flight owner before execution and drains it before teardown completes', async () => {
    let finishExecution!: () => void
    const executionGate = new Promise<void>((resolve) => { finishExecution = resolve })
    const releaseOwner = vi.fn().mockResolvedValue(undefined)
    unregister = registerTouchSemanticActionRuntime({
      execute: async () => {
        await executionGate
        return { ok: true, message: 'held' }
      },
      releaseOwner
    })

    const execution = executeTouchSemanticAction(request, 'stream-session-a')
    const teardown = unregister()
    expect(hasTouchSemanticActionRuntime()).toBe(false)
    await expect(executeTouchSemanticAction(request, 'stream-session-b')).resolves.toMatchObject({ ok: false })
    expect(releaseOwner).toHaveBeenCalledWith('stream-session-a')

    finishExecution()
    await expect(execution).resolves.toEqual({ ok: true, message: 'held' })
    await teardown
    expect(releaseOwner).toHaveBeenCalledTimes(1)
    expect(releaseOwner).toHaveBeenCalledWith('stream-session-a')
  })

  it('deduplicates an explicit release racing runtime teardown', async () => {
    let finishRelease!: () => void
    const releaseGate = new Promise<void>((resolve) => { finishRelease = resolve })
    const releaseOwner = vi.fn(async () => releaseGate)
    unregister = registerTouchSemanticActionRuntime({
      execute: async () => ({ ok: true, message: 'held' }),
      releaseOwner
    })

    await executeTouchSemanticAction(request, 'stream-session-a')
    const release = releaseTouchSemanticActionOwner('stream-session-a')
    const teardown = unregister()
    await vi.waitFor(() => expect(releaseOwner).toHaveBeenCalledTimes(1))

    finishRelease()
    await Promise.all([release, teardown])
    expect(releaseOwner).toHaveBeenCalledTimes(1)
  })

  it('admits internal cleanup during teardown and releases the owner it re-registers', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, message: 'sent' })
    const releaseOwner = vi.fn().mockResolvedValue(undefined)
    unregister = registerTouchSemanticActionRuntime({ execute, releaseOwner })

    await executeTouchSemanticAction(request, 'stream-session-a')
    const teardown = unregister()
    await expect(
      executeTouchSemanticCleanupAction(
        { ...request, phase: 'cancel' },
        'stream-session-a'
      )
    ).resolves.toEqual({ ok: true, message: 'sent' })
    await teardown

    expect(execute).toHaveBeenCalledTimes(2)
    expect(releaseOwner).toHaveBeenCalledTimes(2)
  })
})
