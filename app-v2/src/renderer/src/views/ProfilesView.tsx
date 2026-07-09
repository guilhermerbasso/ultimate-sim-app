import { type ReactElement, useEffect, useState } from 'react'
import type { ProfileSummary } from '../../../shared/ipc'
import { SectionExportImport } from '../components/SectionExportImport'
import type { AppViewProps } from '../App'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const UNSUPPORTED_SIM_X_PROFILE_WRITE = 'Action not supported on the current SIM-X firmware.'

function ProfilesView({ connectedDevice, mapping, config, showToast }: AppViewProps): ReactElement {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([])
  const [profileName, setProfileName] = useState('')
  const [busy, setBusy] = useState(false)

  async function refreshProfiles(): Promise<void> {
    try {
      setProfiles(await window.api.listProfiles())
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  useEffect(() => {
    void refreshProfiles()
  }, [])

  async function saveProfile(): Promise<void> {
    if (connectedDevice) {
      showToast(`${UNSUPPORTED_SIM_X_PROFILE_WRITE} Disconnect to save only the already loaded local snapshot.`, 'error')
      return
    }
    setBusy(true)
    try {
      const currentMapping = mapping
      const currentConfig = config
      if (!currentMapping || !currentConfig) throw new Error('Connect the ButtonBox and load the map/config before saving a profile.')
      const saved = await window.api.saveProfile(profileName, { mapping: currentMapping, config: currentConfig })
      setProfileName('')
      await refreshProfiles()
      showToast(`Profile "${saved.name}" saved.`, 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  function applyProfile(): void {
    showToast(`${UNSUPPORTED_SIM_X_PROFILE_WRITE} Applying profiles on the device is disabled.`, 'error')
  }

  async function deleteProfile(name: string): Promise<void> {
    setBusy(true)
    try {
      await window.api.deleteProfile(name)
      await refreshProfiles()
      showToast(`Profile "${name}" deleted.`, 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="view-grid two-columns">
      <article className="panel-card">
        <span className="panel-label">Save profile</span>
        <h3>Current snapshot</h3>
        <p>Save the current map and advanced configuration as a local preset on disk.</p>
        <label className="field-label" htmlFor="profile-name">Profile name</label>
        <input className="text-field" id="profile-name" placeholder="Ex.: GT Sprint" value={profileName} onChange={(event) => setProfileName(event.target.value)} />
        <button className="primary-action" disabled={busy || Boolean(connectedDevice) || !profileName.trim() || !mapping || !config} onClick={() => void saveProfile()} type="button">Save profile</button>
        {connectedDevice
          ? <p className="helper-text">Direct SIM-X save is not supported on the current firmware.</p>
          : <p className="helper-text">Saves only the already loaded local snapshot; direct capture from the SIM-X device is not supported on the current firmware.</p>}
      </article>

      <article className="panel-card scroll-card">
        <div className="panel-heading-row">
          <div><span className="panel-label">Local library</span><h3>Saved profiles</h3></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <SectionExportImport sectionId="legacy-profiles" label="Mapping profiles (legacy)" onImported={() => void refreshProfiles()} />
            <button className="ghost-action compact" disabled={busy} onClick={() => void refreshProfiles()} type="button">Refresh</button>
          </div>
        </div>

        <div className="profile-list">
          {profiles.length === 0 && <p className="empty-state">No saved profiles yet.</p>}
          {profiles.map((profile) => (
            <div className="profile-item rich" key={profile.name}>
              <span>
                <strong>{profile.name}</strong>
                <small>Saved on {new Date(profile.savedAt).toLocaleString('pt-BR')}</small>
              </span>
              <span className="profile-actions">
                <button className="ghost-action compact" disabled title={UNSUPPORTED_SIM_X_PROFILE_WRITE} onClick={() => applyProfile()} type="button">Apply (not supported)</button>
                <button className="ghost-action compact danger" disabled={busy} onClick={() => void deleteProfile(profile.name)} type="button">Delete</button>
              </span>
            </div>
          ))}
        </div>
      </article>
    </section>
  )
}

export default ProfilesView
