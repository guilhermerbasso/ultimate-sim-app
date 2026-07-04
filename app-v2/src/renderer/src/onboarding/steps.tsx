import type { ReactElement } from 'react'

type TelemetryChoice = 'auto' | 'mock'
type OverlayPreset = 'minimal' | 'endurance' | 'streaming' | 'engineer'

interface WelcomeStepProps {
  onConfigure(): void
  onDemo(): void
  onSkip(): void
}

interface TelemetryStepProps {
  selected: TelemetryChoice | null
  busy: boolean
  error: string | null
  onSelect(choice: TelemetryChoice): void
}

interface DevicesStepProps {
  onJump(): void
}

interface OverlaysStepProps {
  selected: OverlayPreset
  onSelect(preset: OverlayPreset): void
  onJump(): void
}

interface FinishStepProps {
  selectedPreset: OverlayPreset
}

const presetLabels: Record<OverlayPreset, string> = {
  minimal: 'Minimal',
  endurance: 'Endurance',
  streaming: 'Streaming',
  engineer: 'Engineer'
}

export function WelcomeStep({ onConfigure, onDemo, onSkip }: WelcomeStepProps): ReactElement {
  return (
    <div className="onboarding-hero">
      <span className="onboarding-kicker">Primeira volta</span>
      <h2>Ultimate Sim App</h2>
      <p>
        Configure telemetria, SIM-X e overlays em menos de 90 segundos para sair do box com o básico pronto.
      </p>
      <div className="onboarding-actions onboarding-actions--hero">
        <button className="onboarding-button onboarding-button--primary" type="button" onClick={onConfigure}>
          Configurar
        </button>
        <button className="onboarding-button" type="button" onClick={onDemo}>
          Usar modo Demo
        </button>
        <button className="onboarding-button onboarding-button--ghost" type="button" onClick={onSkip}>
          Pular
        </button>
      </div>
    </div>
  )
}

export function TelemetryStep({ selected, busy, error, onSelect }: TelemetryStepProps): ReactElement {
  return (
    <div className="onboarding-step-body">
      <span className="onboarding-kicker">Telemetria</span>
      <h2>Escolha a fonte inicial</h2>
      <p>Auto-detect procura simuladores suportados. Demo(mock) liga dados simulados para testar telas sem entrar no cockpit.</p>
      <div className="onboarding-choice-grid">
        <button
          className={`onboarding-choice ${selected === 'auto' ? 'is-selected' : ''}`}
          disabled={busy}
          type="button"
          onClick={() => onSelect('auto')}
        >
          <strong>Auto-detect</strong>
          <span>iRacing, ACC, AC ou AMS2 quando disponíveis.</span>
        </button>
        <button
          className={`onboarding-choice ${selected === 'mock' ? 'is-selected' : ''}`}
          disabled={busy}
          type="button"
          onClick={() => onSelect('mock')}
        >
          <strong>Demo(mock)</strong>
          <span>Dados sintéticos para aprender o app sem hardware.</span>
        </button>
      </div>
      {busy && <p className="onboarding-note">Aplicando fonte de telemetria…</p>}
      {error && <p className="onboarding-error" role="alert">{error}</p>}
    </div>
  )
}

export function DevicesStep({ onJump }: DevicesStepProps): ReactElement {
  return (
    <div className="onboarding-step-body">
      <span className="onboarding-kicker">Dispositivos</span>
      <h2>Conecte o SIM-X quando estiver pronto</h2>
      <p>
        Plugue o controle via USB e use Dispositivos para detectar porta, firmware e status. Você pode concluir o tour agora e conectar depois.
      </p>
      <button className="onboarding-link-card" type="button" onClick={onJump}>
        <strong>Abrir Dispositivos</strong>
        <span>Ir para a tela de conexão do ButtonBox.</span>
      </button>
    </div>
  )
}

export function OverlaysStep({ selected, onSelect, onJump }: OverlaysStepProps): ReactElement {
  return (
    <div className="onboarding-step-body">
      <span className="onboarding-kicker">Overlays</span>
      <h2>Escolha um preset para começar</h2>
      <p>Vamos salvar sua preferência agora. Uma próxima atualização poderá aplicar o preset automaticamente.</p>
      <div className="onboarding-preset-grid">
        {(Object.keys(presetLabels) as OverlayPreset[]).map((preset) => (
          <button
            className={`onboarding-choice ${selected === preset ? 'is-selected' : ''}`}
            key={preset}
            type="button"
            onClick={() => onSelect(preset)}
          >
            <strong>{presetLabels[preset]}</strong>
            <span>{getPresetDescription(preset)}</span>
          </button>
        ))}
      </div>
      <button className="onboarding-inline-link" type="button" onClick={onJump}>Abrir Overlays</button>
    </div>
  )
}

export function FinishStep({ selectedPreset }: FinishStepProps): ReactElement {
  return (
    <div className="onboarding-step-body onboarding-finish">
      <span className="onboarding-kicker">Pronto</span>
      <h2>Seu grid inicial está montado</h2>
      <p>
        Vamos fixar Telemetria, Overlays, Combustível e Dispositivos nos favoritos. Preset escolhido: {presetLabels[selectedPreset]}.
      </p>
      <div className="onboarding-summary">
        <span>★ Telemetria</span>
        <span>★ Overlays</span>
        <span>★ Combustível</span>
        <span>★ Dispositivos</span>
      </div>
    </div>
  )
}

function getPresetDescription(preset: OverlayPreset): string {
  switch (preset) {
    case 'minimal':
      return 'Pouca informação, máximo foco na pista.'
    case 'endurance':
      return 'Fuel, stint e consistência para provas longas.'
    case 'streaming':
      return 'Legibilidade alta para transmissão.'
    case 'engineer':
      return 'Dados densos para ajuste e análise.'
  }
}

export type { OverlayPreset, TelemetryChoice }
