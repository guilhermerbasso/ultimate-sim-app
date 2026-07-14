import type { ReplaySpeechCancelEvent } from '../../../shared/replay'

export type SpeechOwner = 'coach' | 'engineer' | 'spotter'

const generations: Record<SpeechOwner, number> = { coach: 0, engineer: 0, spotter: 0 }
type SpeechOwnerCanceller = (event?: ReplaySpeechCancelEvent) => void
interface SpeechOwnerWaiter {
  token: number
  cancel: () => void
}

const cancellers = new Map<SpeechOwner, Set<SpeechOwnerCanceller>>()
const cancellationWaiters = new Map<SpeechOwner, Set<SpeechOwnerWaiter>>()
interface ActiveWebSpeech {
  owner: SpeechOwner
  cancel: () => void
}
let activeWebSpeech: ActiveWebSpeech | null = null

export function speechOwnerToken(owner: SpeechOwner): number {
  return generations[owner]
}

export function isSpeechOwnerTokenCurrent(owner: SpeechOwner, token: number): boolean {
  return generations[owner] === token
}

export interface SpeechOwnerCancellationSignal {
  promise: Promise<void>
  isCancelled: () => boolean
  cancel: () => void
  dispose: () => void
}

export function createSpeechOwnerCancellationSignal(
  owner: SpeechOwner,
  token: number
): SpeechOwnerCancellationSignal {
  let waiter: SpeechOwnerWaiter | null = null
  let settled = false
  let cancelled = false
  let settle = (): void => undefined
  const cancel = (): void => {
    cancelled = true
    settle()
  }
  const promise = new Promise<void>((resolve) => {
    settle = () => {
      if (settled) return
      settled = true
      if (waiter) {
        const ownerWaiters = cancellationWaiters.get(owner)
        ownerWaiters?.delete(waiter)
        if (ownerWaiters?.size === 0) cancellationWaiters.delete(owner)
        waiter = null
      }
      resolve()
    }
    if (!isSpeechOwnerTokenCurrent(owner, token)) {
      cancel()
      return
    }
    waiter = { token, cancel }
    const ownerWaiters = cancellationWaiters.get(owner) ?? new Set<SpeechOwnerWaiter>()
    ownerWaiters.add(waiter)
    cancellationWaiters.set(owner, ownerWaiters)
  })
  return {
    promise,
    isCancelled: () => cancelled || !isSpeechOwnerTokenCurrent(owner, token),
    cancel,
    dispose: settle
  }
}

export function registerSpeechOwnerCanceller(owner: SpeechOwner, cancel: SpeechOwnerCanceller): () => void {
  const owners = cancellers.get(owner) ?? new Set<SpeechOwnerCanceller>()
  owners.add(cancel)
  cancellers.set(owner, owners)
  return () => {
    owners.delete(cancel)
    if (owners.size === 0) cancellers.delete(owner)
  }
}

export function cancelSpeechOwner(owner: SpeechOwner, event?: ReplaySpeechCancelEvent): void {
  if (event && event.owner !== owner) return
  generations[owner] += 1
  for (const waiter of [...(cancellationWaiters.get(owner) ?? [])]) {
    if (waiter.token !== generations[owner]) waiter.cancel()
  }
  for (const cancel of cancellers.get(owner) ?? []) {
    try { cancel(event) } catch { /* owner cancellation must be isolated */ }
  }
}

function cancelWebSpeechClaim(claim: ActiveWebSpeech): void {
  if (activeWebSpeech !== claim) return
  activeWebSpeech = null
  try { claim.cancel() } catch { /* best effort */ }
}

export interface OwnedWebSpeechRelease {
  (): void
  cancel: () => void
}

export function claimOwnedWebSpeech(owner: SpeechOwner, cancel: () => void): OwnedWebSpeechRelease {
  const previous = activeWebSpeech
  activeWebSpeech = null
  if (previous) {
    try { previous.cancel() } catch { /* best effort */ }
  }
  const claim = { owner, cancel }
  activeWebSpeech = claim
  const release = (() => {
    if (activeWebSpeech === claim) activeWebSpeech = null
  }) as OwnedWebSpeechRelease
  release.cancel = () => cancelWebSpeechClaim(claim)
  return release
}

export function cancelOwnedWebSpeech(owner: SpeechOwner): void {
  if (activeWebSpeech?.owner !== owner) return
  cancelWebSpeechClaim(activeWebSpeech)
}

export function resetSpeechOwnerRuntimeForTests(): void {
  activeWebSpeech = null
  for (const waiters of cancellationWaiters.values()) {
    for (const waiter of [...waiters]) waiter.cancel()
  }
  cancellationWaiters.clear()
  cancellers.clear()
  generations.coach = 0
  generations.engineer = 0
  generations.spotter = 0
}
