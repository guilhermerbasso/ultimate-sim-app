export const APP_NAVIGATE_EVENT = 'usa:navigate-view'
const EDITOR_TARGET_KEY = 'usa:editor-target'

export type EditorSurface = 'dashboard' | 'overlay'

export interface AppNavigateDetail {
  viewId: string
  editorTarget?: {
    surface: EditorSurface
    targetId: string
  }
}

export function navigateToView(viewId: string): void {
  if (!viewId) return
<<<<<<< HEAD
  window.dispatchEvent(new CustomEvent<AppNavigateDetail>(APP_NAVIGATE_EVENT, { detail: { viewId } }))
=======
  window.dispatchEvent(new CustomEvent<AppNavigateDetail>(APP_NAVIGATE_EVENT, {
    detail: { viewId }
  }))
>>>>>>> origin/main
}

export function navigateToEditor(surface: EditorSurface, targetId: string): void {
  if (!targetId) return
  const detail: AppNavigateDetail = {
    viewId: surface === 'dashboard' ? 'dashboards' : 'overlays',
    editorTarget: { surface, targetId }
  }
  try {
    window.sessionStorage.setItem(EDITOR_TARGET_KEY, JSON.stringify(detail.editorTarget))
  } catch {
    // Navigation still works when session storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent<AppNavigateDetail>(APP_NAVIGATE_EVENT, { detail }))
}

export function consumeEditorTarget(surface: EditorSurface): string | null {
  try {
    const raw = window.sessionStorage.getItem(EDITOR_TARGET_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { surface?: unknown; targetId?: unknown }
    if (parsed.surface !== surface || typeof parsed.targetId !== 'string' || !parsed.targetId) return null
    window.sessionStorage.removeItem(EDITOR_TARGET_KEY)
    return parsed.targetId
  } catch {
    return null
  }
}
