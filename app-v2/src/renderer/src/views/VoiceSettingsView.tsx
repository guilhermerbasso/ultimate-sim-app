import { type CSSProperties, type ReactElement, useCallback, useEffect, useMemo, useState } from 'react'
import type { AppViewProps } from '../App'
import { tt } from '../i18n'
import { PIPER_VOICE_CATALOG, piperVoiceLang, TTS_CHANNELS, type PiperVoiceInfo, type PiperVoiceProgress, type TtsEngineStatus } from '../../../shared/spotter'
import { STT_CHANNELS, type SttStatus, type SttModelProgress } from '../../../shared/stt-ipc'
import { ensureSttModel, subscribeSttModelProgress } from '../lib/wake-word'
import {
  DEFAULT_TTS_PREF,
  ensurePiperVoice,
  getTtsPref,
  listPiperVoices,
  setTtsPref,
  speakViaTts,
  subscribeVoiceProgress,
  type TtsEngine,
  type TtsPref
} from '../lib/tts-runtime'

// VoiceSettingsView — pick the neural (Piper) voice the AI engineer speaks with,
// download voices on demand (the installer ships only the engine binary), preview
// them, set the speaking rate, and toggle between the Piper engine and OS Web Speech.
//
// Color rule: WARM chrome (orange/amber accents). Cool GREEN is reserved strictly for
// "installed/ready" states (a downloaded voice = green check).

const shell: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-6)',
  maxWidth: 900
}

const panel: CSSProperties = {
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-6)'
}

const eyebrow: CSSProperties = {
  color: 'var(--accent-primary)',
  fontFamily: '"Barlow Condensed", sans-serif',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.16em',
  textTransform: 'uppercase'
}

const title: CSSProperties = {
  color: 'var(--text-primary)',
  fontFamily: '"Rajdhani", sans-serif',
  fontSize: 26,
  fontWeight: 700,
  margin: '2px 0 0',
  letterSpacing: '0.01em'
}

const sectionLabel: CSSProperties = {
  color: 'var(--text-muted)',
  fontFamily: '"Barlow Condensed", sans-serif',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  marginBottom: 'var(--space-3)'
}

const primaryButton: CSSProperties = {
  background: 'var(--accent-primary)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-on-accent)',
  cursor: 'pointer',
  fontFamily: '"Rajdhani", sans-serif',
  fontWeight: 700,
  textTransform: 'uppercase',
  padding: '0 var(--space-5)',
  height: 32,
  letterSpacing: '0.06em'
}

const ghostButton: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  fontFamily: '"Rajdhani", sans-serif',
  fontWeight: 600,
  textTransform: 'uppercase',
  padding: '0 var(--space-4)',
  height: 30,
  letterSpacing: '0.05em'
}

const rangeStyle: CSSProperties = {
  width: '100%',
  accentColor: 'var(--accent-primary)',
  cursor: 'pointer'
}

const LANG_LABEL: Record<PiperVoiceInfo['lang'], string> = {
  'pt-BR': 'voice.language.ptBR',
  'en-US': 'voice.language.enUS'
}

const PREVIEW_TEXT: Record<string, string> = {
  'pt-BR': 'Turn three on your right. You are clear, good lap.',
  'en-US': 'Turn three on your right. You are clear, good lap.'
}

function previewFor(voiceId: string): string {
  const lang = piperVoiceLang(voiceId) ?? 'pt-BR'
  return PREVIEW_TEXT[lang] ?? PREVIEW_TEXT['pt-BR']
}

function phaseLabel(progress: PiperVoiceProgress | undefined, language: AppViewProps['language']): string {
  if (!progress) return ''
  switch (progress.phase) {
    case 'resolving':
      return 'Preparing…'
    case 'downloading':
      return `Downloading… ${Math.round(progress.ratio * 100)}%`
    case 'verifying':
      return 'Viewifying…'
    case 'done':
      return tt(language, 'voice.phase.done')
    case 'error':
      return tt(language, 'voice.phase.error', { error: progress.error ?? tt(language, 'common.errorUnknown') })
    default:
      return ''
  }
}

