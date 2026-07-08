import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { HifiAiContext } from '../types'
import { AI_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

const mockAi: HifiAiContext = {
  coachTip: { text: 'Smooth out turn entry and release the brake earlier.', corner: 'T4', confidence: 0.82 },
  coachFindings: [
    { label: 'Braking Too Late', severity: 'high' },
    { label: 'Throttle Application', severity: 'med' },
    { label: 'Racing Line Consistency', severity: 'low' }
  ],
  engineerRadio: { text: 'Tyres are holding up well.' },
  proactiveAlert: { text: 'Track temperature rising.', level: 'warn' },
  strategy: { text: 'Box for tyres soon.', pitInLaps: 3 },
  confidence: 0.87
}

function renderAll(ai: HifiAiContext | null): string[] {
  return AI_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot: null, ai, width: widget.defaultSize.w, height: widget.defaultSize.h })))
}

describe('AI_WIDGETS', () => {
  it('has unique ids and universal requirements', () => {
    const ids = AI_WIDGETS.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(AI_WIDGETS.every((widget) => widget.category === 'ai')).toBe(true)
    expect(AI_WIDGETS.every((widget) => widget.requires.length === 0)).toBe(true)
  })

  it('renders populated ai, null ai, and null snapshot without unsafe tokens', () => {
    const nullSnapshot = AI_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot: null, ai: mockAi })))
    for (const markup of [...renderAll(mockAi), ...renderAll(null), ...nullSnapshot]) {
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })

  it('shows intentional placeholders when ai is null', () => {
    const markup = renderAll(null).join('\n')
    expect(markup).toContain('Awaiting AI')
    expect(markup).toContain('—')
  })
})
