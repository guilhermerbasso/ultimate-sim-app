// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { confirmTouchDraftDiscard, requestTouchPanelImport } from './TouchControlsView'

const DISCARD_MESSAGE = 'There are unsaved changes in this button box. Discard and switch panels?'

describe('Touch Controls dirty import guard', () => {
  it('does not open the file picker when discard is rejected', () => {
    const input = { click: vi.fn() }
    const confirm = vi.fn().mockReturnValue(false)

    expect(requestTouchPanelImport(input, true, DISCARD_MESSAGE, confirm)).toBe(false)
    expect(confirm).toHaveBeenCalledWith(DISCARD_MESSAGE)
    expect(input.click).not.toHaveBeenCalled()
  })

  it('opens the picker only after explicit dirty-draft confirmation', () => {
    const input = { click: vi.fn() }
    const confirm = vi.fn().mockReturnValue(true)

    expect(requestTouchPanelImport(input, true, DISCARD_MESSAGE, confirm)).toBe(true)
    expect(confirm).toHaveBeenCalledWith(DISCARD_MESSAGE)
    expect(input.click).toHaveBeenCalledTimes(1)
  })

  it('does not prompt when the draft is clean', () => {
    const input = { click: vi.fn() }
    const confirm = vi.fn()

    expect(requestTouchPanelImport(input, false, DISCARD_MESSAGE, confirm)).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    expect(input.click).toHaveBeenCalledTimes(1)
    expect(confirmTouchDraftDiscard(false, DISCARD_MESSAGE, confirm)).toBe(true)
  })
})