import {
  SETUP_ADJUSTMENT_SPECS,
  SETUP_SUGGESTION_ADJUSTMENT_CODES,
  type SetupAdjustment,
  type SetupCorner,
  type SetupSuggestion,
  type SetupSymptomKind
} from '../../../shared/setup-advisor'
import type { UnitSystem } from '../../../shared/units'
import { tt, type ResolvedLanguage } from '../i18n'

export interface LocalizedSetupAdjustment {
  change: string
  details: string
}

export interface LocalizedSetupSuggestion {
  symptom: string
  rationale: string
  evidence: string
  primary: LocalizedSetupAdjustment
  alternatives: LocalizedSetupAdjustment[]
}

const LOCALES: Record<ResolvedLanguage, string> = {
  'pt-BR': 'pt-BR',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  zh: 'zh-CN',
  ja: 'ja-JP'
}

const HANDLING_SYMPTOMS = new Set<SetupSymptomKind>([
  'understeer-entry',
  'understeer-mid',
  'understeer-exit',
  'oversteer-entry',
  'oversteer-mid',
  'oversteer-exit'
])
const CORNER_TYRE_SYMPTOMS = new Set<SetupSymptomKind>([
  'tyre-overheat',
  'tyre-cold',
  'camber-excess',
  'camber-lack',
  'pressure-high',
  'pressure-low'
])