function VoiceSettingsView({ showToast, language }: AppViewProps): ReactElement {
  const [pref, setPref] = useState<TtsPref>(() => getTtsPref())
  const [voices, setVoices] = useState<PiperVoiceInfo[]>(() =>
    PIPER_VOICE_CATALOG.map((v) => ({ ...v, installed: false }))
  )
  const [progress, setProgress] = useState<Record<string, PiperVoiceProgress>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [sttStatus, setSttStatus] = useState<SttStatus | null>(null)
  const [sttBusy, setSttBusy] = useState(false)
  const [sttProgress, setSttProgress] = useState<SttModelProgress | null>(null)
  const [engineStatus, setEngineStatus] = useState<TtsEngineStatus | null>(null)

  const refreshVoices = useCallback(async () => {
    const list = await listPiperVoices()
    if (list.length > 0) setVoices(list)
  }, [])

  useEffect(() => {
    void refreshVoices()
    const off = subscribeVoiceProgress((p) => {
      setProgress((prev) => ({ ...prev, [p.voiceId]: p }))
      if (p.phase === 'done' || p.phase === 'error') void refreshVoices()
    })
    return off
  }, [refreshVoices])

  const refreshSttStatus = useCallback(async () => {
    try {
      const s = await window.ipc.invoke<SttStatus>(STT_CHANNELS.status)
      setSttStatus(s)
    } catch {
      // STT inactive on this host (e.g. dev/mac without the bundled binary).
    }
  }, [])

  useEffect(() => {
    void refreshSttStatus()
    const offStatus = window.ipc.subscribe<SttStatus>(STT_CHANNELS.statusEvent, (s) => setSttStatus(s))
    const offProg = subscribeSttModelProgress((p) => {
      setSttProgress(p)
      if (p.phase === 'done' || p.phase === 'error') void refreshSttStatus()
    })
    return () => {
      offStatus()
      offProg()
    }
  }, [refreshSttStatus])

  // Self-test the neural engine once so the user gets a clear signal when synth is
  // silently falling back to OS voices (e.g. onnxruntime crashes on this CPU).
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const status = await window.ipc.invoke<TtsEngineStatus>(TTS_CHANNELS.engineStatus)
        if (active) setEngineStatus(status)
      } catch {
        // engine module not ready (e.g. dev/mac) — leave the pill hidden
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const updatePref = useCallback((patch: Partial<TtsPref>) => {
    setPref(setTtsPref(patch))
  }, [])

  // Ensure a Piper voice is present on disk before we rely on it. Returns how the
  // voice will actually speak: 'piper' when the neural model + engine are ready,
  // 'system' when the model downloaded but the Piper engine binary is absent (e.g.
  // dev/macOS) so playback will fall back to the OS voice, or 'failed' on error.
  const ensureVoiceReady = useCallback(
    async (voiceId: string): Promise<'piper' | 'system' | 'failed'> => {
      setBusy((b) => ({ ...b, [voiceId]: true }))
      try {
        const result = await ensurePiperVoice(voiceId)
        const list = await listPiperVoices()
        if (list.length > 0) setVoices(list)
        if (!result.ok) return 'failed'
        // listVoices.installed = (engine binary present AND model on disk). When the
        // model is on disk (result.installed) but listVoices still reports false, the
        // engine binary is missing → playback uses the system voice.
        const usable = list.find((v) => v.id === voiceId)?.installed ?? false
        return usable ? 'piper' : 'system'
      } finally {
        setBusy((b) => ({ ...b, [voiceId]: false }))
      }
    },
    []
  )

  const handleEngine = useCallback(
    (engine: TtsEngine) => {
      updatePref({ engine })
      showToast(engine === 'piper' ? 'Engine: Piper (offline neural · default)' : 'Engine: system voice (Web Speech fallback)', 'info')
    },
    [updatePref, showToast]
  )

  const handleDownload = useCallback(
    async (voiceId: string) => {
      const outcome = await ensureVoiceReady(voiceId)
      if (outcome === 'failed') showToast(tt(language, 'voice.downloadFailedToast', { voice: voiceId }), 'error')
      else if (outcome === 'system') showToast(`Voice downloaded: ${voiceId} (Piper engine unavailable on this host — system voice will be used).`, 'info')
      else showToast(tt(language, 'voice.downloadedToast', { voice: voiceId }), 'success')
    },
    [ensureVoiceReady, showToast]
  )

  const handleTest = useCallback(
    async (voice: PiperVoiceInfo) => {
      // Auto-download the voice on demand BEFORE playing so "Testar voz" always
      // previews the ACTUAL distinct Piper voice (progress shows via the bar).
      if (pref.engine === 'piper' && !voice.installed) {
        const outcome = await ensureVoiceReady(voice.id)
        if (outcome === 'system') {
          showToast('Piper engine unavailable — using system voice.', 'info')
        } else if (outcome === 'failed') {
          showToast('Voice download failed — using system voice.', 'info')
        }
      } else if (pref.engine !== 'piper') {
        showToast('System voice engine selected — testing with the system voice.', 'info')
      }
      void speakViaTts(previewFor(voice.id), { voiceId: voice.id })
    },
    [pref.engine, ensureVoiceReady, showToast]
  )

  const handleSetDefault = useCallback(
    async (voiceId: string) => {
      updatePref({ voiceId })
      // Setting the engineer voice should make it usable immediately — auto-download
      // it if it isn't on disk yet (otherwise the engineer would silently fall back
      // to the single OS voice and every voice would sound the same).
      if (pref.engine === 'piper') {
        const outcome = await ensureVoiceReady(voiceId)
        if (outcome === 'system') showToast(`Default voice: ${voiceId} (engine unavailable — system voice).`, 'info')
        else if (outcome === 'failed') showToast(tt(language, 'voice.defaultDownloadFailedToast', { voice: voiceId }), 'info')
        else showToast(tt(language, 'voice.defaultVoiceToast', { voice: voiceId }), 'success')
      } else {
        showToast(tt(language, 'voice.defaultVoiceToast', { voice: voiceId }), 'success')
      }
    },
    [updatePref, pref.engine, ensureVoiceReady, showToast]
  )

  const handleSttToggle = useCallback(
    async (enabled: boolean) => {
      try {
        await window.ipc.invoke(STT_CHANNELS.setConfig, { enabled })
        await refreshSttStatus()
        showToast(enabled ? tt(language, 'voice.wakeEnabledToast') : tt(language, 'voice.wakeDisabledToast'), 'info')
      } catch {
        showToast(tt(language, 'voice.inputChangeFailedToast'), 'error')
      }
    [language, refreshSttStatus, showToast]
  )

  const handleSttDownload = useCallback(async () => {
    setSttBusy(true)
    try {
      await ensureSttModel()
      await refreshSttStatus()
      showToast(tt(language, 'voice.recognitionReadyToast'), 'success')
    } catch {
      showToast(tt(language, 'voice.recognitionDownloadFailedToast'), 'error')
    } finally {
      setSttBusy(false)
    }
  }, [refreshSttStatus, showToast])

  const ratePct = useMemo(() => Math.round(pref.rate * 100), [pref.rate])

  const engineOk = engineStatus?.ok === true
  const enginePill: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    marginTop: 'var(--space-3)',
    padding: '3px 10px',
    borderRadius: 999,
    fontFamily: '"Barlow Condensed", sans-serif',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.04em',
    border: `1px solid ${engineOk ? 'var(--accent-success)' : 'var(--accent-warning)'}`,
    color: engineOk ? 'var(--accent-success)' : 'var(--accent-warning)',
    background: engineOk ? 'var(--accent-success-dim, transparent)' : 'var(--accent-warning-dim, transparent)',
    cursor: engineStatus?.reason ? 'help' : 'default'
  }

  return (
    <div style={shell}>
      <header>
        <div style={eyebrow}>Voice · offline neural TTS</div>
        <h1 style={title}>{tt(language, 'voice.title')}</h1>
        <p style={{ color: 'var(--text-secondary)', maxWidth: 620, marginTop: 'var(--space-2)' }}>
          Piper synthesizes neural speech locally (no cloud). Voices are downloaded on demand — the installer ships
          only the engine. If no voice is installed, the app automatically uses the system voice. The voice chosen here is used
          by the <strong>AI Engineer</strong> (answers, proactive coaching, and debrief). <strong>Voice Spotter</strong>
          has its own voice, selectable in the Voice Spotter section inside AI Engineer.
        </p>
        {engineStatus && (
          <div style={enginePill} title={engineStatus.reason ?? undefined}>
            <span aria-hidden>{engineOk ? '●' : '▲'}</span>
            {engineOk ? 'Neural engine OK' : 'Neural engine unavailable — using distinct Windows voices'}
          </div>
        )}
      </header>

      {/* Engine + rate */}
      <section style={panel}>
        <div style={sectionLabel}>Voice engine · neural is the default; system voice is fallback only</div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-6)' }}>
          {(['piper', 'webspeech'] as TtsEngine[]).map((engine) => {
            const active = pref.engine === engine
            return (
              <button
                key={engine}
                type="button"
                onClick={() => handleEngine(engine)}
                style={{
                  ...ghostButton,
                  height: 34,
                  padding: '0 var(--space-5)',
                  background: active ? 'var(--accent-primary-dim)' : 'transparent',
                  borderColor: active ? 'var(--accent-primary)' : 'var(--border-strong)',
                  color: active ? 'var(--accent-primary)' : 'var(--text-primary)'
                }}
              >
                {engine === 'piper' ? 'Piper (neural · default)' : 'System (fallback)'}
              </button>
            )
          })}
        </div>

        <div style={sectionLabel}>
          Speech rate · <span style={{ color: 'var(--text-primary)' }}>{ratePct}%</span>
        </div>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.05}
          value={pref.rate}
          onChange={(e) => updatePref({ rate: Number(e.target.value) })}
          style={rangeStyle}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: 11 }}>
          <span>0.5×</span>
          <button
            type="button"
            onClick={() => updatePref({ rate: DEFAULT_TTS_PREF.rate })}
            style={{ ...ghostButton, height: 22, fontSize: 10 }}
          >
            Reset
          </button>
          <span>2.0×</span>
        </div>
      </section>

      {/* Voice catalog */}
      <section style={panel}>
        <div style={sectionLabel}>{tt(language, 'voice.voicesInstalled', { count: voices.filter((v) => v.installed).length })}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {voices.map((voice) => {
            const isDefault = pref.voiceId === voice.id
            const prog = progress[voice.id]
            const downloading = busy[voice.id] || (prog && (prog.phase === 'downloading' || prog.phase === 'resolving'))
            return (
              <div
                key={voice.id}
                style={{
                  border: `1px solid ${isDefault ? 'var(--accent-primary)' : 'var(--border-default)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-4)',
                  background: isDefault ? 'var(--accent-primary-dim)' : 'var(--surface-sunken)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <span
                        style={{
                          fontFamily: '"Rajdhani", sans-serif',
                          fontWeight: 700,
                          fontSize: 16,
                          color: 'var(--text-primary)'
                        }}
                      >
                        {voice.name}
                      </span>
                      {voice.installed && (
                        <span
                          title={tt(language, 'voice.installedTitle')}
                          style={{
                            color: 'var(--accent-success)',
                            fontWeight: 700,
                            fontSize: 13,
                            border: '1px solid var(--accent-success)',
                            borderRadius: 'var(--radius-pill, 999px)',
                            padding: '1px 8px'
                          }}
                        >
                          ✓ Ready
                        </span>
                      )}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>
                      {LANG_LABEL[voice.lang]} · quality {voice.quality}
                      {voice.onnxBytes ? ` · ~${Math.round(voice.onnxBytes / 1_000_000)} MB` : ''}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
                    <button type="button" onClick={() => void handleTest(voice)} style={ghostButton}>
                      Test voice
                    </button>
                    {!voice.installed ? (
                      <button
                        type="button"
                        onClick={() => void handleDownload(voice.id)}
                        disabled={!!downloading}
                        style={{ ...primaryButton, opacity: downloading ? 0.6 : 1 }}
                      >
                        {downloading ? 'Downloading…' : 'Download'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleSetDefault(voice.id)}
                        disabled={isDefault}
                        style={{
                          ...primaryButton,
                          background: isDefault ? 'var(--accent-success)' : 'var(--accent-primary)',
                          opacity: isDefault ? 0.85 : 1,
                          cursor: isDefault ? 'default' : 'pointer'
                        }}
                      >
                        {isDefault ? tt(language, 'voice.default') : tt(language, 'voice.setDefault')}
                      </button>
                    )}
                  </div>
                </div>

                {prog && prog.phase !== 'done' && (
                  <div style={{ marginTop: 'var(--space-3)' }}>
                    <div
                      style={{
                        height: 6,
                        borderRadius: 999,
                        background: 'var(--surface-overlay)',
                        overflow: 'hidden'
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.round((prog.ratio || 0) * 100)}%`,
                          background:
                            prog.phase === 'error' ? 'var(--accent-danger)' : 'var(--accent-primary)',
                          transition: 'width 120ms linear'
                        }}
                      />
                    </div>
                    <div
                      style={{
                        color: prog.phase === 'error' ? 'var(--text-danger)' : 'var(--text-muted)',
                        fontSize: 11,
                        marginTop: 4
                      }}
                    >
                      {phaseLabel(prog, language)}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section style={panel}>
        <div style={sectionLabel}>Voice input — "Hey, Engineer"</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 'var(--space-4)' }}>
          {tt(language, 'voice.inputHelpBefore')} <strong>"Hey, Engineer"</strong> {tt(language, 'voice.inputHelpAfter')}
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-4)'
          }}
        >
          <span>{tt(language, 'voice.enableWakeWord')}</span>
          <input
            type="checkbox"
            checked={sttStatus?.enabled ?? true}
            onChange={(e) => void handleSttToggle(e.target.checked)}
          />
        </label>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-3)'
          }}
        >
          <div style={{ fontSize: 12, color: sttStatus?.available ? 'var(--accent-success)' : 'var(--text-muted)' }}>
            {sttStatus?.available
              ? tt(language, 'voice.recognitionReady')
              : sttStatus?.binaryPresent === false
                ? tt(language, 'voice.packagedOnly')
                : tt(language, 'voice.downloadRecognitionHelp')}
          </div>
          {!sttStatus?.modelPresent && sttStatus?.binaryPresent !== false && (
            <button type="button" style={primaryButton} disabled={sttBusy} onClick={() => void handleSttDownload()}>
              {sttBusy ? 'Downloading…' : 'Download recognition (~75MB)'}
            </button>
          )}
        </div>

        {sttProgress && sttProgress.phase !== 'done' && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.round((sttProgress.ratio || 0) * 100)}%`,
                  background: sttProgress.phase === 'error' ? 'var(--accent-danger)' : 'var(--accent-primary)',
                  transition: 'width 120ms linear'
                }}
              />
            </div>
            <div
              style={{
                color: sttProgress.phase === 'error' ? 'var(--text-danger)' : 'var(--text-muted)',
                fontSize: 11,
                marginTop: 4
              }}
            >
              {sttProgress.phase === 'downloading'
                ? `Downloading recognition… ${Math.round((sttProgress.ratio || 0) * 100)}%`
                : sttProgress.phase === 'error'
                  ? tt(language, 'voice.phase.error', { error: sttProgress.error ?? tt(language, 'common.errorUnknown') })
                  : sttProgress.phase}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

export default VoiceSettingsView
