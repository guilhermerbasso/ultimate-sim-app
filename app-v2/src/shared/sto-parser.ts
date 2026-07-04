export interface StoSection {
  [key: string]: string
}

export interface StoSetup {
  sections: Record<string, StoSection>
}

export type StoDiffKind = 'added' | 'removed' | 'changed'

export interface StoDiffEntry {
  key: string
  kind: StoDiffKind
  before?: string
  after?: string
}

export interface StoSectionDiff {
  section: string
  added: StoDiffEntry[]
  removed: StoDiffEntry[]
  changed: StoDiffEntry[]
}

export interface StoDiffResult {
  sections: StoSectionDiff[]
  totalChanges: number
}

const GLOBAL_SECTION = 'General'

export function parseSto(text: string): StoSetup {
  const sections: Record<string, StoSection> = {}
  let currentSection = GLOBAL_SECTION

  function ensureSection(name: string): StoSection {
    const clean = cleanName(name) || GLOBAL_SECTION
    sections[clean] = sections[clean] ?? {}
    return sections[clean]
  }

  ensureSection(currentSection)

  try {
    for (const rawLine of String(text ?? '').split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith(';') || line.startsWith('#')) continue

      const sectionMatch = line.match(/^\[([^\]]+)\]/)
      if (sectionMatch) {
        currentSection = cleanName(sectionMatch[1]) || GLOBAL_SECTION
        ensureSection(currentSection)
        continue
      }

      const parsed = parseKeyValue(line)
      if (!parsed) continue
      ensureSection(currentSection)[parsed.key] = parsed.value
    }
  } catch {
    return { sections }
  }

  return { sections }
}

export function diffSetups(a: StoSetup, b: StoSetup): StoDiffResult {
  const sectionNames = Array.from(new Set([...Object.keys(a.sections), ...Object.keys(b.sections)])).sort((left, right) => left.localeCompare(right))
  const sections: StoSectionDiff[] = []
  let totalChanges = 0

  for (const section of sectionNames) {
    const before = a.sections[section] ?? {}
    const after = b.sections[section] ?? {}
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort((left, right) => left.localeCompare(right))
    const sectionDiff: StoSectionDiff = { section, added: [], removed: [], changed: [] }

    for (const key of keys) {
      const hasBefore = Object.prototype.hasOwnProperty.call(before, key)
      const hasAfter = Object.prototype.hasOwnProperty.call(after, key)
      if (!hasBefore && hasAfter) sectionDiff.added.push({ key, kind: 'added', after: after[key] })
      else if (hasBefore && !hasAfter) sectionDiff.removed.push({ key, kind: 'removed', before: before[key] })
      else if (before[key] !== after[key]) sectionDiff.changed.push({ key, kind: 'changed', before: before[key], after: after[key] })
    }

    const count = sectionDiff.added.length + sectionDiff.removed.length + sectionDiff.changed.length
    if (count > 0) {
      totalChanges += count
      sections.push(sectionDiff)
    }
  }

  return { sections, totalChanges }
}

function parseKeyValue(line: string): { key: string; value: string } | null {
  const colon = line.indexOf(':')
  const equals = line.indexOf('=')
  const separator = colon >= 0 && equals >= 0 ? Math.min(colon, equals) : Math.max(colon, equals)
  if (separator <= 0) return null

  const key = cleanName(line.slice(0, separator))
  if (!key) return null
  return { key, value: line.slice(separator + 1).trim() }
}

function cleanName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180)
}
