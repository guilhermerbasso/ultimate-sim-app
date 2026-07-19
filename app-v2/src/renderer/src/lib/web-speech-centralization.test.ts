import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Web Speech centralization', () => {
  it('keeps direct speak/cancel ownership inside the shared scheduler', () => {
    for (const relative of ['./tts-runtime.ts', './spotter-runtime.ts']) {
      const source = readFileSync(new URL(relative, import.meta.url), 'utf8')
      expect(source).not.toMatch(/speechSynthesis\.(?:speak|cancel)\s*\(/)
      expect(source).toContain('getSharedWebSpeechScheduler')
    }
    const scheduler = readFileSync(
      new URL('./web-speech-scheduler.ts', import.meta.url),
      'utf8'
    )
    expect(scheduler).toMatch(/speechSynthesis\.speak\s*\(/)
    expect(scheduler).toMatch(/speechSynthesis\.cancel\s*\(/)
  })
})
