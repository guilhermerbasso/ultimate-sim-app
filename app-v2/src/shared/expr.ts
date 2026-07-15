export interface ExpressionDef {
  id: string
  name: string
  expr: string
}

export type ExpressionValue = number | boolean | string | null

export type ExpressionScope = Record<string, ExpressionValue | undefined>

export interface ExpressionEvaluation {
  value: ExpressionValue
}

export type EnabledIracingVars = string[]

// Single expression result entry — emitted batched on `expr:results`.
export interface ExpressionResultEntry {
  name: string
  value: ExpressionValue
  // Deletion tombstone. Consumers must evict both id and name caches instead of
  // retaining the last value for a deleted expression.
  deleted?: true
}

// Batched payload broadcast on `expr:results` (~10Hz). Keyed by `ExpressionDef.id`.
export interface ExpressionResultsBatch {
  results: Record<string, ExpressionResultEntry>
  timestamp: number
}

// Canonical IPC channel names for the expression engine. Kept here so renderer
// and main agree on a single source of truth.
export const EXPR_CHANNELS = {
  getStudio: 'expr:getStudio',
  mutateStudio: 'expr:mutateStudio',
  getPlacements: 'expr:getPlacements',
  getExpressions: 'expr:getExpressions',
  setExpressions: 'expr:setExpressions',
  getEnabledVars: 'expr:getEnabledVars',
  setEnabledVars: 'expr:setEnabledVars',
  evaluate: 'expr:evaluate',
  getResults: 'expr:getResults',
  // Broadcast channel (main → renderers).
  results: 'expr:results',
  studioChanged: 'expr:studioChanged'
} as const

export type ExprChannel = (typeof EXPR_CHANNELS)[keyof typeof EXPR_CHANNELS]
