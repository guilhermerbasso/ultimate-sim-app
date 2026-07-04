// Centralized classification + formatting of serial I/O errors that are safe to
// swallow. The Windows `serialport` binding raises "Operation aborted" /
// ERROR_OPERATION_ABORTED (often wrapped as "Writing to COM port
// (GetOverlappedResult): Operation aborted") when a read/write is in flight and
// the port is closed, cancelled or yanked — e.g. during a flash/cancel, a
// disconnect, or app teardown. Those are benign: whatever we were doing is
// already being torn down, so there is nothing to recover and certainly nothing
// worth crashing the whole main process over.
//
// Used both at the individual write/port sites and by the global uncaught
// exception / unhandled rejection guard in the main bootstrap.

function describeSerialError(error: unknown): { code: string; message: string; canceled: boolean } {
  if (error && typeof error === 'object') {
    const candidate = error as { code?: unknown; message?: unknown; canceled?: unknown }
    const code = typeof candidate.code === 'string' ? candidate.code : ''
    const message = typeof candidate.message === 'string' ? candidate.message : ''
    // node-serialport tags benign cancellation/teardown errors (a read/write
    // aborted because the port is closing) with `canceled: true` on its
    // BindingsError. That structured, serial-scoped flag is a far safer signal
    // than substring-matching the word "cancel" in an arbitrary message.
    const canceled = candidate.canceled === true
    return { code, message, canceled }
  }
  return { code: '', message: error == null ? '' : String(error), canceled: false }
}

// True when an error is a known-benign serial abort/cancel/closed-port condition
// that should never crash the app. Intentionally narrow: genuine failures such
// as "Access denied" (port busy) are NOT treated as benign so they still surface
// to the user.
export function isBenignSerialError(error: unknown): boolean {
  const { code, message, canceled } = describeSerialError(error)
  // serialport's own benign-cancellation flag, set when a pending read/write is
  // aborted because the port is closing — the most reliable serial signal.
  if (canceled) return true
  const c = code.toUpperCase()
  if (c === 'ERROR_OPERATION_ABORTED' || c === 'ECANCELED' || c === 'ECANCELLED' || c === 'EABORT') {
    return true
  }

  const m = message.toLowerCase()
  if (!m) return false
  // NOTE: deliberately NO bare 'cancel…' substring match here — this function
  // gates the GLOBAL uncaughtException/unhandledRejection guard, so matching the
  // word "cancel" anywhere would swallow unrelated app-wide errors (e.g. an
  // aborted fetch / "Request canceled"). Genuine serial cancellations are already
  // covered by the `canceled` flag and the ECANCELED/ERROR_OPERATION_ABORTED
  // codes above; the Windows abort phrasing is matched explicitly below.
  return (
    m.includes('operation aborted') ||
    m.includes('error_operation_aborted') ||
    m.includes('getoverlappedresult') ||
    m.includes('overlapped i/o') ||
    m.includes('port is not open') ||
    m.includes('port is closed') ||
    m.includes('port is closing') ||
    m.includes('port is already closed') ||
    m.includes('port is gone') ||
    m.includes('writing while port is closed')
  )
}

// Compact, human-readable description for logging (message preferred, falls back
// to a stringified value). Avoids dumping full stacks for the benign cases.
export function serialErrorMessage(error: unknown): string {
  const { code, message } = describeSerialError(error)
  if (message) return code ? `${message} (${code})` : message
  if (code) return code
  return String(error)
}
