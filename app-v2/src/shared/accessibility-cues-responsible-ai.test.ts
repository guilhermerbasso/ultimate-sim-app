import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('accessibility cue Responsible-AI ADR', () => {
  it('records the non-inference, readiness, isolation, and cohort gates', () => {
    const adr = readFileSync(
      new URL('../../docs/ADR-ACCESSIBILITY-CUE-RESPONSIBLE-AI.md', import.meta.url),
      'utf8'
    )
    expect(adr).toContain('Never infer disability')
    expect(adr).toContain('Fail closed until the persisted profile is ready')
    expect(adr).toContain('Preview uses isolated speech')
    expect(adr).toContain('preregistered target-user testing')
    expect(adr).toContain('Evolution log')
  })
})
