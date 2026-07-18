import type { ResolvedLanguage } from '../i18n'

const en = {
  'obsLocal.title': 'OBS local certification target',
  'obsLocal.summary': 'Loopback-first Browser Source feed plus allowlisted OBS WebSocket v5 control, health, timeline, and reliability checks.',
  'obsLocal.readOnly': 'The Browser Source is read-only. OBS control uses a separate authenticated and allowlisted connection.',
  'obsLocal.error': 'OBS local operation failed.',
  'obsLocal.feed.online': 'feed online',
  'obsLocal.feed.offline': 'feed offline',
  'obsLocal.control.ready': 'control ready',
  'obsLocal.control.offline': 'control offline',
  'obsLocal.feed.title': 'Read-only Browser Source',
  'obsLocal.feed.dashboard': 'Allowlisted dashboard',
  'obsLocal.feed.port': 'Fixed loopback port override (optional)',
  'obsLocal.feed.portPlaceholder': 'Blank = private ephemeral port',
  'obsLocal.feed.help': 'Always binds 127.0.0.1. A fixed port is used only when explicitly entered.',
  'obsLocal.feed.start': 'Start OBS feed',
  'obsLocal.feed.stop': 'Stop feed',
  'obsLocal.feed.url': 'OBS Browser Source URL',
  'obsLocal.feed.binding': 'Binding: {address}:{port} · {mode} port · one allowlisted dashboard',
  'obsLocal.copy': 'Copy URL',
  'obsLocal.copied': 'Copied ✓',
  'obsLocal.control.title': 'OBS WebSocket control',
  'obsLocal.control.host': 'OBS host',
  'obsLocal.control.port': 'Port',
  'obsLocal.control.password': 'OBS WebSocket password',
  'obsLocal.control.scene': 'Allowlisted scene',
  'obsLocal.control.sources': 'Allowlisted sources (comma-separated)',
  'obsLocal.control.nonLoopback': 'Explicitly allow a non-loopback OBS endpoint (not certified)',
  'obsLocal.control.connect': 'Connect and handshake',
  'obsLocal.control.disconnect': 'Disconnect',
  'obsLocal.control.health': 'Refresh health',
  'obsLocal.control.failed': 'OBS capability or health handshake failed.',
  'obsLocal.control.manualOverride': 'Manual override: pause all automation',
  'obsLocal.status.title': 'Certification status',
  'obsLocal.status.line': 'Health: {health} · current scene: {scene} · endpoint: {endpoint}',
  'obsLocal.status.handshake': 'OBS {obs} · WebSocket {websocket} · {count} advertised requests',
  'obsLocal.status.noHandshake': 'No capability handshake yet.',
  'obsLocal.status.metrics': 'Commands accepted {accepted}, denied {denied}, p95 latency {p95} ms',
  'obsLocal.status.reliability': 'Connections {connected}/{attempts} · health failures {healthFailures} · rate-limited {rateLimited} · wrong-scene blocks {wrongScene}',
  'obsLocal.status.timeline': 'Last timeline: race {race}s → OBS {obs}s · {source} · {replay}',
  'obsLocal.status.nonCertified': 'Explicit non-loopback override is active. This connection is outside the local certification profile.',
  'obsLocal.action.show': 'Show source',
  'obsLocal.action.hide': 'Hide source',
  'obsLocal.action.replay': 'Save Replay Buffer',
  'obsLocal.action.undo': 'Undo last source action'
}

const keys: Partial<Record<ResolvedLanguage, Record<string, string>>> = {
  en,
  'pt-BR': {
    ...en,
    'obsLocal.title': 'Target de certificação OBS local',
    'obsLocal.readOnly': 'A Browser Source é somente leitura. O controle do OBS usa conexão autenticada e allowlist separadas.',
    'obsLocal.feed.title': 'Browser Source somente leitura',
    'obsLocal.feed.start': 'Iniciar feed OBS',
    'obsLocal.feed.stop': 'Parar feed',
    'obsLocal.control.connect': 'Conectar e negociar',
    'obsLocal.control.disconnect': 'Desconectar',
    'obsLocal.control.manualOverride': 'Override manual: pausar toda automação'
  },
  es: en,
  fr: en,
  de: en,
  zh: en,
  ja: en
}

export default keys
