// One-shot "the app is still running in the system tray" hint state.
//
// The first time the main window is hidden to the tray (close-to-tray is ON by
// default) we surface a balloon/notification explaining the app keeps running and
// how to fully quit. To make it appear ONCE PER INSTALL we persist a marker file
// under userData: its mere existence means "already shown". The decision logic is
// kept here, free of Electron, with injectable fs hooks so it is unit-testable
// without touching the real disk.

import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Filename (under userData) of the one-shot flag recording that the tray hint has
// already been shown. A leading dot keeps it out of the way in the data folder.
export const TRAY_HINT_FLAG_FILENAME = '.tray-hint-shown'

export function trayHintFlagPath(userDataDir: string): string {
  return join(userDataDir, TRAY_HINT_FLAG_FILENAME)
}

export interface TrayHintFsHooks {
  exists(path: string): boolean
  write(path: string): void
}

const defaultFsHooks: TrayHintFsHooks = {
  exists: existsSync,
  write: (path) => writeFileSync(path, `${new Date().toISOString()}\n`, 'utf8')
}

// Returns true the FIRST time it is asked for a not-yet-existing flag file and
// persists the flag, so every later call (this run or a future run) returns false.
// An unreadable flag is treated as "not shown yet" and we attempt to claim it once;
// a failed write is swallowed (the caller's in-memory guard still prevents repeats
// within the current run).
export function claimFirstTrayHint(flagPath: string, fsHooks: TrayHintFsHooks = defaultFsHooks): boolean {
  try {
    if (fsHooks.exists(flagPath)) return false
  } catch {
    // Unreadable flag — fall through and try to claim it once.
  }
  try {
    fsHooks.write(flagPath)
  } catch {
    // Best effort: persistence failure must never block hiding to the tray.
  }
  return true
}
