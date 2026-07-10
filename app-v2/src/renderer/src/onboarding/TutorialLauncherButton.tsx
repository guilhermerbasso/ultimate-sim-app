import type { ReactElement } from 'react'
import { tt, type ResolvedLanguage } from '../i18n'
import { hasTutorial } from './tutorialRegistry'
import '../styles/onboarding.css'

interface TutorialLauncherButtonProps {
  viewId: string
  language: ResolvedLanguage
  onStart(): void
}

export function TutorialLauncherButton({ viewId, language, onStart }: TutorialLauncherButtonProps): ReactElement | null {
  if (!hasTutorial(viewId)) return null
  const label = tt(language, 'tutorials.launcher')
  return (
    <button className="tutorial-launcher" type="button" onClick={onStart} aria-label={label} title={label}>
      <span aria-hidden="true">?</span>
      <span>{label}</span>
    </button>
  )
}
