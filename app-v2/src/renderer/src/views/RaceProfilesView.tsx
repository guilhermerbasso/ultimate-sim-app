import { type CSSProperties, type ReactElement, useEffect, useMemo, useState } from 'react'
import type { ProfileSummary } from '../../../shared/ipc'
import type { RaceProfile, RaceProfileSuggestion } from '../../../shared/raceprofiles'
import { getLatestTelemetry } from '../lib/telemetry'
import { SectionExportImport } from '../components/SectionExportImport'
import type { AppViewProps } from '../App'

const EMPTY_PROFILE: RaceProfile = {
  id: '',
  name: '',
  match: {},
  buttonboxProfile: ''
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function RaceProfilesView({ connectedDevice, mapping, config, refreshDeviceState, showToast }: AppViewProps): ReactElement {
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

  useEffect(() => {
    void refreshAll()
    const unsubscribe = window.ipc.subscribe<RaceProfileSuggestion>('profilesv2:suggest', setSuggestion)
    return unsubscribe
  }, [])

  // Auto-apply profile when autoSwitch is enabled and a new suggestion arrives.
  useEffect(() => {
    if (!autoSwitch || !suggestion) return
    const profile = profiles.find((p) => p.id === suggestion.profileId)
    if (profile) void applyRaceProfile(profile)
  }, [suggestion, autoSwitch, profiles])

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
        showToast('Telemetria sem carro/pista no momento.', 'error')
        return
      }
      setDraft((current) => ({
        ...current,
        match: {
          carName: snapshot?.carName ?? current.match?.carName,
          trackName: snapshot?.trackName ?? current.match?.trackName
        }
      }))
      showToast('Carro/pista preenchidos pela telemetria.', 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function saveCurrent(): Promise<void> {
    const name = draft.name.trim()
    if (!name) {
      showToast('Informe um nome para o perfil de corrida.', 'error')
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
      showToast(`Perfil de corrida “${saved.name}” salvo.`, 'success')
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

  async function applyRaceProfile(profile: RaceProfile): Promise<void> {
    setBusy(true)
    try {
      if (profile.oled !== undefined) await window.ipc.invoke('oled:setConfig', profile.oled)
      if (profile.overlays !== undefined) await window.ipc.invoke('overlays:setConfig', profile.overlays)
      if (profile.alerts !== undefined) await window.ipc.invoke('alerts:setConfig', profile.alerts)
      if (profile.bindings !== undefined) await window.ipc.invoke('actions:setBindings', profile.bindings)

      if (profile.hapticsGains && Object.keys(profile.hapticsGains).length > 0) {
        const effectsPatch: Record<string, { intensity: number }> = {}
        for (const [id, intensity] of Object.entries(profile.hapticsGains)) {
          effectsPatch[id] = { intensity: intensity as number }
        }
        await window.ipc.invoke('haptics:setConfig', { effects: effectsPatch }).catch(() => undefined)
      }

      if (profile.buttonboxProfile) {
        if (!connectedDevice) {
          showToast('Configs do app aplicadas. Conecte o ButtonBox para aplicar o perfil HID.', 'info')
        } else {
          const buttonboxProfile = await window.api.loadProfile(profile.buttonboxProfile)
          await window.api.applyProfileToDevice({ mapping: buttonboxProfile.mapping, config: buttonboxProfile.config })
          await refreshDeviceState()
        }
      }

      setSuggestion(null)
      showToast(`Perfil de corrida "${profile.name}" aplicado.`, 'success')
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
      showToast('Perfil de corrida excluído.', 'success')
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
      showToast(saved ? 'Auto-troca ativada.' : 'Auto-troca desativada.', 'success')
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
            <strong>Perfil sugerido: {suggestedProfile.name}</strong>
            <p style={styles.bannerText}>
              Detectado {suggestion.carName || 'carro atual'} em {suggestion.trackName || 'pista atual'}.
            </p>
          </div>
          <div style={styles.row}>
            <button style={styles.primaryButton} disabled={busy} onClick={() => void applyRaceProfile(suggestedProfile)} type="button">Aplicar</button>
            <button style={styles.ghostButton} disabled={busy} onClick={() => setSuggestion(null)} type="button">Ignorar</button>
          </div>
        </div>
      )}

      <article style={styles.card}>
        <div style={styles.headerRow}>
          <div>
            <span style={styles.kicker}>Profiles v2</span>
            <h3 style={styles.title}>Perfis por carro/pista</h3>
            <p style={styles.text}>Agrupe ButtonBox, OLED, overlays, alertas e bindings para cada combinação de corrida.</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <SectionExportImport sectionId="race-profiles" label="Perfis de corrida" onImported={() => void refreshAll()} />
            <label style={styles.switchLabel}>
              <input checked={autoSwitch} onChange={(event) => void toggleAutoSwitch(event.target.checked)} type="checkbox" />
              Auto-troca
            </label>
          </div>
        </div>

        <div style={styles.formGrid}>
          <label style={styles.field}>
            Nome do perfil
            <input
              style={styles.input}
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder="Ex.: Porsche GT3 em Interlagos"
            />
          </label>
          <label style={styles.field}>
            Perfil ButtonBox (HID)
            <select
              style={styles.input}
              value={draft.buttonboxProfile ?? ''}
              onChange={(event) => setDraft((current) => ({ ...current, buttonboxProfile: event.target.value }))}
            >
              <option value="">Não alterar ButtonBox</option>
              {buttonboxProfiles.map((profile) => (
                <option key={profile.name} value={profile.name}>{profile.name}</option>
              ))}
            </select>
          </label>
          <label style={styles.field}>
            Carro
            <input
              style={styles.input}
              value={draft.match?.carName ?? ''}
              onChange={(event) => setDraft((current) => ({ ...current, match: { ...current.match, carName: event.target.value } }))}
              placeholder="Ex.: Porsche 911 GT3 R"
            />
          </label>
          <label style={styles.field}>
            Pista
            <input
              style={styles.input}
              value={draft.match?.trackName ?? ''}
              onChange={(event) => setDraft((current) => ({ ...current, match: { ...current.match, trackName: event.target.value } }))}
              placeholder="Ex.: Autódromo José Carlos Pace"
            />
          </label>
        </div>

        <div style={styles.row}>
          <button style={styles.secondaryButton} disabled={busy} onClick={() => void fillMatchFromTelemetry()} type="button">Usar telemetria</button>
          <button style={styles.primaryButton} disabled={busy || !draft.name.trim()} onClick={() => void saveCurrent()} type="button">Salvar atual</button>
          <button style={styles.ghostButton} disabled={busy} onClick={resetDraft} type="button">Novo</button>
        </div>
      </article>

      <article style={styles.card}>
        <div style={styles.headerRow}>
          <div>
            <span style={styles.kicker}>Biblioteca local</span>
            <h3 style={styles.title}>Perfis de corrida salvos</h3>
          </div>
          <button style={styles.ghostButton} disabled={busy} onClick={() => void refreshAll()} type="button">Atualizar</button>
        </div>

        <div style={styles.list}>
          {profiles.length === 0 && <p style={styles.empty}>Nenhum perfil de corrida salvo ainda.</p>}
          {profiles.map((profile) => (
            <div key={profile.id} style={styles.profileItem}>
              <div>
                <strong>{profile.name}</strong>
                <p style={styles.meta}>
                  {profile.match?.carName || 'Qualquer carro'} · {profile.match?.trackName || 'Qualquer pista'}
                  {profile.buttonboxProfile ? ` · HID: ${profile.buttonboxProfile}` : ''}
                </p>
              </div>
              <div style={styles.row}>
                <button style={styles.secondaryButton} disabled={busy} onClick={() => editProfile(profile)} type="button">Editar</button>
                <button style={styles.primaryButton} disabled={busy} onClick={() => void applyRaceProfile(profile)} type="button">Aplicar</button>
                <button style={styles.dangerButton} disabled={busy} onClick={() => void deleteProfile(profile.id)} type="button">Excluir</button>
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
