// Career & Ratings Hub — renderer view.
//
// A progression dashboard for a serious iRacing GT3 racer: iRating & Safety
// Rating history, license/class standings, an incident trend, recent races,
// per-discipline career stats and recent per-car / per-track strengths.
//
// All data arrives already normalized from the `career:` main module (human SR
// floats, 1-based positions, car names resolved). This view only formats and
// lays it out. It reuses the track-map embedded-browser session for auth, so the
// "not logged in" state points the user at the same iRacing web login.
//
// Charts are dependency-free SVG (see ./career/charts). Pure-black surfaces,
// hairline borders, tabular numerics — clean motorsport aesthetic.

import { type CSSProperties, type ReactElement, useCallback, useEffect, useMemo, useState } from 'react'
import type { AppViewProps } from '../App'
import {
  CAREER_CHANNELS,
  careerCategoryLabel,
  type CareerActiveSeason,
  type CareerCategoryCharts,
  type CareerCategoryStat,
  type CareerChartsResult,
  type CareerDivision,
  type CareerEnrichmentResult,
  type CareerLeague,
  type CareerLicense,
  type CareerOverview,
  type CareerProfile,
  type CareerRecentRace,
  type CareerRecentResult,
  type CareerStatus,
  type CareerStrength,
  type CareerUpdatedEvent,
  type CareerYearlyStat
} from '../../../shared/career'
import {
  DRIVER_NOTES_CHANNELS,
  DRIVER_TAG_OPTIONS,
  type DriverNote,
  type DriverNoteInput,
  type DriverNotesListResult,
  type DriverNotesUpdatedEvent,
  type DriverTag
} from '../../../shared/driver-notes'
import type { DriverEntry, TelemetrySnapshot } from '../../../shared/telemetry'
import { TRACK_MAP_CHANNELS, type TrackMapBrowserLoginResult } from '../../../shared/track-map'
import {
  TRADING_PAINTS_CHANNELS,
  type TradingPaintsClientInfo,
  type TradingPaintsDriverInput,
  type TradingPaintsDriverPaintStatus,
  type TradingPaintsStatusResult
} from '../../../shared/trading-paints'
import { getLatestTelemetry, onTelemetry } from '../lib/telemetry'
import { SectionExportImport } from '../components/SectionExportImport'
import { HistoryChart, IncidentTrendChart } from './career/charts'

const IRATING_COLOR = 'var(--accent-primary)'
const SR_COLOR = 'var(--accent-success)'

// ─── Styles ───────────────────────────────────────────────────────────────────
const column: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16 }

const card: CSSProperties = {
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--surface-raised)',
  padding: 16
}

const eyebrow: CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--accent-primary)',
  fontWeight: 600
}

const heading: CSSProperties = { margin: '4px 0 0', fontSize: 20, color: 'var(--text-primary)', letterSpacing: '0.01em' }
const muted: CSSProperties = { color: 'var(--text-secondary)', fontSize: 13 }
const sectionTitle: CSSProperties = { margin: 0, fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-secondary)' }
const guidedEmptyCopy = 'Conecte ao iRacing ou escolha Demo (mock) para ver dados.'
const guidedEmptyState: CSSProperties = {
  margin: 0,
  padding: 14,
  border: '1px dashed var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface-sunken)',
  color: 'var(--text-muted)',
  fontSize: 13,
  lineHeight: 1.45
}

const button: CSSProperties = {
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface-overlay)',
  color: 'var(--text-primary)',
  padding: '8px 14px',
  fontSize: 13,
  cursor: 'pointer'
}

const primaryButton: CSSProperties = {
  ...button,
  border: '1px solid var(--border-accent)',
  background: 'var(--accent-primary)',
  color: 'var(--text-on-accent)',
  fontWeight: 600
}

const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const th: CSSProperties = {
  textAlign: 'right',
  padding: '7px 10px',
  borderBottom: '1px solid var(--border-default)',
  color: 'var(--text-muted)',
  fontWeight: 600,
  fontSize: 11,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap'
}
const thLeft: CSSProperties = { ...th, textAlign: 'left' }
const td: CSSProperties = {
  textAlign: 'right',
  padding: '7px 10px',
  borderBottom: '1px solid var(--border-subtle)',
  color: 'var(--text-primary)',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap'
}
const tdLeft: CSSProperties = { ...td, textAlign: 'left' }

const chip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-pill)',
  padding: '4px 10px',
  fontSize: 12,
  color: 'var(--text-secondary)',
  background: 'var(--surface-sunken)'
}

const inputStyle: CSSProperties = {
  width: '100%',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface-sunken)',
  color: 'var(--text-primary)',
  padding: '8px 10px',
  fontSize: 12
}

const smallButton: CSSProperties = {
  ...button,
  padding: '6px 10px',
  fontSize: 12
}

type CareerTab = 'career' | 'profile' | 'drivers' | 'paints'

// ─── Formatting helpers ─────────────────────────────────────────────────────────
function fmtInt(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '—' : Math.round(value).toLocaleString('pt-BR')
}

function fmtSR(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(2)
}

function fmtOne(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(1)
}

