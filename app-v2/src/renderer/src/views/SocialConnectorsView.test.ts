import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { buildMockCapabilityMatrix } from '../../../shared/social-connectors'
import type { AppViewProps } from '../App'
import { navSections } from '../navigation/navModel'
import SocialConnectorsView, { rowsForProvider } from './SocialConnectorsView'

describe('SocialConnectorsView', () => {
  it('renders the mock-only capability and policy status matrix', () => {
    const markup = renderToStaticMarkup(
      createElement(SocialConnectorsView, {
        showToast: vi.fn()
      } as unknown as AppViewProps)
    )

    expect(markup).toContain('Social connector capability matrix')
    expect(markup).toContain('Twitch')
    expect(markup).toContain('YouTube')
    expect(markup).toContain('Discord')
    expect(markup).toContain('twitch.eventsub.ingest')
    expect(markup).toContain('youtube.broadcast.manage')
    expect(markup).toContain('discord.room.create')
    expect(markup).toContain('Merged chat output blocked')
    expect(markup).toContain('No credentials, OAuth tokens, network transport')
    expect(markup).toContain('Unavailable by design')
    expect(markup).not.toContain('<input')
    expect(markup).not.toContain('<button')
    expect(markup).not.toContain('http://')
    expect(markup).not.toContain('https://')
  })

  it('keeps every requested provider capability visible and navigable', () => {
    const rows = buildMockCapabilityMatrix()

    expect(rowsForProvider(rows, 'twitch')).toHaveLength(7)
    expect(rowsForProvider(rows, 'youtube')).toHaveLength(5)
    expect(rowsForProvider(rows, 'discord')).toHaveLength(4)
    expect(
      navSections.find((section) => section.title === 'Broadcast')?.viewIds
    ).toContain('social-connectors')
  })
})
