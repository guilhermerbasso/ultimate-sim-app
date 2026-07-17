// Shared types, IPC channels, and the section-registry METADATA for the config
// EXPORT/IMPORT feature. Importable by renderer, preload, main, and tests with
// NO electron/node dependency.
//
// SECURITY MODEL — the registry below is an ALLOWLIST of non-secret config
// stores. Auth/credential stores (iRacing credentials, OAuth tokens, browser
// session cookies, encrypted blobs) are NEVER listed here. `isForbiddenConfigPath`
// is a second, independent lock: the engine refuses to read or write any path it
// flags, so a future edit cannot accidentally serialize a secret.

export const CONFIG_BUNDLE_APP_ID = 'ultimate-sim-app' as const
export const CONFIG_BUNDLE_VERSION = 1 as const

// ─── IPC channels ─────────────────────────────────────────────────────────────

export const CONFIG_IO_CHANNELS = {
  /** Renderer → Main: build the full profile bundle and save it via a dialog. */
  exportAll: 'config:exportAll',
  /** Renderer → Main: open a bundle file and apply every known section. */
  importAll: 'config:importAll',
  /** Renderer → Main: export a single section to a file. */
  exportSection: 'config:exportSection',
  /** Renderer → Main: open a file and apply a single section. */
  importSection: 'config:importSection',
  /**
   * Renderer → Main: list every allowlisted section's saved-state metadata
   * (exists, size, last-modified, item count). Used by the "Settings
   * salvas" panel so the user can SEE what survived a reinstall.
   */
  listSaved: 'config:listSaved',
  /**
   * Renderer → Main: delete a single section's userData store, returning it to
   * factory default on the next launch. Guarded by the same allowlist +
   * forbidden-path locks as the storage layer — auth/credential stores can
   * never be targeted.
   */
  deleteSection: 'config:deleteSection',
  /** Renderer → Main: reset a section to factory default (alias of delete). */
  resetSection: 'config:resetSection',
  /** Main → Renderer: broadcast emitted after a successful import. */
  imported: 'config:imported',
  /**
   * Main → Renderer: broadcast emitted after a section is deleted/reset, so any
   * open "Settings salvas" panel re-reads the on-disk metadata.
   */
  changed: 'config:changed',
  /**
   * Renderer → Main: relaunch the app so freshly-imported config is loaded.
   * Imports are written to disk but every store is cached in memory at boot,
   * so a restart is the reliable way to apply them.
   */
  relaunch: 'config:relaunch'
} as const

export type ConfigIoChannel = (typeof CONFIG_IO_CHANNELS)[keyof typeof CONFIG_IO_CHANNELS]

// ─── Main-process-INTERNAL signal (NOT a renderer IPC channel) ─────────────────
// Emitted on the main `ipcMain` EventEmitter right AFTER a section's userData
// store is deleted/reset, carrying the sectionId. The in-memory module that OWNS
// that section (e.g. the overlays manager) listens and drops its cached copy so
// it stops persisting — otherwise a before-quit save flush would RESURRECT the
// file the user just deleted ("apaguei mas voltou ao reiniciar"). No renderer
// ever sends on this channel; it is a decoupled intra-main notification.
export const CONFIG_SECTION_RESET_SIGNAL = 'config:section-reset.internal' as const

// Emitted on the main `ipcMain` EventEmitter right AFTER a section's userData
// store is overwritten by an IMPORT (importSection / importAll), carrying the
// sectionId plus an optional completion callback. The in-memory module that OWNS
// that section listens and RE-READS
// its file from disk so the freshly-imported config goes live IMMEDIATELY, with
// no app restart. This is the hot-apply counterpart of CONFIG_SECTION_RESET_SIGNAL
// (which drops the cache); here the module reloads it. A module that reloads has
// fresh in-memory data, so its before-quit flush can no longer clobber the
// imported file. No renderer ever sends on this channel; it is intra-main only.
export const CONFIG_SECTION_RELOAD_SIGNAL = 'config:section-reload.internal' as const

// Sections whose OWNING main module listens for CONFIG_SECTION_RELOAD_SIGNAL and
// re-reads its store on import, so the change applies live WITHOUT a restart. The
// renderer uses this to show "Importado e aplicado ✓" for these and to keep an
// optional "Reiniciar" affordance for every other section (whose live module
// still caches its store until the next launch).
export const CONFIG_HOT_RELOAD_SECTIONS: readonly string[] = ['rgb-matrix', 'spotter', 'revlights', 'expressions'] as const

export function isHotReloadSection(id: string): boolean {
  return CONFIG_HOT_RELOAD_SECTIONS.includes(id)
}

// ─── Section registry metadata ────────────────────────────────────────────────

