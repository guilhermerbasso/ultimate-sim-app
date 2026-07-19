import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { RigPreflightPersistence } from './service'

type CandidateKind = 'current' | 'next' | 'previous'

interface PersistenceCandidate {
  kind: CandidateKind
  path: string
  content: string
  validJsonObject: boolean
}

export class FileRigPreflightPersistence implements RigPreflightPersistence {
  private quarantineSequence = 0

  constructor(
    private readonly path: string,
    private readonly now: () => number = Date.now
  ) {}

  async read(): Promise<string | null> {
    const currentPath = this.path
    const nextPath = `${this.path}.next`
    const previousPath = `${this.path}.previous`
    const [current, next, previous] = await Promise.all([
      this.readCandidate('current', currentPath),
      this.readCandidate('next', nextPath),
      this.readCandidate('previous', previousPath)
    ])
    const artifacts = [next, previous].filter(
      (candidate): candidate is PersistenceCandidate => candidate !== null
    )
    if (artifacts.length === 0) return current?.content ?? null

    const chosen = [next, current, previous].find(
      (candidate): candidate is PersistenceCandidate =>
        Boolean(candidate?.validJsonObject)
    )
    if (!chosen) {
      await this.quarantineCandidates(
        [current, next, previous].filter(
          (candidate): candidate is PersistenceCandidate => candidate !== null
        )
      )
      throw new Error(
        'Interrupted rig preflight replacement contained no recoverable JSON state.'
      )
    }

    const unchosen = [current, next, previous].filter(
      (candidate): candidate is PersistenceCandidate =>
        candidate !== null && candidate !== chosen
    )
    await this.quarantineCandidates(unchosen)
    if (chosen.path !== currentPath) await rename(chosen.path, currentPath)
    return chosen.content
  }

  async write(content: string): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const nextPath = `${this.path}.next`
    const backupPath = `${this.path}.previous`
    await writeFile(nextPath, content, 'utf8')
    try {
      await rename(nextPath, this.path)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST' && code !== 'EPERM') throw error
      await rm(backupPath, { force: true })
      await rename(this.path, backupPath)
      try {
        await rename(nextPath, this.path)
        await rm(backupPath, { force: true })
      } catch (replaceError) {
        await rename(backupPath, this.path).catch(() => undefined)
        throw replaceError
      }
    }
  }

  async quarantine(_reason: string): Promise<string | null> {
    const quarantinePath = `${this.path}.corrupt-${this.now()}-${++this.quarantineSequence}.json`
    try {
      await rename(this.path, quarantinePath)
      return quarantinePath
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private async readCandidate(
    kind: CandidateKind,
    path: string
  ): Promise<PersistenceCandidate | null> {
    try {
      const content = await readFile(path, 'utf8')
      let validJsonObject = false
      try {
        const parsed = JSON.parse(content) as unknown
        validJsonObject = Boolean(
          parsed &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed)
        )
      } catch {
        validJsonObject = false
      }
      return { kind, path, content, validJsonObject }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private async quarantineCandidates(
    candidates: readonly PersistenceCandidate[]
  ): Promise<void> {
    for (const candidate of candidates) {
      const quarantinePath =
        `${this.path}.interrupted-${this.now()}-${++this.quarantineSequence}-${candidate.kind}.json`
      await rename(candidate.path, quarantinePath)
    }
  }
}
