import type { ExpressionDef } from '../../../../shared/expr'

export interface ExpressionEditorState {
  selectedId: string | null
  draft: ExpressionDef
  persisted: ExpressionDef | null
}

export function expressionEditorFor(item: ExpressionDef): ExpressionEditorState {
  return {
    selectedId: item.id,
    draft: { ...item },
    persisted: { ...item }
  }
}

export function newExpressionEditor(draft: ExpressionDef): ExpressionEditorState {
  return {
    selectedId: null,
    draft: { ...draft },
    persisted: null
  }
}

export function isExpressionEditorDirty(state: ExpressionEditorState): boolean {
  if (state.selectedId === null || !state.persisted) return true
  return !sameExpression(state.draft, state.persisted)
}

export function reconcileExpressionEditor(
  state: ExpressionEditorState,
  expressions: readonly ExpressionDef[],
  createBlank: () => ExpressionDef
): ExpressionEditorState {
  // Broadcasts also follow variable/output/destination mutations from this same
  // view. A local draft is editor-owned until it is saved or another expression
  // is explicitly selected.
  if (isExpressionEditorDirty(state)) return state

  const selected = state.selectedId
    ? expressions.find((expression) => expression.id === state.selectedId)
    : undefined
  if (selected) return expressionEditorFor(selected)

  const first = expressions[0]
  return first ? expressionEditorFor(first) : newExpressionEditor(createBlank())
}

function sameExpression(left: ExpressionDef, right: ExpressionDef): boolean {
  return left.id === right.id && left.name === right.name && left.expr === right.expr
}
