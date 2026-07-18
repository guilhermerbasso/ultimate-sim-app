import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { ResolvedLanguage } from '../i18n'
import { tt } from '../i18n'
import { OVERLAY_EDITOR_PREVIEW_CHANNELS } from '../../../shared/overlay-editor-preview'
import {
  persistEditorTriggerPreviewPreference,
  readEditorTriggerPreviewPreference
} from '../overlay/editor-trigger-preview'

export function useEditorTriggerPreviewPreference(): [
  boolean,
  (active: boolean) => void
] {
  const [active, setActive] = useState(readEditorTriggerPreviewPreference)
  const update = useCallback((next: boolean): void => {
    setActive(next)
    persistEditorTriggerPreviewPreference(next)
  }, [])
  return [active, update]
}

export function useOverlayPositioningPreviewChannel(active: boolean): void {
  useEffect(() => {
    const publishVisibility = (): void => {
      const effectiveActive = document.visibilityState === 'hidden' ? false : active
      void window.ipc
        .invoke(OVERLAY_EDITOR_PREVIEW_CHANNELS.setActive, effectiveActive)
        .catch(() => undefined)
    }
    publishVisibility()
    document.addEventListener('visibilitychange', publishVisibility)
    window.addEventListener('focus', publishVisibility)
    return () => {
      document.removeEventListener('visibilitychange', publishVisibility)
      window.removeEventListener('focus', publishVisibility)
    }
  }, [active])

  useEffect(() => {
    return () => {
      void window.ipc
        .invoke(OVERLAY_EDITOR_PREVIEW_CHANNELS.setActive, false)
        .catch(() => undefined)
    }
  }, [])
}

export function TriggerPreviewToggle({
  checked,
  onChange,
  language,
  label,
  help,
  style
}: {
  checked: boolean
  onChange(active: boolean): void
  language?: ResolvedLanguage
  label?: string
  help?: string
  style?: CSSProperties
}): ReactElement {
  const resolvedLabel = label ?? tt(language, 'triggerPreview.label')
  const resolvedHelp = help ?? tt(language, 'triggerPreview.help')
  return (
    <label
      data-trigger-preview-toggle="true"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        color: 'var(--text-secondary)',
        fontSize: 12,
        ...style
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={resolvedLabel}
      />
      <span>
        <strong style={{ display: 'block', color: 'var(--text-primary)' }}>
          {resolvedLabel}
        </strong>
        <span style={{ display: 'block', marginTop: 2, color: 'var(--text-muted)' }}>
          {resolvedHelp}
        </span>
      </span>
    </label>
  )
}
