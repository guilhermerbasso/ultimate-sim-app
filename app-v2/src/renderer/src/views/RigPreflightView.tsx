import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react'
import type { AppViewProps } from '../App'
import {
  RIG_PREFLIGHT_CHANNELS,
  applyRigPreflightPreset,
  type RigFaultMatrixRun,
  type RigPreflightCategory,
  type RigPreflightCheck,
  type RigPreflightProfile,
  type RigPreflightProfileMode,
  type RigPreflightRequirements,
  type RigPreflightRun,
  type RigPreflightState,
  type RigPreflightStateSnapshot
} from '../../../shared/rig-preflight'
import { tt } from '../i18n'
import { collectRigPreflightClientEvidence } from '../lib/rig-preflight-client'
import '../styles/rig-preflight.css'

const CATEGORY_ORDER: RigPreflightCategory[] = [
  'simulator',
  'displays',
  'serial',
  'audio',
  'haptics',
  'controls',
  'streaming',
  'resources',
  'baseline'
]

const BOOLEAN_REQUIREMENTS: Array<{
  key: keyof RigPreflightRequirements
  labelKey: string
}> = [
  { key: 'requireSimulator', labelKey: 'rigPreflight.requirement.simulator' },
  { key: 'allowMockSimulator', labelKey: 'rigPreflight.requirement.mock' },
  { key: 'requireSimX', labelKey: 'rigPreflight.requirement.simx' },
  { key: 'requireConfiguredSerial', labelKey: 'rigPreflight.requirement.serial' },
  { key: 'requireEsp32', labelKey: 'rigPreflight.requirement.esp32' },
  { key: 'requireAudioOutput', labelKey: 'rigPreflight.requirement.audioOutput' },
  { key: 'requireAudioInput', labelKey: 'rigPreflight.requirement.audioInput' },
  { key: 'requireTts', labelKey: 'rigPreflight.requirement.tts' },
  { key: 'requireStt', labelKey: 'rigPreflight.requirement.stt' },
  { key: 'requireHaptics', labelKey: 'rigPreflight.requirement.haptics' },
  { key: 'requireGamepad', labelKey: 'rigPreflight.requirement.gamepad' },
  { key: 'requireControlBindings', labelKey: 'rigPreflight.requirement.bindings' },
  { key: 'requireStreaming', labelKey: 'rigPreflight.requirement.streaming' },
  { key: 'requireStreamingTunnel', labelKey: 'rigPreflight.requirement.tunnel' },
  { key: 'requireKnownGood', labelKey: 'rigPreflight.requirement.knownGood' }
]

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function translated(language: AppViewProps['language'], key: string, fallback: string): string {
  const value = tt(language, key)
  return value === key ? fallback : value
}

function formatTime(timestamp: number, language: AppViewProps['language']): string {
  if (!timestamp) return '—'
  try {
    return new Date(timestamp).toLocaleString(language || 'en')
  } catch {
    return new Date(timestamp).toISOString()
  }
}

function stateLabel(language: AppViewProps['language'], state: RigPreflightState): string {
  return translated(language, `rigPreflight.state.${state}`, state)
}

function latestCertificateTone(state: RigPreflightStateSnapshot | null): string {
  const active = state?.activeCertificate
  if (
    !active ||
    state?.activeCertificateExpired ||
    state?.activeCertificateRevalidationRequired ||
    state?.storage.blocked ||
    active.invalidatedAt !== null
  ) return 'blocked'
  return active.certificate.decision
}

function checkLabel(language: AppViewProps['language'], check: RigPreflightCheck): string {
  return translated(language, `rigPreflight.check.${check.id}`, check.label)
}

function categoryLabel(language: AppViewProps['language'], category: RigPreflightCategory): string {
  return translated(language, `rigPreflight.category.${category}`, category)
}

function requirementValue(
  profile: RigPreflightProfile,
  key: keyof RigPreflightRequirements
): boolean {
  return profile.requirements[key] === true
}

export function profileContent(profile: RigPreflightProfile | null): string {
  if (!profile) return ''
  const requirements = Object.fromEntries(
    Object.entries(profile.requirements).sort(([left], [right]) =>
      left.localeCompare(right, 'en')
    )
  )
  return JSON.stringify({
    id: profile.id,
    name: profile.name,
    owner: profile.owner,
    mode: profile.mode,
    evidenceMaxAgeMs: profile.evidenceMaxAgeMs,
    certificateTtlMs: profile.certificateTtlMs,
    requirements
  })
}

