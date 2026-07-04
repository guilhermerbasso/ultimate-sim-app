import { EventEmitter } from 'node:events'
import type { AppSettings } from '../../shared/settings'

// Tiny main-process bus so modules can react to AppSettings changes WITHOUT a
// direct reference to the settings owner (app-shell-ui). The SIM-X auto-start
// coordinator subscribes here to start/stop when `autoStartSimX` is toggled live.
class SettingsEvents extends EventEmitter {
  emitChanged(settings: AppSettings): void {
    this.emit('changed', settings)
  }

  onChanged(listener: (settings: AppSettings) => void): () => void {
    this.on('changed', listener)
    return () => this.off('changed', listener)
  }
}

export const settingsEvents = new SettingsEvents()
