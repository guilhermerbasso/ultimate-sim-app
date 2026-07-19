import type {
  CueRoute,
  RoutedCueOutput
} from '../../../shared/accessibility-cues'
import type { AlertEventContext } from '../../../shared/alerts'
import { formatMeasurement, type UnitSystem } from '../../../shared/units'
import { tt, type ResolvedLanguage } from '../i18n'

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function cornerLabel(
  language: ResolvedLanguage,
  corner: AlertEventContext['corner']
): string {
  return typeof corner === 'string'
    ? tt(language, `accessibilityCues.corner.${corner}`)
    : tt(language, 'accessibilityCues.corner.unknown')
}

function formattedValue(
  route: CueRoute,
  language: ResolvedLanguage,
  unitSystem: UnitSystem
): string {
  const value = route.context?.value
  if (!finite(value)) return tt(language, 'accessibilityCues.value.unknown')
  if (route.eventId === 'alert.tyrePressure') {
    return formatMeasurement(value, 'pressure-kpa', unitSystem, {
      decimals: unitSystem === 'imperial' ? 1 : 0,
      includeUnit: true
    }).display
  }
  if (route.eventId === 'alert.tyreTemp' || route.eventId === 'alert.brakeTemp') {
    return formatMeasurement(value, 'temperature-c', unitSystem, {
      decimals: 0,
      includeUnit: true
    }).display
  }
  if (route.eventId === 'alert.lowFuel') return value.toFixed(1)
  return String(value)
}

export function localizeCueMessage(
  route: CueRoute,
  language: ResolvedLanguage,
  unitSystem: UnitSystem
): string {
  const context = route.context
  return tt(language, route.messageKey, {
    corner: cornerLabel(language, context?.corner),
    value: formattedValue(route, language, unitSystem),
    threshold: finite(context?.threshold) ? context.threshold : '—',
    remaining: finite(context?.remaining)
      ? context.remaining.toFixed(route.eventId === 'alert.lowFuel' ? 1 : 0)
      : '—',
    count: finite(context?.count) ? context.count : '—',
    limit: finite(context?.limit) ? context.limit : '—'
  })
}

export function localizeCueEventLabel(
  route: CueRoute,
  language: ResolvedLanguage
): string {
  return tt(language, `accessibilityCues.event.${route.eventId}`)
}

export function localizeCueSymbolLabel(
  output: RoutedCueOutput,
  language: ResolvedLanguage
): string {
  return output.symbolLabelKey
    ? tt(language, output.symbolLabelKey)
    : tt(language, 'accessibilityCues.symbol.unknown')
}

export function localizeCuePattern(
  output: RoutedCueOutput,
  language: ResolvedLanguage
): string {
  return output.patternLabelKey
    ? tt(language, output.patternLabelKey)
    : tt(language, 'accessibilityCues.pattern.unknown')
}
