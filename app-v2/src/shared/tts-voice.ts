import type { AppLanguage } from './settings'
import {
  isValidPiperVoiceId,
  parsePiperVoiceId,
  piperVoiceLang,
  type SpotterLang,
  type VoiceLike
} from './spotter'

export type SpeechLanguage = SpotterLang
export type AccessibilitySpeechLocale =
  | 'en-US'
  | 'pt-BR'
  | 'es-ES'
  | 'fr-FR'
  | 'de-DE'
  | 'zh-CN'
  | 'ja-JP'

export const DEFAULT_PIPER_VOICE_BY_LANGUAGE: Readonly<Record<SpeechLanguage, string>> = {
  'pt-BR': 'pt_BR-faber-medium',
  'en-US': 'en_US-lessac-medium'
}

export function accessibilitySpeechLocale(
  language: string | null | undefined
): AccessibilitySpeechLocale {
  const normalized = (language ?? '').trim().toLowerCase().replace('_', '-')
  if (normalized === 'pt' || normalized.startsWith('pt-')) return 'pt-BR'
  if (normalized === 'es' || normalized.startsWith('es-')) return 'es-ES'
  if (normalized === 'fr' || normalized.startsWith('fr-')) return 'fr-FR'
  if (normalized === 'de' || normalized.startsWith('de-')) return 'de-DE'
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN'
  if (normalized === 'ja' || normalized.startsWith('ja-')) return 'ja-JP'
  return 'en-US'
}

export function piperLanguageForAccessibilityLocale(
  locale: AccessibilitySpeechLocale
): SpeechLanguage | null {
  return locale === 'en-US' || locale === 'pt-BR' ? locale : null
}

export function voiceMatchesAccessibilityLocale(
  actualLanguage: string | null | undefined,
  locale: AccessibilitySpeechLocale
): boolean {
  const actual = (actualLanguage ?? '').trim().toLowerCase().replace('_', '-')
  const target = locale.toLowerCase()
  if (actual === target) return true
  return actual.slice(0, 2) === target.slice(0, 2)
}

export function normalizeSpeechLanguage(
  language: string | null | undefined,
  fallback: SpeechLanguage = 'en-US'
): SpeechLanguage {
  const normalized = (language ?? '').trim().toLowerCase().replace('_', '-')
  if (normalized === 'pt' || normalized.startsWith('pt-')) return 'pt-BR'
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en-US'
  return fallback
}

export function speechLanguageFromAppLanguage(
  language: AppLanguage | string | null | undefined,
  systemLocale = 'en-US'
): SpeechLanguage {
  return normalizeSpeechLanguage(language === 'auto' ? systemLocale : language)
}

export function speechLanguagesMatch(
  actual: string | null | undefined,
  expected: SpeechLanguage
): boolean {
  const normalized = (actual ?? '').trim().toLowerCase().replace('_', '-')
  if (normalized === 'pt' || normalized.startsWith('pt-')) return expected === 'pt-BR'
  if (normalized === 'en' || normalized.startsWith('en-')) return expected === 'en-US'
  return false
}

export function defaultPiperVoiceIdForLanguage(language: string | null | undefined): string {
  return DEFAULT_PIPER_VOICE_BY_LANGUAGE[normalizeSpeechLanguage(language)]
}

export interface ResolvedPiperVoice {
  language: SpeechLanguage
  voiceId: string
  voiceURI: string
  overrideHonored: boolean
}

/**
 * Resolve a Piper model for the text language. A configured/per-call voice is
 * honored only when its model language matches the text; otherwise the
 * language default is used so phonemes are never fed to the wrong model.
 */
export function resolvePiperVoice(
  language: string | null | undefined,
  requestedVoice: string | null | undefined
): ResolvedPiperVoice {
  const requested = (requestedVoice ?? '').trim()
  const requestedId = parsePiperVoiceId(requested) ?? requested
  const requestedLanguage =
    requestedId && isValidPiperVoiceId(requestedId) ? piperVoiceLang(requestedId) : null
  const targetLanguage =
    language && language.trim()
      ? normalizeSpeechLanguage(language)
      : requestedLanguage ?? 'en-US'
  const overrideHonored = requestedLanguage === targetLanguage
  const voiceId = overrideHonored
    ? requestedId
    : DEFAULT_PIPER_VOICE_BY_LANGUAGE[targetLanguage]

  return {
    language: targetLanguage,
    voiceId,
    voiceURI: `piper:${voiceId}`,
    overrideHonored
  }
}

/**
 * Resolve the effective spotter voice URI. Same-language OS overrides remain
 * valid when present in the loaded voice list; absent, unknown, or
 * wrong-language choices safely fall back to the matching Piper default.
 */
export function resolveSpeechVoiceURI<T extends VoiceLike>(
  language: string | null | undefined,
  requestedVoiceURI: string | null | undefined,
  availableVoices: readonly T[] = []
): string {
  const requested = (requestedVoiceURI ?? '').trim()
  const targetLanguage = normalizeSpeechLanguage(language)
  const piperId = parsePiperVoiceId(requested)

  if (!requested || piperId !== null || isValidPiperVoiceId(requested)) {
    return resolvePiperVoice(targetLanguage, requested).voiceURI
  }

  const explicit = availableVoices.find((voice) => voice.voiceURI === requested)
  if (explicit && speechLanguagesMatch(explicit.lang, targetLanguage)) return requested

  return resolvePiperVoice(targetLanguage, null).voiceURI
}