function finiteMetric(suggestion: SetupSuggestion, key: string): number | null {
  const value = suggestion.metrics[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function plausibleTemperature(value: number): boolean {
  return value >= -100 && value <= 500
}

function consistentDelta(left: number, right: number, delta: number): boolean {
  return delta >= 0 && delta <= 500 && Math.abs(Math.abs(left - right) - delta) <= 2
}

function numberText(
  value: number,
  language: ResolvedLanguage,
  maximumFractionDigits = 1
): string {
  return new Intl.NumberFormat(LOCALES[language], {
    maximumFractionDigits,
    minimumFractionDigits: 0
  }).format(value)
}

function temperatureText(
  valueC: number,
  language: ResolvedLanguage,
  unitSystem: UnitSystem
): string {
  const value = unitSystem === 'imperial' ? (valueC * 9 / 5) + 32 : valueC
  return `${numberText(value, language, 0)} ${unitSystem === 'imperial' ? '°F' : '°C'}`
}

function temperatureDeltaText(
  deltaC: number,
  language: ResolvedLanguage,
  unitSystem: UnitSystem
): string {
  const value = unitSystem === 'imperial' ? deltaC * 9 / 5 : deltaC
  return `${numberText(value, language, 0)} ${unitSystem === 'imperial' ? '°F' : '°C'}`
}

function pressureStepText(language: ResolvedLanguage, unitSystem: UnitSystem): string {
  return unitSystem === 'imperial'
    ? `${numberText(0.5, language)}–${numberText(1, language)} psi`
    : `${numberText(3.4, language)}–${numberText(6.9, language)} kPa`
}

function translated(
  language: ResolvedLanguage,
  key: string,
  vars: Record<string, string | number> = {}
): string | null {
  const value = tt(language, key, vars)
  return value === key ? null : value
}

function cornerText(language: ResolvedLanguage, corner: SetupCorner): string | null {
  return translated(language, `debrief.history.setup.corner.${corner}`)
}

function localizeAdjustment(
  adjustment: SetupAdjustment,
  suggestion: SetupSuggestion,
  language: ResolvedLanguage,
  unitSystem: UnitSystem,
  role: 'primary' | 'alternative'
): LocalizedSetupAdjustment | null {
  if (
    !adjustment.code ||
    !Object.prototype.hasOwnProperty.call(SETUP_ADJUSTMENT_SPECS, adjustment.code)
  ) {
    return null
  }
  const spec = SETUP_ADJUSTMENT_SPECS[adjustment.code]
  const allowed = SETUP_SUGGESTION_ADJUSTMENT_CODES[suggestion.symptom][
    role === 'primary' ? 'primary' : 'alternatives'
  ]
  if (
    !allowed.includes(adjustment.code) ||
    spec.area !== adjustment.area ||
    spec.direction !== adjustment.direction ||
    spec.magnitude !== adjustment.magnitude
  ) {
    return null
  }
  const corner = suggestion.corner ? cornerText(language, suggestion.corner) : ''
  const phase = suggestion.phase
    ? translated(language, `debrief.history.setup.phase.${suggestion.phase}`)
    : ''
  if ((suggestion.corner && !corner) || (suggestion.phase && !phase)) return null
  const change = translated(
    language,
    `debrief.history.setup.adjustment.${adjustment.code}`,
    {
      corner: corner ?? '',
      phase: phase ?? '',
      pressureStep: pressureStepText(language, unitSystem)
    }
  )
  const area = translated(language, `debrief.history.setup.area.${adjustment.area}`)
  const direction = translated(language, `debrief.history.setup.direction.${adjustment.direction}`)
  const magnitude = translated(language, `debrief.history.setup.magnitude.${adjustment.magnitude}`)
  if (!change || !area || !direction || !magnitude) return null
  const details = translated(language, 'debrief.history.setup.adjustmentDetails', {
    area,
    direction,
    magnitude,
    context: [corner, phase].filter(Boolean).join(' · ')
  })
  return details ? { change, details } : null
}

function localizeEvidence(
  suggestion: SetupSuggestion,
  language: ResolvedLanguage,
  unitSystem: UnitSystem
): { rationale: string; evidence: string } | null {
  const rationaleKey = `debrief.history.setup.rationale.${suggestion.symptom}`
  const evidenceKey = `debrief.history.setup.evidence.${suggestion.symptom}`
  const corner = suggestion.corner ? cornerText(language, suggestion.corner) : null
  const phase = suggestion.phase
    ? translated(language, `debrief.history.setup.phase.${suggestion.phase}`)
    : null
  const vars: Record<string, string | number> = {
    corner: corner ?? '',
    phase: phase ?? ''
  }

  if (HANDLING_SYMPTOMS.has(suggestion.symptom)) {
    const expectedPhase = suggestion.symptom.split('-').at(-1)
    const bias = finiteMetric(suggestion, 'bias')
    const expectedSign = suggestion.symptom.startsWith('understeer-') ? -1 : 1
    if (
      !phase ||
      suggestion.phase !== expectedPhase ||
      bias === null ||
      Math.abs(bias) > 1 ||
      Math.sign(bias) !== expectedSign
    ) {
      return null
    }
    vars.bias = numberText(bias, language, 2)
  } else if (CORNER_TYRE_SYMPTOMS.has(suggestion.symptom)) {
    if (!corner) return null
    if (suggestion.symptom === 'pressure-high' || suggestion.symptom === 'pressure-low') {
      const middleC = finiteMetric(suggestion, 'middleC')
      const edgesC = finiteMetric(suggestion, 'edgesC')
      const deltaC = finiteMetric(suggestion, 'deltaC')
      const expectedPositiveDelta = suggestion.symptom === 'pressure-high'
        ? middleC !== null && edgesC !== null && middleC > edgesC
        : middleC !== null && edgesC !== null && edgesC > middleC
      if (
        middleC === null ||
        edgesC === null ||
        deltaC === null ||
        !plausibleTemperature(middleC) ||
        !plausibleTemperature(edgesC) ||
        !expectedPositiveDelta ||
        !consistentDelta(middleC, edgesC, deltaC)
      ) {
        return null
      }
      vars.middle = temperatureText(middleC, language, unitSystem)
      vars.edges = temperatureText(edgesC, language, unitSystem)
      vars.delta = temperatureDeltaText(deltaC, language, unitSystem)
    } else if (suggestion.symptom === 'camber-excess' || suggestion.symptom === 'camber-lack') {
      const innerC = finiteMetric(suggestion, 'innerC')
      const outerC = finiteMetric(suggestion, 'outerC')
      const deltaC = finiteMetric(suggestion, 'deltaC')
      const expectedPositiveDelta = suggestion.symptom === 'camber-excess'
        ? innerC !== null && outerC !== null && innerC > outerC
        : innerC !== null && outerC !== null && outerC > innerC
      if (
        innerC === null ||
        outerC === null ||
        deltaC === null ||
        !plausibleTemperature(innerC) ||
        !plausibleTemperature(outerC) ||
        !expectedPositiveDelta ||
        !consistentDelta(innerC, outerC, deltaC)
      ) {
        return null
      }
      vars.inner = temperatureText(innerC, language, unitSystem)
      vars.outer = temperatureText(outerC, language, unitSystem)
      vars.delta = temperatureDeltaText(deltaC, language, unitSystem)
    } else {
      const avgC = finiteMetric(suggestion, 'avgC')
      if (avgC === null || !plausibleTemperature(avgC)) return null
      vars.average = temperatureText(avgC, language, unitSystem)
    }
  } else if (suggestion.symptom === 'tyre-temp-imbalance-lr') {
    const leftC = finiteMetric(suggestion, 'leftC')
    const rightC = finiteMetric(suggestion, 'rightC')
    const deltaC = finiteMetric(suggestion, 'deltaC')
    if (
      !corner ||
      !['front', 'rear'].includes(suggestion.corner ?? '') ||
      leftC === null ||
      rightC === null ||
      deltaC === null ||
      !plausibleTemperature(leftC) ||
      !plausibleTemperature(rightC) ||
      !consistentDelta(leftC, rightC, deltaC)
    ) {
      return null
    }
    vars.left = temperatureText(leftC, language, unitSystem)
    vars.right = temperatureText(rightC, language, unitSystem)
    vars.delta = temperatureDeltaText(deltaC, language, unitSystem)
  } else if (
    suggestion.symptom === 'brake-lock-front' ||
    suggestion.symptom === 'brake-lock-rear'
  ) {
    const expectedCorner = suggestion.symptom === 'brake-lock-front' ? 'front' : 'rear'
    if (
      suggestion.corner !== expectedCorner ||
      finiteMetric(suggestion, 'lockSignal') !== 1 ||
      !corner
    ) {
      return null
    }
    const brakeBiasPct = finiteMetric(suggestion, 'brakeBiasPct')
    if (brakeBiasPct !== null && (brakeBiasPct < 0 || brakeBiasPct > 100)) return null
    vars.biasDetail = brakeBiasPct === null
      ? ''
      : translated(language, 'debrief.history.setup.currentBrakeBias', {
          bias: `${numberText(brakeBiasPct, language, 1)}%`
        }) ?? ''
  } else {
    return null
  }

  const rationale = translated(language, rationaleKey, vars)
  const evidence = translated(language, evidenceKey, vars)
  return rationale && evidence ? { rationale, evidence } : null
}

export function localizeSetupSuggestion(
  suggestion: SetupSuggestion,
  language: ResolvedLanguage,
  unitSystem: UnitSystem
): LocalizedSetupSuggestion | null {
  const symptom = translated(
    language,
    `debrief.history.setup.symptom.${suggestion.symptom}`
  )
  const evidence = localizeEvidence(suggestion, language, unitSystem)
  const primary = localizeAdjustment(
    suggestion.primary,
    suggestion,
    language,
    unitSystem,
    'primary'
  )
  const alternatives = suggestion.alternatives.map((adjustment) =>
    localizeAdjustment(adjustment, suggestion, language, unitSystem, 'alternative')
  )
  if (!symptom || !evidence || !primary || alternatives.some((value) => value === null)) {
    return null
  }
  return {
    symptom,
    rationale: evidence.rationale,
    evidence: evidence.evidence,
    primary,
    alternatives: alternatives as LocalizedSetupAdjustment[]
  }
}