export type ConfigSectionKind = 'file' | 'dir'

export interface ConfigSectionDescriptor {
  /** Stable id used inside bundles, IPC, and the SectionExportImport `sectionId`. */
  id: string
  /** Human-friendly label (PT-BR) shown in the UI. */
  label: string
  /** 'file' → a single JSON file; 'dir' → a folder of JSON files (map keyed by filename). */
  kind: ConfigSectionKind
  /** Path relative to userData: a filename for 'file', a dirname for 'dir'. */
  path: string
}

// The complete set of EXPORTABLE config stores discovered under userData. Auth
// stores are intentionally absent (see SECURITY MODEL above).
export const CONFIG_SECTIONS: readonly ConfigSectionDescriptor[] = [
  { id: 'settings', label: 'App settings & theme', kind: 'file', path: 'settings.json' },
  { id: 'dashboards', label: 'Dashboards', kind: 'dir', path: 'dashboards' },
  { id: 'overlays', label: 'Overlays (including custom)', kind: 'file', path: 'overlays.json' },
  { id: 'overlay-layout', label: 'Overlay layout/composition', kind: 'file', path: 'compositor.json' },
  { id: 'oled', label: 'OLED dashboard', kind: 'file', path: 'oled-dashboard.json' },
  { id: 'revlights', label: 'Rev lights', kind: 'file', path: 'revlights.json' },
  { id: 'rgb-matrix', label: 'RGB matrix (iFlag)', kind: 'file', path: 'rgb-matrix-profiles.json' },
  { id: 'devices', label: 'Device profiles (ButtonBox/controls)', kind: 'file', path: 'arduino-devices.json' },
  { id: 'serial-devices', label: 'Serial devices', kind: 'file', path: 'serial-devices.json' },
  { id: 'pinout-designs', label: 'Firmware pinouts', kind: 'file', path: 'pinout-designs.json' },
  { id: 'custom-catalog', label: 'Custom board catalog', kind: 'file', path: 'custom-catalog.json' },
  { id: 'simx-identity', label: 'Primary SIM-X identity', kind: 'file', path: 'simx-primary-identity.json' },
  { id: 'actions', label: 'Actions & keyboard mappings', kind: 'file', path: 'actions-bindings.json' },
  { id: 'expressions', label: 'Expressions', kind: 'file', path: 'expressions.json' },
  { id: 'output-routes', label: 'Output routing', kind: 'file', path: 'output-routes.json' },
  { id: 'alerts', label: 'Alerts', kind: 'file', path: 'alerts-config.json' },
  { id: 'accessibility-cues', label: 'Accessibility cue profiles', kind: 'file', path: 'accessibility-cues.json' },
  { id: 'setups', label: 'Setups (library)', kind: 'file', path: 'setups.json' },
  { id: 'setup-manager', label: 'Setup manager', kind: 'file', path: 'setup-manager.json' },
  { id: 'race-profiles', label: 'Race profiles', kind: 'file', path: 'race-profiles.json' },
  { id: 'soundshift', label: 'SoundShift', kind: 'file', path: 'soundshift.json' },
  { id: 'spotter', label: 'Spotter / voices / TTS', kind: 'file', path: 'spotter.json' },
  { id: 'haptics', label: 'Haptics', kind: 'file', path: 'haptics.json' },
  { id: 'driver-notes', label: 'Driver notes', kind: 'file', path: 'driver-notes.json' },
  { id: 'legacy-profiles', label: 'Mapping profiles (legacy)', kind: 'dir', path: 'profiles' }
] as const

export function getConfigSection(id: string): ConfigSectionDescriptor | undefined {
  return CONFIG_SECTIONS.find((section) => section.id === id)
}

// ─── Auth/secret EXCLUSION guard (defense-in-depth) ────────────────────────────
// These paths live under the SAME userData dir but hold tokens/cookies/secrets
// or large, machine-specific caches. They are NEVER in CONFIG_SECTIONS; this
// guard is an independent second lock used by the engine and by the tests.

export const FORBIDDEN_CONFIG_FILES: readonly string[] = [
  'iracing-credentials.bin', // CredentialsStore (track-map/store.ts)
  'iracing-oauth.bin', // OAuth token set (track-map/oauth.ts)
  'iracing-session.bin', // session blob (track-map/session-store.ts)
  'iracing-browser-session.json', // captured login cookies (track-map/browser-login.ts)
  'iracing-track-catalog.json' // downloaded catalog cache (track-map/store.ts)
]

export const FORBIDDEN_CONFIG_DIRS: readonly string[] = [
  'track-maps', // learned/downloaded track geometry + metadata (data, not config)
  'recordings',
  'logs',
  'piper-tts', // bundled/downloaded voice model assets (large binaries)
  'pinout-builds'
]

