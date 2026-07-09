import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveAppLanguage, t, translateNavTitle, tt } from './i18n'

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
  })

  it('translates known navigation section titles', () => {
    expect(translateNavTitle('IA & Coaching', 'en')).toBe('AI & Coaching')
    expect(translateNavTitle('Strategy', 'es')).toBe('Estrategia')
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
        return /\.(tsx?|jsx?)$/.test(entry) ? [child] : []
      })
    }
    const files = [
      'TelemetryView.tsx',
      'FuelStrategyView.tsx',
      'TireStrategyView.tsx',
      'StrategyView.tsx',
      'SettingsView.tsx',
      'AlertsView.tsx',
      'DevicesView.tsx',
      'CommunityView.tsx',
      'ControlsView.tsx',
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
