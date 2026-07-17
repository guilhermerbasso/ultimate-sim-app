import {
  type CSSProperties,
  type ComponentType,
  type ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { AppViewProps } from '../App'
import { tt } from '../i18n'
import {
  ACCESSIBILITY_CUE_CHANNELS,
  CUE_MANIFESTS,
  CUE_MODALITIES,
  DEFAULT_ACCESSIBILITY_CUE_STORE,
  DEFAULT_CUE_CAPABILITIES,
  analyzeCueProfile,
  cloneAccessibilityCueStore,
  getActiveCueProfile,
  getCueManifest,
  routeSemanticCue,
  type AccessibilityCueStore,
  type CueModality,
  type CueProfile,
  type CueRoute,
  type SemanticCueEvent
} from '../../../shared/accessibility-cues'
import {
  DEFAULT_HAPTICS_CONFIG,
  HAPTICS_CHANNELS,
  type HapticsConfig
} from '../../../shared/haptics'
import { speakViaTts } from '../lib/tts-runtime'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function profileLabel(profile: CueProfile, language: AppViewProps['language']): string {
  const key = `accessibilityCues.profile.${profile.id}`
  const translated = tt(language, key)
  return translated === key ? profile.name : translated
}

function eventLabel(eventId: string, language: AppViewProps['language']): string {
  return tt(language, `accessibilityCues.event.${eventId}`)
}

function modalityLabel(
  modality: CueModality,
  language: AppViewProps['language']
): string {
  return tt(language, `accessibilityCues.modality.${modality}`)
}

const AccessibilityCuesView: ComponentType<AppViewProps> = ({
  connectedDevice,
  showToast,
  language
}): ReactElement => {
  const [store, setStore] = useState<AccessibilityCueStore>(() =>
    cloneAccessibilityCueStore(DEFAULT_ACCESSIBILITY_CUE_STORE)
  )
  const [haptics, setHaptics] = useState<HapticsConfig>(DEFAULT_HAPTICS_CONFIG)
  const [selectedEventId, setSelectedEventId] = useState<string>(
    CUE_MANIFESTS.find((cue) => cue.preserveCritical)?.eventId ??
      CUE_MANIFESTS[0].eventId
  )
  const [preview, setPreview] = useState<CueRoute | null>(null)

  useEffect(() => {
    void window.ipc
      .invoke<AccessibilityCueStore>(ACCESSIBILITY_CUE_CHANNELS.getState)
      .then(setStore)
      .catch((error) => showToast(errorMessage(error), 'error'))
    void window.ipc
      .invoke<HapticsConfig>(HAPTICS_CHANNELS.getConfig)
      .then(setHaptics)
      .catch(() => undefined)

    const offStore = window.ipc.subscribe<AccessibilityCueStore>(
      ACCESSIBILITY_CUE_CHANNELS.stateEvent,
      setStore
    )
    const offHaptics = window.ipc.subscribe<HapticsConfig>(
      HAPTICS_CHANNELS.configEvent,
      setHaptics
    )
    return () => {
      offStore()
      offHaptics()
    }
  }, [showToast])

  const activeProfile = useMemo(() => getActiveCueProfile(store), [store])
  const activeProfileRef = useRef(activeProfile)
  const persistSequenceRef = useRef(0)
  useEffect(() => {
    activeProfileRef.current = activeProfile
  }, [activeProfile])
  const conflicts = useMemo(
    () => analyzeCueProfile(activeProfile),
    [activeProfile]
  )
  const capabilities = useMemo(
    () => ({
      ...DEFAULT_CUE_CAPABILITIES,
      led: Boolean(connectedDevice),
      haptic: haptics.enabled && !haptics.muted
    }),
    [connectedDevice, haptics.enabled, haptics.muted]
  )

  async function persistProfile(nextProfile: CueProfile): Promise<void> {
    const sequence = ++persistSequenceRef.current
    try {
      const next = await window.ipc.invoke<AccessibilityCueStore>(
        ACCESSIBILITY_CUE_CHANNELS.saveProfile,
        nextProfile
      )
      if (sequence !== persistSequenceRef.current) return
      activeProfileRef.current = getActiveCueProfile(next)
      setStore(next)
    } catch (error) {
      if (sequence !== persistSequenceRef.current) return
      showToast(errorMessage(error), 'error')
    }
  }

  function updateProfile(patch: Partial<CueProfile>): void {
    const base = activeProfileRef.current
    const nextProfile: CueProfile = {
      ...base,
      ...patch,
      modalities: patch.modalities ?? base.modalities,
      overrides: patch.overrides ?? base.overrides
    }
    activeProfileRef.current = nextProfile
    setStore((current) => ({
      ...current,
      profiles: current.profiles.map((profile) =>
        profile.id === nextProfile.id ? nextProfile : profile
      )
    }))
    void persistProfile(nextProfile)
  }

  function updateOverride(
    eventId: string,
    modality: CueModality,
    enabled: boolean
  ): void {
    const base = activeProfileRef.current
    const current = base.overrides[eventId] ?? {}
    updateProfile({
      overrides: {
        ...base.overrides,
        [eventId]: {
          ...current,
          modalities: {
            ...(current.modalities ?? {}),
            [modality]: enabled
          }
        }
      }
    })
  }

  function clearOverride(eventId: string): void {
    const overrides = { ...activeProfileRef.current.overrides }
    delete overrides[eventId]
    updateProfile({ overrides })
  }

  async function selectProfile(profileId: string): Promise<void> {
    persistSequenceRef.current += 1
    try {
      const next = await window.ipc.invoke<AccessibilityCueStore>(
        ACCESSIBILITY_CUE_CHANNELS.setActiveProfile,
        profileId
      )
      activeProfileRef.current = getActiveCueProfile(next)
      setStore(next)
      setPreview(null)
    } catch (error) {
      showToast(errorMessage(error), 'error')
    }
  }

  async function resetProfile(): Promise<void> {
    persistSequenceRef.current += 1
    try {
      const next = await window.ipc.invoke<AccessibilityCueStore>(
        ACCESSIBILITY_CUE_CHANNELS.resetProfile,
        activeProfile.id
      )
      activeProfileRef.current = getActiveCueProfile(next)
      setStore(next)
      setPreview(null)
      showToast(tt(language, 'accessibilityCues.resetDone'), 'success')
    } catch (error) {
      showToast(errorMessage(error), 'error')
    }
  }

  function runSafePreview(): void {
    const cue = getCueManifest(selectedEventId)
    if (!cue) return
    const event: SemanticCueEvent = {
      id: cue.eventId,
      message: tt(language, `accessibilityCues.example.${cue.eventId}`),
      severity: cue.severity,
      timestamp: 0,
      source: 'preview',
      position: 'center'
    }
    const route = routeSemanticCue(event, activeProfile, capabilities)
    setPreview(route)

    const audio = route.outputs.find((output) => output.modality === 'audio')
    if (audio) {
      void speakViaTts(route.message, {
        lang: language,
        source: 'accessibility-cue-preview',
        tipId: route.eventId,
        spatialPan: audio.spatialPan
      })
    }
  }

  return (
    <div
      className="accessibility-cues-view"
      data-high-contrast={activeProfile.highContrast ? 'true' : undefined}
    >
      <header>
        <h1>{tt(language, 'accessibilityCues.title')}</h1>
        <p className="accessibility-cues-view__intro">
          {tt(language, 'accessibilityCues.intro')}
        </p>
      </header>

      <div className="accessibility-cues-status" data-tone="safe" role="note">
        <strong>{tt(language, 'accessibilityCues.localOnlyTitle')}</strong>{' '}
        {tt(language, 'accessibilityCues.localOnlyBody')}
      </div>

      <div className="accessibility-cues-status" role="note">
        <strong>{tt(language, 'accessibilityCues.validationTitle')}</strong>{' '}
        {tt(language, 'accessibilityCues.validationBody')}
      </div>

      <div className="accessibility-cues-grid">
        <section className="accessibility-cues-panel" aria-labelledby="cue-profile-heading">
          <h2 id="cue-profile-heading">{tt(language, 'accessibilityCues.profileHeading')}</h2>

          <label className="accessibility-cues-control">
            <span>{tt(language, 'accessibilityCues.activeProfile')}</span>
            <select
              value={activeProfile.id}
              onChange={(event) => void selectProfile(event.target.value)}
            >
              {store.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profileLabel(profile, language)}
                </option>
              ))}
            </select>
          </label>

          <p className="accessibility-cues-help">
            {tt(language, 'accessibilityCues.noInference')}
          </p>

          <fieldset>
            <legend>{tt(language, 'accessibilityCues.globalModalities')}</legend>
            {CUE_MODALITIES.map((modality) => (
              <label className="accessibility-cues-switch" key={modality}>
                <input
                  type="checkbox"
                  checked={activeProfile.modalities[modality]}
                  onChange={(event) =>
                    updateProfile({
                      modalities: {
                        ...activeProfile.modalities,
                        [modality]: event.target.checked
                      }
                    })
                  }
                />
                <span>
                  <strong>{modalityLabel(modality, language)}</strong>
                  <br />
                  <small>
                    {tt(language, `accessibilityCues.modalityHelp.${modality}`)}
                  </small>
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend>{tt(language, 'accessibilityCues.presentation')}</legend>

            <label className="accessibility-cues-control">
              <span>
                {tt(language, 'accessibilityCues.textScale')}{' '}
                {Math.round(activeProfile.textScale * 100)}%
              </span>
              <input
                type="range"
                min="0.8"
                max="2"
                step="0.05"
                value={activeProfile.textScale}
                onChange={(event) =>
                  updateProfile({ textScale: Number(event.target.value) })
                }
              />
            </label>

            <label className="accessibility-cues-switch">
              <input
                type="checkbox"
                checked={activeProfile.highContrast}
                onChange={(event) =>
                  updateProfile({ highContrast: event.target.checked })
                }
              />
              <span>{tt(language, 'accessibilityCues.highContrast')}</span>
            </label>

            <label className="accessibility-cues-switch">
              <input
                type="checkbox"
                checked={activeProfile.spatialAudio}
                onChange={(event) =>
                  updateProfile({ spatialAudio: event.target.checked })
                }
              />
              <span>
                {tt(language, 'accessibilityCues.spatialAudio')}
                <br />
                <small>{tt(language, 'accessibilityCues.spatialAudioHelp')}</small>
              </span>
            </label>

            <label className="accessibility-cues-switch">
              <input
                type="checkbox"
                checked={activeProfile.persistentCaptions}
                onChange={(event) =>
                  updateProfile({ persistentCaptions: event.target.checked })
                }
              />
              <span>{tt(language, 'accessibilityCues.persistentCaptions')}</span>
            </label>

            <label className="accessibility-cues-switch">
              <input
                type="checkbox"
                checked={activeProfile.reducedMotion}
                onChange={(event) =>
                  updateProfile({ reducedMotion: event.target.checked })
                }
              />
              <span>{tt(language, 'accessibilityCues.reducedMotion')}</span>
            </label>

            <label className="accessibility-cues-control">
              <span>
                {tt(language, 'accessibilityCues.captionDuration')}{' '}
                {(activeProfile.captionDurationMs / 1000).toFixed(0)}s
              </span>
              <input
                type="range"
                min="2000"
                max="30000"
                step="1000"
                value={activeProfile.captionDurationMs}
                disabled={activeProfile.persistentCaptions}
                onChange={(event) =>
                  updateProfile({ captionDurationMs: Number(event.target.value) })
                }
              />
            </label>

            <label className="accessibility-cues-control">
              <span>
                {tt(language, 'accessibilityCues.hapticIntensity')}{' '}
                {Math.round(activeProfile.hapticIntensity * 100)}%
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={activeProfile.hapticIntensity}
                onChange={(event) =>
                  updateProfile({ hapticIntensity: Number(event.target.value) })
                }
              />
            </label>
          </fieldset>

          <div className="accessibility-cues-status" role="status" aria-live="polite">
            <strong>{tt(language, 'accessibilityCues.hardwareStatus')}</strong>
            <br />
            {tt(language, 'accessibilityCues.ledStatus', {
              status: connectedDevice
                ? tt(language, 'accessibilityCues.available')
                : tt(language, 'accessibilityCues.unavailable')
            })}
            <br />
            {tt(language, 'accessibilityCues.hapticStatus', {
              status:
                haptics.enabled && !haptics.muted
                  ? tt(language, 'accessibilityCues.available')
                  : tt(language, 'accessibilityCues.unavailable')
            })}
          </div>

          {conflicts.length > 0 && (
            <div className="accessibility-cues-status" role="alert">
              <strong>{tt(language, 'accessibilityCues.conflicts')}</strong>
              <ul className="accessibility-cues-conflicts">
                {conflicts.map((conflict) => (
                  <li key={`${conflict.code}-${conflict.eventId}`}>
                    {tt(language, `accessibilityCues.conflict.${conflict.code}`, {
                      event: eventLabel(conflict.eventId, language)
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="accessibility-cues-actions">
            <button
              className="accessibility-cues-button"
              type="button"
              onClick={() => void resetProfile()}
            >
              {tt(language, 'accessibilityCues.resetProfile')}
            </button>
          </div>
        </section>

        <section className="accessibility-cues-panel" aria-labelledby="cue-preview-heading">
          <h2 id="cue-preview-heading">{tt(language, 'accessibilityCues.previewHeading')}</h2>
          <p className="accessibility-cues-help" id="cue-preview-help">
            {tt(language, 'accessibilityCues.previewHelp')}
          </p>

          <label className="accessibility-cues-control">
            <span>{tt(language, 'accessibilityCues.previewEvent')}</span>
            <select
              value={selectedEventId}
              onChange={(event) => {
                setSelectedEventId(event.target.value)
                setPreview(null)
              }}
            >
              {CUE_MANIFESTS.map((cue) => (
                <option key={cue.eventId} value={cue.eventId}>
                  {eventLabel(cue.eventId, language)}
                </option>
              ))}
            </select>
          </label>

          <button
            className="accessibility-cues-button accessibility-cues-button--primary"
            type="button"
            aria-describedby="cue-preview-help"
            onClick={runSafePreview}
          >
            {tt(language, 'accessibilityCues.runPreview')}
          </button>

          {preview ? (
            <div
              className="accessibility-cues-preview"
              data-high-contrast={preview.presentation.highContrast ? 'true' : undefined}
              role="status"
              aria-live="polite"
              style={{
                '--preview-text-scale': preview.presentation.textScale
              } as CSSProperties}
            >
              <div className="accessibility-cues-preview__headline">
                {preview.outputs.find((output) => output.modality === 'symbol')?.symbol && (
                  <span
                    className="accessibility-cues-preview__symbol"
                    aria-hidden="true"
                  >
                    {preview.outputs.find((output) => output.modality === 'symbol')?.symbol}
                  </span>
                )}
                <div>
                  <strong>{eventLabel(preview.eventId, language)}</strong>
                  <div>{preview.message}</div>
                </div>
              </div>

              <div className="accessibility-cues-preview__modalities">
                {preview.outputs.map((output) => (
                  <div
                    className="accessibility-cues-preview__modality"
                    key={output.modality}
                  >
                    <strong>{modalityLabel(output.modality, language)}</strong>
                    <span>{output.message}</span>
                    {output.patternLabel && <small>{output.patternLabel}</small>}
                    {output.delivery === 'simulated' && (
                      <small>
                        {tt(language, 'accessibilityCues.simulatedNoHardware')}
                      </small>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="accessibility-cues-status" role="status">
              {tt(language, 'accessibilityCues.previewEmpty')}
            </div>
          )}
        </section>
      </div>

      <section className="accessibility-cues-panel" aria-labelledby="cue-overrides-heading">
        <h2 id="cue-overrides-heading">{tt(language, 'accessibilityCues.overridesHeading')}</h2>
        <p className="accessibility-cues-help">
          {tt(language, 'accessibilityCues.overridesHelp')}
        </p>
        <div className="accessibility-cues-table-wrap">
          <table className="accessibility-cues-table">
            <caption>{tt(language, 'accessibilityCues.overridesCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{tt(language, 'accessibilityCues.eventColumn')}</th>
                {CUE_MODALITIES.map((modality) => (
                  <th key={modality} scope="col">
                    {modalityLabel(modality, language)}
                  </th>
                ))}
                <th scope="col">{tt(language, 'accessibilityCues.resetColumn')}</th>
              </tr>
            </thead>
            <tbody>
              {CUE_MANIFESTS.map((cue) => {
                const override = activeProfile.overrides[cue.eventId]?.modalities
                return (
                  <tr key={cue.eventId}>
                    <th scope="row">
                      <span className="accessibility-cues-event-name">
                        <span>{eventLabel(cue.eventId, language)}</span>
                        <small>{cue.symbol.token} · {cue.led.patternLabel}</small>
                        {cue.preserveCritical && (
                          <span className="accessibility-cues-critical">
                            {tt(language, 'accessibilityCues.critical')}
                          </span>
                        )}
                      </span>
                    </th>
                    {CUE_MODALITIES.map((modality) => {
                      const checked =
                        typeof override?.[modality] === 'boolean'
                          ? override[modality]
                          : activeProfile.modalities[modality]
                      return (
                        <td key={modality}>
                          <input
                            type="checkbox"
                            checked={checked}
                            aria-label={tt(language, 'accessibilityCues.overrideAria', {
                              modality: modalityLabel(modality, language),
                              event: eventLabel(cue.eventId, language)
                            })}
                            onChange={(event) =>
                              updateOverride(cue.eventId, modality, event.target.checked)
                            }
                          />
                        </td>
                      )
                    })}
                    <td>
                      <button
                        className="accessibility-cues-button"
                        type="button"
                        disabled={!activeProfile.overrides[cue.eventId]}
                        onClick={() => clearOverride(cue.eventId)}
                      >
                        {tt(language, 'accessibilityCues.inherit')}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export default AccessibilityCuesView
