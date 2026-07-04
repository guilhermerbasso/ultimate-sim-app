import { type CSSProperties, type ReactElement, useCallback, useEffect, useRef, useState } from 'react'
import {
  generateDebrief,
  getLastDebrief,
  subscribeDebrief,
  subscribeDebriefTrigger
} from '../../lib/stint-debrief'
import { speakViaTts } from '../../lib/tts-runtime'
import type { DebriefReason, StintDebrief } from '../../../../shared/stint-debrief'

// Stint/session DEBRIEF panel (WS-I). Mounted in the Coach IA at the
// `StintDebriefSeam` left by WS-D. Shows the deterministic pt-BR debrief (text +
// bullets) folded from the Coach findings + Predictions, with a "Gerar debrief"
// button (optionally LLM-phrased) and an "Ouvir" button that speaks it through
// the shared neural TTS (Piper → Web Speech). Warm chrome; cool/green reserved
// for the positive "onde foi bem" signal.

const wrap: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 }

const controls: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }

const primaryButton: CSSProperties = {
  padding: '8px 14px',
  background: 'var(--accent-primary)',
  border: 'none',
  borderRadius: 8,
  color: 'var(--text-on-accent)',
  fontFamily: '"Rajdhani", sans-serif',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer'
}

const ghostButton: CSSProperties = {
  padding: '8px 14px',
  background: 'var(--surface-sunken)',
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  color: 'var(--text-secondary)',
  fontFamily: '"Rajdhani", sans-serif',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer'
}

const toggle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  color: 'var(--text-muted)',
  fontSize: 12
}

const card: CSSProperties = {
  background: 'var(--surface-sunken)',
  border: '1px solid var(--border-default)',
  borderRadius: 10,
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10
}

const bodyText: CSSProperties = { color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.55 }
const mutedText: CSSProperties = { color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.5 }

const bulletList: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }

const eyebrow: CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: 11,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
  fontFamily: '"Rajdhani", sans-serif'
}

function bulletColor(text: string): string {
  if (text.startsWith('✅')) return 'var(--accent-success)' // onde foi bem (cool/positive)
  if (text.startsWith('⚠')) return 'var(--accent-warning)' // onde perdeu (warm)
  return 'var(--text-secondary)' // strategy / neutral
}

function reasonLabel(reason: DebriefReason): string {
  if (reason === 'session-end') return 'Fim de sessão'
  if (reason === 'stint-end') return 'Fim de stint'
  return 'Sob demanda'
}

export default function StintDebrief(): ReactElement {
  const [debrief, setDebrief] = useState<StintDebrief | null>(null)
  const [loading, setLoading] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [useLlm, setUseLlm] = useState(false)
  const useLlmRef = useRef(useLlm)
  useLlmRef.current = useLlm

  const run = useCallback(async (reason: DebriefReason) => {
    setLoading(true)
    try {
      const result = await generateDebrief({ useLlm: useLlmRef.current, reason })
      if (result) setDebrief(result)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    void getLastDebrief().then((last) => {
      if (alive && last) setDebrief(last)
    })
    const unsubUpdated = subscribeDebrief((next) => {
      if (alive) setDebrief(next)
    })
    // Auto-generate when the main process detects a stint/session boundary.
    const unsubTrigger = subscribeDebriefTrigger((reason) => {
      void run(reason)
    })
    return () => {
      alive = false
      unsubUpdated()
      unsubTrigger()
    }
  }, [run])

  const speak = useCallback(async () => {
    if (!debrief) return
    const lines = [debrief.text, ...debrief.bullets].filter((l) => l && l.trim().length > 0)
    const speech = lines.join('. ')
    setSpeaking(true)
    try {
      await speakViaTts(speech, { lang: 'pt-BR' })
    } finally {
      setSpeaking(false)
    }
  }, [debrief])

  return (
    <div style={wrap}>
      <div style={controls}>
        <button type="button" style={primaryButton} disabled={loading} onClick={() => void run('manual')}>
          {loading ? 'Gerando…' : 'Gerar debrief'}
        </button>
        <button type="button" style={ghostButton} disabled={!debrief || speaking} onClick={() => void speak()}>
          {speaking ? 'Falando…' : '🔊 Ouvir'}
        </button>
        <label style={toggle}>
          <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} />
          Frasear com IA
        </label>
      </div>

      {debrief ? (
        <div style={card}>
          <span style={eyebrow}>
            {reasonLabel(debrief.reason)} · {debrief.source === 'llm' ? 'IA' : 'determinístico'}
          </span>
          <p style={bodyText}>{debrief.text}</p>
          {debrief.bullets.length > 0 ? (
            <ul style={bulletList}>
              {debrief.bullets.map((b, i) => (
                <li key={i} style={{ ...bodyText, color: bulletColor(b) }}>
                  {b}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p style={mutedText}>
          O resumo do stint/sessão aparece aqui ao final de cada stint, ou clique em “Gerar debrief”.
        </p>
      )}
    </div>
  )
}
