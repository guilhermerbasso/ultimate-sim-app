// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SpeechLanguage } from '../../../../shared/tts-voice'
import type { StintDebrief as StintDebriefPayload } from '../../../../shared/stint-debrief'

const mocks = vi.hoisted(() => ({
  generateDebrief: vi.fn(),
  getLastDebrief: vi.fn(),
  speakViaTts: vi.fn(),
  subscribeDebrief: vi.fn(() => () => undefined)
}))

vi.mock('../../lib/stint-debrief', () => ({
  generateDebrief: mocks.generateDebrief,
  getLastDebrief: mocks.getLastDebrief,
  subscribeDebrief: mocks.subscribeDebrief
}))

vi.mock('../../lib/tts-runtime', () => ({
  speakViaTts: mocks.speakViaTts
}))

import StintDebrief from './StintDebrief'

function debrief(language: SpeechLanguage): StintDebriefPayload {
  return {
    generatedAt: 1_000,
    text: language === 'pt-BR' ? 'Resumo persistido.' : 'Persisted debrief.',
    bullets: [language === 'pt-BR' ? '✅ Curva 1' : '✅ Turn 1'],
    source: 'deterministic',
    language,
    reason: 'manual'
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('StintDebrief playback language', () => {
  it.each<SpeechLanguage>(['pt-BR', 'en-US'])(
    'uses the persisted %s language for TTS playback',
    async (language) => {
      const persisted = debrief(language)
      mocks.getLastDebrief.mockResolvedValue(persisted)
      mocks.speakViaTts.mockResolvedValue(undefined)

      render(React.createElement(StintDebrief))
      await screen.findByText(persisted.text)
      fireEvent.click(screen.getByRole('button', { name: /Ouvir/ }))

      await waitFor(() => {
        expect(mocks.speakViaTts).toHaveBeenCalledWith(
          `${persisted.text}. ${persisted.bullets[0]}`,
          { lang: language, source: 'coach' }
        )
      })
    }
  )
})
