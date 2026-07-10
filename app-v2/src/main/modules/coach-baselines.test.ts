import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { emptyBaseline, updateRobustMetric } from '../../shared/coach-baseline'
import { CoachBaselineStore } from './coach-baselines'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'coach-baselines-test-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

describe('CoachBaselineStore', () => {
  it('round-trips baselines across store instances', () => {
    const dir = tempDir()
    const baseline = emptyBaseline('Spa :: GP', 'Ferrari 488 GT3')
    baseline.corners['1'] = { brakePoint: updateRobustMetric(undefined, 123) }

    new CoachBaselineStore(dir).put(baseline)
    const loaded = new CoachBaselineStore(dir).get('Spa :: GP', 'Ferrari 488 GT3')

    expect(loaded.trackLayoutKey).toBe('Spa :: GP')
    expect(loaded.carName).toBe('Ferrari 488 GT3')
    expect(loaded.corners['1'].brakePoint.median).toBe(123)
    expect(new CoachBaselineStore(dir).all()).toHaveLength(1)
  })

  it('treats corrupt files as an empty store', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'coach-baselines.json'), '{not-json', 'utf8')

    expect(new CoachBaselineStore(dir).all()).toEqual([])
  })

  it('treats version mismatches as an empty store', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'coach-baselines.json'), JSON.stringify({ version: 999, baselines: {} }), 'utf8')

    expect(new CoachBaselineStore(dir).all()).toEqual([])
  })
})
