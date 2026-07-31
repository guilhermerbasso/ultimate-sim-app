import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { AppSettings } from '../../../shared/settings'
import { APP_SETTINGS_CHANGED_EVENT, resolveAppLanguage, tt, type ResolvedLanguage } from '../i18n'
import { collectTags, filterByTags, normalizeTagKey } from '../../../shared/tags'
import { ROVING_ITEM_ATTRIBUTE, useRovingTabIndex } from '../lib/useRovingTabIndex'

// `filterByTags`/`collectTags` are pure tag-set operations with no React or i18n in
// them, so they live in shared/tags.ts next to `normalizeTagKey`. Re-exported here
// because this component is their main consumer — and so node-environment suites can
// reach them without loading this module's 394 KB i18n dependency.
export { collectTags, filterByTags, type TagCount } from '../../../shared/tags'

/** See useRovingTabIndex: out of sequential navigation, still focusable and clickable. */
const ROVING = { tabIndex: -1, [ROVING_ITEM_ATTRIBUTE]: 'true' } as const

export interface TagFilterProps<T> {
  items: readonly T[]
  selectedTags: readonly string[]
  onSelectedTagsChange: (tags: string[]) => void
  getTags: (item: T) => readonly string[] | undefined
  label?: string
  language?: ResolvedLanguage
  className?: string
  style?: CSSProperties
}

export function TagFilter<T>({
  items,
  selectedTags,
  onSelectedTagsChange,
  getTags,
  label,
  language,
  className,
  style
}: TagFilterProps<T>): ReactElement {
  const [query, setQuery] = useState('')
  const [fallbackLanguage, setFallbackLanguage] = useState<ResolvedLanguage>('en')
  const effectiveLanguage = language ?? fallbackLanguage
  const tagCounts = useMemo(() => collectTags(items, getTags), [items, getTags])
  const filteredItems = useMemo(() => filterByTags(items, selectedTags, getTags), [items, selectedTags, getTags])
  const selectedSet = useMemo(() => new Set(selectedTags.map((tag) => normalizeTagKey(tag))), [selectedTags])
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleTags = normalizedQuery
    ? tagCounts.filter(({ tag }) => tag.toLocaleLowerCase().includes(normalizedQuery))
    : tagCounts
  const roving = useRovingTabIndex<HTMLDivElement>()

  useEffect(() => {
    if (language) return
    window.ipc
      .invoke<AppSettings>('app:getSettings')
      .then((settings) => setFallbackLanguage(resolveAppLanguage(settings.language)))
      .catch(() => {})
    const onSettingsChanged = (event: Event): void => {
      const detail = (event as CustomEvent<AppSettings>).detail
      if (detail) setFallbackLanguage(resolveAppLanguage(detail.language))
    }
    window.addEventListener(APP_SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => window.removeEventListener(APP_SETTINGS_CHANGED_EVENT, onSettingsChanged)
  }, [language])

  function toggleTag(tag: string): void {
    const key = normalizeTagKey(tag)
    if (selectedSet.has(key)) {
      onSelectedTagsChange(selectedTags.filter((selected) => normalizeTagKey(selected) !== key))
      return
    }
    onSelectedTagsChange([...selectedTags, tag])
  }

  return (
    <div className={className} style={{ ...containerStyle, ...style }}>
      <span style={labelStyle}>{label ?? tt(effectiveLanguage, 'shared.tagFilter.tags')}</span>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={tt(effectiveLanguage, 'shared.tagFilter.search')}
        aria-label={tt(effectiveLanguage, 'shared.tagFilter.search')}
        style={searchStyle}
      />
      <span style={countStyle}>{tt(effectiveLanguage, 'shared.tagFilter.count', { shown: filteredItems.length, total: items.length })}</span>
      {/*
        WCAG 2.2 A — 2.4.3 Focus Order. The preset gallery renders 361 tags, so
        this row was 361 tab stops between the search box and everything after
        it. It is now one stop with a roving tabindex; the chips stay clickable,
        stay in the accessibility tree, and are reached with the arrow keys.

        `display: contents` so the chips keep flowing in the parent's wrap
        exactly as before — this component is shared with three screens and the
        layout must not move.
      */}
      <div
        ref={roving.containerRef}
        onKeyDown={roving.onKeyDown}
        onFocus={roving.onFocus}
        role="toolbar"
        aria-label={tt(effectiveLanguage, 'shared.tagFilter.tags')}
        data-tag-filter-chips="true"
        style={{ display: 'contents' }}
      >
        <button
          type="button"
          {...ROVING}
          className={selectedTags.length === 0 ? 'overlay-fav is-fav' : 'overlay-fav'}
          onClick={() => onSelectedTagsChange([])}
          disabled={selectedTags.length === 0}
          style={{ ...chipStyle, opacity: selectedTags.length === 0 ? 0.7 : 1 }}
        >
          {tt(effectiveLanguage, 'common.clear')}
        </button>
        {visibleTags.map(({ tag, count }) => {
          const selected = selectedSet.has(normalizeTagKey(tag))
          return (
            <button
              key={tag}
              type="button"
              {...ROVING}
              className={selected ? 'overlay-fav is-fav' : 'overlay-fav'}
              aria-pressed={selected}
              onClick={() => toggleTag(tag)}
              style={chipStyle}
              title={tt(effectiveLanguage, count === 1 ? 'shared.tagFilter.itemSingular' : 'shared.tagFilter.itemPlural', { count })}
            >
              {tag} <span style={countBubbleStyle}>{count}</span>
            </button>
          )
        })}
      </div>
      {visibleTags.length === 0 && <span style={countStyle}>{tt(effectiveLanguage, 'shared.tagFilter.noTags')}</span>}
    </div>
  )
}

const containerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap'
}

const labelStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em'
}

const searchStyle: CSSProperties = {
  minWidth: 120,
  maxWidth: 180,
  background: 'var(--surface-base)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-default)',
  borderRadius: 999,
  padding: '3px 10px',
  fontSize: 12
}

const countStyle: CSSProperties = {
  color: 'var(--muted)',
  fontSize: 12
}

const chipStyle: CSSProperties = {
  padding: '2px 10px',
  fontSize: 12
}

const countBubbleStyle: CSSProperties = {
  opacity: 0.7,
  marginLeft: 4
}