function fmtPct(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`
}

function fmtSignedInt(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0'
  const sign = value > 0 ? '+' : '−'
  return `${sign}${Math.abs(Math.round(value)).toLocaleString('pt-BR')}`
}

function fmtDate(when: string): string {
  const ms = Date.parse(when)
  if (!Number.isFinite(ms)) return '—'
  return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function fmtDateTime(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return 'nunca'
  return new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function fmtRelativeTime(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '—'
  const diffDays = Math.max(0, Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000)))
  if (diffDays === 0) return 'hoje'
  if (diffDays === 1) return 'ontem'
  return `${diffDays} dias`
}

function deltaColor(value: number): string {
  if (value > 0) return 'var(--accent-success)'
  if (value < 0) return 'var(--text-danger)'
  return 'var(--text-secondary)'
}

function positionLabel(position: number, fieldSize?: number): string {
  if (!Number.isFinite(position) || position <= 0) return '—'
  return fieldSize && fieldSize > 0 ? `P${position}/${fieldSize}` : `P${position}`
}

// PT-BR status banner copy for each auth state.
function statusHint(status: CareerStatus): { text: string; tone: string } | null {
  switch (status.auth) {
    case 'loading':
      return { text: 'Atualizando dados da iRacing…', tone: 'var(--text-secondary)' }
    case 'rate-limited':
      return { text: 'Limite de requisições da iRacing atingido. Mostrando dados em cache.', tone: 'var(--accent-warning)' }
    case 'error':
      return { text: status.message ? `Erro ao atualizar: ${status.message}. Mostrando cache.` : 'Erro ao atualizar. Mostrando cache.', tone: 'var(--accent-warning)' }
    case 'needs-login':
      return {
        text:
          status.message ??
          'O iRacing desativou o login legado e pausou novos apps OAuth; telemetria, mapa, radar, relatives, dashboards e overlays funcionam sem login.',
        tone: 'var(--accent-warning)'
      }
    default:
      return null
  }
}

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return window.ipc.invoke<T>(channel, ...args)
}

function tagLabel(tag: DriverTag): string {
  switch (tag) {
    case 'clean':
      return 'Limpo'
    case 'aggressive':
      return 'Agressivo'
    case 'avoid':
      return 'Evitar'
    case 'fast':
      return 'Rápido'
    case 'friend':
      return 'Amigo'
    default:
      return 'Sem tag'
  }
}

function tagColor(tag: DriverTag): string {
  switch (tag) {
    case 'clean':
      return 'var(--accent-success)'
    case 'aggressive':
      return 'var(--accent-warning)'
    case 'avoid':
      return 'var(--text-danger)'
    case 'fast':
      return 'var(--accent-primary)'
    case 'friend':
      return '#49C5B1'
    default:
      return 'var(--text-muted)'
  }
}

function validTag(value: string): value is DriverTag {
  return DRIVER_TAG_OPTIONS.includes(value as DriverTag)
}

// ─── Sub-components ──────────────────────────────────────────────────────────────
function StatTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }): ReactElement {
  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-sunken)', padding: '12px 14px', minWidth: 0 }}>
      <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: accent ?? 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', marginTop: 4, lineHeight: 1.1 }}>{value}</div>
      {sub ? <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{sub}</div> : null}
    </div>
  )
}

function GuidedEmptyState({ style }: { style?: CSSProperties }): ReactElement {
  return <p style={{ ...guidedEmptyState, ...style }}>{guidedEmptyCopy}</p>
}

function LicenseCard({ license }: { license: CareerLicense }): ReactElement {
  const classColor = license.color ? `#${license.color}` : 'var(--accent-primary)'
  return (
    <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-sunken)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{careerCategoryLabel(license.categoryId, license.category)}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: classColor, display: 'inline-block' }} />
          {license.groupName}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 18 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>iRating</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{fmtInt(license.iRating)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Safety</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: SR_COLOR, fontVariantNumeric: 'tabular-nums' }}>{fmtSR(license.safetyRating)}</div>
        </div>
        {license.cpi !== undefined ? (
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>CPI</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{fmtInt(license.cpi)}</div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function StrengthTable({ title, scope, rows }: { title: string; scope: string; rows: CareerStrength[] }): ReactElement {
  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
        <h3 style={sectionTitle}>{title}</h3>
        <p style={{ ...muted, margin: '4px 0 0', fontSize: 11 }}>{scope}</p>
      </div>
      {rows.length === 0 ? (
        <GuidedEmptyState style={{ margin: 14 }} />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thLeft}>Nome</th>
                <th style={th}>Corridas</th>
                <th style={th}>Vit.</th>
                <th style={th}>Melhor</th>
                <th style={th}>Chegada méd.</th>
                <th style={th}>Inc. méd.</th>
                <th style={th}>Δ iR méd.</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 8).map((row) => (
                <tr key={row.id}>
                  <td style={{ ...tdLeft, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.name}</td>
                  <td style={td}>{row.starts}</td>
                  <td style={td}>{row.wins}</td>
                  <td style={td}>{positionLabel(row.bestFinish)}</td>
                  <td style={td}>{fmtOne(row.avgFinish)}</td>
                  <td style={td}>{fmtOne(row.avgIncidents)}</td>
                  <td style={{ ...td, color: deltaColor(row.avgIRatingDelta) }}>{fmtSignedInt(row.avgIRatingDelta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function TabSwitcher({ activeTab, onChange }: { activeTab: CareerTab; onChange: (tab: CareerTab) => void }): ReactElement {
  const tabs: Array<{ id: CareerTab; label: string }> = [
    { id: 'career', label: 'Carreira' },
    { id: 'profile', label: 'Perfil & Séries' },
    { id: 'drivers', label: 'Pilotos' },
    { id: 'paints', label: 'Paints' }
  ]
  return (
    <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} aria-label="Abas da carreira">
      {tabs.map((tab) => {
        const active = tab.id === activeTab
        return (
          <button
            key={tab.id}
            type="button"
            style={{
              ...chip,
              cursor: 'pointer',
              color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)',
              background: active ? 'var(--accent-primary)' : 'var(--surface-sunken)',
              borderColor: active ? 'var(--border-accent)' : 'var(--border-default)'
            }}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}

function DriverTagBadge({ tag }: { tag: DriverTag }): ReactElement {
  return (
    <span style={{ ...chip, padding: '3px 8px', fontSize: 11 }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: tagColor(tag), display: 'inline-block' }} />
      {tagLabel(tag)}
    </span>
  )
}

function DriverNoteEditor({
  custId,
  note,
  onSave,
  onRemove
}: {
  custId: number
  note?: DriverNote
  onSave: (input: DriverNoteInput) => Promise<void>
  onRemove: (custId: number) => Promise<void>
}): ReactElement {
  const [tag, setTag] = useState<DriverTag>(note?.tag ?? 'none')
  const [noteText, setNoteText] = useState(note?.note ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setTag(note?.tag ?? 'none')
    setNoteText(note?.note ?? '')
  }, [note])

  const save = useCallback(async (nextTag = tag, nextNote = noteText) => {
    setSaving(true)
    try {
      await onSave({
        custId,
        tag: nextTag,
        note: nextNote,
        color: tagColor(nextTag)
      })
    } finally {
      setSaving(false)
    }
  }, [custId, noteText, onSave, tag])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 160px) minmax(180px, 1fr) auto auto', gap: 8, alignItems: 'center' }}>
      <select
        style={inputStyle}
        value={tag}
        onChange={(event) => {
          const nextTag = validTag(event.currentTarget.value) ? event.currentTarget.value : 'none'
          setTag(nextTag)
          void save(nextTag)
        }}
      >
        {DRIVER_TAG_OPTIONS.map((option) => (
          <option key={option} value={option}>{tagLabel(option)}</option>
        ))}
      </select>
      <input
        style={inputStyle}
        value={noteText}
        placeholder="Nota livre"
        onChange={(event) => setNoteText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void save()
        }}
      />
      <button type="button" style={smallButton} disabled={saving} onClick={() => void save()}>
        {saving ? 'Salvando…' : 'Salvar'}
      </button>
      <button type="button" style={smallButton} disabled={!note || saving} onClick={() => void onRemove(custId)}>
        Remover
      </button>
    </div>
  )
}

function paintStatusCopy(status: TradingPaintsDriverPaintStatus['status']): { label: string; color: string; background: string; border: string } {
  switch (status) {
    case 'downloaded':
      return { label: 'Baixado', color: 'var(--accent-success)', background: 'rgba(40, 180, 120, 0.12)', border: 'rgba(40, 180, 120, 0.35)' }
    case 'stale':
      return { label: 'Antigo', color: '#D7A75C', background: 'rgba(215, 167, 92, 0.12)', border: 'rgba(215, 167, 92, 0.38)' }
    default:
      return { label: 'Ausente', color: '#D7A75C', background: 'rgba(215, 167, 92, 0.08)', border: 'rgba(215, 167, 92, 0.28)' }
  }
}

function PaintStatusBadge({ status }: { status: TradingPaintsDriverPaintStatus['status'] }): ReactElement {
  const copy = paintStatusCopy(status)
  return (
    <span
      style={{
        ...chip,
        color: copy.color,
        background: copy.background,
        borderColor: copy.border,
        fontWeight: 600
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 999, background: copy.color, display: 'inline-block' }} />
      {copy.label}
    </span>
  )
}

function PaintsTab({ showToast }: { showToast: AppViewProps['showToast'] }): ReactElement {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null)
  const [client, setClient] = useState<TradingPaintsClientInfo | null>(null)
  const [result, setResult] = useState<TradingPaintsStatusResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [opening, setOpening] = useState(false)

  useEffect(() => {
    void getLatestTelemetry().then(setSnapshot).catch(() => undefined)
    void invoke<TradingPaintsClientInfo>(TRADING_PAINTS_CHANNELS.clientInfo)
      .then(setClient)
      .catch((error) => showToast(error instanceof Error ? error.message : String(error), 'error'))
    const unsubscribeTelemetry = onTelemetry(setSnapshot)
    return () => unsubscribeTelemetry()
  }, [showToast])

  const drivers = useMemo(() => {
    const entries = snapshot?.drivers ?? []
    return entries
      .filter((driver) => !driver.isPlayer && Number.isInteger(driver.custId) && (driver.custId ?? 0) > 0 && Boolean(driver.carPath))
      .sort((a, b) => (a.position || 999) - (b.position || 999))
  }, [snapshot])

  const requestDrivers = useMemo<TradingPaintsDriverInput[]>(
    () => drivers.map((driver) => ({
      custId: driver.custId,
      carPath: driver.carPath,
      name: driver.name,
      carNumber: driver.carNumber
    })),
    [drivers]
  )
  const driversSignature = useMemo(
    () => requestDrivers.map((driver) => `${driver.custId}:${driver.carPath}:${driver.name}:${driver.carNumber}`).join('|'),
    [requestDrivers]
  )

  useEffect(() => {
    let active = true
    setLoading(true)
    void invoke<TradingPaintsStatusResult>(TRADING_PAINTS_CHANNELS.status, { drivers: requestDrivers })
      .then((next) => {
        if (active) setResult(next)
      })
      .catch((error) => {
        if (active) showToast(error instanceof Error ? error.message : String(error), 'error')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [driversSignature, showToast])

  const statusesByCustId = useMemo(() => new Map((result?.statuses ?? []).map((item) => [item.custId, item])), [result])
  const downloaded = result?.statuses.filter((item) => item.status === 'downloaded').length ?? 0
  const stale = result?.statuses.filter((item) => item.status === 'stale').length ?? 0
  const missing = result?.statuses.filter((item) => item.status === 'missing').length ?? 0

  const openTradingPaints = useCallback(async () => {
    setOpening(true)
    try {
      const opened = await invoke<{ ok: boolean; message?: string }>(TRADING_PAINTS_CHANNELS.openClient)
      if (opened.message) showToast(opened.message, 'info')
      const nextClient = await invoke<TradingPaintsClientInfo>(TRADING_PAINTS_CHANNELS.clientInfo)
      setClient(nextClient)
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setOpening(false)
    }
  }, [showToast])

  return (
    <>
      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <h3 style={sectionTitle}>Trading Paints client</h3>
            <p style={{ ...muted, margin: '6px 0 0' }}>
              Status observacional: o app oficial baixa os arquivos; o Hub só detecta presença local.
            </p>
          </div>
          <button type="button" style={client?.installed ? button : primaryButton} disabled={opening} onClick={() => void openTradingPaints()}>
            {opening ? 'Abrindo…' : client?.installed ? 'Abrir Trading Paints' : 'Instalar Trading Paints'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          <span style={chip}>
            Cliente: <strong style={{ color: client?.installed ? 'var(--accent-success)' : '#D7A75C' }}>{client?.installed ? 'instalado' : 'não detectado'}</strong>
          </span>
          <span style={chip}>Plataforma: {client?.platform ?? '—'}</span>
          {result?.supported === false ? <span style={{ ...chip, color: '#D7A75C' }}>Monitoramento disponível no Windows</span> : null}
        </div>
      </section>

      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <div>
            <h3 style={sectionTitle}>Paints dos adversários</h3>
            <p style={{ ...muted, margin: '6px 0 0' }}>Checa Documents/iRacing/paint/&lt;carPath&gt; para cada Cust ID da sessão atual.</p>
          </div>
          <span style={muted}>{snapshot?.connected ? `${drivers.length} adversários` : 'Telemetria desconectada'}</span>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          <span style={chip}>Baixados: {downloaded}</span>
          <span style={chip}>Antigos: {stale}</span>
          <span style={chip}>Ausentes: {missing}</span>
          {loading ? <span style={chip}>Atualizando…</span> : null}
        </div>

        {drivers.length === 0 ? (
          <p style={{ ...muted, margin: '14px 0 0' }}>Nenhum adversário com Cust ID e carPath na sessão atual.</p>
        ) : result?.supported === false ? (
          <p style={{ ...muted, margin: '14px 0 0' }}>No Mac, esta aba só valida tipos. A checagem real das pastas do iRacing precisa de Windows.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
            {drivers.map((driver) => {
              const status = statusesByCustId.get(driver.custId ?? 0)
              return (
                <div key={`${driver.custId}-${driver.carPath}`} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-sunken)', padding: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) auto', gap: 12, alignItems: 'center' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <strong style={{ color: 'var(--text-primary)' }}>{driver.name}</strong>
                        <span style={muted}>#{driver.carNumber}</span>
                      </div>
                      <div style={{ ...muted, fontSize: 11, marginTop: 3 }}>
                        Cust ID #{driver.custId} · {driver.carPath}
                        {status?.fileName ? ` · ${status.fileName} · ${fmtRelativeTime(status.mtimeMs)}` : ''}
                      </div>
                    </div>
                    <PaintStatusBadge status={status?.status ?? 'missing'} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </>
  )
}

function DriversTab({ showToast }: { showToast: AppViewProps['showToast'] }): ReactElement {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null)
  const [notes, setNotes] = useState<DriverNote[]>([])

  const loadNotes = useCallback(async () => {
    const result = await invoke<DriverNotesListResult>(DRIVER_NOTES_CHANNELS.list)
    setNotes(result.notes)
  }, [])

  useEffect(() => {
    void loadNotes().catch((error) => showToast(error instanceof Error ? error.message : String(error), 'error'))
    void getLatestTelemetry().then(setSnapshot).catch(() => undefined)
    const unsubscribeNotes = window.ipc.subscribe<DriverNotesUpdatedEvent>(DRIVER_NOTES_CHANNELS.updated, (event) => {
      setNotes(event.notes)
    })
    const unsubscribeTelemetry = onTelemetry(setSnapshot)
    return () => {
      unsubscribeNotes()
      unsubscribeTelemetry()
    }
  }, [loadNotes, showToast])

  const notesByCustId = useMemo(() => new Map(notes.map((note) => [note.custId, note])), [notes])
  const drivers = useMemo(() => {
    const entries = snapshot?.drivers ?? []
    return entries
      .filter((driver) => !driver.isPlayer && Number.isInteger(driver.custId) && (driver.custId ?? 0) > 0)
      .sort((a, b) => (a.position || 999) - (b.position || 999))
  }, [snapshot])
  const driversByCustId = useMemo(() => new Map(drivers.map((driver) => [driver.custId, driver])), [drivers])

  const saveNote = useCallback(async (input: DriverNoteInput) => {
    try {
      const saved = await invoke<DriverNote>(DRIVER_NOTES_CHANNELS.set, input)
      setNotes((current) => [saved, ...current.filter((note) => note.custId !== saved.custId)])
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }, [showToast])

  const removeNote = useCallback(async (custId: number) => {
    try {
      const result = await invoke<DriverNotesListResult>(DRIVER_NOTES_CHANNELS.remove, custId)
      setNotes(result.notes)
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }, [showToast])

  return (
    <>
      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <div>
            <h3 style={sectionTitle}>Pilotos da sessão atual</h3>
            <p style={{ ...muted, margin: '6px 0 0' }}>Tags salvas por Cust ID estável da iRacing.</p>
          </div>
          <span style={muted}>{snapshot?.connected ? `${drivers.length} adversários` : 'Telemetria desconectada'}</span>
        </div>
        {drivers.length === 0 ? (
          <p style={{ ...muted, margin: '14px 0 0' }}>Nenhum piloto com Cust ID na sessão atual.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
            {drivers.map((driver) => {
              const note = notesByCustId.get(driver.custId ?? 0)
              return (
                <DriverRow
                  key={driver.custId}
                  driver={driver}
                  note={note}
                  onSave={saveNote}
                  onRemove={removeNote}
                />
              )
            })}
          </div>
        )}
      </section>

      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={sectionTitle}>Notas salvas</h3>
          <SectionExportImport sectionId="driver-notes" label="Anotações do piloto" onImported={() => void loadNotes().catch((error) => showToast(error instanceof Error ? error.message : String(error), 'error'))} />
        </div>
        {notes.length === 0 ? (
          <p style={{ ...muted, margin: '10px 0 0' }}>Nenhum piloto anotado ainda.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
            {notes.map((note) => {
              const driver = driversByCustId.get(note.custId)
              return (
                <div key={note.custId} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-sunken)', padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{driver?.name ?? `Cust ID #${note.custId}`}</div>
                      <div style={{ ...muted, fontSize: 11 }}>
                        Cust ID #{note.custId}{driver?.carNumber ? ` · #${driver.carNumber}` : ''} · Atualizado {fmtDateTime(note.updatedAt)}
                      </div>
                    </div>
                    <DriverTagBadge tag={note.tag} />
                  </div>
                  <DriverNoteEditor custId={note.custId} note={note} onSave={saveNote} onRemove={removeNote} />
                </div>
              )
            })}
          </div>
        )}
      </section>
    </>
  )
}

function DriverRow({
  driver,
  note,
  onSave,
  onRemove
}: {
  driver: DriverEntry
  note?: DriverNote
  onSave: (input: DriverNoteInput) => Promise<void>
  onRemove: (custId: number) => Promise<void>
}): ReactElement {
  const custId = driver.custId ?? 0
  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-sunken)', padding: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) auto', gap: 12, alignItems: 'center', marginBottom: 10 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ color: 'var(--text-primary)' }}>{driver.name}</strong>
            <span style={muted}>#{driver.carNumber}</span>
            <DriverTagBadge tag={note?.tag ?? 'none'} />
          </div>
          <div style={{ ...muted, fontSize: 11, marginTop: 3 }}>
            Cust ID #{custId} · iRating {fmtInt(driver.iRating)}{driver.teamName ? ` · ${driver.teamName}` : ''}
          </div>
        </div>
        <span style={{ ...chip, fontVariantNumeric: 'tabular-nums' }}>P{driver.position || '—'}</span>
      </div>
      <DriverNoteEditor custId={custId} note={note} onSave={onSave} onRemove={onRemove} />
    </div>
  )
}


// ─── ProfileTab ───────────────────────────────────────────────────────────────
function HelmetBadge({ color1, color2 }: { color1?: string; color2?: string }): ReactElement {
  const c1 = color1 ? `#${color1}` : 'var(--accent-primary)'
  const c2 = color2 ? `#${color2}` : 'var(--surface-overlay)'
  return (
    <svg width="32" height="24" viewBox="0 0 32 24" style={{ flexShrink: 0 }}>
      <ellipse cx="16" cy="14" rx="14" ry="9" fill={c1} />
      <ellipse cx="16" cy="11" rx="10" ry="7" fill={c2} opacity="0.55" />
      <ellipse cx="16" cy="14" rx="14" ry="9" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" />
    </svg>
  )
}

function YearlyStatsTable({ rows }: { rows: CareerYearlyStat[] }): ReactElement {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.year - a.year || b.starts - a.starts),
    [rows]
  )
  if (sorted.length === 0) return <GuidedEmptyState />
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thLeft}>Ano</th>
            <th style={thLeft}>Disciplina</th>
            <th style={th}>Corridas</th>
            <th style={th}>Vitórias</th>
            <th style={th}>Top 5</th>
            <th style={th}>Vit.%</th>
            <th style={th}>Chegada méd.</th>
            <th style={th}>Inc. méd.</th>
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, 30).map((row, i) => (
            <tr key={`${row.year}-${row.categoryId}-${i}`}>
              <td style={tdLeft}>{row.year}</td>
              <td style={{ ...tdLeft, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {careerCategoryLabel(row.categoryId, row.category)}
              </td>
              <td style={td}>{fmtInt(row.starts)}</td>
              <td style={{ ...td, color: row.wins > 0 ? 'var(--accent-primary)' : undefined }}>{fmtInt(row.wins)}</td>
              <td style={td}>{fmtInt(row.top5)}</td>
              <td style={td}>{fmtPct(row.winPercentage)}</td>
              <td style={td}>{fmtOne(row.avgFinishPosition)}</td>
              <td style={td}>{fmtOne(row.avgIncidents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LeagueList({ leagues }: { leagues: CareerLeague[] }): ReactElement {
  if (leagues.length === 0) {
    return <p style={{ ...muted, margin: '10px 0 0' }}>Nenhuma liga encontrada.</p>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
      {leagues.map((league) => (
        <div
          key={league.leagueId}
          style={{
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--surface-sunken)',
            padding: '10px 14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12
          }}
        >
          <div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13 }}>{league.leagueName}</div>
            <div style={{ ...muted, fontSize: 11, marginTop: 2 }}>
              ID #{league.leagueId}
              {league.rosterCount !== undefined ? ` · ${league.rosterCount} membros` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {league.owner ? <span style={{ ...chip, fontSize: 11, color: 'var(--accent-primary)' }}>Dono</span> : null}
            {league.admin && !league.owner ? <span style={{ ...chip, fontSize: 11 }}>Admin</span> : null}
          </div>
        </div>
      ))}
    </div>
  )
}

function SeasonsList({ seasons }: { seasons: CareerActiveSeason[] }): ReactElement {
  if (seasons.length === 0) {
    return <p style={{ ...muted, margin: '10px 0 0' }}>Nenhuma temporada ativa encontrada para a disciplina principal.</p>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
      {seasons.slice(0, 15).map((s) => (
        <div
          key={s.seasonId}
          style={{
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--surface-sunken)',
            padding: '10px 14px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13 }}>{s.seriesName}</div>
              <div style={{ ...muted, fontSize: 11, marginTop: 2 }}>{s.seasonName}</div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
              {s.official ? <span style={{ ...chip, fontSize: 11 }}>Oficial</span> : <span style={{ ...chip, fontSize: 11, color: 'var(--text-muted)' }}>Informal</span>}
              {s.fixedSetup ? <span style={{ ...chip, fontSize: 11, color: 'var(--text-muted)' }}>Setup fixo</span> : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function DivisionBadge({ division }: { division: CareerDivision }): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <StatTile label="Divisão" value={String(division.division)} />
      {division.rank > 0 ? <StatTile label="Posição" value={`#${division.rank}`} /> : null}
      {division.points > 0 ? <StatTile label="Pontos" value={fmtInt(division.points)} /> : null}
    </div>
  )
}

function ProfileTab({
  profile,
  yearly,
  leagues,
  division,
  activeSeasonsForPrimary,
  loading
}: {
  profile: CareerProfile | null
  yearly: CareerYearlyStat[]
  leagues: CareerLeague[]
  division: CareerDivision | null
  activeSeasonsForPrimary: CareerActiveSeason[]
  loading: boolean
}): ReactElement {
  return (
    <>
      {/* Member profile card */}
      {profile ? (
        <section style={card}>
          <h3 style={sectionTitle}>Perfil do piloto</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
            <HelmetBadge color1={profile.helmetColor1} color2={profile.helmetColor2} />
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {profile.clubName ? (
                <div>
                  <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Clube</div>
                  <div style={{ fontSize: 14, color: 'var(--text-primary)', marginTop: 2 }}>{profile.clubName}</div>
                </div>
              ) : null}
              {profile.memberSince ? (
                <div>
                  <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Membro desde</div>
                  <div style={{ fontSize: 14, color: 'var(--text-primary)', marginTop: 2 }}>{fmtDate(profile.memberSince)}</div>
                </div>
              ) : null}
            </div>
          </div>
          {division ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ ...sectionTitle, marginBottom: 10 }}>Divisão (temporada atual)</div>
              <DivisionBadge division={division} />
            </div>
          ) : null}
        </section>
      ) : loading ? (
        <section style={{ ...card, padding: '14px 16px' }}>
          <span style={muted}>Carregando perfil…</span>
        </section>
      ) : null}

      {/* Yearly stats */}
      <section style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px 0' }}>
          <h3 style={sectionTitle}>Estatísticas anuais</h3>
          <p style={{ ...muted, margin: '4px 0 12px', fontSize: 11 }}>Resultados por ano e disciplina (máx. 30 linhas).</p>
        </div>
        <YearlyStatsTable rows={yearly} />
      </section>

      {/* Leagues */}
      <section style={card}>
        <h3 style={sectionTitle}>Ligas ({leagues.length})</h3>
        <LeagueList leagues={leagues} />
      </section>

      {/* Active seasons */}
      <section style={card}>
        <h3 style={sectionTitle}>Temporadas ativas (disciplina principal)</h3>
        <p style={{ ...muted, margin: '4px 0 0', fontSize: 11 }}>Séries disponíveis para correr agora na sua disciplina.</p>
        <SeasonsList seasons={activeSeasonsForPrimary} />
      </section>
    </>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────
export default function CareerView({ showToast }: AppViewProps): ReactElement {
  const [overview, setOverview] = useState<CareerOverview | null>(null)
  const [recent, setRecent] = useState<CareerRecentRace[]>([])
  const [chartsByCat, setChartsByCat] = useState<Record<number, CareerCategoryCharts | null>>({})
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [activeTab, setActiveTab] = useState<CareerTab>('career')
  const [enrichment, setEnrichment] = useState<CareerEnrichmentResult | null>(null)
  const [enrichmentLoading, setEnrichmentLoading] = useState(false)

  const status = overview?.status ?? null

  const loadOverview = useCallback(async () => {
    const next = await invoke<CareerOverview>(CAREER_CHANNELS.getOverview)
    setOverview(next)
    setSelectedCategoryId((current) => current ?? next.primaryCategoryId ?? next.availableCategoryIds[0] ?? null)
    return next
  }, [])

  const loadRecent = useCallback(async () => {
    const next = await invoke<CareerRecentResult>(CAREER_CHANNELS.getRecent)
    setRecent(next.races)
  }, [])

  const loadCharts = useCallback(async (categoryId: number, force = false) => {
    if (!force && categoryId in chartsByCat) return
    const result = await invoke<CareerChartsResult>(CAREER_CHANNELS.getCharts, { categoryId })
    setChartsByCat((current) => ({ ...current, [categoryId]: result.charts }))
  }, [chartsByCat])

  const loadEnrichment = useCallback(async () => {
    setEnrichmentLoading(true)
    try {
      const next = await invoke<CareerEnrichmentResult>(CAREER_CHANNELS.getEnrichment)
      setEnrichment(next)
    } catch {
      // Enrichment is best-effort; don't fail the whole view.
    } finally {
      setEnrichmentLoading(false)
    }
  }, [])

  // Initial load + live updates broadcast after every refresh attempt.
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        await Promise.all([loadOverview(), loadRecent(), loadEnrichment()])
      } catch (error) {
        if (active) showToast(error instanceof Error ? error.message : String(error), 'error')
      } finally {
        if (active) setInitialized(true)
      }
    })()
    const unsubscribe = window.ipc.subscribe<CareerUpdatedEvent>(CAREER_CHANNELS.updated, () => {
      void loadOverview().catch(() => undefined)
      void loadRecent().catch(() => undefined)
      void loadEnrichment().catch(() => undefined)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [loadOverview, loadRecent, loadEnrichment, showToast])

  // Lazy-load the selected discipline's history charts on demand.
  useEffect(() => {
    if (selectedCategoryId === null) return
    void loadCharts(selectedCategoryId).catch(() => undefined)
  }, [selectedCategoryId, loadCharts])

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      const next = await invoke<CareerOverview>(CAREER_CHANNELS.refresh)
      setOverview(next)
      const category = selectedCategoryId ?? next.primaryCategoryId ?? next.availableCategoryIds[0] ?? null
      setSelectedCategoryId(category)
      await loadRecent()
      if (category !== null) await loadCharts(category, true)
      if (next.status.auth === 'needs-login') {
        showToast('Data API indisponível; telemetria e overlays continuam sem login.', 'info')
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }, [selectedCategoryId, loadRecent, loadCharts, showToast])

  // Reuse the track-map embedded-browser login; on success, force a refresh.
  const connect = useCallback(async () => {
    setLoggingIn(true)
    try {
      const result = await invoke<TrackMapBrowserLoginResult>(TRACK_MAP_CHANNELS.browserLogin)
      if (result.status === 'ok') {
        await refresh()
      } else {
        showToast(result.message ?? 'Login cancelado.', 'info')
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setLoggingIn(false)
    }
  }, [refresh, showToast])

  const selectedCharts = selectedCategoryId !== null ? chartsByCat[selectedCategoryId] ?? null : null

  const careerRows = useMemo<CareerCategoryStat[]>(
    () => (overview ? [...overview.career].sort((a, b) => b.starts - a.starts) : []),
    [overview]
  )

  const hint = status ? statusHint(status) : null
  const hasIdentity = Boolean(overview?.identity)
  const needsLogin = status?.auth === 'needs-login'

  if (activeTab === 'drivers') {
    return (
      <div style={column}>
        <header style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <span style={eyebrow}>iRacing · Pilotos</span>
            <h2 style={heading}>Tags de adversários</h2>
            <p style={{ ...muted, margin: '6px 0 0' }}>Anote pilotos por Cust ID estável e reencontre essas notas em sessões futuras.</p>
          </div>
        </header>
        <TabSwitcher activeTab={activeTab} onChange={setActiveTab} />
        <DriversTab showToast={showToast} />
      </div>
    )
  }

  if (activeTab === 'paints') {
    return (
      <div style={column}>
        <header style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <span style={eyebrow}>iRacing · Trading Paints</span>
            <h2 style={heading}>Paints da sessão</h2>
            <p style={{ ...muted, margin: '6px 0 0' }}>Observa o cliente oficial e os arquivos locais, sem baixar ou consultar CDN.</p>
          </div>
        </header>
        <TabSwitcher activeTab={activeTab} onChange={setActiveTab} />
        <PaintsTab showToast={showToast} />
      </div>
    )
  }

  if (activeTab === 'profile') {
    const primaryCatId = overview?.primaryCategoryId
    const activeSeasonsForPrimary: CareerActiveSeason[] = enrichment?.activeSeasonsForPrimary ?? []
    return (
      <div style={column}>
        <header style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <span style={eyebrow}>iRacing · Perfil & Séries</span>
            <h2 style={heading}>{overview?.identity?.displayName ?? 'Piloto'}</h2>
            <p style={{ ...muted, margin: '6px 0 0' }}>
              Perfil, divisão, estatísticas anuais, ligas e temporadas ativas na disciplina principal
              {primaryCatId !== undefined && primaryCatId !== null ? ` (${careerCategoryLabel(primaryCatId)})` : ''}.
            </p>
          </div>
          <button type="button" style={button} disabled={enrichmentLoading} onClick={() => void loadEnrichment()}>
            {enrichmentLoading ? 'Carregando…' : 'Atualizar'}
          </button>
        </header>
        <TabSwitcher activeTab={activeTab} onChange={setActiveTab} />
        {!hasIdentity ? (
          <section style={{ ...card, padding: 24 }}>
            <p style={muted}>Conecte sua conta iRacing para ver o perfil enriquecido.</p>
            <button type="button" style={{ ...primaryButton, marginTop: 12 }} disabled={loggingIn} onClick={() => void connect()}>
              {loggingIn ? 'Abrindo login…' : 'Conectar à iRacing'}
            </button>
          </section>
        ) : (
          <ProfileTab
            profile={enrichment?.profile ?? null}
            yearly={enrichment?.yearly ?? []}
            leagues={enrichment?.leagues ?? []}
            division={enrichment?.division ?? null}
            activeSeasonsForPrimary={activeSeasonsForPrimary}
            loading={enrichmentLoading}
          />
        )}
      </div>
    )
  }

    // ── Empty / not-logged-in gate ──────────────────────────────────────────────
  if (!hasIdentity) {
    return (
      <div style={column}>
        <header style={card}>
          <span style={eyebrow}>iRacing</span>
          <h2 style={heading}>Carreira & Ratings</h2>
          <p style={{ ...muted, margin: '8px 0 0', maxWidth: 620 }}>
            Acompanhe sua progressão de iRating, Safety Rating, licenças, incidentes e resultados recentes —
            tudo direto da API da iRacing, com cache offline.
          </p>
        </header>
        <TabSwitcher activeTab={activeTab} onChange={setActiveTab} />
        <section style={{ ...card, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 14, padding: 24 }}>
          <span style={eyebrow}>{needsLogin ? 'Sessão necessária' : 'Conecte sua conta'}</span>
          <h3 style={{ margin: 0, fontSize: 17, color: 'var(--text-primary)' }}>
            {initialized ? 'Conecte sua conta iRacing para carregar sua carreira' : 'Carregando…'}
          </h3>
          <p style={{ ...muted, margin: 0, maxWidth: 560 }}>
            O Hub usa a mesma sessão do navegador embutido dos mapas de pista. Faça login na iRacing
            (resolvendo CAPTCHA/2FA na janela) e os dados aparecem aqui — depois ficam disponíveis offline.
          </p>
          <button type="button" style={primaryButton} disabled={loggingIn} onClick={() => void connect()}>
            {loggingIn ? 'Abrindo login da iRacing…' : 'Conectar à iRacing'}
          </button>
          {hint ? <span style={{ fontSize: 12, color: hint.tone }}>{hint.text}</span> : null}
        </section>
      </div>
    )
  }

  const identity = overview?.identity
  const licenses = overview?.licenses ?? []
  const thisYear = overview?.thisYear ?? null
  const availableCategoryIds = overview?.availableCategoryIds ?? []

  return (
    <div style={column}>
      {/* Header */}
      <header style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <span style={eyebrow}>iRacing · Carreira</span>
          <h2 style={heading}>{identity?.displayName ?? 'Piloto'}</h2>
          <p style={{ ...muted, margin: '6px 0 0' }}>
            Cust ID #{identity?.custId} · Atualizado {fmtDateTime(status?.lastUpdated)}
            {status?.fromCache ? ' · cache' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {needsLogin ? (
            <button type="button" style={primaryButton} disabled={loggingIn} onClick={() => void connect()}>
              {loggingIn ? 'Abrindo login…' : 'Tentar login Data API'}
            </button>
          ) : null}
          <button type="button" style={button} disabled={busy} onClick={() => void refresh()}>
            {busy ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
      </header>

      <TabSwitcher activeTab={activeTab} onChange={setActiveTab} />

      {hint ? (
        <div style={{ ...card, padding: '10px 14px', borderColor: 'var(--border-default)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: hint.tone, display: 'inline-block' }} />
          <span style={{ fontSize: 12, color: hint.tone }}>
            {hint.text}{' '}
            <a href="https://forums.iracing.com/discussion/93956/oauth-client-id-creation" target="_blank" rel="noreferrer" style={{ color: hint.tone, fontWeight: 700 }}>
              OAuth client IDs
            </a>{' '}
            ·{' '}
            <a href="https://support.iracing.com/support/solutions/articles/31000174478" target="_blank" rel="noreferrer" style={{ color: hint.tone, fontWeight: 700 }}>
              suporte iRacing
            </a>
          </span>
        </div>
      ) : null}

      {/* Licenses */}
      <section style={card}>
        <h3 style={sectionTitle}>Licenças & Ratings atuais</h3>
        {licenses.length === 0 ? (
          <GuidedEmptyState style={{ marginTop: 12 }} />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, marginTop: 12 }}>
            {licenses.map((license) => (
              <LicenseCard key={license.categoryId} license={license} />
            ))}
          </div>
        )}
      </section>

      {/* History charts */}
      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <h3 style={sectionTitle}>Histórico de progressão</h3>
          {availableCategoryIds.length > 0 ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {availableCategoryIds.map((categoryId) => {
                const activeCat = categoryId === selectedCategoryId
                return (
                  <button
                    key={categoryId}
                    type="button"
                    onClick={() => setSelectedCategoryId(categoryId)}
                    style={{
                      ...chip,
                      cursor: 'pointer',
                      color: activeCat ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                      background: activeCat ? 'var(--accent-primary)' : 'var(--surface-sunken)',
                      borderColor: activeCat ? 'var(--border-accent)' : 'var(--border-default)'
                    }}
                  >
                    {careerCategoryLabel(categoryId)}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>iRating</span>
              <span style={{ fontSize: 12, color: IRATING_COLOR, fontVariantNumeric: 'tabular-nums' }}>
                {fmtInt(selectedCharts?.iRating.at(-1)?.value)}
              </span>
            </div>
            <HistoryChart points={selectedCharts?.iRating ?? []} color={IRATING_COLOR} valueDigits={0} ariaLabel="Histórico de iRating" />
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Safety Rating</span>
              <span style={{ fontSize: 12, color: SR_COLOR, fontVariantNumeric: 'tabular-nums' }}>
                {fmtSR(selectedCharts?.safetyRating.at(-1)?.value)}
              </span>
            </div>
            <HistoryChart points={selectedCharts?.safetyRating ?? []} color={SR_COLOR} valueDigits={2} ariaLabel="Histórico de Safety Rating" />
          </div>
        </div>
      </section>

      {/* Incident trend + this-year */}
      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 16 }}>
        <div style={card}>
          <h3 style={sectionTitle}>Tendência de incidentes</h3>
          <p style={{ ...muted, margin: '4px 0 12px', fontSize: 11 }}>Incidentes por corrida nas corridas recentes (mais antigas → recentes).</p>
          <IncidentTrendChart points={overview?.incidentTrend ?? []} />
        </div>
        <div style={card}>
          <h3 style={sectionTitle}>Este ano</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
            <StatTile label="Largadas oficiais" value={fmtInt(thisYear?.officialStarts)} />
            <StatTile label="Vitórias oficiais" value={fmtInt(thisYear?.officialWins)} accent="var(--accent-primary)" />
            <StatTile label="Largadas liga" value={fmtInt(thisYear?.leagueStarts)} />
            <StatTile label="Vitórias liga" value={fmtInt(thisYear?.leagueWins)} />
          </div>
        </div>
      </section>

      {/* Career stats per discipline */}
      <section style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px 0' }}>
          <h3 style={sectionTitle}>Estatísticas de carreira por disciplina</h3>
        </div>
        {careerRows.length === 0 ? (
          <GuidedEmptyState style={{ margin: '16px' }} />
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 12 }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thLeft}>Disciplina</th>
                  <th style={th}>Largadas</th>
                  <th style={th}>Vitórias</th>
                  <th style={th}>Top 5</th>
                  <th style={th}>Poles</th>
                  <th style={th}>Vit.%</th>
                  <th style={th}>Top5%</th>
                  <th style={th}>Largada méd.</th>
                  <th style={th}>Chegada méd.</th>
                  <th style={th}>Inc. méd.</th>
                  <th style={th}>Voltas lid.</th>
                </tr>
              </thead>
              <tbody>
                {careerRows.map((row) => (
                  <tr key={row.categoryId}>
                    <td style={tdLeft}>{careerCategoryLabel(row.categoryId, row.category)}</td>
                    <td style={td}>{fmtInt(row.starts)}</td>
                    <td style={{ ...td, color: row.wins > 0 ? 'var(--accent-primary)' : undefined }}>{fmtInt(row.wins)}</td>
                    <td style={td}>{fmtInt(row.top5)}</td>
                    <td style={td}>{fmtInt(row.poles)}</td>
                    <td style={td}>{fmtPct(row.winPercentage)}</td>
                    <td style={td}>{fmtPct(row.top5Percentage)}</td>
                    <td style={td}>{fmtOne(row.avgStartPosition)}</td>
                    <td style={td}>{fmtOne(row.avgFinishPosition)}</td>
                    <td style={td}>{fmtOne(row.avgIncidents)}</td>
                    <td style={td}>{fmtInt(row.lapsLed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent races */}
      <section style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px 0' }}>
          <h3 style={sectionTitle}>Corridas recentes</h3>
        </div>
        {recent.length === 0 ? (
          <GuidedEmptyState style={{ margin: '16px' }} />
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 12 }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thLeft}>Data</th>
                  <th style={thLeft}>Série</th>
                  <th style={thLeft}>Carro</th>
                  <th style={thLeft}>Pista</th>
                  <th style={th}>Largada</th>
                  <th style={th}>Chegada</th>
                  <th style={th}>Inc.</th>
                  <th style={th}>Δ iR</th>
                  <th style={th}>SR</th>
                  <th style={th}>SOF</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((race) => (
                  <tr key={race.subsessionId}>
                    <td style={tdLeft}>{fmtDate(race.sessionStartTime)}</td>
                    <td style={{ ...tdLeft, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{race.seriesName}</td>
                    <td style={{ ...tdLeft, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis' }}>{race.carName}</td>
                    <td style={{ ...tdLeft, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis' }}>{race.trackName}</td>
                    <td style={td}>{positionLabel(race.startPosition, race.fieldSize)}</td>
                    <td style={{ ...td, color: race.won ? 'var(--accent-primary)' : undefined, fontWeight: race.won ? 600 : undefined }}>
                      {positionLabel(race.finishPosition, race.fieldSize)}
                    </td>
                    <td style={{ ...td, color: race.incidents > 4 ? 'var(--accent-warning)' : undefined }}>{fmtInt(race.incidents)}</td>
                    <td style={{ ...td, color: deltaColor(race.iRatingDelta) }}>{fmtSignedInt(race.iRatingDelta)}</td>
                    <td style={td}>{fmtSR(race.newSafetyRating)}</td>
                    <td style={td}>{fmtInt(race.strengthOfField)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Strengths */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
        <StrengthTable title="Pontos fortes por carro" scope="Forma recente (janela de corridas recentes)" rows={overview?.strengthsByCar ?? []} />
        <StrengthTable title="Pontos fortes por pista" scope="Forma recente (janela de corridas recentes)" rows={overview?.strengthsByTrack ?? []} />
      </section>
    </div>
  )
}
