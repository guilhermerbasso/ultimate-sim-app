import type { DashboardSummary } from './dashboards'
import type { ButtonBoxSummary } from './touch-panel'
import {
  isStreamTargetSourceId,
  streamTargetSourceKey,
  type StreamTargetSettings,
  type StreamTargetSource
} from './stream-targets'
import type { StreamingLayoutKind, StreamingStatus } from './streaming'

export const STREAM_SOURCE_CHANNELS = {
  list: 'streaming:sources:list',
  add: 'streaming:sources:add',
  remove: 'streaming:sources:remove',
  updated: 'streaming:sources:updated'
} as const

export type StreamSourceIneligibleReason = 'missing' | 'hidden' | 'built-in' | 'invalid-id'

export interface StreamSourceRef {
  kind: StreamingLayoutKind
  id: string
}

export interface StreamSourceDescriptor extends StreamSourceRef {
  label: string
  eligible: boolean
  reason: StreamSourceIneligibleReason | null
  added: boolean
  active: boolean
}

export type StreamSourceMutationRequest = StreamSourceRef

type StreamSourceRuntimeStatus = Pick<StreamingStatus, 'running' | 'layoutKind' | 'layoutId'>

export interface BuildStreamSourceDescriptorOptions {
  includeUnaddedIneligible?: boolean
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function sourceLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed && trimmed.length <= 96 && !/[\u0000-\u001f\u007f]/.test(trimmed)
    ? trimmed
    : fallback
}

export function parseStreamSourceMutationRequest(value: unknown): StreamSourceMutationRequest | null {
  const record = recordOf(value)
  if (!record) return null
  const keys = Object.keys(record)
  if (keys.length !== 2 || !keys.includes('kind') || !keys.includes('id')) return null
  if (record.kind !== 'dashboard' && record.kind !== 'touch') return null
  if (typeof record.id !== 'string' || !isStreamTargetSourceId(record.id)) return null
  return { kind: record.kind, id: record.id }
}

export function parseStreamSourceRemovalRequest(value: unknown): StreamSourceMutationRequest | null {
  const record = recordOf(value)
  if (!record) return null
  const keys = Object.keys(record)
  if (keys.length !== 2 || !keys.includes('kind') || !keys.includes('id')) return null
  if (record.kind !== 'dashboard' && record.kind !== 'touch') return null
  if (typeof record.id !== 'string') return null
  const id = record.id.trim()
  if (!id || id.length > 256 || /[\u0000-\u001f\u007f]/.test(id)) return null
  return { kind: record.kind, id }
}

export function streamSourceRefsFromSettings(settings: StreamTargetSettings): StreamSourceRef[] {
  const seen = new Set<string>()
  const refs: StreamSourceRef[] = []
  for (const profile of settings.profiles) {
    const ref = { kind: profile.kind, id: profile.sourceId }
    const key = streamTargetSourceKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    refs.push(ref)
  }
  return refs
}

export function streamSourceIsAdded(
  settings: StreamTargetSettings,
  source: StreamSourceRef
): boolean {
  return settings.profiles.some((profile) =>
    profile.kind === source.kind && profile.sourceId === source.id
  )
}

function sourceReason(
  source: Pick<StreamSourceRef, 'id'> & { hidden?: boolean; builtIn?: boolean }
): StreamSourceIneligibleReason | null {
  if (!isStreamTargetSourceId(source.id)) return 'invalid-id'
  if (source.builtIn) return 'built-in'
  if (source.hidden) return 'hidden'
  return null
}

function activeSource(status: StreamSourceRuntimeStatus | null | undefined, source: StreamSourceRef): boolean {
  return Boolean(
    status?.running &&
    status.layoutKind === source.kind &&
    status.layoutId === source.id
  )
}

export function buildStreamSourceDescriptors(
  dashboards: readonly DashboardSummary[],
  touchPanels: readonly ButtonBoxSummary[],
  settings: StreamTargetSettings,
  status?: StreamSourceRuntimeStatus | null,
  options: BuildStreamSourceDescriptorOptions = {}
): StreamSourceDescriptor[] {
  const descriptors = new Map<string, StreamSourceDescriptor>()
  const addedLabels = new Map<string, string>()

  for (const profile of settings.profiles) {
    const key = streamTargetSourceKey({ kind: profile.kind, id: profile.sourceId })
    if (!addedLabels.has(key)) addedLabels.set(key, profile.label)
  }

  const addRegistrySource = (
    source: StreamTargetSource,
    state: { hidden?: boolean; builtIn?: boolean }
  ): void => {
    const key = streamTargetSourceKey(source)
    if (descriptors.has(key)) return
    const reason = sourceReason({ id: source.id, ...state })
    const added = addedLabels.has(key)
    if (reason !== null && !added && !options.includeUnaddedIneligible) return
    descriptors.set(key, {
      kind: source.kind,
      id: source.id,
      label: sourceLabel(source.label, source.id),
      eligible: reason === null,
      reason,
      added,
      active: activeSource(status, source)
    })
  }

  for (const dashboard of dashboards) {
    addRegistrySource(
      {
        kind: 'dashboard',
        id: String(dashboard.id),
        label: sourceLabel(dashboard.name, String(dashboard.id))
      },
      { hidden: Boolean(dashboard.hidden), builtIn: Boolean(dashboard.builtIn) }
    )
  }
  for (const panel of touchPanels) {
    addRegistrySource(
      {
        kind: 'touch',
        id: String(panel.id),
        label: sourceLabel(panel.name, String(panel.id))
      },
      { hidden: Boolean(panel.hidden) }
    )
  }

  for (const [key, label] of addedLabels) {
    if (descriptors.has(key)) continue
    const separator = key.indexOf(':')
    const kind = key.slice(0, separator) as StreamingLayoutKind
    const id = key.slice(separator + 1)
    const reason: StreamSourceIneligibleReason = isStreamTargetSourceId(id) ? 'missing' : 'invalid-id'
    descriptors.set(key, {
      kind,
      id,
      label: sourceLabel(label, id),
      eligible: false,
      reason,
      added: true,
      active: activeSource(status, { kind, id })
    })
  }

  return [...descriptors.values()].sort((left, right) =>
    Number(right.active) - Number(left.active) ||
    Number(right.added) - Number(left.added) ||
    Number(right.eligible) - Number(left.eligible) ||
    left.kind.localeCompare(right.kind) ||
    left.label.localeCompare(right.label) ||
    left.id.localeCompare(right.id)
  )
}