function RigPreflightView({ language, showToast }: AppViewProps): ReactElement {
  const [state, setState] = useState<RigPreflightStateSnapshot | null>(null)
  const [draft, setDraft] = useState<RigPreflightProfile | null>(null)
  const [busy, setBusy] = useState<'load' | 'save' | 'run' | 'faults' | 'waiver' | 'baseline' | null>('load')
  const [waiverCheckId, setWaiverCheckId] = useState('')
  const [waiverReason, setWaiverReason] = useState('')
  const [waiverHours, setWaiverHours] = useState(4)
  const savedProfileRef = useRef<RigPreflightProfile | null>(null)

  const loadState = async (): Promise<void> => {
    const next = await window.ipc.invoke<RigPreflightStateSnapshot>(RIG_PREFLIGHT_CHANNELS.getState)
    setState(next)
    setDraft(next.profile)
    savedProfileRef.current = next.profile
  }

  useEffect(() => {
    void loadState()
      .catch((error) => showToast(errorMessage(error), 'error'))
      .finally(() => setBusy(null))
    return window.ipc.subscribe<RigPreflightStateSnapshot>(
      RIG_PREFLIGHT_CHANNELS.changed,
      (next) => {
        setState(next)
        setDraft((current) =>
          current && profileContent(current) !== profileContent(savedProfileRef.current)
            ? current
            : next.profile
        )
        savedProfileRef.current = next.profile
      }
    )
  }, [])

  const latestRun = state?.history[0] ?? null
  const profileDirty = Boolean(
    draft &&
    state &&
    profileContent(draft) !== profileContent(state.profile)
  )
  const latestFaultRun = state?.faultHistory[0] ?? null
  const waiverCandidates = latestRun?.checks.filter(
    (check) =>
      check.applicability === 'required' &&
      check.underlyingState !== 'verified'
  ) ?? []
  const groupedChecks = useMemo(() => {
    const groups = new Map<RigPreflightCategory, RigPreflightCheck[]>()
    for (const category of CATEGORY_ORDER) groups.set(category, [])
    for (const check of latestRun?.checks ?? []) groups.get(check.category)?.push(check)
    return groups
  }, [latestRun])

  useEffect(() => {
    if (!waiverCandidates.length) {
      setWaiverCheckId('')
      return
    }
    if (!waiverCandidates.some((check) => check.id === waiverCheckId)) {
      setWaiverCheckId(waiverCandidates[0].id)
    }
  }, [latestRun?.id])

  const patchRequirement = (
    key: keyof RigPreflightRequirements,
    value: boolean | number
  ): void => {
    setDraft((current) => current
      ? {
          ...current,
          requirements: {
            ...current.requirements,
            [key]: value
          },
          updatedAt: Date.now()
        }
      : current)
  }

  const applyPreset = (mode: RigPreflightProfileMode): void => {
    setDraft((current) => current ? applyRigPreflightPreset(current, mode) : current)
  }

  const saveProfile = async (): Promise<void> => {
    if (!draft) return
    setBusy('save')
    try {
      const next = await window.ipc.invoke<RigPreflightStateSnapshot>(
        RIG_PREFLIGHT_CHANNELS.setProfile,
        draft
      )
      setState(next)
      setDraft(next.profile)
      savedProfileRef.current = next.profile
      showToast(tt(language, 'rigPreflight.toast.profileSaved'), 'success')
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const runPreflight = async (): Promise<void> => {
    if (!draft || profileDirty) {
      showToast(tt(language, 'rigPreflight.toast.saveBeforeRun'), 'error')
      return
    }
    setBusy('run')
    try {
      const clientEvidence = await collectRigPreflightClientEvidence()
      const run = await window.ipc.invoke<RigPreflightRun>(
        RIG_PREFLIGHT_CHANNELS.run,
        { profile: draft, clientEvidence }
      )
      await loadState()
      showToast(
        run.certificate.decision === 'blocked'
          ? tt(language, 'rigPreflight.toast.blocked')
          : tt(language, 'rigPreflight.toast.ready'),
        run.certificate.decision === 'blocked' ? 'error' : 'success'
      )
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const runFaultMatrix = async (): Promise<void> => {
    if (!draft || profileDirty) {
      showToast(tt(language, 'rigPreflight.toast.saveBeforeRun'), 'error')
      return
    }
    setBusy('faults')
    try {
      const clientEvidence = await collectRigPreflightClientEvidence()
      const result = await window.ipc.invoke<RigFaultMatrixRun>(
        RIG_PREFLIGHT_CHANNELS.faultMatrix,
        { profile: draft, clientEvidence }
      )
      await loadState()
      showToast(
        tt(language, 'rigPreflight.toast.faults', {
          passed: result.passed,
          total: result.total
        }),
        result.passed === result.total ? 'success' : 'error'
      )
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const acceptKnownGood = async (): Promise<void> => {
    if (!latestRun) return
    setBusy('baseline')
    try {
      await window.ipc.invoke(
        RIG_PREFLIGHT_CHANNELS.acceptKnownGood,
        latestRun.id,
        draft?.owner || state?.profile.owner
      )
      await loadState()
      showToast(tt(language, 'rigPreflight.toast.baselineSaved'), 'success')
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const createWaiver = async (): Promise<void> => {
    if (!waiverCheckId || !waiverReason.trim()) return
    setBusy('waiver')
    try {
      await window.ipc.invoke(
        RIG_PREFLIGHT_CHANNELS.waive,
        {
          checkId: waiverCheckId,
          reason: waiverReason.trim(),
          owner: draft?.owner || state?.profile.owner || 'Rig owner',
          expiresAt: Date.now() + waiverHours * 60 * 60_000
        }
      )
      setWaiverReason('')
      await loadState()
      showToast(tt(language, 'rigPreflight.toast.waiverSaved'), 'success')
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const removeWaiver = async (id: string): Promise<void> => {
    setBusy('waiver')
    try {
      await window.ipc.invoke(RIG_PREFLIGHT_CHANNELS.removeWaiver, id)
      await loadState()
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const certificateTone = latestCertificateTone(state)
  const activeCertificate = state?.activeCertificate
  const activeStatus = state?.storage.blocked
    ? tt(language, 'rigPreflight.certificate.storageBlocked')
    : !activeCertificate
    ? tt(language, 'rigPreflight.certificate.none')
    : state?.activeCertificateExpired
      ? tt(language, 'rigPreflight.certificate.expired')
      : state?.activeCertificateRevalidationRequired
        ? tt(language, 'rigPreflight.certificate.revalidationRequired')
      : activeCertificate.invalidatedAt !== null
        ? tt(language, 'rigPreflight.certificate.invalidated')
        : translated(
            language,
            `rigPreflight.decision.${activeCertificate.certificate.decision}`,
            activeCertificate.certificate.decision
          )

  return (
    <section className="view-grid rig-preflight-view">
      <article className="panel-card rig-preflight-hero">
        <div>
          <span className="panel-label">{tt(language, 'rigPreflight.eyebrow')}</span>
          <h3>{tt(language, 'rigPreflight.title')}</h3>
          <p className="helper-text">{tt(language, 'rigPreflight.description')}</p>
        </div>
        <div className="rig-preflight-actions">
          <button
            className="ghost-action"
            disabled={Boolean(busy) || profileDirty || Boolean(state?.storage.blocked)}
            onClick={() => void runFaultMatrix()}
            type="button"
          >
            {busy === 'faults' ? tt(language, 'rigPreflight.runningFaults') : tt(language, 'rigPreflight.runFaults')}
          </button>
          <button
            className="primary-action"
            disabled={Boolean(busy) || profileDirty || Boolean(state?.storage.blocked)}
            onClick={() => void runPreflight()}
            type="button"
          >
            {busy === 'run' ? tt(language, 'rigPreflight.running') : tt(language, 'rigPreflight.run')}
          </button>
        </div>
      </article>

      {state?.storage.blocked && (
        <article className="notice-card danger">
          <strong>{tt(language, 'rigPreflight.storage.blocked')}</strong>
          <p>{state.storage.message}</p>
          {state.storage.quarantinePath && <small>{state.storage.quarantinePath}</small>}
          <p>{tt(language, 'rigPreflight.storage.recover')}</p>
        </article>
      )}

      {profileDirty && (
        <article className="notice-card warning">
          <strong>{tt(language, 'rigPreflight.profile.unsaved')}</strong>
          <p>{tt(language, 'rigPreflight.profile.unsavedHelp')}</p>
        </article>
      )}

      <section className="rig-preflight-summary">
        <article className={`panel-card rig-certificate ${certificateTone}`}>
          <span className="panel-label">{tt(language, 'rigPreflight.certificate.title')}</span>
          <strong>{activeStatus}</strong>
          <small>
            {activeCertificate
              ? tt(language, 'rigPreflight.certificate.expires', {
                  time: formatTime(
                    Math.min(
                      activeCertificate.certificate.expiresAt,
                      activeCertificate.freshUntil
                    ),
                    language
                  )
                })
              : tt(language, 'rigPreflight.certificate.runHint')}
          </small>
          {activeCertificate?.invalidationReason && (
            <p className="rig-inline-alert">{activeCertificate.invalidationReason}</p>
          )}
        </article>
        <article className="panel-card rig-metric-card">
          <span className="panel-label">{tt(language, 'rigPreflight.coverage')}</span>
          <strong>{latestRun ? `${Math.round(latestRun.certificate.coverage * 100)}%` : '—'}</strong>
          <small>{tt(language, 'rigPreflight.coverageHelp')}</small>
        </article>
        <article className="panel-card rig-metric-card">
          <span className="panel-label">{tt(language, 'rigPreflight.signature')}</span>
          <strong className="rig-signature">{latestRun?.signature.slice(0, 12) || '—'}</strong>
          <small>{translated(language, `rigPreflight.drift.${latestRun?.certificate.drift || 'not-established'}`, latestRun?.certificate.drift || '—')}</small>
        </article>
        <article className="panel-card rig-metric-card">
          <span className="panel-label">{tt(language, 'rigPreflight.history')}</span>
          <strong>{state?.history.length ?? 0}</strong>
          <small>{tt(language, 'rigPreflight.historyHelp')}</small>
        </article>
      </section>

      <article className="panel-card">
        <div className="panel-heading-row">
          <div>
            <span className="panel-label">{tt(language, 'rigPreflight.profile.eyebrow')}</span>
            <h3>{tt(language, 'rigPreflight.profile.title')}</h3>
          </div>
          <button
            className="ghost-action compact"
            disabled={!draft || Boolean(busy)}
            onClick={() => void saveProfile()}
            type="button"
          >
            {busy === 'save' ? tt(language, 'rigPreflight.profile.saving') : tt(language, 'rigPreflight.profile.save')}
          </button>
        </div>
        {!draft ? (
          <p className="empty-state">{tt(language, 'rigPreflight.loading')}</p>
        ) : (
          <>
            <div className="rig-preset-row">
              {(['configured', 'full-rig', 'no-hardware'] as RigPreflightProfileMode[]).map((mode) => (
                <button
                  className={`rig-preset ${draft.mode === mode ? 'is-active' : ''}`}
                  key={mode}
                  onClick={() => applyPreset(mode)}
                  type="button"
                >
                  {translated(language, `rigPreflight.profile.mode.${mode}`, mode)}
                </button>
              ))}
            </div>
            <div className="rig-profile-fields">
              <label>
                <span>{tt(language, 'rigPreflight.profile.name')}</span>
                <input
                  onChange={(event) => setDraft({ ...draft, name: event.target.value, updatedAt: Date.now() })}
                  value={draft.name}
                />
              </label>
              <label>
                <span>{tt(language, 'rigPreflight.profile.owner')}</span>
                <input
                  onChange={(event) => setDraft({ ...draft, owner: event.target.value, updatedAt: Date.now() })}
                  value={draft.owner}
                />
              </label>
              <label>
                <span>{tt(language, 'rigPreflight.profile.freshness')}</span>
                <select
                  onChange={(event) => setDraft({ ...draft, evidenceMaxAgeMs: Number(event.target.value), updatedAt: Date.now() })}
                  value={draft.evidenceMaxAgeMs}
                >
                  <option value={30_000}>30s</option>
                  <option value={60_000}>60s</option>
                  <option value={300_000}>5 min</option>
                </select>
              </label>
              <label>
                <span>{tt(language, 'rigPreflight.profile.ttl')}</span>
                <select
                  onChange={(event) => setDraft({ ...draft, certificateTtlMs: Number(event.target.value), updatedAt: Date.now() })}
                  value={draft.certificateTtlMs}
                >
                  <option value={15 * 60_000}>15 min</option>
                  <option value={30 * 60_000}>30 min</option>
                  <option value={60 * 60_000}>60 min</option>
                </select>
              </label>
              <label>
                <span>{tt(language, 'rigPreflight.profile.minDisplays')}</span>
                <input
                  max={16}
                  min={0}
                  onChange={(event) => patchRequirement('minDisplays', Number(event.target.value))}
                  type="number"
                  value={draft.requirements.minDisplays}
                />
              </label>
              <label>
                <span>{tt(language, 'rigPreflight.profile.minWindows')}</span>
                <input
                  max={16}
                  min={0}
                  onChange={(event) => patchRequirement('minDashboardWindows', Number(event.target.value))}
                  type="number"
                  value={draft.requirements.minDashboardWindows}
                />
              </label>
              <label>
                <span>{tt(language, 'rigPreflight.profile.port')}</span>
                <input
                  max={65535}
                  min={0}
                  onChange={(event) => patchRequirement('streamingPort', Number(event.target.value))}
                  type="number"
                  value={draft.requirements.streamingPort}
                />
                <small>{tt(language, 'rigPreflight.profile.portHelp')}</small>
              </label>
            </div>
            <div className="rig-requirement-grid">
              {BOOLEAN_REQUIREMENTS.map(({ key, labelKey }) => (
                <label className="rig-requirement" key={key}>
                  <input
                    checked={requirementValue(draft, key)}
                    onChange={(event) => patchRequirement(key, event.target.checked)}
                    type="checkbox"
                  />
                  <span>{tt(language, labelKey)}</span>
                </label>
              ))}
            </div>
          </>
        )}
      </article>

      <article className="panel-card">
        <div className="panel-heading-row">
          <div>
            <span className="panel-label">{tt(language, 'rigPreflight.results.eyebrow')}</span>
            <h3>{tt(language, 'rigPreflight.results.title')}</h3>
          </div>
          {latestRun?.eligibleAsKnownGood && (
            <button
              className="ghost-action compact"
              disabled={Boolean(busy)}
              onClick={() => void acceptKnownGood()}
              type="button"
            >
              {busy === 'baseline' ? tt(language, 'rigPreflight.baseline.saving') : tt(language, 'rigPreflight.baseline.save')}
            </button>
          )}
        </div>
        {!latestRun ? (
          <p className="empty-state">{tt(language, 'rigPreflight.results.empty')}</p>
        ) : (
          <div className="rig-check-groups">
            {CATEGORY_ORDER.map((category) => {
              const checks = groupedChecks.get(category) ?? []
              if (!checks.length) return null
              return (
                <section className="rig-check-group" key={category}>
                  <h4>{categoryLabel(language, category)}</h4>
                  {checks.map((check) => (
                    <article className={`rig-check state-${check.state}`} key={check.id}>
                      <div className="rig-check-head">
                        <div>
                          <strong>{checkLabel(language, check)}</strong>
                          <small>
                            {check.owner} · {formatTime(check.observedAt, language)} · {check.provenance.map((item) => item.source).join(' + ') || tt(language, 'rigPreflight.noProvenance')}
                          </small>
                        </div>
                        <span className={`rig-state state-${check.state}`}>
                          {check.applicability === 'not-required'
                            ? tt(language, 'rigPreflight.notRequired')
                            : stateLabel(language, check.state)}
                        </span>
                      </div>
                      <p>{check.summary}</p>
                      <dl className="rig-evidence">
                        <div>
                          <dt>{tt(language, 'rigPreflight.expected')}</dt>
                          <dd>{check.expected}</dd>
                        </div>
                        <div>
                          <dt>{tt(language, 'rigPreflight.observed')}</dt>
                          <dd>{check.observed}</dd>
                        </div>
                      </dl>
                      {check.delta.length > 0 && (
                        <div className="rig-delta">
                          <strong>{tt(language, 'rigPreflight.delta')}</strong>
                          <ul>{check.delta.map((item) => <li key={item}>{item}</li>)}</ul>
                        </div>
                      )}
                      {check.remediation.length > 0 && (
                        <div className="rig-remediation">
                          <strong>{tt(language, 'rigPreflight.remediation')}</strong>
                          <ul>{check.remediation.map((item) => <li key={item}>{item}</li>)}</ul>
                        </div>
                      )}
                      {check.waiver && (
                        <div className="rig-waiver-note">
                          {tt(language, 'rigPreflight.waiver.until', {
                            owner: check.waiver.owner,
                            time: formatTime(check.waiver.expiresAt, language)
                          })}: {check.waiver.reason}
                        </div>
                      )}
                    </article>
                  ))}
                </section>
              )
            })}
          </div>
        )}
      </article>

      <section className="view-grid two-columns">
        <article className="panel-card">
          <span className="panel-label">{tt(language, 'rigPreflight.waiver.eyebrow')}</span>
          <h3>{tt(language, 'rigPreflight.waiver.title')}</h3>
          <p className="helper-text">{tt(language, 'rigPreflight.waiver.help')}</p>
          <div className="rig-waiver-form">
            <label>
              <span>{tt(language, 'rigPreflight.waiver.check')}</span>
              <select
                disabled={!waiverCandidates.length}
                onChange={(event) => setWaiverCheckId(event.target.value)}
                value={waiverCheckId}
              >
                {!waiverCandidates.length && <option value="">{tt(language, 'rigPreflight.waiver.none')}</option>}
                {waiverCandidates.map((check) => (
                  <option key={check.id} value={check.id}>{checkLabel(language, check)}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{tt(language, 'rigPreflight.waiver.reason')}</span>
              <textarea
                onChange={(event) => setWaiverReason(event.target.value)}
                placeholder={tt(language, 'rigPreflight.waiver.reasonPlaceholder')}
                rows={3}
                value={waiverReason}
              />
            </label>
            <label>
              <span>{tt(language, 'rigPreflight.waiver.expiry')}</span>
              <select onChange={(event) => setWaiverHours(Number(event.target.value))} value={waiverHours}>
                <option value={1}>1h</option>
                <option value={4}>4h</option>
                <option value={24}>24h</option>
                <option value={168}>7d</option>
              </select>
            </label>
            <button
              className="primary-action"
              disabled={Boolean(busy) || !waiverCheckId || !waiverReason.trim()}
              onClick={() => void createWaiver()}
              type="button"
            >
              {tt(language, 'rigPreflight.waiver.create')}
            </button>
          </div>
          {(state?.waivers.length ?? 0) > 0 && (
            <div className="rig-waiver-list">
              {state?.waivers.map((waiver) => (
                <div key={waiver.id}>
                  <span>
                    <strong>{waiver.checkId}</strong>
                    <small>{waiver.owner} · {formatTime(waiver.expiresAt, language)}</small>
                  </span>
                  <button
                    className="ghost-action compact"
                    disabled={Boolean(busy)}
                    onClick={() => void removeWaiver(waiver.id)}
                    type="button"
                  >
                    {tt(language, 'rigPreflight.waiver.remove')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="panel-card">
          <span className="panel-label">{tt(language, 'rigPreflight.faults.eyebrow')}</span>
          <h3>{tt(language, 'rigPreflight.faults.title')}</h3>
          <p className="helper-text">{tt(language, 'rigPreflight.faults.help')}</p>
          {!latestFaultRun ? (
            <p className="empty-state">{tt(language, 'rigPreflight.faults.empty')}</p>
          ) : (
            <>
              <div className={`rig-fault-score ${latestFaultRun.passed === latestFaultRun.total ? 'pass' : 'fail'}`}>
                {latestFaultRun.passed}/{latestFaultRun.total}
              </div>
              <ul className="rig-fault-list">
                {latestFaultRun.results.map((result) => (
                  <li key={result.faultId}>
                    <span className={result.detected ? 'pass' : 'fail'}>{result.detected ? '✓' : '×'}</span>
                    <div>
                      <strong>{translated(language, `rigPreflight.fault.${result.faultId}`, result.faultId)}</strong>
                      <small>{result.checkId} · {stateLabel(language, result.actualState)}</small>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </article>
      </section>

      <article className="panel-card">
        <span className="panel-label">{tt(language, 'rigPreflight.history.eyebrow')}</span>
        <h3>{tt(language, 'rigPreflight.history.title')}</h3>
        {(state?.history.length ?? 0) === 0 ? (
          <p className="empty-state">{tt(language, 'rigPreflight.history.empty')}</p>
        ) : (
          <div className="rig-history-table">
            {state?.history.map((run) => (
              <div key={run.id}>
                <span>
                  <strong>{formatTime(run.completedAt, language)}</strong>
                  <small>{run.profileName} · {run.signature.slice(0, 12)}</small>
                </span>
                <span className={`rig-state decision-${run.certificate.decision}`}>
                  {translated(language, `rigPreflight.decision.${run.certificate.decision}`, run.certificate.decision)}
                </span>
                <span>{Math.round(run.certificate.coverage * 100)}%</span>
                <span>
                  {tt(language, 'rigPreflight.history.expires', {
                    time: formatTime(run.certificate.expiresAt, language)
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  )
}

export default RigPreflightView
