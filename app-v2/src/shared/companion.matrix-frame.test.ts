import { describe, expect, it } from 'vitest'
import {
  COMPANION_V2_MAX_COMMAND_LEN,
  COMPANION_V2_MAX_STREAM_LEN,
  formatMatrixRowRgb,
  formatStripRgb
} from './companion'

// Regression guard for the iFlag in-app TEST path. The 8x8 panel is sent as ONE
// atomic `P` pixel-stream frame; the generic matrix firmware reads `P` frames
// character-by-character (bypassing its line buffer), so the app must let a full
// 64-LED `P` frame through even though it exceeds the per-LINE command ceiling.
// If this relationship ever breaks, in-app tests silently render nothing.
describe('matrix frame wire sizes', () => {
  const full = Array.from({ length: 64 }, () => '#ff8800')

  it('a full 64-LED P frame exceeds the per-line cap but fits the stream cap', () => {
    const frame = formatStripRgb(full)
    expect(frame).not.toBeNull()
    const len = (frame as string).length
    // P + 64 * 6 hex = 385.
    expect(len).toBe(385)
    expect(len).toBeGreaterThan(COMPANION_V2_MAX_COMMAND_LEN)
    expect(len).toBeLessThanOrEqual(COMPANION_V2_MAX_STREAM_LEN)
  })

  it('a single Q row always fits within the per-line cap', () => {
    const row = formatMatrixRowRgb(0, full.slice(0, 8), 8)
    expect(row.length).toBeLessThanOrEqual(COMPANION_V2_MAX_COMMAND_LEN)
  })

  it('the stream cap is larger than the per-line cap', () => {
    expect(COMPANION_V2_MAX_STREAM_LEN).toBeGreaterThan(COMPANION_V2_MAX_COMMAND_LEN)
  })
})
