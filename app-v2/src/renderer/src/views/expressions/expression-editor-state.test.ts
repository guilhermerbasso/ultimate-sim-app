import { describe, expect, it } from 'vitest'
import {
  expressionEditorFor,
  isExpressionEditorDirty,
  newExpressionEditor,
  reconcileExpressionEditor
} from './expression-editor-state'

const saved = { id: 'expr-1', name: 'Saved', expr: 'speedKmh' }
const blank = () => ({ id: 'new-id', name: 'New expression', expr: 'rpm' })

describe('Expression Studio editor reconciliation', () => {
  it('updates the selected persisted expression when the draft is clean', () => {
    const current = expressionEditorFor(saved)
    const remote = { ...saved, name: 'Renamed remotely', expr: 'speedKmh * 2' }

    const next = reconcileExpressionEditor(current, [remote], blank)

    expect(next).toEqual(expressionEditorFor(remote))
    expect(isExpressionEditorDirty(next)).toBe(false)
  })

  it('retains every dirty draft field across self-originated studioChanged broadcasts', () => {
    const current = {
      ...expressionEditorFor(saved),
      draft: { ...saved, name: 'Local dirty name', expr: 'speedKmh + 7' }
    }
    const broadcastExpressions = [{ ...saved }]

    const next = reconcileExpressionEditor(current, broadcastExpressions, blank)

    expect(next).toBe(current)
    expect(next.selectedId).toBe('expr-1')
    expect(next.draft).toEqual({
      id: 'expr-1',
      name: 'Local dirty name',
      expr: 'speedKmh + 7'
    })
  })

  it('retains a new unsaved draft identity and fields when persisted selection changes', () => {
    const current = newExpressionEditor({
      id: 'unsaved-stable-id',
      name: 'My unsaved expression',
      expr: 'brake > 0.5'
    })

    const next = reconcileExpressionEditor(current, [saved], blank)

    expect(next).toBe(current)
    expect(next.selectedId).toBeNull()
    expect(next.draft).toEqual({
      id: 'unsaved-stable-id',
      name: 'My unsaved expression',
      expr: 'brake > 0.5'
    })
  })

  it('moves a clean deleted selection to the first persisted expression', () => {
    const current = expressionEditorFor(saved)
    const remaining = { id: 'expr-2', name: 'Remaining', expr: 'rpm' }

    expect(reconcileExpressionEditor(current, [remaining], blank)).toEqual(
      expressionEditorFor(remaining)
    )
  })
})
