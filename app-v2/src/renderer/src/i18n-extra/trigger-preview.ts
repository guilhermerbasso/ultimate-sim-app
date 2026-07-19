import type { ResolvedLanguage } from '../i18n'

const en = {
  'triggerPreview.label': 'Show trigger-only items active',
  'triggerPreview.help': 'Editor and positioning preview only. Live overlay state, dashboards, streaming, trigger rules, and race behavior are unchanged.'
}

const keys: Partial<Record<ResolvedLanguage, Record<string, string>>> = {
  en,
  'pt-BR': {
    'triggerPreview.label': 'Mostrar itens acionados por gatilho como ativos',
    'triggerPreview.help': 'Somente na prévia do editor. Overlays ao vivo, dashboards, streaming, regras de gatilho e comportamento na corrida não mudam.'
  },
  es: {
    'triggerPreview.label': 'Mostrar activos los elementos solo por activación',
    'triggerPreview.help': 'Solo en la vista previa del editor. Los overlays en vivo, dashboards, streaming, reglas y comportamiento de carrera no cambian.'
  },
  fr: {
    'triggerPreview.label': 'Afficher les éléments à déclenchement comme actifs',
    'triggerPreview.help': 'Aperçu de l’éditeur uniquement. Les overlays en direct, dashboards, streaming, règles et comportement en course restent inchangés.'
  },
  de: {
    'triggerPreview.label': 'Nur ausgelöste Elemente aktiv anzeigen',
    'triggerPreview.help': 'Nur Editorvorschau. Live-Overlays, Dashboards, Streaming, Triggerregeln und Rennverhalten bleiben unverändert.'
  },
  zh: {
    'triggerPreview.label': '将仅触发显示的项目预览为激活',
    'triggerPreview.help': '仅影响编辑器预览。实时叠加层、仪表板、串流、触发规则和比赛行为均不变。'
  },
  ja: {
    'triggerPreview.label': 'トリガー専用項目をアクティブ表示',
    'triggerPreview.help': 'エディターのプレビューだけに適用されます。ライブオーバーレイ、ダッシュボード、配信、トリガールール、レース動作は変わりません。'
  }
}

export default keys
