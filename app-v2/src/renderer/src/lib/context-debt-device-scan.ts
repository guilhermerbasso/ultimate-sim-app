import type {
  ContextDebtDeviceKind,
  ContextDebtScanStatus
} from '../../../shared/context-debt'

export interface ContextDebtDeviceScanDependencies {
  refreshAudioOutputs(): Promise<boolean>
  refreshSerialDevices(): Promise<void>
  refreshDisplays(): Promise<unknown>
  listGamepads(): string[]
}

export interface ContextDebtDeviceScanResult {
  scanStatus: Record<ContextDebtDeviceKind, ContextDebtScanStatus>
  gamepadIds: string[]
}

export async function scanContextDebtDevices(
  dependencies: ContextDebtDeviceScanDependencies
): Promise<ContextDebtDeviceScanResult> {
  const [audio, serial, display, gamepad] = await Promise.allSettled([
    dependencies.refreshAudioOutputs(),
    dependencies.refreshSerialDevices(),
    dependencies.refreshDisplays(),
    Promise.resolve().then(() => dependencies.listGamepads())
  ])

  return {
    scanStatus: {
      audio: audio.status === 'fulfilled' && audio.value ? 'success' : 'failed',
      serial: serial.status === 'fulfilled' ? 'success' : 'failed',
      display: display.status === 'fulfilled' ? 'success' : 'failed',
      gamepad: gamepad.status === 'fulfilled' ? 'success' : 'failed'
    },
    gamepadIds: gamepad.status === 'fulfilled' ? gamepad.value : []
  }
}
