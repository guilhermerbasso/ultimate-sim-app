import { viewRegistry } from '../views/registry'

export interface TutorialStepRef {
  id: string
  titleKey: string
  bodyKey: string
}

export interface TutorialDefinition {
  viewId: string
  steps: TutorialStepRef[]
}

const STEP_COUNTS: Record<string, number> = {
  telemetry: 4,
  dashboards: 5,
  'touch-controls': 3,
  'oled-dash': 3,
  overlays: 5,
  fuel: 3,
  tire: 3,
  search: 2,
  alerts: 3,
  expr: 3,
  'race-profiles': 3,
  sounds: 3,
  setups: 2,
  career: 2,
  engineer: 3,
  haptics: 3,
  coach: 3,
  strategy: 3,
  'dashboard-builder': 3,
  'dashboard-adaptive': 3,
  biometrics: 2,
  community: 2,
  'haptics-zonal': 3,
  'spotter-3d': 2,
  devices: 5,
  arduinos: 6,
  revlights: 3,
  inputs: 2,
  profiles: 2,
  controls: 3,
  pinout: 3,
  settings: 5,
  about: 2,
  voice: 3
}

function createDefinition(viewId: string): TutorialDefinition {
  const count = STEP_COUNTS[viewId] ?? 2
  return {
    viewId,
    steps: Array.from({ length: count }, (_, index) => ({
      id: `${viewId}-${index + 1}`,
      titleKey: `tutorials.${viewId}.steps.${index + 1}.title`,
      bodyKey: `tutorials.${viewId}.steps.${index + 1}.body`
    }))
  }
}

export const tutorialRegistry: Record<string, TutorialDefinition> = Object.fromEntries(
  viewRegistry.map((view) => [view.id, createDefinition(view.id)])
)

export function getTutorial(viewId: string): TutorialDefinition | null {
  return tutorialRegistry[viewId] ?? null
}

export function hasTutorial(viewId: string): boolean {
  return Boolean(tutorialRegistry[viewId])
}

export function getTutorialCoverage(): { full: string[]; fallback: string[] } {
  return { full: Object.keys(STEP_COUNTS), fallback: [] }
}
