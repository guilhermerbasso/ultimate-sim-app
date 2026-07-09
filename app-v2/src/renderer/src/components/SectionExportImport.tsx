import { type ReactElement, useEffect, useState } from 'react'
import {
  CONFIG_IO_CHANNELS,
  isHotReloadSection,
  type ConfigExportResult,
  type ConfigImportResult
} from '../../../shared/config-io'
import type { AppSettings } from '../../../shared/settings'
import { APP_SETTINGS_CHANGED_EVENT, resolveAppLanguage, tt, type ResolvedLanguage } from '../i18n'

export interface SectionExportImportProps {
  /** Stable section id from CONFIG_SECTIONS (e.g. 'rgb-matrix', 'overlays'). */
  sectionId: string
  /** Human label shown in the confirm dialog and tooltips. */
  label: string
  /**
   * Optional callback fired after a successful HOT-APPLIED import (the owning
   * main module re-read its store live — see CONFIG_HOT_RELOAD_SECTIONS). Call
   * sites that keep their own in-memory mirror can use this to refetch. For
   * sections that still need a restart it is NOT invoked (the running app serves
   * its in-memory cache until relaunch).
   */
  onImported?: () => void
  language?: ResolvedLanguage
}

type Busy = false | 'export' | 'import'
type Status = { text: string; tone: 'ok' | 'err' } | null

async function relaunchApp(): Promise<void> {
  // Resolves to nothing: the main process exits the renderer as it relaunches.
  await window.ipc.invoke(CONFIG_IO_CHANNELS.relaunch).catch(() => {})
}

// Compact Export/Import pair for a single config section. Embed it next to any
// menu/submenu header; it talks to the same config:* IPC used by the global
// Settings backup panel. After a successful import the owning main module is told
// to RE-READ its store from disk: for hot-reloadable sections the change is live
// immediately ("Importado e aplicado ✓"); the few sections that cannot hot-swap
// their live windows/state (overlays, layout, OLED, …) show "Reinicie para
// aplicar" with an OPTIONAL restart button — the import is already safe on disk
// and protected from a before-quit clobber, so the restart is no longer forced.
export function SectionExportImport({ sectionId, label, onImported, language }: SectionExportImportProps): ReactElement {
  const [busy, setBusy] = useState<Busy>(false)
  const [status, setStatus] = useState<Status>(null)
  const [needsRestart, setNeedsRestart] = useState(false)
  const [fallbackLanguage, setFallbackLanguage] = useState<ResolvedLanguage>('en')
  const effectiveLanguage = language ?? fallbackLanguage
  const hotReload = isHotReloadSection(sectionId)

  useEffect(() => {
    if (language) return
    window.ipc
      .invoke<AppSettings>('app:getSettings')
      .then((settings) => setFallbackLanguage(resolveAppLanguage(settings.language)))
      .catch(() => {})
    const onSettingsChanged = (event: Event): void => {
      const detail = (event as CustomEvent<AppSettings>).detail
      if (detail) setFallbackLanguage(resolveAppLanguage(detail.language))
    }
    window.addEventListener(APP_SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => window.removeEventListener(APP_SETTINGS_CHANGED_EVENT, onSettingsChanged)
  }, [language])

  const runExport = async (): Promise<void> => {
    setBusy('export')
    setStatus(null)
    try {
      const result = await window.ipc.invoke<ConfigExportResult>(CONFIG_IO_CHANNELS.exportSection, sectionId)
      if (!result.canceled) setStatus({ text: tt(effectiveLanguage, 'shared.sectionExport.exported'), tone: 'ok' })
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), tone: 'err' })
    } finally {
      setBusy(false)
    }
  }

  const runImport = async (): Promise<void> => {
    // Single confirmation — the import overwrites this section on disk and (for
    // hot-reloadable sections) applies it live. No second mandatory dialog.
    if (!window.confirm(tt(effectiveLanguage, 'shared.sectionExport.importConfirm', { label }))) return
    setBusy('import')
    setStatus(null)
    setNeedsRestart(false)
    try {
      const result = await window.ipc.invoke<ConfigImportResult>(CONFIG_IO_CHANNELS.importSection, sectionId)
      if (!result.canceled) {
        const applied = result.summary?.applied.length ?? 0
        if (applied > 0) {
          if (hotReload) {
            setStatus({ text: tt(effectiveLanguage, 'shared.sectionExport.importedApplied'), tone: 'ok' })
            onImported?.()
          } else {
            // Written to disk and protected from a quit-time clobber, but the live
            // module keeps its in-memory copy until relaunch — restart is optional.
            setNeedsRestart(true)
            setStatus({ text: tt(effectiveLanguage, 'shared.sectionExport.importedRestart'), tone: 'ok' })
          }
        } else {
          setStatus({ text: tt(effectiveLanguage, 'shared.sectionExport.nothingApplied'), tone: 'err' })
        }
      }
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), tone: 'err' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button
        className="ghost-action compact"
        disabled={busy !== false}
        onClick={runExport}
        title={tt(effectiveLanguage, 'shared.sectionExport.exportTitle', { label })}
        type="button"
      >
        {busy === 'export' ? tt(effectiveLanguage, 'common.exporting') : tt(effectiveLanguage, 'common.export')}
      </button>
      <button
        className="ghost-action compact"
        disabled={busy !== false}
        onClick={runImport}
        title={tt(effectiveLanguage, 'shared.sectionExport.importTitle', { label })}
        type="button"
      >
        {busy === 'import' ? tt(effectiveLanguage, 'common.importing') : tt(effectiveLanguage, 'common.import')}
      </button>
      {needsRestart && (
        <>
          <span
            title={tt(effectiveLanguage, 'shared.sectionExport.restartTitle')}
            style={{
              background: 'var(--accent, #0078d4)',
              color: '#fff',
              borderRadius: 6,
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: 'nowrap'
            }}
          >
            {tt(effectiveLanguage, 'common.restartToApply')}
          </span>
          <button className="ghost-action compact" onClick={() => void relaunchApp()} type="button">
            {tt(effectiveLanguage, 'common.restartNow')}
          </button>
        </>
      )}
      {status && (
        <small style={{ color: status.tone === 'ok' ? 'var(--accent)' : 'var(--danger, #e5484d)' }}>{status.text}</small>
      )}
    </div>
  )
}

export default SectionExportImport
