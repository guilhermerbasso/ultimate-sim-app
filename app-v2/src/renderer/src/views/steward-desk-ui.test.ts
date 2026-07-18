import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { navSections } from '../navigation/navModel'
import { viewRegistry } from './registry'

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
  const linear = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  )
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrast(left: string, right: string): number {
  const values = [luminance(left), luminance(right)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

describe('Steward Desk navigation and accessibility', () => {
  it('registers the screen in a dedicated League Ops navigation section', () => {
    expect(viewRegistry.find((entry) => entry.id === 'steward-desk')).toMatchObject({
      group: 'League Ops',
      label: 'Steward Desk'
    })
    expect(navSections.find((section) => section.title === 'League Ops')?.viewIds).toContain('steward-desk')
  })

  it('exposes labeled landmarks, live integrity status, and the human-owner guardrail', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'StewardDeskView.tsx'),
      'utf8'
    )
    expect(source).toContain('aria-labelledby="steward-desk-title"')
    expect(source).toContain('aria-label={tt(language, \'steward.queueAria\')}')
    expect(source).toContain('role="status"')
    expect(source).toContain('aria-live="polite"')
    expect(source).toContain("tt(language, 'steward.owner.body')")
    expect(source).toContain("'steward.details.verified'")
    expect(source).toContain("tt(language, 'steward.drafts.confirmDiscard')")
    for (const field of [
      'windowBeforeSec',
      'provenance.producer',
      'ruleCitationIds',
      'requestedRemedy',
      'resolutionId'
    ]) {
      expect(source, field).toContain(field)
    }
  })

  it('keeps interactive control boundaries above the WCAG 3:1 non-text contrast floor', () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'steward-desk.css'),
      'utf8'
    )
    const border = css.match(/--steward-control-border:\s*(#[0-9a-f]{6})/i)?.[1]
    expect(border).toBeTruthy()
    expect(contrast(border as string, '#111111')).toBeGreaterThanOrEqual(3)
    expect(contrast(border as string, '#060606')).toBeGreaterThanOrEqual(3)
    expect(contrast('#e86920', '#211209')).toBeGreaterThanOrEqual(3)
    expect(contrast('#e86920', '#2f180b')).toBeGreaterThanOrEqual(3)
    expect(css).toContain('border: 1px solid var(--steward-control-border)')
    expect(css).toContain('border-color: var(--accent-primary)')
  })
})
