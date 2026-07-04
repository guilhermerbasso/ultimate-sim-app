// WS-K — Renderer helper for the semantic search feature. Thin, typed wrapper
// around `window.ipc` for the `search:*` channels so the view stays declarative.
// No React here — just IPC plumbing.

import {
  SEMANTIC_SEARCH_CHANNELS,
  type SemanticIndexStatus,
  type SemanticModelProgress,
  type SemanticQueryArgs,
  type SemanticQueryResult
} from '../../../shared/semantic-search-ipc'

export async function getSearchStatus(): Promise<SemanticIndexStatus> {
  return window.ipc.invoke<SemanticIndexStatus>(SEMANTIC_SEARCH_CHANNELS.status)
}

export async function runSearch(args: SemanticQueryArgs): Promise<SemanticQueryResult> {
  return window.ipc.invoke<SemanticQueryResult>(SEMANTIC_SEARCH_CHANNELS.query, args)
}

/** Triggers the on-demand model download/load; resolves with the new status. */
export async function ensureSearchModel(): Promise<SemanticIndexStatus> {
  return window.ipc.invoke<SemanticIndexStatus>(SEMANTIC_SEARCH_CHANNELS.ensureModel)
}

export async function reindexSearch(): Promise<SemanticIndexStatus> {
  return window.ipc.invoke<SemanticIndexStatus>(SEMANTIC_SEARCH_CHANNELS.reindex)
}

export function onModelProgress(cb: (p: SemanticModelProgress) => void): () => void {
  return window.ipc.subscribe<SemanticModelProgress>(SEMANTIC_SEARCH_CHANNELS.modelProgress, cb)
}

export function onStatusChanged(cb: (s: SemanticIndexStatus) => void): () => void {
  return window.ipc.subscribe<SemanticIndexStatus>(SEMANTIC_SEARCH_CHANNELS.changed, cb)
}
