import { buttonActionToIpc, type ButtonAction } from '../../../shared/touch-panel'

function authToken(): string {
  try {
    return new URLSearchParams(window.location.search).get('token') ?? ''
  } catch {
    return ''
  }
}

export function isBrowserStreamRuntime(): boolean {
  return typeof window.ipc?.invoke !== 'function'
}

export async function fetchStreamPanel(panelId: string): Promise<unknown> {
  const url = new URL(`/api/touch/panel/${encodeURIComponent(panelId)}`, window.location.origin)
  url.searchParams.set('token', authToken())
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

// Fire a button's bound action over the existing IPC bridge. The channel + args
// are decided by the pure mapper in shared/touch-panel.ts; this thin wrapper just
// performs the invoke and swallows errors so a missing handler (e.g. iRacing not
// running) never breaks the touch UI.
export async function executeButtonAction(action: ButtonAction): Promise<void> {
  if (isBrowserStreamRuntime()) {
    const url = new URL('/api/touch/action', window.location.origin)
    url.searchParams.set('token', authToken())
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(action)
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return
  }
  const ipc = buttonActionToIpc(action)
  if (!ipc) return
  try {
    await window.ipc.invoke(ipc.channel, ...ipc.args)
  } catch (error) {
    console.warn('[touchpanel] action dispatch failed', ipc.channel, error)
  }
}
