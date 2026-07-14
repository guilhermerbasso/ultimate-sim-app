import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./touchpanel.ts', import.meta.url), 'utf8')

describe('touch panel preload least privilege', () => {
  it('allows only exact hold and read-only expression channels', () => {
    expect(source).toContain("'actions:touchKeyboardHold'")
    expect(source).toContain("'expr:getResults'")
    expect(source).toContain("'expr:results'")
    expect(source).not.toContain("'expr:getExpressions'")
    expect(source).not.toContain("'expr:setExpressions'")
  })

  it('does not grant the mutable touchpanel prefix or any gamepad API', () => {
    expect(source).toContain('const ALLOWED_PREFIXES: string[] = []')
    expect(source).not.toMatch(/ALLOWED_PREFIXES\s*=\s*\[[^\]]*app:touchpanel:/s)
    expect(source).not.toContain('gamepad')
    expect(source).not.toContain('actions:trigger')
    expect(source).not.toContain('actions:setBindings')
  })
})