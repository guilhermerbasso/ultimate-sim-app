import { type CSSProperties, type ReactElement, useEffect, useMemo, useState } from 'react'
import type { ProfileSummary } from '../../../shared/ipc'
import type { RaceProfile, RaceProfileSuggestion } from '../../../shared/raceprofiles'
import { getLatestTelemetry } from '../lib/telemetry'
import { applyRaceProfile, describeRaceProfileFailure } from '../lib/race-profile-runtime'
import { SectionExportImport } from '../components/SectionExportImport'
import type { AppViewProps } from '../App'
import { tt } from '../i18n'

const EMPTY_PROFILE: RaceProfile = {
  id: '',
  name: '',
  match: {},
  buttonboxProfile: ''
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function RaceProfilesView({ connectedDevice, mapping, config, refreshDeviceState, showToast, language }: AppViewProps): ReactElement {
  const [profiles, setProfiles] = useState<RaceProfile[]>([])
  const [buttonboxProfiles, setButtonboxProfiles] = useState<ProfileSummary[]>([])
  const [draft, setDraft] = useState<RaceProfile>(EMPTY_PROFILE)
  const [autoSwitch, setAutoSwitch] = useState(false)
  const [suggestion, setSuggestion] = useState<RaceProfileSuggestion | null>(null)
  const [busy, setBusy] = useState(false)

  const suggestedProfile = useMemo(
    () => profiles.find((profile) => profile.id === suggestion?.profileId) ?? null,
    [profiles, suggestion]
  )

  // Auto-switch itself lives in useRaceProfileAutoSwitch (mounted in App.tsx) so it
  // works on every screen. This view only mirrors the resulting state.
  useEffect(() => {
    void refreshAll()
    const unsubscribe = window.ipc.subscribe<RaceProfileSuggestion>('profilesv2:suggest', setSuggestion)
    return unsubscribe
  }, [])

  async function refreshAll(): Promise<void> {
    try {
      const [nextProfiles, nextButtonboxProfiles, nextAutoSwitch] = await Promise.all([
        window.ipc.invoke<RaceProfile[]>('profilesv2:list'),
        window.api.listProfiles(),
        window.ipc.invoke<boolean>('profilesv2:getAutoSwitch')
      ])
      setProfiles(nextProfiles)
      setButtonboxProfiles(nextButtonboxProfiles)
      setAutoSwitch(nextAutoSwitch)
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  function editProfile(profile: RaceProfile): void {
    setDraft({
      ...profile,
      match: { ...profile.match },
      buttonboxProfile: profile.buttonboxProfile ?? ''
    })
  }

  function resetDraft(): void {
    setDraft({ ...EMPTY_PROFILE, match: {} })
  }

  async function fillMatchFromTelemetry(): Promise<void> {
    try {
      const snapshot = await getLatestTelemetry()
      if (!snapshot?.carName && !snapshot?.trackName) {
        showToast(tt(language, 'raceProfiles.noTelemetryToast'), 'error')
        return
      }
      setDraft((current) => ({
        ...current,
        match: {
          carName: snapshot?.carName ?? current.match?.carName,
          trackName: snapshot?.trackName ?? current.match?.trackName
        }
      }))
      showToast(tt(language, 'raceProfiles.filledToast'), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function saveCurrent(): Promise<void> {
    const name = draft.name.trim()
    if (!name) {
      showToast(tt(language, 'raceProfiles.enterNameToast'), 'error')
      return
    }

    setBusy(true)
    try {
      const [snapshot, oled, overlays, alerts, bindings, hapticsConfig] = await Promise.all([
        getLatestTelemetry().catch(() => null),
        window.ipc.invoke('oled:getConfig'),
        window.ipc.invoke('overlays:getConfig'),
        window.ipc.invoke('alerts:getConfig'),
        window.ipc.invoke('actions:getBindings'),
        window.ipc.invoke<{ effects?: Record<string, { intensity?: number }> }>('haptics:getConfig').catch(() => null)
      ])

      const buttonboxProfileName = await captureButtonboxProfile(name)

      const hapticsGains: Record<string, number> = {}
      if (hapticsConfig?.effects) {
        for (const [id, eff] of Object.entries(hapticsConfig.effects)) {
          if (typeof eff?.intensity === 'number') hapticsGains[id] = eff.intensity
        }
      }

      const profile: RaceProfile = {
        id: draft.id || createProfileId(),
        name,
        match: {
          carName: draft.match?.carName?.trim() || snapshot?.carName,
          trackName: draft.match?.trackName?.trim() || snapshot?.trackName
        },
        buttonboxProfile: buttonboxProfileName,
        oled,
        overlays,
        alerts,
        bindings,
        hapticsGains: Object.keys(hapticsGains).length > 0 ? hapticsGains : undefined
      }

      const saved = await window.ipc.invoke<RaceProfile>('profilesv2:save', profile)
      setDraft({ ...saved, match: { ...saved.match }, buttonboxProfile: saved.buttonboxProfile ?? '' })
      await refreshAll()
      showToast(tt(language, 'raceProfiles.savedToast', { name: saved.name }), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function captureButtonboxProfile(raceProfileName: string): Promise<string | undefined> {
    const selectedProfileName = draft.buttonboxProfile?.trim()
    const currentMapping = connectedDevice ? await window.api.getMapping() : mapping
    const currentConfig = connectedDevice ? await window.api.getConfig() : config

    if (currentMapping && currentConfig) {
      const profileName = selectedProfileName || `${raceProfileName} HID`
      await window.api.saveProfile(profileName, { mapping: currentMapping, config: currentConfig })
      return profileName
    }

    if (selectedProfileName) {
      await window.api.loadProfile(selectedProfileName)
      return selectedProfileName
    }

    return undefined
  }

  async function applyProfileTransactionally(profile: RaceProfile): Promise<void> {
    setBusy(true)
    try {
      const result = await applyRaceProfile(profile, {
        connected: Boolean(connectedDevice),
        applyButtonbox: async (name) => {
          const buttonboxProfile = await window.api.loadProfile(name)
          await window.api.applyProfileToDevice({ mapping: buttonboxProfile.mapping, config: buttonboxProfile.config })
          await refreshDeviceState()
        }
      })
      if (!result.ok) {
        showToast(describeRaceProfileFailure(result), 'error')
        return
      }
      if (profile.buttonboxProfile && !connectedDevice) {
        showToast(tt(language, 'raceProfiles.appSettingsAppliedToast'), 'info')
      }
      setSuggestion(null)
      showToast(tt(language, 'raceProfiles.appliedToast', { name: profile.name }), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function deleteProfile(id: string): Promise<void> {
    setBusy(true)
    try {
      await window.ipc.invoke('profilesv2:delete', id)
      if (draft.id === id) resetDraft()
      await refreshAll()
      showToast(tt(language, 'raceProfiles.deletedToast'), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function toggleAutoSwitch(enabled: boolean): Promise<void> {
    setAutoSwitch(enabled)
    try {
      const saved = await window.ipc.invoke<boolean>('profilesv2:setAutoSwitch', enabled)
      setAutoSwitch(saved)
      showToast(saved ? tt(language, 'raceProfiles.autoSwitchEnabledToast') : tt(language, 'raceProfiles.autoSwitchDisabledToast'), 'success')
    } catch (error) {
      setAutoSwitch(!enabled)
      showToast(getErrorMessage(error), 'error')
    }
  }

  return (
    <section style={styles.shell}>
      {suggestion && suggestedProfile && !autoSwitch && (
        <div style={styles.banner}>
          <div>
            <strong>{tt(language, 'raceProfiles.suggestedProfile', { name: suggestedProfile.name })}</strong>
            <p style={styles.bannerText}>
              {tt(language, 'raceProfiles.detectedOnTrack', { car: suggestion.carName || tt(language, 'raceProfiles.currentCar'), track: suggestion.trackName || tt(language, 'raceProfiles.currentTrack') })}
            </p>
          </div>
          <div style={styles.row}>
            <button style={styles.primaryButton} disabled={busy} onClick={() => void applyProfileTransactionally(suggestedProfile)} type="button">{tt(language, 'raceProfiles.apply')}</button>
            <button style={styles.ghostButton} disabled={busy} onClick={() => setSuggestion(null)} type="button">{tt(language, 'raceProfiles.ignore')}</button>
          </div>
        </div>
      )}

      <article style={styles.card}>
        <div style={styles.headerRow}>
          <div>
            <span style={styles.kicker}>{tt(language, 'raceProfiles.eyebrow')}</span>
            <h3 style={styles.title}>{tt(language, 'raceProfiles.title')}</h3>
            <p style={styles.text}>{tt(language, 'raceProfiles.description')}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <SectionExportImport sectionId="race-profiles" label={tt(language, 'raceProfiles.exportLabel')} onImported={() => void refreshAll()} />
            <label style={styles.switchLabel}>
              <input checked={autoSwitch} onChange={(event) => void toggleAutoSwitch(event.target.checked)} type="checkbox" />
              {tt(language, 'raceProfiles.autoSwitch')}
            </label>
          </div>
        </div>

        <div style={styles.formGrid}>
          <label style={styles.field}>
            {tt(language, 'raceProfiles.profileName')}
            <input
              style={styles.input}
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder={tt(language, 'raceProfiles.namePlaceholder')}
            />
          </label>
          <label style={styles.field}>
            {tt(language, 'raceProfiles.buttonBoxProfile')}
            <select
              style={styles.input}
              value={draft.buttonboxProfile ?? ''}
              onChange={(event) => setDraft((current) => ({ ...current, buttonboxProfile: event.target.value }))}
            >
              <option value="">{tt(language, 'raceProfiles.keepButtonBox')}</option>
              {buttonboxProfiles.map((profile) => (
                <option key={profile.name} value={profile.name}>{profile.name}</option>
              ))}
            </select>
          </label>
          <label style={styles.field}>
            {tt(language, 'raceProfiles.car')}
            <input
              style={styles.input}
              value={draft.match?.carName ?? ''}
              onChange={(event) => setDraft((current) => ({ ...current, match: { ...current.match, carName: event.target.value } }))}
              placeholder={tt(language, 'raceProfiles.carPlaceholder')}
            />
          </label>
          <label style={styles.field}>
            {tt(language, 'raceProfiles.track')}
            <input
              style={styles.input}
              value={draft.match?.trackName ?? ''}
              onChange={(event) => setDraft((current) => ({ ...current, match: { ...current.match, trackName: event.target.value } }))}
              placeholder={tt(language, 'raceProfiles.trackPlaceholder')}
            />
          </label>
        </div>

        <div style={styles.row}>
          <button style={styles.secondaryButton} disabled={busy} onClick={() => void fillMatchFromTelemetry()} type="button">{tt(language, 'raceProfiles.useTelemetry')}</button>
          <button style={styles.primaryButton} disabled={busy || !draft.name.trim()} onClick={() => void saveCurrent()} type="button">{tt(language, 'raceProfiles.saveCurrent')}</button>
          <button style={styles.ghostButton} disabled={busy} onClick={resetDraft} type="button">{tt(language, 'raceProfiles.new')}</button>
        </div>
      </article>

      <article style={styles.card}>
        <div style={styles.headerRow}>
          <div>
            <span style={styles.kicker}>{tt(language, 'raceProfiles.localLibrary')}</span>
            <h3 style={styles.title}>{tt(language, 'raceProfiles.savedProfiles')}</h3>
          </div>
          <button style={styles.ghostButton} disabled={busy} onClick={() => void refreshAll()} type="button">{tt(language, 'raceProfiles.refresh')}</button>
        </div>

        <div style={styles.list}>
          {profiles.length === 0 && <p style={styles.empty}>{tt(language, 'raceProfiles.empty')}</p>}
          {profiles.map((profile) => (
            <div key={profile.id} style={styles.profileItem}>
              <div>
                <strong>{profile.name}</strong>
                <p style={styles.meta}>
                  {profile.match?.carName || 'Any car'} · {profile.match?.trackName || 'Any track'}
                  {profile.buttonboxProfile ? ` · HID: ${profile.buttonboxProfile}` : ''}
                </p>
              </div>
              <div style={styles.row}>
                <button style={styles.secondaryButton} disabled={busy} onClick={() => editProfile(profile)} type="button">{tt(language, 'raceProfiles.edit')}</button>
                <button style={styles.primaryButton} disabled={busy} onClick={() => void applyProfileTransactionally(profile)} type="button">{tt(language, 'raceProfiles.apply')}</button>
                <button style={styles.dangerButton} disabled={busy} onClick={() => void deleteProfile(profile.id)} type="button">{tt(language, 'raceProfiles.delete')}</button>
              </div>
            </div>
          ))}
        </div>
      </article>
    </section>
  )
}

function createProfileId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `race-${Date.now().toString(36)}`
}

const styles: Record<string, CSSProperties> = {
  shell: {
    display: 'grid',
    gap: 18
  },
  card: {
    background: 'rgba(11, 18, 32, 0.88)',
    border: '1px solid rgba(120, 164, 255, 0.18)',
    borderRadius: 'var(--radius-sm)',
    padding: 20,
    
  },
  banner: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    alignItems: 'center',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid rgba(var(--accent-rgb), 0.55)',
    background: 'var(--surface-selected)',
    padding: '14px 16px'
  },
  bannerText: {
    margin: '4px 0 0',
    color: '#c7d2fe'
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    alignItems: 'flex-start',
    marginBottom: 16
  },
  kicker: {
    color: 'var(--accent-primary)',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0.8,
    textTransform: 'uppercase'
  },
  title: {
    margin: '4px 0',
    color: 'var(--text-primary)'
  },
  text: {
    margin: 0,
    color: 'var(--text-muted)'
  },
  switchLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    color: 'var(--text-primary)',
    fontWeight: 700
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))',
    gap: 14
  },
  field: {
    display: 'grid',
    gap: 8,
    color: 'var(--text-secondary)',
    fontSize: 13,
    fontWeight: 700
  },
  input: {
    width: '100%',
    borderRadius: "var(--radius-sm)",
    border: '1px solid var(--border-default)',
    background: 'var(--surface-sunken)',
    color: 'var(--text-primary)',
    padding: '10px 12px'
  },
  row: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap'
  },
  primaryButton: {
    border: 0,
    borderRadius: "var(--radius-sm)",
    background: 'var(--accent-primary)',
    color: 'var(--text-on-accent)',
    cursor: 'pointer',
    fontWeight: 800,
    padding: '9px 14px'
  },
  secondaryButton: {
    border: '1px solid var(--border-strong)',
    borderRadius: "var(--radius-sm)",
    background: 'var(--surface-base)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    fontWeight: 800,
    padding: '8px 13px'
  },
  ghostButton: {
    border: '1px solid var(--border-strong)',
    borderRadius: "var(--radius-sm)",
    background: 'transparent',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    fontWeight: 800,
    padding: '8px 13px'
  },
  dangerButton: {
    border: '1px solid var(--accent-danger)',
    borderRadius: "var(--radius-sm)",
    background: 'var(--accent-danger-dim)',
    color: 'var(--accent-danger)',
    cursor: 'pointer',
    fontWeight: 800,
    padding: '8px 13px'
  },
  list: {
    display: 'grid',
    gap: 12
  },
  profileItem: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 14,
    alignItems: 'center',
    border: '1px solid var(--border-default)',
    borderRadius: "var(--radius-sm)",
    background: 'var(--surface-base)',
    padding: 14
  },
  meta: {
    margin: '5px 0 0',
    color: 'var(--text-muted)',
    fontSize: 13
  },
  empty: {
    color: 'var(--text-muted)',
    margin: 0
  }
}
