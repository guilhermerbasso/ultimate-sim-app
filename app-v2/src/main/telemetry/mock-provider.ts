import {
  createRaceConMockFrame,
  type RaceConMockDashboardId
} from '../../shared/racecon-mock-telemetry'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { TelemetryProvider } from './provider'

// Provider sintético: gera uma lap plausível para desenvolver/visualizar
// dashboards, overlays e OLED SEM estar numa sessão real (essencial no Mac).
export class MockProvider implements TelemetryProvider {
  readonly id = 'mock' as const
  private running = false
  private startedAt = 0

  constructor(
    private readonly now: () => number = Date.now,
    readonly scenarioId: RaceConMockDashboardId = 'RC-01'
  ) {}

  start(): void {
    this.running = true
    this.startedAt = this.now()
  }

  stop(): void {
    this.running = false
  }

  isConnected(): boolean {
    return this.running
  }

  poll(): TelemetrySnapshot | null {
    if (!this.running) return null
    const now = this.now()
    const elapsedSec = Math.max(0, (now - this.startedAt) / 1000)
    const frame = createRaceConMockFrame(this.scenarioId, elapsedSec)
    return { ...frame.snapshot, timestamp: now }
  }
}
