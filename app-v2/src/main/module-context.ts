import type { App, BrowserWindow, IpcMain } from 'electron'
import type { IRacingControl } from './iracing/control'
import type { ProfileStore } from './profiles'
import type { SerialManager } from './serial-manager'
import type { SerialHub } from './serial/hub'
import type { TelemetryHub } from './telemetry/hub'

export type GracefulTeardownPhase = 'quiesce' | 'persistence'
export type GracefulTeardownStage = GracefulTeardownPhase | 'hardware'
export type GracefulTeardownTask = () => Promise<void> | void
export type GracefulTeardownErrorHandler = (stage: string, error: unknown) => void

export interface BoundedTeardownOperation {
  stage: string
  timeoutMs: number
  task: GracefulTeardownTask
}

export interface OrderedGracefulTeardownPlan {
  registry: GracefulTeardownRegistry
  quiesceTimeoutMs: number
  outputOff: readonly BoundedTeardownOperation[]
  drain: readonly BoundedTeardownOperation[]
  persistenceTimeoutMs: number
  finishPersistence?: GracefulTeardownTask
  onError: GracefulTeardownErrorHandler
}

export interface BeforeQuitEvent {
  preventDefault(): void
}

export interface GracefulQuitControllerOptions {
  teardown: GracefulTeardownTask
  quit(): void
  onStart?(): void
  onComplete?(): void
  onError?(error: unknown): void
}

export class TeardownTimeoutError extends Error {
  constructor(stage: string, timeoutMs: number) {
    super(`${stage} timed out after ${timeoutMs}ms`)
    this.name = 'TeardownTimeoutError'
  }
}

export class GracefulTeardownRegistry {
  private readonly tasks: Record<GracefulTeardownPhase, Set<GracefulTeardownTask>> = {
    quiesce: new Set(),
    persistence: new Set()
  }

  register(task: GracefulTeardownTask, phase: GracefulTeardownPhase = 'persistence'): () => void {
    this.tasks[phase].add(task)
    return () => this.tasks[phase].delete(task)
  }

  async run(
    hardware: GracefulTeardownTask,
    onError: GracefulTeardownErrorHandler
  ): Promise<void> {
    await this.runPhase('quiesce', onError)
    try {
      await hardware()
    } catch (error) {
      this.reportError(onError, 'hardware', error)
    }
    await this.runPhase('persistence', onError)
  }

  async runPhase(
    phase: GracefulTeardownPhase,
    onError: GracefulTeardownErrorHandler
  ): Promise<void> {
    await Promise.all(
      [...this.tasks[phase]].map(async (task) => {
        try {
          await task()
        } catch (error) {
          this.reportError(onError, phase, error)
        }
      })
    )
  }

  private reportError(
    onError: GracefulTeardownErrorHandler,
    stage: string,
    error: unknown
  ): void {
    try {
      onError(stage, error)
    } catch {
      // Teardown error reporting must never prevent later safety phases.
    }
  }
}

export async function settleBoundedTeardownOperation(
  operation: BoundedTeardownOperation,
  onError: GracefulTeardownErrorHandler
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  const work = Promise.resolve().then(() => operation.task())
  const watchdog = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new TeardownTimeoutError(operation.stage, operation.timeoutMs)),
      operation.timeoutMs
    )
  })
  try {
    await Promise.race([work, watchdog])
  } catch (error) {
    try {
      onError(operation.stage, error)
    } catch {
      // Error reporting must not prevent the remaining teardown stages.
    }
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export async function runOrderedGracefulTeardown(plan: OrderedGracefulTeardownPlan): Promise<void> {
  await settleBoundedTeardownOperation(
    {
      stage: 'quiesce',
      timeoutMs: plan.quiesceTimeoutMs,
      task: () => plan.registry.runPhase('quiesce', plan.onError)
    },
    plan.onError
  )
  await Promise.all(
    plan.outputOff.map((operation) => settleBoundedTeardownOperation(operation, plan.onError))
  )
  for (const operation of plan.drain) {
    await settleBoundedTeardownOperation(operation, plan.onError)
  }
  await settleBoundedTeardownOperation(
    {
      stage: 'persistence',
      timeoutMs: plan.persistenceTimeoutMs,
      task: async () => {
        await plan.registry.runPhase('persistence', plan.onError)
        await plan.finishPersistence?.()
      }
    },
    plan.onError
  )
}

export class GracefulQuitController {
  private started = false
  private done = false

  constructor(private readonly options: GracefulQuitControllerOptions) {}

  handleBeforeQuit(event: BeforeQuitEvent): void {
    if (this.done) return
    event.preventDefault()
    if (this.started) return
    this.started = true
    try {
      this.options.onStart?.()
    } catch {
      // Startup diagnostics must not block teardown.
    }
    const teardown = Promise.resolve().then(() => this.options.teardown())
    void teardown.then(
      () => this.complete(),
      (error: unknown) => {
        try {
          this.options.onError?.(error)
        } catch {
          // Teardown completion must still re-issue quit.
        }
        this.complete()
      }
    )
  }

  private complete(): void {
    this.done = true
    try {
      this.options.onComplete?.()
    } catch {
      // Continue to the final quit even if cleanup diagnostics fail.
    }
    try {
      this.options.quit()
    } catch {
      // The host owns any final process-exit fallback.
    }
  }
}

// Contexto compartilhado entregue a cada módulo no registro. Permite que módulos
// (telemetria, overlays, OLED, ações, etc.) registrem IPC e usem os serviços
// centrais SEM editar arquivos centrais — cada módulo vive nos próprios arquivos.
export interface ModuleContext {
  app: App
  ipcMain: IpcMain
  telemetryHub: TelemetryHub
  // Legacy single-device facade: wraps the PRIMARY (SIM-X) device on the hub.
  // Existing callers (revlights, OLED, arduino, buttonbox:* IPC) keep using
  // this exactly as before.
  serialManager: SerialManager
  // Multi-device fleet: use this to target a non-primary device (custom
  // serial outputs for alerts/expressions, extra Arduinos, etc.).
  serialHub: SerialHub
  profileStore: ProfileStore
  iracingControl: IRacingControl
  getMainWindow(): BrowserWindow | null
  // Envia um evento para TODAS as janelas (principal + overlays).
  broadcast(channel: string, payload: unknown): void
  /** Join async module cleanup to the app's ordered, bounded graceful teardown barrier. */
  registerGracefulTeardown(task: GracefulTeardownTask, phase?: GracefulTeardownPhase): () => void
}
