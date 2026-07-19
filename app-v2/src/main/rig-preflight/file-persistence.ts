import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  RigPreflightPersistence,
  RigPreflightWriteResult
} from './service'

type CandidateKind = 'current' | 'next' | 'previous'

export type RigPreflightFileStep =
  | 'mkdir'
  | 'write-next'
  | 'fsync-next'
  | 'remove-stale-previous'
  | 'rename-primary-previous'
  | 'rename-next-primary'
  | 'fsync-directory'
  | 'remove-previous'

interface PersistenceCandidate {
  kind: CandidateKind
  path: string
  content: string
}

export class RigPreflightNotCommittedError extends Error {
  readonly committed = false

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RigPreflightNotCommittedError'
  }
}

export class FileRigPreflightPersistence implements RigPreflightPersistence {
  private quarantineSequence = 0

  constructor(
    private readonly path: string,
    private readonly now: () => number = Date.now,
    private readonly beforeStep?: (step: RigPreflightFileStep) => void | Promise<void>
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

    if (current) {
      await this.quarantineCandidates(
        [next, previous].filter(
          (candidate): candidate is PersistenceCandidate => candidate !== null
        )
      )
      return current.content
    }
    if (previous) {
      if (next) await this.quarantineCandidates([next])
      await rename(previous.path, currentPath)
      return previous.content
    }
    if (next) {
      await this.quarantineCandidates([next])
      throw new Error(
        'Interrupted rig preflight write has no previously committed primary state.'
      )
    }
    return null
  }

  async write(content: string): Promise<RigPreflightWriteResult> {
    const directory = dirname(this.path)
    const nextPath = `${this.path}.next`
    const previousPath = `${this.path}.previous`
    await this.runStep('mkdir', () => mkdir(directory, { recursive: true }))

    let nextHandle: Awaited<ReturnType<typeof open>> | null = null
    try {
      nextHandle = await open(nextPath, 'w')
      await this.runStep('write-next', () => nextHandle!.writeFile(content, 'utf8'))
      await this.runStep('fsync-next', () => nextHandle!.sync())
      await nextHandle.close()
      nextHandle = null
    } catch (error) {
      await nextHandle?.close().catch(() => undefined)
      await this.cleanupUncommittedNext(nextPath)
      throw new RigPreflightNotCommittedError(
        `Rig preflight write did not reach the commit point: ${errorMessage(error)}`,
        { cause: error }
      )
    }

    let primaryMoved = false
    try {
      await this.runStep('remove-stale-previous', () => rm(previousPath, { force: true }))
      try {
        await this.runStep('rename-primary-previous', () => rename(this.path, previousPath))
        primaryMoved = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await this.runStep('rename-next-primary', () => rename(nextPath, this.path))
    } catch (error) {
      if (primaryMoved) {
        await rename(previousPath, this.path).catch(() => undefined)
      }
      await this.cleanupUncommittedNext(nextPath)
      throw new RigPreflightNotCommittedError(
        `Rig preflight write did not reach the commit point: ${errorMessage(error)}`,
        { cause: error }
      )
    }

    const warnings: string[] = []
    try {
      await this.runStep('fsync-directory', () => this.syncDirectory(directory))
    } catch (error) {
      warnings.push(`directory fsync failed after commit: ${errorMessage(error)}`)
    }
    try {
      await this.runStep('remove-previous', () => rm(previousPath, { force: true }))
    } catch (error) {
      warnings.push(`previous-state cleanup failed after commit: ${errorMessage(error)}`)
    }
    return {
      committed: true,
      cleanupWarning: warnings.length > 0 ? warnings.join('; ') : undefined
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

  private async runStep<T>(
    step: RigPreflightFileStep,
    operation: () => Promise<T>
  ): Promise<T> {
    await this.beforeStep?.(step)
    return operation()
  }

  private async syncDirectory(path: string): Promise<void> {
    const handle = await open(path, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  private async cleanupUncommittedNext(nextPath: string): Promise<void> {
    try {
      await rm(nextPath, { force: true })
    } catch {
      const quarantinePath =
        `${this.path}.aborted-${this.now()}-${++this.quarantineSequence}-next.json`
      await rename(nextPath, quarantinePath).catch(() => undefined)
    }
  }

  private async readCandidate(
    kind: CandidateKind,
    path: string
  ): Promise<PersistenceCandidate | null> {
    try {
      return { kind, path, content: await readFile(path, 'utf8') }
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
