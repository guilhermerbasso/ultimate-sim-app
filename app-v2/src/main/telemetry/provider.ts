import type { SimId, TelemetrySnapshot } from '../../shared/telemetry'

// Contrato de um provider de telemetria. Cada sim (iRacing/ACC/AC/AMS2) e o Mock
// implementam isto. O Hub faz polling no tick e normaliza a saída.
export interface TelemetryProvider {
  readonly id: SimId
  // Inicia leitura (abrir MMF/shared memory, etc.). Idempotente.
  start(): Promise<void> | void
  // Para a leitura e libera recursos.
  stop(): Promise<void> | void
  // O sim correspondente está rodando e enviando dados?
  isConnected(): boolean
  // Snapshot mais recente já normalizado, ou null se indispolevel.
  poll(): TelemetrySnapshot | null
  /**
   * Optional. Tells the provider whether the user selected it explicitly or whether it is
   * competing in auto-detection. Providers that share a transport with another simulator
   * (AC and ACC both publish to `Local\acpmf_*`) must not claim an ambiguous source during
   * auto-detection, but an explicit selection IS the user answering "which sim is this?".
   */
  setSelectionMode?(mode: 'auto' | 'explicit'): void
}
