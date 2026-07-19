import type { ContextDebtReport } from '../../../shared/context-debt'

export const CONTEXT_DEBT_STORAGE_KEY = 'usa:context-debt-experiment:v1'

export type ContextDebtDecision = 'accepted' | 'rejected'

export interface ContextDebtDecisionRecord {
  decision: ContextDebtDecision
  fingerprint: string
  decidedAt: number
}

export interface ContextDebtProfileExperiment {
  runs: number
  lastRunAt?: number
  lastFingerprint?: string
  decisions: Record<string, ContextDebtDecisionRecord>
}

export interface ContextDebtExperimentState {
  version: 1
  profiles: Record<string, ContextDebtProfileExperiment>
}

export interface ContextDebtStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const MAX_PROFILES = 50
const MAX_DECISIONS_PER_PROFILE = 200

export function createEmptyContextDebtExperimentState(): ContextDebtExperimentState {
  return { version: 1, profiles: {} }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeDecision(value: unknown): ContextDebtDecisionRecord | null {
  if (!isRecord(value)) return null
  if (value.decision !== 'accepted' && value.decision !== 'rejected') return null
  if (typeof value.fingerprint !== 'string' || !value.fingerprint) return null
  if (typeof value.decidedAt !== 'number' || !Number.isFinite(value.decidedAt)) return null
  return {
    decision: value.decision,
    fingerprint: value.fingerprint,
    decidedAt: value.decidedAt
  }
}

function normalizeProfile(value: unknown): ContextDebtProfileExperiment {
  if (!isRecord(value)) return { runs: 0, decisions: {} }
  const decisions: Record<string, ContextDebtDecisionRecord> = {}
  if (isRecord(value.decisions)) {
    const entries = Object.entries(value.decisions)
      .map(([id, decision]) => [id, normalizeDecision(decision)] as const)
      .filter((entry): entry is readonly [string, ContextDebtDecisionRecord] => Boolean(entry[1]))
      .sort((a, b) => b[1].decidedAt - a[1].decidedAt)
      .slice(0, MAX_DECISIONS_PER_PROFILE)
    for (const [id, decision] of entries) decisions[id] = decision
  }
  return {
    runs: typeof value.runs === 'number' && Number.isFinite(value.runs) ? Math.max(0, Math.round(value.runs)) : 0,
    ...(typeof value.lastRunAt === 'number' && Number.isFinite(value.lastRunAt) ? { lastRunAt: value.lastRunAt } : {}),
    ...(typeof value.lastFingerprint === 'string' && value.lastFingerprint ? { lastFingerprint: value.lastFingerprint } : {}),
    decisions
  }
}

export function normalizeContextDebtExperimentState(value: unknown): ContextDebtExperimentState {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.profiles)) {
    return createEmptyContextDebtExperimentState()
  }

  const profiles = Object.entries(value.profiles)
    .map(([key, profile]) => [key, normalizeProfile(profile)] as const)
    .sort((a, b) => (b[1].lastRunAt ?? 0) - (a[1].lastRunAt ?? 0))
    .slice(0, MAX_PROFILES)

  return {
    version: 1,
    profiles: Object.fromEntries(profiles)
  }
}

function defaultStorage(): ContextDebtStorage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readContextDebtExperimentState(
  storage: ContextDebtStorage | null = defaultStorage()
): ContextDebtExperimentState {
  if (!storage) return createEmptyContextDebtExperimentState()
  try {
    const raw = storage.getItem(CONTEXT_DEBT_STORAGE_KEY)
    return raw ? normalizeContextDebtExperimentState(JSON.parse(raw)) : createEmptyContextDebtExperimentState()
  } catch {
    return createEmptyContextDebtExperimentState()
  }
}

export function writeContextDebtExperimentState(
  state: ContextDebtExperimentState,
  storage: ContextDebtStorage | null = defaultStorage()
): void {
  if (!storage) return
  try {
    storage.setItem(CONTEXT_DEBT_STORAGE_KEY, JSON.stringify(normalizeContextDebtExperimentState(state)))
  } catch {
    // Experimental metrics must never block the configuration audit.
  }
}

export function recordContextDebtRun(
  state: ContextDebtExperimentState,
  report: Pick<ContextDebtReport, 'profile' | 'fingerprint'>,
  at = Date.now()
): ContextDebtExperimentState {
  const current = state.profiles[report.profile.key] ?? { runs: 0, decisions: {} }
  return normalizeContextDebtExperimentState({
    ...state,
    profiles: {
      ...state.profiles,
      [report.profile.key]: {
        ...current,
        runs: current.runs + 1,
        lastRunAt: at,
        lastFingerprint: report.fingerprint
      }
    }
  })
}

export function recordContextDebtDecision(
  state: ContextDebtExperimentState,
  report: Pick<ContextDebtReport, 'profile' | 'fingerprint'>,
  suggestionId: string,
  decision: ContextDebtDecision,
  at = Date.now()
): ContextDebtExperimentState {
  const current = state.profiles[report.profile.key] ?? { runs: 0, decisions: {} }
  return normalizeContextDebtExperimentState({
    ...state,
    profiles: {
      ...state.profiles,
      [report.profile.key]: {
        ...current,
        decisions: {
          ...current.decisions,
          [suggestionId]: {
            decision,
            fingerprint: report.fingerprint,
            decidedAt: at
          }
        }
      }
    }
  })
}

export function clearContextDebtDecision(
  state: ContextDebtExperimentState,
  profileKey: string,
  suggestionId: string
): ContextDebtExperimentState {
  const current = state.profiles[profileKey]
  if (!current?.decisions[suggestionId]) return state
  const decisions = { ...current.decisions }
  delete decisions[suggestionId]
  return normalizeContextDebtExperimentState({
    ...state,
    profiles: {
      ...state.profiles,
      [profileKey]: { ...current, decisions }
    }
  })
}

export function currentContextDebtDecisions(
  state: ContextDebtExperimentState,
  report: Pick<ContextDebtReport, 'profile' | 'fingerprint'>
): Record<string, ContextDebtDecisionRecord> {
  const profile = state.profiles[report.profile.key]
  if (!profile) return {}
  return Object.fromEntries(
    Object.entries(profile.decisions).filter(([, decision]) => decision.fingerprint === report.fingerprint)
  )
}

export function acceptedContextDebtSuggestionIds(
  state: ContextDebtExperimentState,
  report: Pick<ContextDebtReport, 'profile' | 'fingerprint'>
): string[] {
  return Object.entries(currentContextDebtDecisions(state, report))
    .filter(([, record]) => record.decision === 'accepted')
    .map(([id]) => id)
}
