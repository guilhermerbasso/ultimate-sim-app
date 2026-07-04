import { parseCompanionInput, type CompanionInputEvent } from '../../shared/companion'
import { emptyInputSnapshot, type CompanionInputSnapshot } from '../../shared/arduino'

// Per-device input aggregator. Owns the live `CompanionInputSnapshot` for each
// generic serial device (the SIM-X box has its own HID + encoder path; we
// don't aggregate companion-protocol inputs for it). The Arduinos module
// calls `ingest(deviceId, line)` on every RX line and consumers (Inputs panel
// over IPC) snapshot the result.
export class CompanionInputTracker {
  private readonly snapshots = new Map<string, CompanionInputSnapshot>()
  private readonly tombstones = new Set<string>()
  private dirty = new Set<string>()

  // Returns the parsed event when the line was recognised and the snapshot
  // updated, null otherwise. Callers can use the return value to broadcast a
  // dedicated event channel later if needed (e.g. action-binding triggers).
  ingest(deviceId: string, line: string): CompanionInputEvent | null {
    const event = parseCompanionInput(line)
    if (!event) return null
    const snapshot = this.getOrCreate(deviceId)
    snapshot.updatedAt = Date.now()
    switch (event.kind) {
      case 'button':
        snapshot.buttons[event.index] = event.pressed
        break
      case 'encoder':
        snapshot.encoders[event.index] = (snapshot.encoders[event.index] ?? 0) + event.direction
        break
      case 'analog':
        snapshot.analogs[event.index] = event.value
        break
    }
    this.dirty.add(deviceId)
    return event
  }

  // Returns deep-copied snapshots so subscribers don't share mutable state
  // with the aggregator (the renderer plays back the maps).
  list(): CompanionInputSnapshot[] {
    return Array.from(this.snapshots.values()).map(cloneSnapshot)
  }

  get(deviceId: string): CompanionInputSnapshot | null {
    const snapshot = this.snapshots.get(deviceId)
    return snapshot ? cloneSnapshot(snapshot) : null
  }

  // Returns the deviceIds whose snapshots changed since the last drainDirty().
  // Used by the throttled broadcast loop in the arduino module.
  drainDirty(): string[] {
    if (this.dirty.size === 0) return []
    const ids = Array.from(this.dirty)
    this.dirty.clear()
    return ids
  }

  // Wipe a device's snapshot when it disconnects so the Inputs panel doesn't
  // show stale state.
  forget(deviceId: string): void {
    if (!this.snapshots.has(deviceId)) return
    this.snapshots.delete(deviceId)
    this.tombstones.add(deviceId)
    this.dirty.add(deviceId)
  }

  takeTombstone(deviceId: string): CompanionInputSnapshot | null {
    if (!this.tombstones.delete(deviceId)) return null
    return { ...emptyInputSnapshot(deviceId), removed: true }
  }

  private getOrCreate(deviceId: string): CompanionInputSnapshot {
    let snapshot = this.snapshots.get(deviceId)
    if (!snapshot) {
      snapshot = emptyInputSnapshot(deviceId)
      this.snapshots.set(deviceId, snapshot)
    }
    return snapshot
  }
}

function cloneSnapshot(snapshot: CompanionInputSnapshot): CompanionInputSnapshot {
  return {
    deviceId: snapshot.deviceId,
    removed: snapshot.removed,
    buttons: { ...snapshot.buttons },
    encoders: { ...snapshot.encoders },
    analogs: { ...snapshot.analogs },
    updatedAt: snapshot.updatedAt
  }
}
