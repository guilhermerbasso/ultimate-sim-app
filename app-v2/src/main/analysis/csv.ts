import type { AnalysisLapSample } from '../../shared/recording'

const DIST_COLUMNS = ['lapdistpct', 'dist', 'distance']
const SPEED_COLUMNS = ['speedkmh', 'speed']
const THROTTLE_COLUMNS = ['throttle']
const BRAKE_COLUMNS = ['brake']
const TIME_COLUMNS = ['currentlaptimesec', 'time', 'laptime']

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        quoted = !quoted
      }
    } else if (ch === ',' && !quoted) {
      out.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  out.push(current.trim())
  return out
}

function parseNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const cleaned = raw.trim().replace(',', '.')
  if (!cleaned) return undefined
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : undefined
}

function findColumn(headers: string[], candidates: string[]): number {
  return headers.findIndex((header) => candidates.includes(header))
}

function normalizePct(value: number): number {
  return Math.max(0, Math.min(1, value > 1 ? value / 100 : value))
}

export function parseAnalysisCsv(text: string): AnalysisLapSample[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 2) throw new Error('CSV must include a header and at least one data row.')

  const headers = parseCsvLine(lines[0]).map(normalizeHeader)
  const distIdx = findColumn(headers, DIST_COLUMNS)
  const speedIdx = findColumn(headers, SPEED_COLUMNS)
  const throttleIdx = findColumn(headers, THROTTLE_COLUMNS)
  const brakeIdx = findColumn(headers, BRAKE_COLUMNS)
  const timeIdx = findColumn(headers, TIME_COLUMNS)
  const rpmIdx = findColumn(headers, ['rpm'])
  const gearIdx = findColumn(headers, ['gear'])

  if (distIdx < 0 || speedIdx < 0 || throttleIdx < 0 || brakeIdx < 0) {
    throw new Error('CSV must include distance, speed, throttle, and brake columns.')
  }

  const samples: AnalysisLapSample[] = []
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line)
    const dist = parseNumber(cols[distIdx])
    const speedKmh = parseNumber(cols[speedIdx])
    const throttle = parseNumber(cols[throttleIdx])
    const brake = parseNumber(cols[brakeIdx])
    if (dist === undefined || speedKmh === undefined || throttle === undefined || brake === undefined) continue
    samples.push({
      lapDistPct: normalizePct(dist),
      speedKmh: Math.max(0, speedKmh),
      throttle: normalizePct(throttle),
      brake: normalizePct(brake),
      currentLapTimeSec: timeIdx >= 0 ? parseNumber(cols[timeIdx]) : undefined,
      rpm: rpmIdx >= 0 ? parseNumber(cols[rpmIdx]) : undefined,
      gear: gearIdx >= 0 ? parseNumber(cols[gearIdx]) : undefined
    })
  }

  samples.sort((a, b) => a.lapDistPct - b.lapDistPct)
  if (samples.length === 0) throw new Error('CSV contains no usable telemetry rows.')
  return samples
}
