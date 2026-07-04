import { type ReactElement, useEffect, useState } from 'react'
import type { ProfileSummary } from '../../../shared/ipc'
import { SectionExportImport } from '../components/SectionExportImport'
import type { AppViewProps } from '../App'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const UNSUPPORTED_SIM_X_PROFILE_WRITE = 'Ação não suportada no firmware SIM-X atual.'

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
      showToast(`${UNSUPPORTED_SIM_X_PROFILE_WRITE} Desconecte para salvar apenas o snapshot local já carregado.`, 'error')
      return
    }
    setBusy(true)
    try {
      const currentMapping = mapping
      const currentConfig = config
      if (!currentMapping || !currentConfig) throw new Error('Conecte o ButtonBox e carregue mapa/config antes de salvar um perfil.')
      const saved = await window.api.saveProfile(profileName, { mapping: currentMapping, config: currentConfig })
      setProfileName('')
      await refreshProfiles()
      showToast(`Perfil “${saved.name}” salvo.`, 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  function applyProfile(): void {
    showToast(`${UNSUPPORTED_SIM_X_PROFILE_WRITE} Aplicar perfis no dispositivo está desativado.`, 'error')
  }

  async function deleteProfile(name: string): Promise<void> {
    setBusy(true)
    try {
      await window.api.deleteProfile(name)
      await refreshProfiles()
      showToast(`Perfil “${name}” excluído.`, 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="view-grid two-columns">
      <article className="panel-card">
        <span className="panel-label">Salvar perfil</span>
        <h3>Snapshot atual</h3>
        <p>Salve o mapa e a configuração avançada atuais como um preset local em disco.</p>
        <label className="field-label" htmlFor="profile-name">Nome do perfil</label>
        <input className="text-field" id="profile-name" placeholder="Ex.: GT Sprint" value={profileName} onChange={(event) => setProfileName(event.target.value)} />
        <button className="primary-action" disabled={busy || Boolean(connectedDevice) || !profileName.trim() || !mapping || !config} onClick={() => void saveProfile()} type="button">Salvar perfil</button>
        {connectedDevice
          ? <p className="helper-text">Salvar direto do SIM-X não é suportado no firmware atual.</p>
          : <p className="helper-text">Salva apenas o snapshot local já carregado; captura direta do dispositivo SIM-X não é suportada no firmware atual.</p>}
      </article>

      <article className="panel-card scroll-card">
        <div className="panel-heading-row">
          <div><span className="panel-label">Biblioteca local</span><h3>Perfis salvos</h3></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <SectionExportImport sectionId="legacy-profiles" label="Perfis de mapeamento (legado)" onImported={() => void refreshProfiles()} />
            <button className="ghost-action compact" disabled={busy} onClick={() => void refreshProfiles()} type="button">Atualizar</button>
          </div>
        </div>

        <div className="profile-list">
          {profiles.length === 0 && <p className="empty-state">Nenhum perfil salvo ainda.</p>}
          {profiles.map((profile) => (
            <div className="profile-item rich" key={profile.name}>
              <span>
                <strong>{profile.name}</strong>
                <small>Salvo em {new Date(profile.savedAt).toLocaleString('pt-BR')}</small>
              </span>
              <span className="profile-actions">
                <button className="ghost-action compact" disabled title={UNSUPPORTED_SIM_X_PROFILE_WRITE} onClick={() => applyProfile()} type="button">Aplicar (não suportado)</button>
                <button className="ghost-action compact danger" disabled={busy} onClick={() => void deleteProfile(profile.name)} type="button">Excluir</button>
              </span>
            </div>
          ))}
        </div>
      </article>
    </section>
  )
}

export default ProfilesView
