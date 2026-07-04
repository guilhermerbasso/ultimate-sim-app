import { describe, expect, it, vi } from 'vitest'

// pace-model.ts transitively imports ./logger (and ./predictions → ./logger), which
// imports `electron` for the in-app save/open helpers. Those are never touched at
// import time, so a tiny stub lets us unit-test the pure `modelKey` helper in node.
vi.mock('electron', () => ({ dialog: {}, shell: {}, app: {} }))

import { modelKey } from './pace-model'

// N1 — the pace learner must NOT share one model across track LAYOUTS. modelKey
// folds the iRacing TrackConfigName into the key so two configs of one track get
// independent learners (and the outlier gate no longer rejects the other layout's
// laps), while staying backward-compatible when there is no config.
describe('modelKey (car + track + layout)', () => {
  it('returns null when car or track is missing', () => {
    expect(modelKey(undefined, 'Silverstone')).toBeNull()
    expect(modelKey('Ferrari 296', undefined)).toBeNull()
    expect(modelKey('   ', 'Silverstone')).toBeNull()
    expect(modelKey('Ferrari 296', '   ')).toBeNull()
  })

  it('is `car__track` when no layout is given (backward-compatible)', () => {
    expect(modelKey('Ferrari 296 GT3', 'Silverstone Circuit')).toBe('ferrari-296-gt3__silverstone-circuit')
    // An empty/whitespace config must NOT change the legacy key.
    expect(modelKey('Ferrari 296 GT3', 'Silverstone Circuit', '   ')).toBe('ferrari-296-gt3__silverstone-circuit')
    expect(modelKey('Ferrari 296 GT3', 'Silverstone Circuit', undefined)).toBe(
      'ferrari-296-gt3__silverstone-circuit'
    )
  })

  it('separates two LAYOUTS of the same track', () => {
    const gp = modelKey('Ferrari 296 GT3', 'Silverstone Circuit', 'Grand Prix')
    const intl = modelKey('Ferrari 296 GT3', 'Silverstone Circuit', 'International')
    expect(gp).toBe('ferrari-296-gt3__silverstone-circuit__grand-prix')
    expect(intl).toBe('ferrari-296-gt3__silverstone-circuit__international')
    expect(gp).not.toBe(intl)
  })

  it('normalises punctuation/spacing into a filesystem-safe key', () => {
    expect(modelKey('Porsche 911 GT3 R (992)', 'Nürburgring', 'Combined VLN')).toBe(
      'porsche-911-gt3-r-992__n-rburgring__combined-vln'
    )
  })
})
