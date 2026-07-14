import { useEffect, useMemo, useState } from 'react'
import { EXPR_CHANNELS, type ExpressionResultEntry, type ExpressionResultsBatch, type ExpressionValue } from '../../../shared/expr'
import type { ButtonBoxButton } from '../../../shared/touch-panel'

/**
 * Read-only adapter over the canonical expression engine. It stores only the
 * latest values needed by this mounted panel; expression definitions/evaluation
 * remain exclusively in the existing main-process store.
 */
export function useTouchExpressionValues(
  buttons: ReadonlyArray<ButtonBoxButton> | undefined
): Readonly<Record<string, ExpressionValue | undefined>> {
  const ids = useMemo(() => {
    const found = new Set<string>()
    for (const button of buttons ?? []) {
      for (const binding of Object.values(button.stateBindings ?? {})) {
        if (binding?.source === 'expression') found.add(binding.expressionId)
      }
    }
    return [...found].sort()
  }, [buttons])
  const idsKey = ids.join('\u0001')
  const [values, setValues] = useState<Record<string, ExpressionValue | undefined>>({})

  useEffect(() => {
    if (ids.length === 0 || typeof window.ipc?.invoke !== 'function') {
      setValues({})
      return
    }
    let alive = true
    const wanted = new Set(ids)
    const merge = (entries: Record<string, ExpressionResultEntry>): void => {
      if (!alive) return
      setValues((current) => {
        const next: Record<string, ExpressionValue | undefined> = {}
        for (const id of wanted) next[id] = entries[id]?.value ?? current[id]
        return next
      })
    }
    void window.ipc
      .invoke<Record<string, ExpressionResultEntry>>(EXPR_CHANNELS.getResults)
      .then(merge)
      .catch(() => undefined)
    const unsubscribe = window.ipc.subscribe<ExpressionResultsBatch>(EXPR_CHANNELS.results, (batch) => {
      if (batch && typeof batch === 'object' && batch.results) merge(batch.results)
    })
    return () => {
      alive = false
      unsubscribe()
    }
    // idsKey is a stable semantic dependency; `ids` is reconstructed with buttons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

  return values
}