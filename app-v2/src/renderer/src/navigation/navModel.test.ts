import { describe, expect, it } from 'vitest'
import { navSections } from './navModel'
import { viewRegistry } from '../views/registry'

describe('SP-07 navigation', () => {
  it('registers the context-debt screen exactly once with a unique shortcut', () => {
    const routeCount = navSections.flatMap((section) => section.viewIds)
      .filter((viewId) => viewId === 'context-debt')
      .length
    const views = viewRegistry.filter((view) => view.id === 'context-debt')

    expect(routeCount).toBe(1)
    expect(views).toHaveLength(1)
    expect(viewRegistry.filter((view) => view.shortcut === views[0].shortcut)).toHaveLength(1)
  })
})
