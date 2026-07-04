import { buttonActionToIpc, type ButtonAction } from '../../../shared/touch-panel'

// Fire a button's bound action over the existing IPC bridge. The channel + args
// are decided by the pure mapper in shared/touch-panel.ts; this thin wrapper just
// performs the invoke and swallows errors so a missing handler (e.g. iRacing not
// running) never breaks the touch UI.
export async function executeButtonAction(action: ButtonAction): Promise<void> {
  const ipc = buttonActionToIpc(action)
  if (!ipc) return
  try {
    await window.ipc.invoke(ipc.channel, ...ipc.args)
  } catch (error) {
    console.warn('[touchpanel] action dispatch failed', ipc.channel, error)
  }
}
