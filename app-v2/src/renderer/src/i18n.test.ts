import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveAppLanguage, t, translateNavTitle, tt } from './i18n'
import {
  SETUP_ADJUSTMENT_CODES,
  SETUP_AREA_VALUES,
  SETUP_CORNER_VALUES,
  SETUP_DIRECTION_VALUES,
  SETUP_MAGNITUDE_VALUES,
  SETUP_PHASE_VALUES,
  SETUP_SYMPTOM_VALUES
} from '../../shared/setup-advisor'

describe('resolveAppLanguage', () => {
  it('uses the manual language when configured', () => {
    expect(resolveAppLanguage('de', ['pt-BR'])).toBe('de')
  })

  it('follows the first supported system language in auto mode', () => {
    expect(resolveAppLanguage('auto', ['it-IT', 'fr-FR', 'en-US'])).toBe('fr')
    expect(resolveAppLanguage('auto', ['es-MX'])).toBe('es')
    expect(resolveAppLanguage('auto', ['pt-BR'])).toBe('pt-BR')
  })

  it('falls back to English when the system language is unsupported', () => {
    expect(resolveAppLanguage('auto', ['it-IT'])).toBe('en')
  })

  it('has a safe default for non-browser callers', () => {
    expect(resolveAppLanguage('auto', [])).toBe('en')
  })
})

describe('i18n text helpers', () => {
  it('interpolates shell strings', () => {
    expect(t('en', 'addFavorite', { label: 'Telemetry' })).toBe('Add Telemetry to favorites')
  })

  it('interpolates view catalog strings with English fallback', () => {
    expect(tt('en', 'fuel.untilLap', { lap: 12 })).toBe('until lap 12')
    expect(tt('pt-BR', 'fuel.untilLap', { lap: 12 })).toBe('até volta 12')
    expect(tt('es', 'fuel.untilLap', { lap: 12 })).toBe('until lap 12')
    expect(tt('en', 'rigPreflight.title')).toBe('Rig Twin & Preflight')
    expect(tt('pt-BR', 'rigPreflight.title')).toBe('Gêmeo do Rig e Preflight')
    expect(tt('ja', 'rigPreflight.title')).toBe('Rig Twin & Preflight')
    expect(tt('en', 'contextDebt.title')).toBe('Context-Debt Meter')
    expect(tt('pt-BR', 'contextDebt.title')).toBe('Medidor de dívida de contexto')
  })

  it('translates known navigation section titles', () => {
    expect(translateNavTitle('IA & Coaching', 'en')).toBe('AI & Coaching')
    expect(translateNavTitle('Strategy', 'es')).toBe('Estrategia')
    expect(translateNavTitle('League Ops', 'pt-BR')).toBe('Operações da liga')
  })

  it('loads Steward Desk translations from the per-zone catalog', () => {
    expect(tt('en', 'steward.owner.title')).toBe('Human decision owner')
    expect(tt('pt-BR', 'steward.owner.title')).toBe('Decisão sob responsabilidade humana')
  })

  it('has complete structured setup guidance keys in every supported locale', () => {
    const keys = [
      ...SETUP_SYMPTOM_VALUES.flatMap((value) => [
        `debrief.history.setup.symptom.${value}`,
        `debrief.history.setup.rationale.${value}`,
        `debrief.history.setup.evidence.${value}`
      ]),
      ...SETUP_AREA_VALUES.map((value) => `debrief.history.setup.area.${value}`),
      ...SETUP_DIRECTION_VALUES.map((value) => `debrief.history.setup.direction.${value}`),
      ...SETUP_MAGNITUDE_VALUES.map((value) => `debrief.history.setup.magnitude.${value}`),
      ...SETUP_CORNER_VALUES.map((value) => `debrief.history.setup.corner.${value}`),
      ...SETUP_PHASE_VALUES.map((value) => `debrief.history.setup.phase.${value}`),
      ...SETUP_ADJUSTMENT_CODES.map((value) => `debrief.history.setup.adjustment.${value}`),
      'debrief.history.setup.adjustmentDetails',
      'debrief.history.setup.currentBrakeBias',
      'debrief.history.setup.structuredInsufficient'
    ]
    for (const language of ['pt-BR', 'en', 'es', 'fr', 'de', 'zh', 'ja'] as const) {
      for (const key of keys) expect(tt(language, key), `${language}:${key}`).not.toBe(key)
    }
  })
})

describe('migrated view i18n coverage', () => {
  it('keeps curated migrated views free of hardcoded pt-BR UI copy', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const collectSourceFiles = (relativePath: string): string[] => {
      const fullPath = join(here, relativePath)
      const stat = statSync(fullPath)
      if (stat.isFile()) return [relativePath]
      return readdirSync(fullPath).flatMap((entry) => {
        const child = join(relativePath, entry)
        const childFullPath = join(here, child)
        const childStat = statSync(childFullPath)
        if (childStat.isDirectory()) return collectSourceFiles(child)
        return /\.(tsx?|jsx?)$/.test(entry) && !/\.test\.[tj]sx?$/.test(entry) ? [child] : []
      })
    }
    const files = [
      'TelemetryView.tsx',
      'FuelStrategyView.tsx',
      'TireStrategyView.tsx',
      'StrategyView.tsx',
      'StintPassportView.tsx',
      'SettingsView.tsx',
      'AlertsView.tsx',
      'DevicesView.tsx',
      'CommunityView.tsx',
      'StewardDeskView.tsx',
      'ControlsView.tsx',
      'ContextDebtView.tsx',
      'CoachView.tsx',
      '../components/SavedConfigsPanel.tsx',
      '../components/WakeWordIndicator.tsx',
      'CareerView.tsx',
      'DashboardsView.tsx',
      ...collectSourceFiles('views/arduinos').map((file) => file.replace(/^views[\\/]/, '')),
      ...collectSourceFiles('views/career').map((file) => file.replace(/^views[\\/]/, '')),
      ...collectSourceFiles('views/coach').map((file) => file.replace(/^views[\\/]/, '')),
      ...collectSourceFiles('views/dashboard').map((file) => file.replace(/^views[\\/]/, '')),
      ...collectSourceFiles('views/hub').map((file) => file.replace(/^views[\\/]/, '')),
      ...collectSourceFiles('views/overlay').map((file) => file.replace(/^views[\\/]/, '')),
      ...collectSourceFiles('components').map((file) => `../${file}`)
    ]
    const portugueseUiPattern =
      /[áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]|Novo|Buscar|Conectar|Configura|Combust|Bandeira|Perfil|Aplicar|Adicionar|Adicione|Carregar|Nenhum|Selecionar|Remover|Sucesso/
    const offenders = Array.from(new Set(files)).flatMap((file) => {
      const source = readFileSync(join(here, 'views', file), 'utf8')
      return portugueseUiPattern.test(source) ? [file] : []
    })
    expect(offenders).toEqual([])
  })
})
