import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { RaceProfile } from '../../shared/raceprofiles'

interface RaceProfilesFile {
  version: 1
  autoSwitch: boolean
  profiles: RaceProfile[]
}

const STORE_FILE = 'race-profiles.json'
const DEFAULT_STORE: RaceProfilesFile = { version: 1, autoSwitch: false, profiles: [] }

export class RaceProfileStore {
  private data: RaceProfilesFile | null = null
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly userDataPath: string) {}

  async list(): Promise<RaceProfile[]> {
    const data = await this.load()
    return [...data.profiles].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }

  async get(id: string): Promise<RaceProfile | null> {
    const data = await this.load()
    return data.profiles.find((profile) => profile.id === id) ?? null
  }

  async save(profile: RaceProfile): Promise<RaceProfile> {
    return this.mutate(async () => {
      const data = await this.load()
      const normalized = normalizeProfile(profile)
      const index = data.profiles.findIndex((candidate) => candidate.id === normalized.id)
      if (index >= 0) data.profiles[index] = normalized
      else data.profiles.push(normalized)
      await this.persist()
      return normalized
    })
  }

  async delete(id: string): Promise<void> {
    await this.mutate(async () => {
      const data = await this.load()
      data.profiles = data.profiles.filter((profile) => profile.id !== id)
      await this.persist()
    })
  }

  async getAutoSwitch(): Promise<boolean> {
    return (await this.load()).autoSwitch
  }

  async setAutoSwitch(enabled: boolean): Promise<boolean> {
    return this.mutate(async () => {
      const data = await this.load()
      data.autoSwitch = enabled
      await this.persist()
      return data.autoSwitch
    })
  }

  async findMatch(carName?: string, trackName?: string): Promise<RaceProfile | null> {
    const data = await this.load()
    const matches = data.profiles
      .filter((profile) => matchesTelemetry(profile, carName, trackName))
      .sort((a, b) => matchScore(b) - matchScore(a) || a.name.localeCompare(b.name, 'pt-BR'))
    return matches[0] ?? null
  }

  private async load(): Promise<RaceProfilesFile> {
    if (this.data) return this.data

    try {
      const raw = JSON.parse(await readFile(this.storePath, 'utf8')) as unknown
      this.data = normalizeStore(raw)
    } catch {
      this.data = { ...DEFAULT_STORE, profiles: [] }
    }

    return this.data
  }

  private async persist(): Promise<void> {
    if (!this.data) return
    await mkdir(dirname(this.storePath), { recursive: true })
    await writeFile(this.storePath, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8')
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.catch(() => undefined).then(operation)
    this.mutationQueue = run.then(() => undefined, () => undefined)
    return run
  }

  private get storePath(): string {
    return join(this.userDataPath, STORE_FILE)
  }
}

function normalizeStore(raw: unknown): RaceProfilesFile {
  if (!isRecord(raw)) return { ...DEFAULT_STORE, profiles: [] }
  const rawProfiles = Array.isArray(raw.profiles) ? raw.profiles : []
  return {
    version: 1,
    autoSwitch: raw.autoSwitch === true,
    profiles: rawProfiles.map((profile) => normalizeProfile(profile)).filter(Boolean)
  }
}

export function normalizeProfile(raw: unknown): RaceProfile {
  if (!isRecord(raw)) throw new Error('Invalid race profile.')
  const name = asTrimmedString(raw.name)
  if (!name) throw new Error('Enter a name for the race profile.')

  const id = asTrimmedString(raw.id) || createProfileId()
  const match = isRecord(raw.match)
    ? {
        carName: asOptionalString(raw.match.carName),
        trackName: asOptionalString(raw.match.trackName)
      }
    : undefined
  const hapticsGains = normalizeHapticsGains(raw.hapticsGains)

  return {
    id,
    name,
    ...(match && (match.carName || match.trackName) ? { match } : {}),
    ...(asOptionalString(raw.buttonboxProfile) ? { buttonboxProfile: asOptionalString(raw.buttonboxProfile) } : {}),
    ...(raw.oled !== undefined ? { oled: raw.oled } : {}),
    ...(raw.overlays !== undefined ? { overlays: raw.overlays } : {}),
    ...(raw.alerts !== undefined ? { alerts: raw.alerts } : {}),
    ...(raw.bindings !== undefined ? { bindings: raw.bindings } : {}),
    ...(hapticsGains ? { hapticsGains } : {})
  }
}

function normalizeHapticsGains(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined
  const gains = Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, number] => (
        entry[0].trim().length > 0 &&
        typeof entry[1] === 'number' &&
        Number.isFinite(entry[1])
      ))
      .map(([id, intensity]) => [id, Math.max(0, Math.min(1, intensity))])
  )
  return Object.keys(gains).length > 0 ? gains : undefined
}

function matchesTelemetry(profile: RaceProfile, carName?: string, trackName?: string): boolean {
  const match = profile.match
  if (!match?.carName && !match?.trackName) return false
  if (match.carName && normalizeKey(match.carName) !== normalizeKey(carName)) return false
  if (match.trackName && normalizeKey(match.trackName) !== normalizeKey(trackName)) return false
  return true
}

function matchScore(profile: RaceProfile): number {
  return Number(Boolean(profile.match?.carName)) + Number(Boolean(profile.match?.trackName))
}

function createProfileId(): string {
  return `race-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase('pt-BR') : ''
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asOptionalString(value: unknown): string | undefined {
  const normalized = asTrimmedString(value)
  return normalized || undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
