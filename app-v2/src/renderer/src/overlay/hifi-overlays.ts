import type { OverlayListItem, OverlayPosition, OverlayTrigger, OverlayTriggerResult, OverlayWidgetConfig, OverlayWidgetDefinition, OverlayWidgetId, OverlaysConfig } from '../../../shared/overlays'
import {
  createDefaultOverlayStyle,
  createDefaultOverlaysConfig,
  DEFAULT_OVERLAY_STYLE_PRESET,
  OVERLAY_WIDGETS,
  sanitizeOverlayTrigger,
  sanitizeOverlayTriggerForRole
} from '../../../shared/overlays'
import { HIFI_WIDGETS, hifiWidgetTags } from '../hifi/widgets/registry'

function hifiOverlayId(moduleId: string): OverlayWidgetId {
  return `hifi:${moduleId}`
}

/** Default triggers by overlay id, for spotter-style trigger-only overlays
 *  (car left/right, radar-on-proximity, shift flash, pit limiter, flag, low fuel).
 *  The compositor falls back to this when the user has not set an explicit trigger. */
export const HIFI_DEFAULT_TRIGGERS: Record<string, OverlayTrigger> = Object.fromEntries(
  HIFI_WIDGETS.filter((module) => module.defaultTrigger != null).map((module) => [
    hifiOverlayId(module.id),
    module.defaultTrigger as OverlayTrigger
  ])
)

function defaultPosition(index: number, size: { w: number; h: number }): OverlayPosition {
  const width = Math.max(160, Math.round(size.w))
  const height = Math.max(70, Math.round(size.h))
  return {
    x: 80 + (index % 4) * 28,
    y: 80 + (index % 6) * 24,
    width,
    height
  }
}

export const HIFI_OVERLAY_DEFS: OverlayWidgetDefinition[] = HIFI_WIDGETS.map((module, index) => ({
  id: hifiOverlayId(module.id),
  title: module.title,
  description: module.description,
  category: module.category,
  tags: hifiWidgetTags(module),
  requires: module.requires,
  role: module.role,
  defaultTrigger: module.defaultTrigger,
  catalogOrder: module.catalogOrder,
  releasedAt: module.releasedAt,
  priority: module.priority,
  defaultPosition: defaultPosition(index, module.defaultSize)
}))

export const ALL_OVERLAY_WIDGETS: OverlayWidgetDefinition[] = [...OVERLAY_WIDGETS, ...HIFI_OVERLAY_DEFS]

export function hifiOverlayConfigs(): Record<string, OverlayWidgetConfig> {
  return Object.fromEntries(
    HIFI_OVERLAY_DEFS.map((definition) => {
      const moduleId = definition.id.slice(5)
      return [
        definition.id,
        {
          id: definition.id,
          enabled: false,
          locked: false,
          favorite: false,
          position: { ...definition.defaultPosition },
          opacity: 100,
          stylePreset: DEFAULT_OVERLAY_STYLE_PRESET,
          style: createDefaultOverlayStyle(),
          display: null,
          hifiModuleId: moduleId,
          role: definition.role,
          ...(HIFI_DEFAULT_TRIGGERS[definition.id] ? { trigger: HIFI_DEFAULT_TRIGGERS[definition.id] } : {})
        } satisfies OverlayWidgetConfig
      ]
    })
  )
}

export function createDefaultOverlaysConfigWithHifi(): OverlaysConfig {
  const base = createDefaultOverlaysConfig()
  return {
    ...base,
    widgets: {
      ...base.widgets,
      ...hifiOverlayConfigs()
    } as OverlaysConfig['widgets']
  }
}

export function mergeHifiOverlayConfigs(config: OverlaysConfig): OverlaysConfig {
  const hifiDefaults = hifiOverlayConfigs()
  const hifiWidgets = Object.fromEntries(
    Object.entries(hifiDefaults).map(([id, defaults]) => {
      const definition = HIFI_OVERLAY_DEFS.find((item) => item.id === id)
      const current = config.widgets[id as OverlayWidgetId]
      const merged = {
        ...defaults,
        ...(current ?? {}),
        id: id as OverlayWidgetId,
        hifiModuleId: defaults.hifiModuleId,
        role: definition?.role ?? current?.role
      }
      merged.trigger = resolveOverlayTrigger(definition, current)
      return [id, merged]
    })
  )
  return {
    ...config,
    widgets: {
      ...config.widgets,
      ...hifiWidgets
    } as OverlaysConfig['widgets']
  }
}

export function resolveOverlayTrigger(
  definition: OverlayWidgetDefinition | undefined,
  config: Pick<OverlayWidgetConfig, 'trigger'> | null | undefined
): OverlayTrigger | null {
  const fallback = definition?.defaultTrigger ?? null
  if (config?.trigger == null) {
    return definition?.role === 'alert'
      ? sanitizeOverlayTriggerForRole(null, definition.role, fallback)
      : fallback
  }
  if (definition?.role === 'alert') {
    return sanitizeOverlayTriggerForRole(config.trigger, definition.role, fallback)
  }
  return sanitizeOverlayTrigger(config.trigger)
}

export function shouldRenderOverlayRuntime(
  definition: OverlayWidgetDefinition | undefined,
  config: Pick<OverlayWidgetConfig, 'locked'>,
  visibility: OverlayTriggerResult
): boolean {
  return definition?.role !== 'alert' && !config.locked ? true : visibility.visible
}

export function hasAllHifiOverlayConfigs(config: OverlaysConfig): boolean {
  return HIFI_OVERLAY_DEFS.every((definition) => Boolean(config.widgets[definition.id]?.hifiModuleId))
}

export function mergeHifiOverlayItems(items: OverlayListItem[], config: OverlaysConfig): OverlayListItem[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const hifiItems = HIFI_OVERLAY_DEFS.map((definition) => {
    const current = config.widgets[definition.id]
    return {
      ...definition,
      ...current,
      role: definition.role,
      visible: Boolean(current?.enabled)
    } as OverlayListItem
  })
  return [
    ...items,
    ...hifiItems.filter((item) => !byId.has(item.id))
  ]
}
