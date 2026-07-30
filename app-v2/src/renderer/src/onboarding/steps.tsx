import type { ReactElement } from 'react'

type TelemetryChoice = 'auto' | 'mock'
type OverlayPreset = 'minimal' | 'endurance' | 'streaming' | 'engineer'

interface WelcomeStepProps {
  busy: boolean
  error: string | null
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

export function WelcomeStep({ busy, error, onConfigure, onDemo, onSkip }: WelcomeStepProps): ReactElement {
  return (
    <div className="onboarding-hero">
      <span className="onboarding-kicker">First lap</span>
      <h2>Ultimate Sim App</h2>
      <p>
        Configure telemetry, SIM-X, and overlays in under 90 seconds so you can leave the pit box with the basics ready.
      </p>
      <div className="onboarding-actions onboarding-actions--hero">
        <button className="onboarding-button onboarding-button--primary" type="button" onClick={onConfigure} disabled={busy}>
          Configure
        </button>
        <button
          className="onboarding-button"
          type="button"
          onClick={onDemo}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          Use Demo mode
        </button>
        <button className="onboarding-button onboarding-button--ghost" type="button" onClick={onSkip}>
          Skip
        </button>
      </div>
      {busy && <p className="onboarding-note">Starting Demo mode…</p>}
      {error && <p className="onboarding-error" role="alert">{error}</p>}
    </div>
  )
}

export function TelemetryStep({ selected, busy, error, onSelect }: TelemetryStepProps): ReactElement {
  return (
    <div className="onboarding-step-body">
      <span className="onboarding-kicker">Telemetry</span>
      <h2>Choose the initial source</h2>
      <p>Auto-detect looks for supported sims. Demo (mock) enables simulated data so you can test screens without entering the cockpit.</p>
      <div className="onboarding-choice-grid">
        <button
          className={`onboarding-choice ${selected === 'auto' ? 'is-selected' : ''}`}
          disabled={busy}
          type="button"
          onClick={() => onSelect('auto')}
        >
          <strong>Auto-detect</strong>
          <span>iRacing, ACC, AC, or AMS2 when available.</span>
        </button>
        <button
          className={`onboarding-choice ${selected === 'mock' ? 'is-selected' : ''}`}
          disabled={busy}
          type="button"
          onClick={() => onSelect('mock')}
        >
          <strong>Demo(mock)</strong>
          <span>Synthetic data to learn the app without hardware.</span>
        </button>
      </div>
      {busy && <p className="onboarding-note">Applying telemetry source…</p>}
      {error && <p className="onboarding-error" role="alert">{error}</p>}
    </div>
  )
}

export function DevicesStep({ onJump }: DevicesStepProps): ReactElement {
  return (
    <div className="onboarding-step-body">
      <span className="onboarding-kicker">Devices</span>
      <h2>Connect SIM-X when ready</h2>
      <p>
        Plug in the controller over USB and use Devices to detect the port, firmware, and status. You can finish the tour now and connect later.
      </p>
      <button className="onboarding-link-card" type="button" onClick={onJump}>
        <strong>Open Devices</strong>
        <span>Go to the ButtonBox connection screen.</span>
      </button>
    </div>
  )
}

export function OverlaysStep({ selected, onSelect, onJump }: OverlaysStepProps): ReactElement {
  return (
    <div className="onboarding-step-body">
      <span className="onboarding-kicker">Overlays</span>
      <h2>Choose a preset to get started</h2>
      <p>We will save your preference now. A future update may apply the preset automatically.</p>
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
      <button className="onboarding-inline-link" type="button" onClick={onJump}>Open Overlays</button>
    </div>
  )
}

export function FinishStep({ selectedPreset }: FinishStepProps): ReactElement {
  return (
    <div className="onboarding-step-body onboarding-finish">
      <span className="onboarding-kicker">Ready</span>
      <h2>Your starter grid is ready</h2>
      <p>
        We will pin Telemetry, Overlays, Fuel, and Devices to favorites. Chosen preset: {presetLabels[selectedPreset]}.
      </p>
      <div className="onboarding-summary">
        <span>★ Telemetry</span>
        <span>★ Overlays</span>
        <span>★ Fuel</span>
        <span>★ Devices</span>
      </div>
    </div>
  )
}

function getPresetDescription(preset: OverlayPreset): string {
  switch (preset) {
    case 'minimal':
      return 'Less information, maximum focus on track.'
    case 'endurance':
      return 'Fuel, stint, and consistency for endurance races.'
    case 'streaming':
      return 'High readability for broadcasts.'
    case 'engineer':
      return 'Dense data for tuning and analysis.'
  }
}

export type { OverlayPreset, TelemetryChoice }
