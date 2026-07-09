// Persistent "Join us on Discord" chrome button label. Merged into UI_TEXT by
// ../i18n.ts (see the i18n-extra glob-merge).
import type { ResolvedLanguage } from '../i18n'

const keys: Partial<Record<ResolvedLanguage, Record<string, string>>> = {
  en: {
    'chrome.joinDiscord': 'Join us on Discord',
    'chrome.joinDiscordTitle': 'Join our Discord community'
  },
  'pt-BR': {
    'chrome.joinDiscord': 'Entre no nosso Discord',
    'chrome.joinDiscordTitle': 'Participe da nossa comunidade no Discord'
  },
  es: {
    'chrome.joinDiscord': 'Únete a nuestro Discord',
    'chrome.joinDiscordTitle': 'Únete a nuestra comunidad de Discord'
  },
  fr: {
    'chrome.joinDiscord': 'Rejoignez-nous sur Discord',
    'chrome.joinDiscordTitle': 'Rejoignez notre communauté Discord'
  },
  de: {
    'chrome.joinDiscord': 'Tritt unserem Discord bei',
    'chrome.joinDiscordTitle': 'Tritt unserer Discord-Community bei'
  },
  zh: {
    'chrome.joinDiscord': '加入我们的 Discord',
    'chrome.joinDiscordTitle': '加入我们的 Discord 社区'
  },
  ja: {
    'chrome.joinDiscord': 'Discord に参加',
    'chrome.joinDiscordTitle': 'Discord コミュニティに参加'
  }
}

export default keys