// Returns true for any path that must never be exported or imported. Conservative
// by design: blocks `.bin` blobs, the known secret/cache files above, anything
// under a forbidden directory, path-traversal, and any name that looks like a
// credential.
export function isForbiddenConfigPath(path: string): boolean {
  const norm = path.replace(/\\/g, '/').toLowerCase()
  if (norm.includes('..')) return true
  const segments = norm.split('/').filter(Boolean)
  const base = segments.length > 0 ? segments[segments.length - 1] : norm
  if (base.endsWith('.bin')) return true
  if (FORBIDDEN_CONFIG_FILES.some((file) => file.toLowerCase() === base)) return true
  if (FORBIDDEN_CONFIG_DIRS.some((dir) => segments.includes(dir))) return true
  if (/credential|oauth|session|cookie|token|password|secret/.test(base)) return true
  return false
}

// ─── Bundle shapes ─────────────────────────────────────────────────────────────

export interface ConfigBundle {
  app: typeof CONFIG_BUNDLE_APP_ID
  version: number
  exportedAt: string
  sections: Record<string, unknown>
}

export interface ConfigSectionExport {
  app: typeof CONFIG_BUNDLE_APP_ID
  version: number
  exportedAt: string
  sectionId: string
  data: unknown
}

export interface ConfigImportSummary {
  app: typeof CONFIG_BUNDLE_APP_ID
  version: number
  /** sections written to their store. */
  applied: string[]
  /** known sections deliberately not applied (e.g. filtered out by opts). */
  skipped: string[]
  /** sections in the file that this app version does not recognize (ignored). */
  unknown: string[]
  /** Per-section item/application counts when the section has a meaningful collection shape. */
  details?: Record<string, ConfigSectionImportDetail>
}

export interface ConfigSectionImportDetail {
  /** Number of validated items read from the imported section. */
  itemCount?: number
  /** Number of live targets updated by a hot-reloadable owning module. */
  hotAppliedCount?: number
  /** Valid imported items that could not be bound to a live target. */
  unmatchedItemCount?: number
}

/** Result returned by an owning main module after an import hot-reload. */
export interface ConfigSectionReloadResult {
  sectionId: string
  itemCount: number
  hotAppliedCount: number
  unmatchedItemCount: number
}

export type ConfigSectionReloadCallback = (error: string | null, result?: ConfigSectionReloadResult) => void

export interface ConfigExportResult {
  canceled: boolean
  filePath?: string
  sections?: string[]
}

export interface ConfigImportResult {
  canceled: boolean
  summary?: ConfigImportSummary
}

// ─── Saved-state inspection / deletion shapes ──────────────────────────────────

// Per-section snapshot of what is persisted under userData. Surfaced by the
// "Settings salvas" panel so the user can see exactly what survived a
// reinstall and delete it. Only allowlisted (non-secret) sections are ever
// reported — auth/credential stores are never listed.
export interface SavedSectionInfo {
  id: string
  label: string
  kind: ConfigSectionKind
  /** true when content is persisted: a present file, or a dir with ≥1 .json. */
  exists: boolean
  /** On-disk size in bytes (sum of the dir's .json files for a 'dir' section). */
  sizeBytes: number
  /** Epoch ms of the last modification, or null when nothing is saved. */
  modifiedAt: number | null
  /**
   * Cheap-only item count: for a 'dir' section the number of .json files; for a
   * 'file' section the top-level array/object length when trivially parseable.
   * Omitted when it cannot be derived cheaply (e.g. a large file is skipped).
   */
  itemCount?: number
  /**
   * true when this section's metadata could NOT be read (permission denied, file
   * lock, etc.). The section is still listed (exists:false) so ONE unreadable
   * store never blanks the whole "Settings salvas" panel.
   */
  error?: boolean
}

export interface ConfigDeleteResult {
  id: string
  /** true if a store actually existed and was removed; false if already absent (idempotent). */
  removed: boolean
}

// ─── Validation helpers (pure, used by main + tests) ───────────────────────────

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isConfigBundle(value: unknown): value is ConfigBundle {
  return (
    isPlainObject(value) &&
    value.app === CONFIG_BUNDLE_APP_ID &&
    typeof value.version === 'number' &&
    isPlainObject(value.sections)
  )
}

export function isConfigSectionExport(value: unknown): value is ConfigSectionExport {
  return (
    isPlainObject(value) &&
    value.app === CONFIG_BUNDLE_APP_ID &&
    typeof value.version === 'number' &&
    typeof value.sectionId === 'string' &&
    'data' in value
  )
}
