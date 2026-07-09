import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { tt, type ResolvedLanguage } from '../i18n'
import type { TutorialDefinition } from './tutorialRegistry'
import '../styles/onboarding.css'

interface TutorialOverlayProps {
  tutorial: TutorialDefinition
  viewLabel: string
  language: ResolvedLanguage
  onClose(disableAutomatic: boolean): void
}

export function TutorialOverlay({ tutorial, viewLabel, language, onClose }: TutorialOverlayProps): ReactElement {
  const [stepIndex, setStepIndex] = useState(0)
  const [disableAutomatic, setDisableAutomatic] = useState(false)
  const currentStep = tutorial.steps[stepIndex]
  const isFirstStep = stepIndex === 0
  const isLastStep = stepIndex === tutorial.steps.length - 1
  const progress = useMemo(() => Math.round(((stepIndex + 1) / tutorial.steps.length) * 100), [stepIndex, tutorial.steps.length])

  const close = useCallback(() => onClose(disableAutomatic), [disableAutomatic, onClose])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <div className="onboarding-backdrop" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
      <div className="onboarding-panel tutorial-panel">
        <header className="onboarding-header">
          <div>
            <span className="onboarding-kicker">
              {tt(language, 'tutorials.kicker', { view: viewLabel, progress })}
            </span>
            <h1 id="tutorial-title">{tt(language, currentStep.titleKey)}</h1>
          </div>
          <button className="onboarding-skip" type="button" onClick={close} aria-label={tt(language, 'tutorials.close')}>?</button>
        </header>

        <div className="onboarding-progress" aria-label={tt(language, 'tutorials.progressAria', { current: stepIndex + 1, total: tutorial.steps.length })} style={{ gridTemplateColumns: `repeat(${tutorial.steps.length}, 1fr)` }}>
          {tutorial.steps.map((step, index) => (
            <span
              aria-current={step.id === currentStep.id ? 'step' : undefined}
              className={`onboarding-progress-dot ${index <= stepIndex ? 'is-active' : ''}`}
              key={step.id}
              title={tt(language, step.titleKey)}
            />
          ))}
        </div>

        <section className="onboarding-content tutorial-content">
          <div className="onboarding-step-body">
            <span className="onboarding-kicker">{tt(language, 'tutorials.stepCounter', { current: stepIndex + 1, total: tutorial.steps.length })}</span>
            <h2>{tt(language, currentStep.titleKey)}</h2>
            <p className="tutorial-body">{tt(language, currentStep.bodyKey)}</p>
          </div>
        </section>

        <footer className="onboarding-footer tutorial-footer">
          <label className="tutorial-auto-toggle">
            <input
              type="checkbox"
              checked={disableAutomatic}
              onChange={(event) => setDisableAutomatic(event.currentTarget.checked)}
            />
            <span>{tt(language, 'tutorials.disableAutomatic')}</span>
          </label>
          <div className="onboarding-actions">
            <button className="onboarding-button" type="button" onClick={() => setStepIndex((current) => Math.max(current - 1, 0))} disabled={isFirstStep}>
              {tt(language, 'tutorials.back')}
            </button>
            <button
              className="onboarding-button onboarding-button--primary"
              type="button"
              onClick={isLastStep ? close : () => setStepIndex((current) => Math.min(current + 1, tutorial.steps.length - 1))}
            >
              {isLastStep ? tt(language, 'tutorials.finish') : tt(language, 'tutorials.next')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
