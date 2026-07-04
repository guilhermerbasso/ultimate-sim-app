import { type ComponentType, type CSSProperties, type ReactElement, type ReactNode, useEffect, useMemo, useState } from 'react'
import type { AppViewProps } from '../App'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import {
  DEFAULT_SPOTTER_3D_CONFIG,
  SPOTTER_3D_CHANNELS,
  computeSpatialCues,
  type SpatialCue,
  type SpatialSide,
  type Spotter3DConfig,
  type Spotter3DConfigPatch,
  type Spotter3DTestPosition
} from '../lib/spotter-3d'
import {
  getSpotter3DEngine,
  subscribeSpotter3DStatus,
  type Spotter3DStatus
} from '../lib/spotter3d-runtime'

// 3D Spotter — CONFIG + EXPLANATION + TEST. The audio runtime is GLOBAL (mounted
// once in App.tsx via useSpotter3DRuntime), so it already runs during the whole
// session. This view does NOT own the engine: it edits the config (the runtime
// reacts live), tests the GLOBAL engine, and explains the feature. Works on any
// stereo output — headphones give the best HRTF imaging.

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Warm (orange/amber) = chrome/accents/alerts. Cool/teal = positive ready/active.
const WARM = '#FF8C00'
const WARM_SOFT = '#FFB020'
const READY = '#49C5B1'

const panel: CSSProperties = {
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-6)'
}

const label: CSSProperties = {
  color: 'var(--text-muted)',
  fontFamily: '"Barlow Condensed", sans-serif',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.10em',
  textTransform: 'uppercase'
}

const button: CSSProperties = {
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  fontFamily: '"Rajdhani", sans-serif',
  fontWeight: 600,
  textTransform: 'uppercase',
  padding: '0 var(--space-5)',
  height: 34,
  letterSpacing: '0.06em'
}

const RADAR = 280
const SIDE_COLOR: Record<SpatialSide, string> = { left: '#4F8EF7', right: WARM, center: READY }

function Slider({
  text,
  min,
  max,
  step,
  value,
  display,
  onChange,
  onCommit
}: {
  text: string
  min: number
  max: number
  step: number
  value: number
  display: string
  onChange(next: number): void
  onCommit(next: number): void
}): ReactElement {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ ...label, display: 'flex', justifyContent: 'space-between' }}>
        <span>{text}</span>
        <span style={{ color: 'var(--text-primary)' }}>{display}</span>
      </span>
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={() => onCommit(value)}
        onKeyUp={() => onCommit(value)}
        step={step}
        style={{ width: '100%', accentColor: WARM }}
        type="range"
        value={value}
      />
    </label>
  )
}

function ExplainerBlock({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <h3 style={{ margin: 0, color: WARM, fontFamily: '"Rajdhani", sans-serif', fontSize: 15, letterSpacing: '0.02em' }}>{title}</h3>
      <div style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>{children}</div>
    </div>
  )
}

function radarDot(cue: SpatialCue, config: Spotter3DConfig): ReactElement {
  const half = RADAR / 2
  const scaleX = (half - 16) / Math.max(0.5, config.panWidthM)
  const scaleZ = (half - 16) / Math.max(0.5, config.maxDistanceM)
  const px = half + Math.max(-(half - 8), Math.min(half - 8, cue.x * scaleX))
  const py = half - Math.max(-(half - 8), Math.min(half - 8, cue.z * scaleZ))
  const size = 8 + cue.intensity * 18
  return (
    <div
      key={cue.id}
      style={{
        position: 'absolute',
        left: px - size / 2,
        top: py - size / 2,
        width: size,
        height: size,
        borderRadius: '50%',
        background: SIDE_COLOR[cue.side],
        opacity: 0.35 + cue.intensity * 0.65,
        boxShadow: `0 0 ${Math.round(6 + cue.intensity * 18)}px ${SIDE_COLOR[cue.side]}`,
        transition: 'left 80ms linear, top 80ms linear'
      }}
      title={`car ${cue.id} · ${cue.distanceM.toFixed(1)} m · ${Math.round(cue.intensity * 100)}%`}
    />
  )
}

