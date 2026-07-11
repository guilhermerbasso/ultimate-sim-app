import type { ResolvedLanguage } from '../i18n'

const keys: Partial<Record<ResolvedLanguage, Record<string, string>>> = {
  en: {
    'settings.units': 'Units',
    'settings.units.metric': 'Metric (km/h · °C · bar · L)',
    'settings.units.imperial': 'Imperial · US (mph · °F · psi · gal)',
    'settings.unitsHelp': 'Applies live to telemetry, dashboards, overlays, analysis, and coach messages.'
  },
  'pt-BR': {
    'settings.units': 'Unidades',
    'settings.units.metric': 'Métrico',
    'settings.units.imperial': 'Imperial · EUA',
    'settings.unitsHelp': 'Aplica ao vivo à telemetria, dashboards, overlays, análises e mensagens do coach.'
  }
}

export default keys
