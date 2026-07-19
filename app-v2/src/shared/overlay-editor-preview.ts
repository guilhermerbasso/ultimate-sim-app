export const OVERLAY_EDITOR_PREVIEW_CHANNELS = Object.freeze({
  setActive: 'overlays:editorPreview:setActive',
  state: 'overlays:editorPreview:state'
})

export interface OverlayEditorPreviewState {
  active: boolean
}
