import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react'
import type { AppViewProps } from '../App'
import { tt } from '../i18n'
import {
  PASSPORT_ITEM_DEFINITIONS,
  STINT_PASSPORT_CHANNELS,
  passportItemDefinition,
  type PassportConfig,
  type PassportDataClass,
  type PassportExportProfile,
  type PassportExportResult,
  type PassportImportResult,
  type PassportItem,
  type PassportItemResolutionInput,
  type PassportPrivacySettings,
  type PassportRole,
  type PassportRosterMember,
  type PassportSnapshot,
  type StintPassport
} from '../../../shared/stint-passport'

type TabId = 'current' | 'history' | 'roster' | 'configuration' | 'privacy'

const page: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16 }
const panel: CSSProperties = {
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  padding: 18
}
const grid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12
}
const label: CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase'
}
const input: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  marginTop: 5,
  padding: '9px 10px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-default)',
  background: 'var(--surface-sunken)',
  color: 'var(--text-primary)'
}
const button: CSSProperties = {
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--accent-primary)',
  color: 'var(--text-on-accent)',
  cursor: 'pointer',
  fontWeight: 700,
  padding: '8px 12px'
}
const secondaryButton: CSSProperties = {
  ...button,
  background: 'var(--surface-sunken)',
  color: 'var(--text-primary)'
}

const ROLE_VALUES: PassportRole[] = ['driver', 'engineer', 'crew-chief', 'spotter', 'team-manager']

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return window.ipc.invoke<T>(channel, ...args)
}

function time(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value).toLocaleString()
    : '—'
}

function statusTone(status: PassportItem['status']): string {
  if (status === 'verified' || status === 'manual-confirmed' || status === 'not-applicable') {
    return 'var(--accent-success)'
  }
  if (status === 'mismatch' || status === 'expired') return 'var(--accent-danger)'
  if (status === 'waived-with-reason') return 'var(--accent-warning)'
  return 'var(--border-default)'
}

function ownerValue(item: PassportItem): string {
  return item.owner ? `${item.owner.memberId}::${item.owner.role}` : ''
}

function parseOwner(value: string): PassportItemResolutionInput['owner'] | null {
  const [memberId, role] = value.split('::')
  return memberId && ROLE_VALUES.includes(role as PassportRole)
    ? { memberId, role: role as PassportRole }
    : null
}

function roleLabel(language: AppViewProps['language'], role: PassportRole): string {
  return tt(language, `passport.role.${role}`)
}

