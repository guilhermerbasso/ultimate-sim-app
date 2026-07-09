import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { AppSettings } from '../../../shared/settings'
import { APP_SETTINGS_CHANGED_EVENT, resolveAppLanguage, tt, type ResolvedLanguage } from '../i18n'

export interface TagCount {
  tag: string
  count: number
}

function normalizeSelected(selectedTags: readonly string[] | ReadonlySet<string>): string[] {
  return Array.from(selectedTags).map((tag) => tag.trim()).filter(Boolean)
}

export function filterByTags<T>(
  items: readonly T[],
  selectedTags: readonly string[] | ReadonlySet<string>,
  getTags: (item: T) => readonly string[] | undefined
): T[] {
  const selected = normalizeSelected(selectedTags)
  if (selected.length === 0) return [...items]
  return items.filter((item) => {
    const itemTags = new Set((getTags(item) ?? []).map((tag) => tag.trim()).filter(Boolean))
    return selected.every((tag) => itemTags.has(tag))
  })
}

export function collectTags<T>(
  items: readonly T[],
  getTags: (item: T) => readonly string[] | undefined
): TagCount[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    const uniqueTags = new Set((getTags(item) ?? []).map((tag) => tag.trim()).filter(Boolean))
    for (const tag of uniqueTags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return Array.from(counts, ([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag))
}

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
  const selectedSet = useMemo(() => new Set(selectedTags), [selectedTags])
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleTags = normalizedQuery
    ? tagCounts.filter(({ tag }) => tag.toLocaleLowerCase().includes(normalizedQuery))
    : tagCounts

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
    if (selectedSet.has(tag)) {
      onSelectedTagsChange(selectedTags.filter((selected) => selected !== tag))
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
      <button
        type="button"
        className={selectedTags.length === 0 ? 'overlay-fav is-fav' : 'overlay-fav'}
        onClick={() => onSelectedTagsChange([])}
        disabled={selectedTags.length === 0}
        style={{ ...chipStyle, opacity: selectedTags.length === 0 ? 0.7 : 1 }}
      >
        {tt(effectiveLanguage, 'common.clear')}
      </button>
      {visibleTags.map(({ tag, count }) => {
        const selected = selectedSet.has(tag)
        return (
          <button
            key={tag}
            type="button"
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
