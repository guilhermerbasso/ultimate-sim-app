import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { ViewIcon } from '../views/icons'
import type { ViewDef } from '../views/registry'
import { t, type ResolvedLanguage } from '../i18n'

interface CommandPaletteProps {
  open: boolean
  activeId: string
  views: ViewDef[]
  language: ResolvedLanguage
  onClose(): void
  onSelect(id: string): void
}

const LISTBOX_ID = 'cmdk-listbox'

function optionId(id: string): string {
  return `cmdk-option-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

// Ctrl/Cmd+K palette: fuzzy-free substring search over every registered view
// (label, group, eyebrow, description, shortcut) so the user can jump anywhere
// without hunting the sidebar. Additive — does not touch the view components.
export function CommandPalette({ open, activeId, views, language, onClose, onSelect }: CommandPaletteProps): ReactElement | null {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return views
    return views.filter((view) =>
      `${view.label} ${view.group} ${view.eyebrow} ${view.description} ${view.shortcut}`.toLowerCase().includes(q)
    )
  }, [query, views])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setHighlight(0)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    setHighlight((current) => Math.min(current, Math.max(0, results.length - 1)))
  }, [results.length])

  if (!open) return null

  const activeOptionId = results[highlight] ? optionId(results[highlight].id) : undefined

  const trapTab = (event: KeyboardEvent<HTMLDivElement>): void => {
    const panel = panelRef.current
    if (!panel) return

    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>('input, button, [href], [tabindex]:not([tabindex="-1"])')
    ).filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true')

    if (focusable.length === 0) return

    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement)
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
      : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1)

    event.preventDefault()
    focusable[nextIndex]?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((current) => Math.min(current + 1, Math.max(0, results.length - 1)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((current) => Math.max(current - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const target = results[highlight]
      if (target) onSelect(target.id)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'Tab') {
      trapTab(event)
    }
  }

  return (
    <div className="cmdk-backdrop" role="dialog" aria-modal="true" aria-label={t(language, 'searchScreens')} onMouseDown={onClose}>
      <div ref={panelRef} className="cmdk-panel" onKeyDown={handleKeyDown} onMouseDown={(event) => event.stopPropagation()}>
        <div className="cmdk-input-row">
          <span className="cmdk-input-icon" aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            className="cmdk-input"
            role="combobox"
            aria-expanded={open}
            aria-controls={LISTBOX_ID}
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            placeholder={t(language, 'searchScreens')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd className="cmdk-kbd">Esc</kbd>
        </div>
        <ul id={LISTBOX_ID} className="cmdk-list" role="listbox">
          {results.length === 0 && <li className="cmdk-empty">{t(language, 'noResults')}</li>}
          {results.map((view, index) => (
            <li
              id={optionId(view.id)}
              key={view.id}
              role="option"
              aria-selected={index === highlight}
              tabIndex={0}
              className={`cmdk-item ${index === highlight ? 'is-highlight' : ''} ${view.id === activeId ? 'is-current' : ''}`}
              onFocus={() => setHighlight(index)}
              onMouseEnter={() => setHighlight(index)}
              onMouseDown={(event) => {
                event.preventDefault()
                onSelect(view.id)
              }}
            >
              <span className="cmdk-item-icon" aria-hidden="true"><ViewIcon id={view.id} /></span>
              <span className="cmdk-item-text">
                <strong>{view.label}</strong>
                <small>{view.group} · {view.description}</small>
              </span>
              {view.shortcut && <span className="cmdk-item-tag">{view.shortcut}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
