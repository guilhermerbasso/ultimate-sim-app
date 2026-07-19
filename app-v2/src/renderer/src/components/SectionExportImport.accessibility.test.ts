// @vitest-environment jsdom

import { createElement } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CONFIG_IO_CHANNELS } from '../../../shared/config-io'
import { SectionExportImport } from './SectionExportImport'

describe('SectionExportImport accessibility errors', () => {
  it('shows strict import rejection and never reports a successful apply', async () => {
    const onImported = vi.fn()
    const invoke = vi.fn(async (channel: string) => {
      if (channel === CONFIG_IO_CHANNELS.importSection) {
        throw new Error(
          'Invalid accessibility cue import at store: unknown field "future".'
        )
      }
      return undefined
    })
    Object.defineProperty(window, 'ipc', {
      configurable: true,
      value: {
        invoke,
        subscribe: vi.fn(() => () => undefined)
      }
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(
      createElement(SectionExportImport, {
        sectionId: 'accessibility-cues',
        label: 'Accessibility cue profiles',
        language: 'en',
        onImported
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    expect(
      await screen.findByText(/Invalid accessibility cue import/)
    ).toBeTruthy()
    expect(onImported).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith(
      CONFIG_IO_CHANNELS.importSection,
      'accessibility-cues'
    )
  })
})
