import { type ReactElement, useEffect, useState } from 'react'
import type { ProfileSummary } from '../../../shared/ipc'
import { SectionExportImport } from '../components/SectionExportImport'
import type { AppViewProps } from '../App'
import { tt } from '../i18n'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function ProfilesView({ connectedDevice, mapping, config, showToast, language }: AppViewProps): ReactElement {
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
      showToast(tt(language, 'profiles.saveUnsupportedToast'), 'error')
      return
    }
    setBusy(true)
    try {
      const currentMapping = mapping
      const currentConfig = config
      if (!currentMapping || !currentConfig) throw new Error(tt(language, 'profiles.missingSnapshotError'))
      const saved = await window.api.saveProfile(profileName, { mapping: currentMapping, config: currentConfig })
      setProfileName('')
      await refreshProfiles()
      showToast(tt(language, 'profiles.savedToast', { name: saved.name }), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  function applyProfile(): void {
    showToast(tt(language, 'profiles.applyUnsupportedToast'), 'error')
  }

  async function deleteProfile(name: string): Promise<void> {
    setBusy(true)
    try {
      await window.api.deleteProfile(name)
      await refreshProfiles()
      showToast(tt(language, 'profiles.deletedToast', { name }), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="view-grid two-columns">
      <article className="panel-card">
        <span className="panel-label">{tt(language, 'profiles.saveLabel')}</span>
        <h3>{tt(language, 'profiles.currentSnapshot')}</h3>
        <p>{tt(language, 'profiles.saveDescription')}</p>
        <label className="field-label" htmlFor="profile-name">{tt(language, 'profiles.nameLabel')}</label>
        <input className="text-field" id="profile-name" placeholder={tt(language, 'profiles.namePlaceholder')} value={profileName} onChange={(event) => setProfileName(event.target.value)} />
        <button className="primary-action" disabled={busy || Boolean(connectedDevice) || !profileName.trim() || !mapping || !config} onClick={() => void saveProfile()} type="button">{tt(language, 'profiles.saveButton')}</button>
        {connectedDevice
          ? <p className="helper-text">{tt(language, 'profiles.directSaveUnsupported')}</p>
          : <p className="helper-text">{tt(language, 'profiles.localSnapshotOnly')}</p>}
      </article>

      <article className="panel-card scroll-card">
        <div className="panel-heading-row">
          <div><span className="panel-label">{tt(language, 'profiles.libraryLabel')}</span><h3>{tt(language, 'profiles.savedProfiles')}</h3></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <SectionExportImport sectionId="legacy-profiles" label={tt(language, 'profiles.legacyExportLabel')} onImported={() => void refreshProfiles()} />
            <button className="ghost-action compact" disabled={busy} onClick={() => void refreshProfiles()} type="button">{tt(language, 'profiles.refresh')}</button>
          </div>
        </div>

        <div className="profile-list">
          {profiles.length === 0 && <p className="empty-state">{tt(language, 'profiles.empty')}</p>}
          {profiles.map((profile) => (
            <div className="profile-item rich" key={profile.name}>
              <span>
                <strong>{profile.name}</strong>
                <small>{tt(language, 'profiles.savedOn', { date: new Date(profile.savedAt).toLocaleString(language ?? 'en') })}</small>
              </span>
              <span className="profile-actions">
                <button className="ghost-action compact" disabled title={tt(language, 'profiles.writeUnsupportedTitle')} onClick={() => applyProfile()} type="button">{tt(language, 'profiles.applyUnsupported')}</button>
                <button className="ghost-action compact danger" disabled={busy} onClick={() => void deleteProfile(profile.name)} type="button">{tt(language, 'profiles.delete')}</button>
              </span>
            </div>
          ))}
        </div>
      </article>
    </section>
  )
}

export default ProfilesView