const Spotter3DView: ComponentType<AppViewProps> = ({ showToast }): ReactElement => {
  const [config, setConfig] = useState<Spotter3DConfig>(DEFAULT_SPOTTER_3D_CONFIG)
  const [live, setLive] = useState<TelemetrySnapshot | null>(null)
  const [status, setStatus] = useState<Spotter3DStatus>({ unlocked: false, enabled: DEFAULT_SPOTTER_3D_CONFIG.enabled, running: false })

  useEffect(() => {
    void window.ipc
      .invoke<Spotter3DConfig>(SPOTTER_3D_CHANNELS.getConfig)
      .then(setConfig)
      .catch((error) => showToast(getErrorMessage(error), 'error'))
    const offConfig = window.ipc.subscribe<Spotter3DConfig>(SPOTTER_3D_CHANNELS.configEvent, setConfig)
    const offTelemetry = window.ipc.subscribe<TelemetrySnapshot | null>('telemetry:snapshot', setLive)
    const offStatus = subscribeSpotter3DStatus(setStatus)
    return () => {
      offConfig()
      offTelemetry()
      offStatus()
    }
  }, [showToast])

  const cues = useMemo<SpatialCue[]>(() => computeSpatialCues(live, config), [live, config])

  async function persist(patch: Spotter3DConfigPatch): Promise<void> {
    try {
      const saved = await window.ipc.invoke<Spotter3DConfig>(SPOTTER_3D_CHANNELS.setConfig, patch)
      setConfig(saved)
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  function runTest(position: Spotter3DTestPosition): void {
    const engine = getSpotter3DEngine()
    void engine.resume()
    engine.test(position)
  }

  const active = status.enabled && status.unlocked
  const pillColor = active ? READY : status.enabled ? WARM_SOFT : 'var(--text-muted)'
  const pillText = active ? 'Ativo · áudio liberado' : status.enabled ? 'Ligado · aguardando 1º clique' : 'Desligado'

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <header style={{ display: 'grid', gap: 6 }}>
        <h1 style={{ margin: 0, fontFamily: '"Rajdhani", sans-serif', fontSize: 24, color: 'var(--text-primary)' }}>Spotter 3D</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', maxWidth: 760 }}>
          Áudio espacial (Web Audio HRTF) que toca durante toda a sessão: você <strong>ouve</strong> os carros próximos posicionados ao seu
          redor — esquerda/direita pelo lado, perto/longe pelo volume, frente/trás pelo tom. Use <strong>fones de ouvido</strong> para a
          melhor imagem 3D. Complementa (não substitui) os avisos falados do Voice Spotter.
        </p>
      </header>

      <section style={{ ...panel, display: 'grid', gap: 16 }}>
        <ExplainerBlock title="O que é o Spotter 3D">
          Um spotter de <strong>áudio puro</strong>: em vez de falar, ele coloca um som suave na posição de cada carro perto de você, como se
          o carro estivesse mesmo ali no espaço. É a sua "visão periférica" sonora em curvas, ultrapassagens e brigas lado a lado.
        </ExplainerBlock>
        <ExplainerBlock title="Como funciona">
          A telemetria do iRacing informa onde estão os carros vizinhos. O app converte isso em sons posicionados (HRTF): carro à
          <strong> esquerda</strong> soa à esquerda, à <strong>direita</strong> soa à direita, <strong>atrás</strong> soa mais grave, e quanto
          mais <strong>perto</strong>, mais alto. Sem nenhum carro por perto, fica <strong>em silêncio</strong>.
        </ExplainerBlock>
        <ExplainerBlock title="Como usar">
          Já vem <strong>ligado</strong> por padrão e roda sozinho em qualquer tela. Por uma regra do navegador, o áudio só libera após o seu
          <strong> primeiro clique</strong> em qualquer lugar do app — depois disso funciona o resto da sessão. Coloque os fones, ajuste o
          volume abaixo e teste a posição nos botões.
        </ExplainerBlock>
      </section>

      <section style={{ ...panel, display: 'grid', gridTemplateColumns: `${RADAR}px 1fr`, gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 10, justifyItems: 'center' }}>
          <div
            style={{
              position: 'relative',
              width: RADAR,
              height: RADAR,
              borderRadius: 'var(--radius-md)',
              background: 'var(--surface-sunken)',
              border: '1px solid var(--border-default)',
              overflow: 'hidden'
            }}
          >
            <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', borderTop: '1px dashed var(--border-default)' }} />
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', borderLeft: '1px dashed var(--border-default)' }} />
            <div
              style={{
                position: 'absolute',
                left: RADAR / 2 - 6,
                top: RADAR / 2 - 6,
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: 'var(--text-primary)'
              }}
              title="Você"
            />
            <span style={{ position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)', ...label }}>frente</span>
            <span style={{ position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', ...label }}>trás</span>
            {cues.map((cue) => radarDot(cue, config))}
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{cues.length} carro(s) com cue ativo</span>
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => void persist({ enabled: !config.enabled })}
              style={{
                ...button,
                background: config.enabled ? READY : 'transparent',
                color: config.enabled ? '#06231f' : 'var(--text-primary)',
                border: config.enabled ? 'none' : '1px solid var(--border-strong)'
              }}
              type="button"
            >
              {config.enabled ? 'Spotter 3D ligado' : 'Spotter 3D desligado'}
            </button>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                color: pillColor,
                fontSize: 12,
                fontWeight: 600
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: pillColor, boxShadow: `0 0 8px ${pillColor}` }} />
              {pillText}
            </span>
          </div>

          {config.enabled && !status.unlocked && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(255, 176, 32, 0.12)',
                border: `1px solid ${WARM_SOFT}`,
                color: WARM_SOFT,
                fontSize: 13
              }}
            >
              🔊 Clique em qualquer lugar do app para ativar o áudio (política de autoplay do navegador).
            </div>
          )}

          <div>
            <span style={label}>Testar posição</span>
            <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              {([
                ['left', 'Esquerda'],
                ['right', 'Direita'],
                ['behind', 'Atrás']
              ] as Array<[Spotter3DTestPosition, string]>).map(([position, text]) => (
                <button
                  key={position}
                  onClick={() => runTest(position)}
                  style={{ ...button, background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-strong)' }}
                  type="button"
                >
                  {text}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(180px, 1fr))', gap: 14 }}>
            <Slider
              text="Volume"
              min={0}
              max={1}
              step={0.05}
              value={config.masterVolume}
              display={`${Math.round(config.masterVolume * 100)}%`}
              onChange={(masterVolume) => setConfig((c) => ({ ...c, masterVolume }))}
              onCommit={(masterVolume) => void persist({ masterVolume })}
            />
            <Slider
              text="Distância máx. (m)"
              min={5}
              max={80}
              step={1}
              value={config.maxDistanceM}
              display={`${config.maxDistanceM} m`}
              onChange={(maxDistanceM) => setConfig((c) => ({ ...c, maxDistanceM }))}
              onCommit={(maxDistanceM) => void persist({ maxDistanceM })}
            />
            <Slider
              text="Largura do pan (m)"
              min={2}
              max={20}
              step={0.5}
              value={config.panWidthM}
              display={`${config.panWidthM} m`}
              onChange={(panWidthM) => setConfig((c) => ({ ...c, panWidthM }))}
              onCommit={(panWidthM) => void persist({ panWidthM })}
            />
            <Slider
              text="Vozes simultâneas"
              min={1}
              max={6}
              step={1}
              value={config.maxVoices}
              display={`${config.maxVoices}`}
              onChange={(maxVoices) => setConfig((c) => ({ ...c, maxVoices }))}
              onCommit={(maxVoices) => void persist({ maxVoices })}
            />
          </div>
        </div>
      </section>
    </div>
  )
}

export default Spotter3DView
