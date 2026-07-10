import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  emptyBaseline,
  isValidCoachBaseline,
  type CoachBaseline
} from '../../shared/coach-baseline'

const STORE_FILE = 'coach-baselines.json'
const STORE_VERSION = 1 as const

interface CoachBaselineFile {
  version: typeof STORE_VERSION
  baselines: Record<string, CoachBaseline>
}

export class CoachBaselineStore {
  private readonly filePath: string
  private readonly baselines = new Map<string, CoachBaseline>()

  constructor(userDataDir: string) {
    this.filePath = join(userDataDir, STORE_FILE)
    this.load()
  }

  get(trackLayoutKey: string, carName?: string): CoachBaseline {
    const key = baselineKey(trackLayoutKey, carName)
    return cloneBaseline(this.baselines.get(key) ?? emptyBaseline(trackLayoutKey, carName))
  }

  put(baseline: CoachBaseline): void {
    if (!isValidCoachBaseline(baseline)) return
    const next = cloneBaseline({ ...baseline, updatedAt: Date.now() })
    this.baselines.set(baselineKey(next.trackLayoutKey, next.carName), next)
    this.save()
  }

  all(): CoachBaseline[] {
    return [...this.baselines.values()].map(cloneBaseline)
  }

  save(): void {
    const payload: CoachBaselineFile = {
      version: STORE_VERSION,
      baselines: Object.fromEntries(this.baselines.entries())
    }
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    renameSync(tmpPath, this.filePath)
  }

  private load(): void {
    try {
      const raw = readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      this.baselines.clear()
      if (!isStoreFile(parsed)) return
      for (const [key, baseline] of Object.entries(parsed.baselines)) {
        if (isValidCoachBaseline(baseline)) {
          this.baselines.set(key, cloneBaseline(baseline))
        }
      }
    } catch {
      this.baselines.clear()
    }
  }
}

function baselineKey(trackLayoutKey: string, carName?: string): string {
  const track = (trackLayoutKey ?? '').trim()
  const car = (carName ?? '').trim()
  return `${track}::${car}`
}

function isStoreFile(value: unknown): value is CoachBaselineFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Partial<CoachBaselineFile>).version === STORE_VERSION &&
    typeof (value as Partial<CoachBaselineFile>).baselines === 'object' &&
    (value as Partial<CoachBaselineFile>).baselines !== null
  )
}

function cloneBaseline(baseline: CoachBaseline): CoachBaseline {
  return JSON.parse(JSON.stringify(baseline)) as CoachBaseline
}