export function PassportStatusPanel({
  loading,
  error,
  snapshot,
  language
}: {
  loading: boolean
  error: string | null
  snapshot: PassportSnapshot | null
  language?: AppViewProps['language']
}): ReactElement | null {
  if (loading) return <section style={panel} aria-live="polite">{tt(language, 'passport.loading')}</section>
  if (error) {
    return (
      <section style={{ ...panel, border: '1px solid var(--accent-danger)' }} role="alert">
        <strong>{tt(language, 'passport.errorTitle')}</strong>
        <div style={{ marginTop: 6, color: 'var(--text-muted)' }}>{error}</div>
      </section>
    )
  }
  if (
    snapshot &&
    snapshot.persistence.state !== 'ready'
  ) {
    return (
      <section style={{ ...panel, border: '1px solid var(--accent-danger)' }} role="alert">
        <strong>{tt(language, 'passport.persistenceError')}</strong>
        <div>{snapshot.persistence.lastError ?? snapshot.persistence.state}</div>
      </section>
    )
  }
  if (snapshot?.runtime.queue.killSwitch) {
    return (
      <section style={{ ...panel, border: '1px solid var(--accent-warning)' }} role="status">
        <strong>{tt(language, 'passport.killSwitchActive')}</strong>
      </section>
    )
  }
  if ((snapshot?.runtime.queue.consumerErrors ?? 0) > 0) {
    return (
      <section style={{ ...panel, border: '1px solid var(--accent-danger)' }} role="alert">
        <strong>{tt(language, 'passport.queueError')}</strong>
        <div>{snapshot?.runtime.queue.lastError ?? tt(language, 'passport.queueErrorFallback')}</div>
      </section>
    )
  }
  if (snapshot?.runtime.overflowBlocked) {
    return (
      <section style={{ ...panel, border: '1px solid var(--accent-danger)' }} role="alert">
        <strong>{tt(language, 'passport.overflowBlocked')}</strong>
        <div>{tt(language, 'passport.cleanFrames', { count: snapshot.runtime.cleanFramesSinceOverflow })}</div>
      </section>
    )
  }
  if (snapshot?.current && (!snapshot.integrity.verified || snapshot.integrity.state !== 'anchored')) {
    return (
      <section style={{ ...panel, border: '1px solid var(--accent-danger)' }} role="alert">
        <strong>{tt(language, 'passport.integrityBlocked')}</strong>
        <div>{snapshot.integrity.message ?? snapshot.integrity.state}</div>
      </section>
    )
  }
  if (snapshot && !snapshot.current) {
    return (
      <section style={{ ...panel, border: '1px dashed var(--border-default)' }} data-testid="passport-empty">
        <strong>{tt(language, 'passport.emptyTitle')}</strong>
        <p style={{ color: 'var(--text-muted)', marginBottom: 0 }}>
          {snapshot.runtime.telemetryContext === 'replay'
            ? tt(language, 'passport.replayReadOnly')
            : tt(language, 'passport.emptyBody')}
        </p>
      </section>
    )
  }
  return null
}

