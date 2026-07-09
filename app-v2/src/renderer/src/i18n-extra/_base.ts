// ── Per-zone i18n key module (anchor) ─────────────────────────────────────────
// Files in this folder default-export translation maps that are merged into
// UI_TEXT at module load (see the glob-merge at the end of ../i18n.ts). This lets
// multiple i18n workstreams add keys IN PARALLEL, each owning its own file here,
// WITHOUT editing the giant i18n.ts (which would corrupt under concurrent edits).
//
// Rules:
//  - Namespace keys per zone to avoid collisions (e.g. 'dashboards.*', 'overlays.*').
//  - Always fill `en` (fallback language); fill pt-BR/es/fr/de/zh/ja too.
//  - `tt(language, key)` reads these exactly like the inline UI_TEXT keys.
import type { ResolvedLanguage } from '../i18n'

const keys: Partial<Record<ResolvedLanguage, Record<string, string>>> = {
  en: { '_i18nExtraSanity': 'OK' },
  'pt-BR': { '_i18nExtraSanity': 'OK-pt' },
  es: {},
  fr: {},
  de: {},
  zh: {},
  ja: {}
}

export default keys
