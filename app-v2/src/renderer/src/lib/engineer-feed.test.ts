import { describe, expect, it } from 'vitest'
import { engineerFeedScope, type EngineerFeedItem } from './engineer-feed'

function item(overrides: Partial<EngineerFeedItem>): EngineerFeedItem {
  return {
    id: 'item',
    at: 1,
    text: 'message',
    source: 'proactive',
    ...overrides
  }
}

describe('engineerFeedScope', () => {
  it('renders no-data qualifying events as Quali rather than a fabricated sector', () => {
    expect(engineerFeedScope(item({ eventType: 'insufficient-history' }))).toBe('Quali')
    expect(engineerFeedScope(item({ eventType: 'quali-briefing' }))).toBe('Quali')
  })

  it('keeps genuine finding and race-status scopes distinct', () => {
    expect(engineerFeedScope(item({ eventType: 'finding', sector: 2 }))).toBe('Sector 2')
    expect(engineerFeedScope(item({ eventType: 'race-status' }))).toBe('Race')
    expect(engineerFeedScope(item({}))).toBe('Info')
  })
})
