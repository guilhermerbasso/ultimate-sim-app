import { useMemo, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'

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
    const itemTags = new Set((getTags(item) ?? []).filter(Boolean))
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
  className?: string
  style?: CSSProperties
}

export function TagFilter<T>({
  items,
  selectedTags,
  onSelectedTagsChange,
  getTags,
  label = 'Tags',
  className,
  style
}: TagFilterProps<T>): ReactElement {
  const [query, setQuery] = useState('')
  const tagCounts = useMemo(() => collectTags(items, getTags), [items, getTags])
  const filteredItems = useMemo(() => filterByTags(items, selectedTags, getTags), [items, selectedTags, getTags])
  const selectedSet = useMemo(() => new Set(selectedTags), [selectedTags])
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleTags = normalizedQuery
    ? tagCounts.filter(({ tag }) => tag.toLocaleLowerCase().includes(normalizedQuery))
    : tagCounts

  function toggleTag(tag: string): void {
    if (selectedSet.has(tag)) {
      onSelectedTagsChange(selectedTags.filter((selected) => selected !== tag))
      return
    }
    onSelectedTagsChange([...selectedTags, tag])
  }

  return (
    <div className={className} style={{ ...containerStyle, ...style }}>
      <span style={labelStyle}>{label}</span>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search tags"
        aria-label="Search tags"
        style={searchStyle}
      />
      <span style={countStyle}>{filteredItems.length} of {items.length}</span>
      <button
        type="button"
        className={selectedTags.length === 0 ? 'overlay-fav is-fav' : 'overlay-fav'}
        onClick={() => onSelectedTagsChange([])}
        disabled={selectedTags.length === 0}
        style={{ ...chipStyle, opacity: selectedTags.length === 0 ? 0.7 : 1 }}
      >
        Clear
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
            title={`${count} item${count === 1 ? '' : 's'}`}
          >
            {tag} <span style={countBubbleStyle}>{count}</span>
          </button>
        )
      })}
      {visibleTags.length === 0 && <span style={countStyle}>No tags found</span>}
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