function PassportSummary({
  passport,
  language,
  forceAwaiting = false
}: {
  passport: StintPassport
  language?: AppViewProps['language']
  forceAwaiting?: boolean
}): ReactElement {
  const visibleLifecycle = passport.lifecycle === 'ready' &&
    (forceAwaiting || passport.durability === 'failed' || passport.durability === 'quarantined')
    ? 'awaiting-checklist'
    : passport.lifecycle
  return (
    <section style={panel} aria-labelledby={`passport-${passport.identity.stintId}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={label}>{tt(language, 'passport.currentEyebrow')}</div>
          <h3 id={`passport-${passport.identity.stintId}`} style={{ margin: '5px 0' }}>
            {passport.identity.driverLabel}
          </h3>
          <div style={{ color: 'var(--text-muted)' }}>
            {passport.identity.trackLabel} · {passport.identity.carLabel}
            {passport.identity.teamLabel ? ` · ${passport.identity.teamLabel}` : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <strong>{tt(language, `passport.lifecycle.${visibleLifecycle}`)}</strong>
          <div>{tt(language, 'passport.durability', { state: passport.durability })}</div>
          <div>{Math.round(passport.coverage * 100)}% · {passport.coveredItems}/{passport.applicableItems}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            {time(passport.identity.startedAt)}
          </div>
        </div>
      </div>
    </section>
  )
}

export default function StintPassportView({
  language,
  showToast
}: AppViewProps): ReactElement {
  const [snapshot, setSnapshot] = useState<PassportSnapshot | null>(null)
  const [snapshotFresh, setSnapshotFresh] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>('current')
  const [inspectionId, setInspectionId] = useState<string>('')
  const [resolutionItem, setResolutionItem] = useState<PassportItem['id']>('session-identity')
  const [resolutionStatus, setResolutionStatus] = useState<PassportItemResolutionInput['status']>('manual-confirmed')
  const [resolutionOwner, setResolutionOwner] = useState('')
  const [resolutionReason, setResolutionReason] = useState('')
  const [challengeOwner, setChallengeOwner] = useState('')
  const [challengeResponse, setChallengeResponse] = useState('')
  const [memberName, setMemberName] = useState('')
  const [memberRoles, setMemberRoles] = useState<PassportRole[]>(['engineer'])
  const [config, setConfig] = useState<PassportConfig | null>(null)
  const [privacy, setPrivacy] = useState<PassportPrivacySettings | null>(null)
  const [packageHash, setPackageHash] = useState('')
  const [repairToken, setRepairToken] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await invoke<PassportSnapshot>(STINT_PASSPORT_CHANNELS.getSnapshot)
      setSnapshot(next)
      setSnapshotFresh(true)
      setConfig((current) => current ?? next.config)
      setPrivacy((current) => current ?? next.privacy)
      setError(null)
    } catch (cause) {
      setSnapshotFresh(false)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    return window.ipc.subscribe(STINT_PASSPORT_CHANNELS.updated, () => void refresh())
  }, [refresh])

  const run = useCallback(async (name: string, operation: () => Promise<void>): Promise<void> => {
    setBusy(name)
    try {
      await operation()
      setError(null)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      showToast(message, 'error')
    } finally {
      setBusy(null)
    }
  }, [showToast])

  const mutate = useCallback(<T,>(channel: string, payload: unknown): Promise<T> => {
    if (!snapshotFresh) return Promise.reject(new Error(tt(language, 'passport.capabilityUnavailable')))
    const capability = snapshot?.mutationCapability
    if (!capability) return Promise.reject(new Error(tt(language, 'passport.capabilityUnavailable')))
    return invoke<T>(channel, { capability, payload })
  }, [language, snapshot?.mutationCapability, snapshotFresh])

  const tabs: TabId[] = ['current', 'history', 'roster', 'configuration', 'privacy']
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, current: TabId): void => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const index = tabs.indexOf(current)
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const next = tabs[(index + delta + tabs.length) % tabs.length]
    setTab(next)
    setTimeout(() => document.getElementById(`passport-tab-${next}`)?.focus(), 0)
  }

  const current = snapshot?.current ?? null
  const persistenceHealthy = snapshot?.persistence.state === 'ready'
  const queueHealthy = snapshot === null
    ? false
    : !snapshot.runtime.queue.killSwitch &&
      snapshot.runtime.queue.consumerErrors === 0 &&
      !snapshot.runtime.overflowBlocked
  const integrityHealthy = Boolean(snapshot?.integrity.verified) &&
    snapshot?.integrity.state === 'anchored'
  const ordinaryMutationDisabled = busy !== null || !snapshotFresh || !persistenceHealthy
  const challengeDisabled = ordinaryMutationDisabled ||
    !queueHealthy ||
    snapshot?.runtime.telemetryContext !== 'live' ||
    current?.coverage !== 1 ||
    (current?.persisted === true && (
      current.durability !== 'durable' ||
      !integrityHealthy
    ))
  const forceAwaiting = !snapshotFresh ||
    !persistenceHealthy ||
    !queueHealthy ||
    (current?.persisted === true && !integrityHealthy)
  const memberNameById = useMemo(
    () => new Map((snapshot?.roster ?? []).map((member) => [member.memberId, member.displayName])),
    [snapshot?.roster]
  )
  const inspected = useMemo(
    () => snapshot?.history.find((passport) => passport.identity.stintId === inspectionId) ?? null,
    [inspectionId, snapshot?.history]
  )

  const ownerOptions = (itemId?: PassportItem['id']): Array<{ value: string; label: string }> => {
    const allowed = itemId ? passportItemDefinition(itemId).allowedRoles : ['driver', 'team-manager']
    return (snapshot?.roster ?? []).flatMap((member) =>
      member.active
        ? member.roles
            .filter((role) => allowed.includes(role))
            .map((role) => ({
              value: `${member.memberId}::${role}`,
              label: `${member.displayName} — ${roleLabel(language, role)}`
            }))
        : []
    )
  }

  const submitResolution = (event: FormEvent): void => {
    event.preventDefault()
    if (!current) return
    const owner = parseOwner(resolutionOwner)
    if (!owner) {
      setError(tt(language, 'passport.ownerRequired'))
      return
    }
    void run('resolution', async () => {
      await mutate(STINT_PASSPORT_CHANNELS.resolveItem, {
        stintId: current.identity.stintId,
        itemId: resolutionItem,
        status: resolutionStatus,
        owner,
        reasonCode: resolutionReason
      })
      setResolutionReason('')
      await refresh()
    })
  }

  const prepareChallenge = (): void => {
    if (!current) return
    const owner = parseOwner(challengeOwner)
    if (!owner) {
      setError(tt(language, 'passport.ownerRequired'))
      return
    }
    void run('challenge-prepare', async () => {
      await mutate(STINT_PASSPORT_CHANNELS.prepareChallenge, {
        stintId: current.identity.stintId,
        owner
      })
      setChallengeResponse('')
      await refresh()
    })
  }

  const completeChallenge = (): void => {
    if (!current || !snapshot?.challenge) return
    const owner = parseOwner(challengeOwner)
    if (!owner) {
      setError(tt(language, 'passport.ownerRequired'))
      return
    }
    void run('challenge', async () => {
      await mutate(STINT_PASSPORT_CHANNELS.completeChallenge, {
        stintId: current.identity.stintId,
        challengeId: snapshot.challenge?.challengeId,
        response: challengeResponse,
        owner
      })
      await refresh()
    })
  }

  const addRosterMember = (event: FormEvent): void => {
    event.preventDefault()
    if (!memberName.trim()) return
    const member: PassportRosterMember = {
      memberId: globalThis.crypto?.randomUUID?.() ?? `member-${snapshot?.roster.length ?? 0}`,
      displayName: memberName.trim(),
      roles: memberRoles,
      active: true
    }
    void run('roster', async () => {
      await mutate(STINT_PASSPORT_CHANNELS.setRoster, [...(snapshot?.roster ?? []), member])
      setMemberName('')
      await refresh()
    })
  }

  const saveConfig = (event: FormEvent): void => {
    event.preventDefault()
    if (!config) return
    void run('config', async () => {
      const saved = await mutate<PassportConfig>(STINT_PASSPORT_CHANNELS.setConfig, config)
      setConfig(saved)
      await refresh()
    })
  }

  const savePrivacy = (event: FormEvent): void => {
    event.preventDefault()
    if (!privacy) return
    void run('privacy', async () => {
      const saved = await mutate<PassportPrivacySettings>(STINT_PASSPORT_CHANNELS.setPrivacy, privacy)
      setPrivacy(saved)
      await refresh()
    })
  }

  const saveExport = (profile: PassportExportProfile): void => {
    void run(`export-${profile}`, async () => {
      const result = await mutate<PassportExportResult>(STINT_PASSPORT_CHANNELS.saveExport, profile)
      if (result.ok) {
        setPackageHash(result.packageHash ?? '')
        showToast(tt(language, 'passport.exportSaved', { file: result.fileName ?? '' }), 'success')
      }
    })
  }

  const deleteClass = (value: PassportDataClass): void => {
    if (window.confirm(tt(language, 'passport.confirmDelete', { class: value })) === false) return
    void run(`delete-${value}`, async () => {
      await mutate(STINT_PASSPORT_CHANNELS.deleteByClass, value)
      await refresh()
    })
  }

  const importPackage = (): void => {
    void run('import', async () => {
      const result = await mutate<PassportImportResult | { ok: false; canceled: true }>(
        STINT_PASSPORT_CHANNELS.importPackage,
        null
      )
      if (!result.ok) return
      await refresh()
      showToast(tt(language, 'passport.importedReplay', {
        count: result.importedPassports
      }), 'success')
    })
  }

  return (
    <div style={page}>
      <PassportStatusPanel loading={loading} error={error} snapshot={snapshot} language={language} />

      <div role="tablist" aria-label={tt(language, 'passport.tabsLabel')} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tabs.map((item) => (
          <button
            key={item}
            role="tab"
            aria-selected={tab === item}
            aria-controls={`passport-panel-${item}`}
            id={`passport-tab-${item}`}
            style={tab === item ? button : secondaryButton}
            onClick={() => setTab(item)}
            onKeyDown={(event) => onTabKey(event, item)}
            type="button"
          >
            {tt(language, `passport.tab.${item}`)}
          </button>
        ))}
      </div>

      {tab === 'current' && (
        <div role="tabpanel" id="passport-panel-current" aria-labelledby="passport-tab-current">
          {current && (
            <>
              <PassportSummary passport={current} language={language} forceAwaiting={forceAwaiting} />
              <section style={{ ...panel, marginTop: 16 }}>
                <h3>{tt(language, 'passport.checklistTitle')}</h3>
                <div style={grid}>
                  {current.items.map((item) => (
                    <article
                      key={item.id}
                      style={{
                        background: 'var(--surface-sunken)',
                        border: `1px solid ${statusTone(item.status)}`,
                        borderRadius: 'var(--radius-sm)',
                        padding: 12
                      }}
                      aria-label={`${tt(language, `passport.item.${item.id}`)}: ${tt(language, `passport.status.${item.status}`)}`}
                    >
                      <div style={label}>{tt(language, `passport.status.${item.status}`)}</div>
                      <strong>{tt(language, `passport.item.${item.id}`)}</strong>
                      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{item.detail}</p>
                      <div style={{ fontSize: 12 }}>
                        {item.owner
                          ? `${tt(language, 'passport.owner')}: ${memberNameById.get(item.owner.memberId) ?? item.owner.memberId} / ${roleLabel(language, item.owner.role)}`
                          : tt(language, 'passport.noOwner')}
                      </div>
                      {item.expiresAt && <div style={{ fontSize: 11 }}>{tt(language, 'passport.expires')}: {time(item.expiresAt)}</div>}
                      {item.evidence && <div style={{ fontSize: 11 }}>{tt(language, 'passport.evidence')}: {item.evidence.state} · {item.evidence.contentHash.slice(0, 10)}</div>}
                    </article>
                  ))}
                </div>
              </section>

              <section style={{ ...panel, marginTop: 16 }}>
                <h3>{tt(language, 'passport.resolveTitle')}</h3>
                <form onSubmit={submitResolution} style={grid}>
                  <label>
                    <span style={label}>{tt(language, 'passport.itemLabel')}</span>
                    <select style={input} value={resolutionItem} onChange={(event) => {
                      setResolutionItem(event.target.value as PassportItem['id'])
                      setResolutionOwner('')
                    }}>
                      {PASSPORT_ITEM_DEFINITIONS.map((definition) => (
                        <option key={definition.id} value={definition.id}>{tt(language, `passport.item.${definition.id}`)}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span style={label}>{tt(language, 'passport.statusLabel')}</span>
                    <select style={input} value={resolutionStatus} onChange={(event) => setResolutionStatus(event.target.value as PassportItemResolutionInput['status'])}>
                      <option value="manual-confirmed">{tt(language, 'passport.status.manual-confirmed')}</option>
                      <option value="waived-with-reason">{tt(language, 'passport.status.waived-with-reason')}</option>
                      <option value="not-applicable">{tt(language, 'passport.status.not-applicable')}</option>
                    </select>
                  </label>
                  <label>
                    <span style={label}>{tt(language, 'passport.owner')}</span>
                    <select style={input} value={resolutionOwner} onChange={(event) => setResolutionOwner(event.target.value)}>
                      <option value="">{tt(language, 'passport.selectOwner')}</option>
                      {ownerOptions(resolutionItem).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label>
                    <span style={label}>{tt(language, 'passport.reason')}</span>
                    <input style={input} value={resolutionReason} onChange={(event) => setResolutionReason(event.target.value)} />
                  </label>
                  <button style={button} disabled={ordinaryMutationDisabled} type="submit">{tt(language, 'passport.applyResolution')}</button>
                </form>
              </section>

              <section style={{ ...panel, marginTop: 16 }}>
                <h3>{tt(language, 'passport.challengeTitle')}</h3>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
                  <label style={{ minWidth: 260 }}>
                    <span style={label}>{tt(language, 'passport.challengeOwner')}</span>
                    <select style={input} value={challengeOwner} onChange={(event) => setChallengeOwner(event.target.value)}>
                      <option value="">{tt(language, 'passport.selectOwner')}</option>
                      {ownerOptions().map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  {!snapshot?.challenge ? (
                    <button style={button} disabled={challengeDisabled} onClick={prepareChallenge} type="button">
                      {tt(language, 'passport.prepareChallenge')}
                    </button>
                  ) : (
                    <>
                      <div aria-live="polite">{tt(language, 'passport.challengeNonce', { nonce: snapshot.challenge.nonce })}</div>
                      <label>
                        <span style={label}>{tt(language, 'passport.challengeResponse')}</span>
                        <input style={input} value={challengeResponse} onChange={(event) => setChallengeResponse(event.target.value)} />
                      </label>
                      <button style={button} disabled={challengeDisabled} onClick={completeChallenge} type="button">
                        {tt(language, 'passport.completeChallenge')}
                      </button>
                    </>
                  )}
                  <button style={secondaryButton} disabled={ordinaryMutationDisabled} onClick={() => void run('close', async () => {
                    await mutate(STINT_PASSPORT_CHANNELS.closeCurrent, null)
                    await refresh()
                  })} type="button">
                    {tt(language, 'passport.closeCurrent')}
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      )}

      {tab === 'history' && (
        <section role="tabpanel" id="passport-panel-history" aria-labelledby="passport-tab-history" style={panel}>
          <h3>{tt(language, 'passport.historyTitle')}</h3>
          {snapshot?.history.length ? (
            <div style={grid}>
              {snapshot.history.map((passport) => (
                <button
                  key={passport.identity.stintId}
                  style={{ ...secondaryButton, textAlign: 'left' }}
                  onClick={() => setInspectionId(passport.identity.stintId)}
                  aria-pressed={inspectionId === passport.identity.stintId}
                  type="button"
                >
                  <strong>{passport.identity.driverLabel}</strong>
                  <div>{passport.identity.trackLabel} · {passport.identity.carLabel}</div>
                  <div>{tt(language, `passport.lifecycle.${passport.lifecycle}`)} · {Math.round(passport.coverage * 100)}%</div>
                </button>
              ))}
            </div>
          ) : <p>{tt(language, 'passport.historyEmpty')}</p>}
          {inspected && (
            <div style={{ marginTop: 16 }}>
              <PassportSummary passport={inspected} language={language} />
              <div style={{ ...grid, marginTop: 12 }}>
                {inspected.items.map((item) => (
                  <article key={item.id} style={{ border: `1px solid ${statusTone(item.status)}`, borderRadius: 'var(--radius-sm)', padding: 10 }}>
                    <strong>{tt(language, `passport.item.${item.id}`)}</strong>
                    <div>{tt(language, `passport.status.${item.status}`)}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{item.detail}</div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {tab === 'roster' && (
        <section role="tabpanel" id="passport-panel-roster" aria-labelledby="passport-tab-roster" style={panel}>
          <h3>{tt(language, 'passport.rosterTitle')}</h3>
          <p>{tt(language, 'passport.rosterPrivacy')}</p>
          <ul>
            {(snapshot?.roster ?? []).map((member) => (
              <li key={member.memberId}>{member.displayName} — {member.roles.map((role) => roleLabel(language, role)).join(', ')}</li>
            ))}
          </ul>
          <form onSubmit={addRosterMember} style={grid}>
            <label>
              <span style={label}>{tt(language, 'passport.memberName')}</span>
              <input style={input} value={memberName} onChange={(event) => setMemberName(event.target.value)} />
            </label>
            <fieldset style={{ border: 0 }}>
              <legend style={label}>{tt(language, 'passport.roles')}</legend>
              {ROLE_VALUES.map((role) => (
                <label key={role} style={{ display: 'block' }}>
                  <input
                    type="checkbox"
                    checked={memberRoles.includes(role)}
                    onChange={(event) => setMemberRoles((currentRoles) =>
                      event.target.checked
                        ? [...new Set([...currentRoles, role])]
                        : currentRoles.filter((candidate) => candidate !== role)
                    )}
                  /> {roleLabel(language, role)}
                </label>
              ))}
            </fieldset>
            <button style={button} disabled={busy !== null} type="submit">{tt(language, 'passport.addMember')}</button>
          </form>
        </section>
      )}

      {tab === 'configuration' && config && (
        <section role="tabpanel" id="passport-panel-configuration" aria-labelledby="passport-tab-configuration" style={panel}>
          <h3>{tt(language, 'passport.configTitle')}</h3>
          <form onSubmit={saveConfig} style={grid}>
            <label><span style={label}>{tt(language, 'passport.raceProfile')}</span><input style={input} value={config.expectedRaceProfileId} onChange={(event) => setConfig({ ...config, expectedRaceProfileId: event.target.value })} /></label>
            <label><span style={label}>{tt(language, 'passport.buttonboxProfile')}</span><input style={input} value={config.expectedButtonboxProfile} onChange={(event) => setConfig({ ...config, expectedButtonboxProfile: event.target.value })} /></label>
            <label><span style={label}>{tt(language, 'passport.deviceIds')}</span><input style={input} value={config.requiredDeviceIds.join(', ')} onChange={(event) => setConfig({ ...config, requiredDeviceIds: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /></label>
            <label><span style={label}>{tt(language, 'passport.controlIds')}</span><input style={input} value={config.requiredControlIds.join(', ')} onChange={(event) => setConfig({ ...config, requiredControlIds: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /></label>
            <label><span style={label}>{tt(language, 'passport.audioDevice')}</span><input style={input} value={config.requiredAudioOutputDeviceId} onChange={(event) => setConfig({ ...config, requiredAudioOutputDeviceId: event.target.value })} /></label>
            <label><span style={label}>{tt(language, 'passport.audioCallouts')}</span><input style={input} value={config.requiredAudioCallouts.join(', ')} onChange={(event) => setConfig({ ...config, requiredAudioCallouts: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /></label>
            <label><span style={label}>{tt(language, 'passport.communicationChannel')}</span><input style={input} value={config.communicationChannel} onChange={(event) => setConfig({ ...config, communicationChannel: event.target.value })} /></label>
            <label><span style={label}>{tt(language, 'passport.minimumFuel')}</span><input style={input} type="number" min="0" value={config.minimumFuelLiters} onChange={(event) => setConfig({ ...config, minimumFuelLiters: Number(event.target.value) })} /></label>
            <label><span style={label}>{tt(language, 'passport.targetLaps')}</span><input style={input} type="number" min="0" value={config.targetStintLaps} onChange={(event) => setConfig({ ...config, targetStintLaps: Number(event.target.value) })} /></label>
            <label><span style={label}>{tt(language, 'passport.weather')}</span><select style={input} value={config.weatherAssumption} onChange={(event) => setConfig({ ...config, weatherAssumption: event.target.value as PassportConfig['weatherAssumption'] })}><option value="any">{tt(language, 'passport.weatherAny')}</option><option value="dry">{tt(language, 'passport.weatherDry')}</option><option value="wet">{tt(language, 'passport.weatherWet')}</option></select></label>
            <button style={button} disabled={busy !== null} type="submit">{tt(language, 'passport.saveConfig')}</button>
          </form>
        </section>
      )}

      {tab === 'privacy' && privacy && snapshot && (
        <section role="tabpanel" id="passport-panel-privacy" aria-labelledby="passport-tab-privacy" style={panel}>
          <h3>{tt(language, 'passport.privacyTitle')}</h3>
          <form onSubmit={savePrivacy} style={grid}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={privacy.identityPersistenceOptIn} onChange={(event) => setPrivacy({ ...privacy, identityPersistenceOptIn: event.target.checked })} />
              {tt(language, 'passport.identityOptIn')}
            </label>
            {(['D1', 'D2', 'D3'] as PassportDataClass[]).map((value) => (
              <label key={value}><span style={label}>{tt(language, 'passport.retentionDays', { class: value })}</span><input style={input} type="number" min="1" value={privacy.retentionDays[value]} onChange={(event) => setPrivacy({ ...privacy, retentionDays: { ...privacy.retentionDays, [value]: Number(event.target.value) } })} /></label>
            ))}
            <button style={button} disabled={busy !== null} type="submit">{tt(language, 'passport.savePrivacy')}</button>
          </form>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
            <button style={secondaryButton} onClick={() => void run('kill', async () => { await mutate(STINT_PASSPORT_CHANNELS.setKillSwitch, !snapshot.runtime.queue.killSwitch); await refresh() })} type="button">
              {snapshot.runtime.queue.killSwitch ? tt(language, 'passport.disableKillSwitch') : tt(language, 'passport.enableKillSwitch')}
            </button>
            {(['race-only', 'pseudonymized', 'full-local'] as PassportExportProfile[]).map((profile) => (
              <button key={profile} style={secondaryButton} onClick={() => saveExport(profile)} type="button">{tt(language, `passport.export.${profile}`)}</button>
            ))}
            <button style={secondaryButton} onClick={importPackage} type="button">
              {tt(language, 'passport.importPackage')}
            </button>
            {(['D1', 'D2', 'D3'] as PassportDataClass[]).map((value) => (
              <button key={value} style={secondaryButton} onClick={() => deleteClass(value)} type="button">{tt(language, 'passport.deleteClass', { class: value })}</button>
            ))}
            <button style={secondaryButton} onClick={() => void run('audit', async () => { await mutate(STINT_PASSPORT_CHANNELS.runFullAudit, null); await refresh() })} type="button">{tt(language, 'passport.fullAudit')}</button>
          </div>
          <p aria-live="polite">{tt(language, 'passport.integrityState', { state: snapshot.integrity.state, checked: snapshot.integrity.checkedEvents })}</p>
          <p>{tt(language, 'passport.persistenceState', { state: snapshot.persistence.state, queued: snapshot.persistence.queued })}</p>
          <p>{tt(language, 'passport.queueBudget', {
            items: snapshot.runtime.queue.budgets.maxItems,
            bytes: snapshot.runtime.queue.budgets.maxBytes,
            age: snapshot.runtime.queue.budgets.maxAgeMs
          })}</p>
          {packageHash && <p style={{ fontFamily: 'monospace' }}>SHA-256: {packageHash}</p>}
          {snapshot.integrity.state === 'corrupt' && (
            <div style={{ marginTop: 12 }}>
              <label>
                <span style={label}>{tt(language, 'passport.repairToken')}</span>
                <input style={input} value={repairToken} onChange={(event) => setRepairToken(event.target.value)} />
              </label>
              <button style={secondaryButton} onClick={() => {
                if (window.confirm(tt(language, 'passport.confirmRepair')) === false) return
                void run('repair', async () => {
                await mutate(STINT_PASSPORT_CHANNELS.repairPersistence, repairToken)
                setRepairToken('')
                await refresh()
                })
              }} type="button">{tt(language, 'passport.repairPersistence')}</button>
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <strong>{tt(language, 'passport.experimentTitle')}</strong>
            <p>{tt(language, 'passport.experimentSummary', {
              defects: snapshot.experiment.handoffDefects,
              falseBlocks: snapshot.experiment.falseBlocks,
              bypasses: snapshot.experiment.bypasses,
              overhead: snapshot.experiment.totalOverheadMs
            })}</p>
            {(['handoff-defect', 'false-block', 'bypass', 'manual-baseline-defect', 'manual-baseline-swap'] as const).map((kind) => (
              <button key={kind} style={secondaryButton} onClick={() => void run(`metric-${kind}`, async () => {
                await mutate(STINT_PASSPORT_CHANNELS.recordExperiment, { kind, count: 1 })
                await refresh()
              })} type="button">{tt(language, `passport.metric.${kind}`)}</button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
