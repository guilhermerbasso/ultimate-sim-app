const MODIFIER_CODES = new Set([
  'AltLeft',
  'AltRight',
  'ControlLeft',
  'ControlRight',
  'MetaLeft',
  'MetaRight',
  'ShiftLeft',
  'ShiftRight'
])

const CODE_TOKENS: Record<string, string> = {
  Backquote: 'backquote',
  Backslash: 'backslash',
  BracketLeft: 'bracketleft',
  BracketRight: 'bracketright',
  Comma: 'comma',
  Delete: 'delete',
  End: 'end',
  Enter: 'enter',
  Equal: 'plus',
  Escape: 'escape',
  Home: 'home',
  Insert: 'insert',
  Minus: 'minus',
  PageDown: 'pagedown',
  PageUp: 'pageup',
  Period: 'period',
  Quote: 'quote',
  Semicolon: 'semicolon',
  Slash: 'slash',
  Space: 'space',
  Tab: 'tab',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up'
}

export function isKeyboardCaptureCancel(event: KeyboardEvent): boolean {
  return event.key === 'Escape' || event.code === 'Escape'
}

export function isKeyboardModifier(code: string): boolean {
  return MODIFIER_CODES.has(code)
}

export function keyboardTokenFromEvent(event: KeyboardEvent): string | null {
  if (event.code.startsWith('Key')) return event.code.slice(3).toLowerCase()
  if (event.code.startsWith('Digit')) return event.code.slice(5)
  if (event.code.startsWith('Numpad') && /^Numpad\d$/.test(event.code)) return event.code.slice(6)
  if (/^F\d{1,2}$/.test(event.code)) return event.code.toLowerCase()
  return CODE_TOKENS[event.code] ?? (event.key.length === 1 ? event.key.toLowerCase() : null)
}

export function composeKeyboardCombo(heldKeys: Map<string, string>): string[] {
  const modifiers: string[] = []
  if (heldKeys.has('ControlLeft') || heldKeys.has('ControlRight')) modifiers.push('ctrl')
  if (heldKeys.has('ShiftLeft') || heldKeys.has('ShiftRight')) modifiers.push('shift')
  if (heldKeys.has('AltLeft') || heldKeys.has('AltRight')) modifiers.push('alt')
  if (heldKeys.has('MetaLeft') || heldKeys.has('MetaRight')) modifiers.push('win')

  const regularKeys = Array.from(heldKeys.entries())
    .filter(([code]) => !isKeyboardModifier(code))
    .map(([, token]) => token)

  return Array.from(new Set([...modifiers, ...regularKeys]))
}
