// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createButtonBoxPanel, type ButtonBoxPanel } from '../../../shared/touch-panel'
import { ButtonBoxEditor } from './ButtonBoxEditor'

const invoke = vi.fn(async (channel: string) => {
  if (channel === 'expr:getExpressions') return [{ id: 'expr-active', name: 'Engine running', expr: 'rpm > 0' }]
  if (channel === 'expr:getResults') return {}
  return null
})

beforeEach(() => {
  invoke.mockClear()
  Object.defineProperty(window, 'ipc', {
    configurable: true,
    value: { invoke, subscribe: vi.fn(() => () => {}) }
  })
})

afterEach(cleanup)

function setup() {
  const panel = createButtonBoxPanel({
    id: 'editor-panel',
    columns: 1,
    rows: 1,
    buttons: [{ id: 'edited-control', label: 'LIMITER' }]
  })
  const changes: ButtonBoxPanel[] = []
  render(
    createElement(ButtonBoxEditor, {
      panel,
      selectedId: 'edited-control',
      onChange: (next) => { changes.push(next) },
      onSelect: vi.fn()
    })
  )
  return { panel, changes }
}

describe('ButtonBoxEditor semantic UX', () => {
  it('edits control semantics independently from visual family and shape', () => {
    const { changes } = setup()
    fireEvent.change(screen.getByRole('combobox', { name: 'Control semantics' }), { target: { value: 'rotary' } })
    expect(changes.at(-1)?.buttons[0].control.kind).toBe('rotary')

    fireEvent.change(screen.getByRole('combobox', { name: 'Button shape' }), { target: { value: 'pill' } })
    expect(changes.at(-1)?.buttons[0].shape).toBe('pill')

    fireEvent.change(screen.getByRole('combobox', { name: 'Visual family' }), { target: { value: 'carbon' } })
    expect(changes.at(-1)?.buttons[0].material).toBe('carbon')
  })

  it('offers a safe interactive preview without dispatching IPC actions', () => {
    setup()
    const preview = screen.getByRole('button', { name: 'Interact with preview' })
    fireEvent.click(preview)
    expect(screen.getByRole('button', { name: 'Exit preview' }).getAttribute('aria-pressed')).toBe('true')
    expect(invoke).not.toHaveBeenCalledWith('actions:testEmulation', expect.anything())
  })

  it('binds exact state destinations to existing expression ids', async () => {
    const { changes } = setup()
    const select = await screen.findByLabelText('Active expression')
    await waitFor(() => expect(select.querySelector('option[value="expr-active"]')).toBeTruthy())
    fireEvent.change(select, { target: { value: 'expr-active' } })
    expect(changes.at(-1)?.buttons[0].stateBindings?.active).toEqual({
      source: 'expression',
      expressionId: 'expr-active'
    })
  })

  it('clears a cell with a non-action value tile instead of breaking grid capacity', () => {
    const { changes } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Clear control cell' }))
    const next = changes.at(-1)
    expect(next?.buttons).toHaveLength(1)
    expect(next?.buttons[0].control.kind).toBe('value-tile')
  })
})