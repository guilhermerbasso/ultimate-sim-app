import { type ReactElement, useCallback, useEffect, useState } from 'react'
import {
  CONFIG_IO_CHANNELS,
  type ConfigDeleteResult,
  type SavedSectionInfo
} from '../../../shared/config-io'

// ─── Pure presentation helpers (exported for unit tests) ───────────────────────

// Runs the per-section deletes for "Excluir tudo". `markRestart` is invoked the
// INSTANT any delete reports a removal, so a later failure (e.g. an IPC throw on
// section k>0) still leaves the restart banner up for the sections already
// removed — instead of swallowing it because the loop never reached the end.
// Stops at the first error (mirroring a thrown IPC) and returns the running
// removed count plus that error, if any.
export async function runDeleteAll(
  ids: readonly string[],
  deleteSection: (id: string) => Promise<ConfigDeleteResult>,
  markRestart: () => void
): Promise<{ removed: number; error: unknown }> {
  let removed = 0
  let error: unknown = null
  for (const id of ids) {
    try {
      const result = await deleteSection(id)
      if (result.removed) {
        removed += 1
        markRestart()
      }
    } catch (err) {
      error = err
      break
    }
  }
  return { removed, error }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${units[unit]}`
}

export function formatModified(modifiedAt: number | null): string {
  if (modifiedAt === null || !Number.isFinite(modifiedAt)) return '—'
  try {
    return new Date(modifiedAt).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return new Date(modifiedAt).toISOString()
  }
}

export function summarizeSaved(items: readonly SavedSectionInfo[]): { savedCount: number; totalBytes: number } {
  let savedCount = 0
  let totalBytes = 0
  for (const item of items) {
    if (item.exists) {
      savedCount += 1
      totalBytes += item.sizeBytes
    }
  }
  return { savedCount, totalBytes }
}

// Compact one-line summary of a section's saved state for the row meta.
export function describeSaved(item: SavedSectionInfo): string {
  if (item.error) return 'erro ao ler (permissão/lock)'
  if (!item.exists) return 'vazio'
  const parts = [formatBytes(item.sizeBytes)]
  if (typeof item.itemCount === 'number') {
    const noun = item.kind === 'dir' ? 'arquivo' : 'entrada'
    parts.push(`${item.itemCount} ${noun}${item.itemCount === 1 ? '' : 's'}`)
  }
  if (item.modifiedAt !== null) parts.push(formatModified(item.modifiedAt))
  return parts.join(' · ')
}

// ─── Component ─────────────────────────────────────────────────────────────────

type Status = { text: string; tone: 'ok' | 'err' } | null

const DANGER = 'var(--danger, #e5484d)'

// "Configurações salvas" panel: lists every allowlisted config store persisted
// under userData (which SURVIVES an app reinstall, hence the user's old flags
// reappearing) and lets the user delete them individually or all at once. After
// a deletion the affected store returns to factory default — but running stores
// are cached in memory, so the panel surfaces a restart prompt (config:relaunch)
// exactly like the import flow. Auth/credentials are never listed or deletable.
export function SavedConfigsPanel(): ReactElement {
  const [items, setItems] = useState<SavedSectionInfo[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>(null)
  const [needsRestart, setNeedsRestart] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await window.ipc.invoke<SavedSectionInfo[]>(CONFIG_IO_CHANNELS.listSaved)
      setItems(list)
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), tone: 'err' })
    }
  }, [])

  useEffect(() => {
    void refresh()
    // Debounce: a "Excluir tudo" of N sections fans out N `config:changed`
    // broadcasts (one per deleteSection); coalesce the bursts into a single
    // re-list instead of triggering ~N full listings back-to-back.
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = window.ipc.subscribe(CONFIG_IO_CHANNELS.changed, () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void refresh()
      }, 150)
    })
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [refresh])

  const deleteOne = async (item: SavedSectionInfo): Promise<void> => {
    if (
      !window.confirm(
        `Excluir a configuração salva de "${item.label}"? Ela volta ao padrão de fábrica. ` +
          'Esta ação não pode ser desfeita.'
      )
    ) {
      return
    }
    setBusy(item.id)
    setStatus(null)
    try {
      const result = await window.ipc.invoke<ConfigDeleteResult>(CONFIG_IO_CHANNELS.deleteSection, item.id)
      if (result.removed) {
        setNeedsRestart(true)
        setStatus({ text: `"${item.label}" excluído. Reinicie para aplicar.`, tone: 'ok' })
      } else {
        setStatus({ text: `"${item.label}" já estava vazio.`, tone: 'ok' })
      }
      await refresh()
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), tone: 'err' })
    } finally {
      setBusy(null)
    }
  }

  const deleteAll = async (): Promise<void> => {
    const saved = (items ?? []).filter((item) => item.exists)
    if (saved.length === 0) return
    if (
      !window.confirm(
        `Excluir TODAS as ${saved.length} configurações salvas? Tudo volta ao padrão de fábrica. ` +
          'Esta ação não pode ser desfeita.'
      )
    ) {
      return
    }
    setBusy('all')
    setStatus(null)
    try {
      // markRestart fires on the FIRST successful removal, so a partial failure
      // still surfaces the restart prompt for whatever was already deleted.
      const { removed, error } = await runDeleteAll(
        saved.map((item) => item.id),
        (id) => window.ipc.invoke<ConfigDeleteResult>(CONFIG_IO_CHANNELS.deleteSection, id),
        () => setNeedsRestart(true)
      )
      if (error) {
        setStatus({ text: error instanceof Error ? error.message : String(error), tone: 'err' })
      } else {
        setStatus({
          text: `${removed} configuraç${removed === 1 ? 'ão' : 'ões'} excluída${removed === 1 ? '' : 's'}. Reinicie para aplicar.`,
          tone: 'ok'
        })
      }
      await refresh()
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), tone: 'err' })
    } finally {
      setBusy(null)
    }
  }

  const restartNow = async (): Promise<void> => {
    // The main process exits the renderer as it relaunches; never resolves.
    await window.ipc.invoke(CONFIG_IO_CHANNELS.relaunch).catch(() => {})
  }

  const summary = items ? summarizeSaved(items) : { savedCount: 0, totalBytes: 0 }
  const loading = items === null

  return (
    <div className="panel-card" style={{ display: 'grid', gap: 12 }}>
      <div>
        <span className="field-label" style={{ margin: 0 }}>
          Configurações salvas
        </span>
        <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 13 }}>
          Suas configurações ficam gravadas na pasta de dados do app (<code>userData</code>) e{' '}
          <strong>continuam lá mesmo depois de desinstalar/reinstalar</strong> — por isso flags e perfis que você desenhou
          antes reaparecem. Aqui você vê o que está salvo e pode excluir. Após excluir, <strong>reinicie o app</strong>{' '}
          para aplicar (a seção volta ao padrão de fábrica). Login e credenciais NUNCA aparecem nem podem ser excluídos
          por aqui.
        </p>
        {items && (
          <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 12 }}>
            {summary.savedCount === 0
              ? 'Nada salvo no momento.'
              : `${summary.savedCount} de ${items.length} seções com dados salvos · ${formatBytes(summary.totalBytes)} no total.`}
          </p>
        )}
      </div>

      <div
        className="status-list"
        style={{
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm, 8px)',
          overflow: 'hidden'
        }}
      >
        {loading && (
          <div style={{ padding: '12px 14px', color: 'var(--muted)', fontSize: 13 }}>Carregando…</div>
        )}
        {items?.map((item, index) => (
          <div
            key={item.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 14px',
              borderTop: index === 0 ? 'none' : '1px solid var(--border-subtle)',
              opacity: item.exists ? 1 : 0.6
            }}
          >
            <span style={{ minWidth: 0 }}>
              <strong style={{ display: 'block' }}>{item.label}</strong>
              <small style={{ color: item.exists ? 'var(--muted)' : DANGER, fontSize: 12 }}>
                {describeSaved(item)}
              </small>
            </span>
            <button
              className="ghost-action danger compact"
              disabled={!item.exists || busy !== null}
              onClick={() => void deleteOne(item)}
              title={item.exists ? `Excluir configuração salva: ${item.label}` : 'Nada salvo nesta seção'}
              type="button"
            >
              {busy === item.id ? 'Excluindo…' : 'Excluir'}
            </button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          className="ghost-action danger"
          disabled={busy !== null || summary.savedCount === 0}
          onClick={() => void deleteAll()}
          type="button"
        >
          {busy === 'all' ? 'Excluindo…' : 'Excluir tudo'}
        </button>
        <button className="ghost-action compact" disabled={busy !== null} onClick={() => void refresh()} type="button">
          Atualizar
        </button>
        {status && (
          <small style={{ color: status.tone === 'ok' ? 'var(--success)' : DANGER }}>{status.text}</small>
        )}
      </div>

      {needsRestart && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span
            title="As seções já carregadas na memória só voltam ao padrão quando o app reinicia."
            style={{
              background: DANGER,
              color: '#fff',
              borderRadius: 6,
              padding: '2px 10px',
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: 'nowrap'
            }}
          >
            Reinicie para aplicar
          </span>
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>
            A configuração foi removida do disco, mas só sai da memória ao reiniciar.
          </span>
          <button className="primary-action" onClick={() => void restartNow()} type="button">
            Reiniciar agora
          </button>
        </div>
      )}
    </div>
  )
}

export default SavedConfigsPanel
