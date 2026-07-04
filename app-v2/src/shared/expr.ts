import type { OutputTarget } from './outputs'

export interface ExpressionDef {
  id: string
  name: string
  expr: string
  // Optional list of OUTPUT TARGETS that this expression should publish into.
  // When present, the expression engine evaluates the value live and the
  // ExpressionsView upserts matching OutputRoutes (see route id convention
  // `expr:<exprId>:<targetKind>`) so consumers (dashboards, overlays, serial,
  // second screen) can bind without each having to know the expression.
  targets?: OutputTarget[]
  // Optional override for the published variable name used by dashboardVar /
  // overlay targets when the renderer needs to slug the expression name. When
  // omitted, callers should derive a slug from `name` (falling back to `id`).
  outputName?: string
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
}

// Batched payload broadcast on `expr:results` (~10Hz). Keyed by `ExpressionDef.id`.
export interface ExpressionResultsBatch {
  results: Record<string, ExpressionResultEntry>
  timestamp: number
}

// Canonical IPC channel names for the expression engine. Kept here so renderer
// and main agree on a single source of truth.
export const EXPR_CHANNELS = {
  getExpressions: 'expr:getExpressions',
  setExpressions: 'expr:setExpressions',
  getEnabledVars: 'expr:getEnabledVars',
  setEnabledVars: 'expr:setEnabledVars',
  evaluate: 'expr:evaluate',
  getResults: 'expr:getResults',
  // Broadcast channel (main → renderers).
  results: 'expr:results'
} as const

export type ExprChannel = (typeof EXPR_CHANNELS)[keyof typeof EXPR_CHANNELS]
