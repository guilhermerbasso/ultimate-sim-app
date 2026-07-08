import { describe, expect, it } from 'vitest'
import { getInteractiveTrackMapFrameSize } from './TrackCoachingHeatmap'

describe('getInteractiveTrackMapFrameSize', () => {
  it('shrinks and grows the allocated map frame with zoom', () => {
    const zoomedOut = getInteractiveTrackMapFrameSize(0.5)
    const fit = getInteractiveTrackMapFrameSize(1)
    const zoomedIn = getInteractiveTrackMapFrameSize(2)

    expect(zoomedOut.widthPx).toBeLessThan(fit.widthPx)
    expect(zoomedOut.heightPx).toBeLessThan(fit.heightPx)
    expect(zoomedIn.widthPx).toBeGreaterThan(fit.widthPx)
    expect(zoomedIn.heightPx).toBeGreaterThan(fit.heightPx)
  })

  it('keeps the frame within readable bounds', () => {
    expect(getInteractiveTrackMapFrameSize(0.01)).toEqual({ widthPx: 360, heightPx: 220 })
    expect(getInteractiveTrackMapFrameSize(999)).toEqual({ widthPx: 1180, heightPx: 760 })
    expect(getInteractiveTrackMapFrameSize(Number.NaN)).toEqual({ widthPx: 720, heightPx: 360 })
  })
})
