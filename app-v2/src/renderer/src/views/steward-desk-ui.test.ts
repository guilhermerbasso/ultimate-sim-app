import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { navSections } from '../navigation/navModel'
import { viewRegistry } from './registry'

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
  })
})
