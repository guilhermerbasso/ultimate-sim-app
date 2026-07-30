import { useFocusTrap } from '../lib/useFocusTrap'
import { useCallback, useMemo, useState, type ReactElement } from 'react'
import { setTelemetrySource } from '../lib/telemetry'
import '../styles/onboarding.css'
import { DevicesStep, FinishStep, OverlaysStep, TelemetryStep, WelcomeStep, type OverlayPreset, type TelemetryChoice } from './steps'

const COMPLETED_STORAGE_KEY = 'usa.onboardingCompleted'
const FAVORITES_STORAGE_KEY = 'usa.favorites'
const PREFERRED_SIM_STORAGE_KEY = 'usa.preferredSim'
const OVERLAY_PRESET_STORAGE_KEY = 'usa.onboardingOverlayPreset'
const SUGGESTED_FAVORITES = ['telemetry', 'overlays', 'fuel', 'devices']

interface OnboardingFlowProps {
  onClose(): void
  onNavigate(viewId: string): void
}

interface StepDef {
  id: string
  label: string
}

const steps: StepDef[] = [
  { id: 'welcome', label: 'Boas-vindas' },
  { id: 'telemetry', label: 'Telemetry' },
  { id: 'devices', label: 'Devices' },
  { id: 'overlays', label: 'Overlays' },
  { id: 'finish', label: 'Finalizar' }
]

function readStringArray(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function writeStringArray(key: string, value: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // localStorage can be unavailable in restricted contexts; onboarding should still close.
  }
}

function writeStorageValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Non-critical preference persistence.
  }
}

function appendSuggestedFavorites(): void {
  const current = readStringArray(FAVORITES_STORAGE_KEY)
  writeStringArray(FAVORITES_STORAGE_KEY, [...current, ...SUGGESTED_FAVORITES.filter((id) => !current.includes(id))])
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function OnboardingFlow({ onClose, onNavigate }: OnboardingFlowProps): ReactElement {
  const [stepIndex, setStepIndex] = useState(0)
  const [telemetryChoice, setTelemetryChoice] = useState<TelemetryChoice | null>(null)
  const [telemetryBusy, setTelemetryBusy] = useState(false)
  const [telemetryError, setTelemetryError] = useState<string | null>(null)
  const [overlayPreset, setOverlayPreset] = useState<OverlayPreset>('minimal')

  const currentStep = steps[stepIndex]
  const isFirstStep = stepIndex === 0
  const isLastStep = stepIndex === steps.length - 1
  const progress = useMemo(() => Math.round(((stepIndex + 1) / steps.length) * 100), [stepIndex])

  const markCompleteAndClose = useCallback(() => {
    writeStorageValue(COMPLETED_STORAGE_KEY, 'true')
    onClose()
  }, [onClose])

  const finish = useCallback(() => {
    writeStorageValue(OVERLAY_PRESET_STORAGE_KEY, overlayPreset)
    appendSuggestedFavorites()
    onNavigate('overlays')
    markCompleteAndClose()
  }, [markCompleteAndClose, onNavigate, overlayPreset])

  const next = useCallback(() => {
    if (isLastStep) {
      finish()
      return
    }
    setStepIndex((current) => Math.min(current + 1, steps.length - 1))
  }, [finish, isLastStep])

  const back = useCallback(() => {
    setStepIndex((current) => Math.max(current - 1, 0))
  }, [])

  const selectTelemetry = useCallback(async (choice: TelemetryChoice): Promise<boolean> => {
    setTelemetryChoice(choice)
    setTelemetryBusy(true)
    setTelemetryError(null)
    writeStorageValue(PREFERRED_SIM_STORAGE_KEY, choice)
    try {
      await setTelemetrySource(choice)
      return true
    } catch (error) {
      setTelemetryError(getErrorMessage(error))
      return false
    } finally {
      setTelemetryBusy(false)
    }
  }, [])

  const useDemo = useCallback(async () => {
    if (telemetryBusy) return
    const applied = await selectTelemetry('mock')
    if (applied) setStepIndex(2)
  }, [selectTelemetry, telemetryBusy])

  const focusTrap = useFocusTrap<HTMLDivElement>({ onEscape: markCompleteAndClose })

  return (
    <div className="onboarding-backdrop" ref={focusTrap.containerRef} onKeyDown={focusTrap.onKeyDown} role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="onboarding-panel">
        <header className="onboarding-header">
          <div>
            <span className="onboarding-kicker">Setup guiado · {progress}%</span>
            <h1 id="onboarding-title">Onboarding</h1>
          </div>
          <button className="onboarding-skip" type="button" onClick={markCompleteAndClose}>Skip</button>
        </header>

        <div className="onboarding-progress" aria-label={`Progress ${progress}%`}>
          {steps.map((step, index) => (
            <span
              aria-current={step.id === currentStep.id ? 'step' : undefined}
              className={`onboarding-progress-dot ${index <= stepIndex ? 'is-active' : ''}`}
              key={step.id}
              title={step.label}
            />
          ))}
        </div>

        <section className="onboarding-content">
          {currentStep.id === 'welcome' && (
            <WelcomeStep
              busy={telemetryBusy}
              error={telemetryError}
              onConfigure={next}
              onDemo={useDemo}
              onSkip={markCompleteAndClose}
            />
          )}
          {currentStep.id === 'telemetry' && (
            <TelemetryStep
              selected={telemetryChoice}
              busy={telemetryBusy}
              error={telemetryError}
              onSelect={selectTelemetry}
            />
          )}
          {currentStep.id === 'devices' && <DevicesStep onJump={() => onNavigate('devices')} />}
          {currentStep.id === 'overlays' && (
            <OverlaysStep
              selected={overlayPreset}
              onSelect={setOverlayPreset}
              onJump={() => onNavigate('overlays')}
            />
          )}
          {currentStep.id === 'finish' && <FinishStep selectedPreset={overlayPreset} />}
        </section>

        {currentStep.id !== 'welcome' && (
          <footer className="onboarding-footer">
            <button className="onboarding-button" type="button" onClick={back} disabled={isFirstStep}>Back</button>
            <button className="onboarding-button onboarding-button--primary" type="button" onClick={next}>
              {isLastStep ? 'Finish' : 'Continue'}
            </button>
          </footer>
        )}
      </div>
    </div>
  )
}
