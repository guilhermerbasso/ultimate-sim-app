import { app } from 'electron'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { EVENT_ORDER } from '../shared/ipc'
import type { Config, EventId, MappingValues, ProfilePayload, ProfileRecord, ProfileSummary } from '../shared/ipc'

const PROFILE_EXTENSION = '.json'
const EVENT_SET = new Set<string>(EVENT_ORDER)

export class ProfileStore {
  private get profilesDir(): string {
    return join(app.getPath('userData'), 'profiles')
  }

  async listProfiles(): Promise<ProfileSummary[]> {
    await this.ensureProfilesDir()
    const files = await readdir(this.profilesDir)
    const profiles = await Promise.all(
      files
        .filter((file) => file.endsWith(PROFILE_EXTENSION))
        .map(async (file) => {
          const profile = await this.readProfileByFile(file)
          return { name: profile.name, savedAt: profile.savedAt }
        })
    )

    return profiles.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  }

  async saveProfile(name: string, data: ProfilePayload): Promise<ProfileRecord> {
    const normalizedName = this.normalizeName(name)
    await this.ensureProfilesDir()
    validateProfilePayload(data, `perfil ${normalizedName}`)

    const profile: ProfileRecord = {
      name: normalizedName,
      mapping: data.mapping,
      config: data.config,
      savedAt: new Date().toISOString()
    }

    await writeFile(this.profilePath(normalizedName), JSON.stringify(profile, null, 2), 'utf8')
    return profile
  }

  async loadProfile(name: string): Promise<ProfileRecord> {
    await this.ensureProfilesDir()
    return this.readProfileByFile(this.fileNameFor(name))
  }

  async deleteProfile(name: string): Promise<void> {
    await rm(this.profilePath(name), { force: true })
  }

  private async readProfileByFile(file: string): Promise<ProfileRecord> {
    const raw = JSON.parse(await readFile(join(this.profilesDir, file), 'utf8')) as unknown
    const profile = validateProfileRecord(raw, file)
    return profile
  }

  private async ensureProfilesDir(): Promise<void> {
    await mkdir(this.profilesDir, { recursive: true })
  }

  private profilePath(name: string): string {
    return join(this.profilesDir, this.fileNameFor(name))
  }

  private fileNameFor(name: string): string {
    return `${encodeURIComponent(this.normalizeName(name))}${PROFILE_EXTENSION}`
  }

  private normalizeName(name: string): string {
    const normalized = name.trim()
    if (!normalized) throw new Error('Informe um nome para o perfil.')
    if (normalized.length > 80) throw new Error('Nome do perfil deve ter no máximo 80 caracteres.')
    return normalized
  }
}

export function validateProfilePayload(data: unknown, context = 'perfil'): asserts data is ProfilePayload {
  if (!isObject(data)) throw new Error(`Perfil inválido (${context}): payload não é objeto.`)
  validateMapping((data as { mapping?: unknown }).mapping, context)
  validateConfig((data as { config?: unknown }).config, context)
}

function validateProfileRecord(raw: unknown, file: string): ProfileRecord {
  if (!isObject(raw)) throw new Error(`Perfil inválido (${file}): JSON não é objeto.`)
  const record = raw as Partial<ProfileRecord>
  if (typeof record.name !== 'string' || !record.name.trim()) throw new Error(`Perfil inválido (${file}): nome ausente.`)
  if (typeof record.savedAt !== 'string' || !record.savedAt.trim()) {
    throw new Error(`Perfil inválido (${file}): data de salvamento ausente.`)
  }
  validateProfilePayload(record, file)
  return record as ProfileRecord
}

function validateMapping(mapping: unknown, context: string): void {
  if (!isObject(mapping)) throw new Error(`Perfil inválido (${context}): mapping ausente.`)
  const values = (mapping as { values?: unknown }).values
  if (!isObject(values)) throw new Error(`Perfil inválido (${context}): mapping.values ausente.`)

  const keys = Object.keys(values)
  const unknownKeys = keys.filter((key) => !EVENT_SET.has(key))
  if (unknownKeys.length > 0) {
    throw new Error(`Perfil inválido (${context}): evento(s) desconhecido(s): ${unknownKeys.join(', ')}.`)
  }
  if (keys.length !== EVENT_ORDER.length) {
    throw new Error(`Perfil inválido (${context}): mapping deve conter exatamente ${EVENT_ORDER.length} eventos.`)
  }

  for (const eventId of EVENT_ORDER) {
    const value = (values as Partial<MappingValues>)[eventId]
    validateIntegerRange(value, `mapping.${eventId}`, 1, 18, context)
  }
}

function validateConfig(config: unknown, context: string): asserts config is Config {
  if (!isObject(config)) throw new Error(`Perfil inválido (${context}): config ausente.`)
  const candidate = config as Partial<Config>
  validateIntegerRange(candidate.pulse, 'config.pulse', 10, 250, context)
  validateIntegerRange(candidate.debounce, 'config.debounce', 5, 200, context)
  if (candidate.encmode !== 'pulse' && candidate.encmode !== 'hold') {
    throw new Error(`Perfil inválido (${context}): config.encmode deve ser pulse ou hold.`)
  }
}

function validateIntegerRange(value: unknown, label: string, min: number, max: number, context: string): void {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < min || value > max) {
    throw new Error(`Perfil inválido (${context}): ${label} deve ser inteiro entre ${min} e ${max}.`)
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
