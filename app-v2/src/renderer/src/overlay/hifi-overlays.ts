import type { OverlayListItem, OverlayPosition, OverlayWidgetConfig, OverlayWidgetDefinition, OverlayWidgetId, OverlaysConfig } from '../../../shared/overlays'
import {
  createDefaultOverlayStyle,
  createDefaultOverlaysConfig,
  DEFAULT_OVERLAY_STYLE_PRESET,
  OVERLAY_WIDGETS
} from '../../../shared/overlays'
import { HIFI_WIDGETS, hifiWidgetTags } from '../hifi/widgets/registry'

function hifiOverlayId(moduleId: string): OverlayWidgetId {
  return `hifi:${moduleId}`
}

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
          hifiModuleId: moduleId
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
    Object.entries(hifiDefaults).map(([id, defaults]) => [
      id,
      {
        ...defaults,
        ...(config.widgets[id as OverlayWidgetId] ?? {}),
        id: id as OverlayWidgetId,
        hifiModuleId: defaults.hifiModuleId
      }
    ])
  )
  return {
    ...config,
    widgets: {
      ...config.widgets,
      ...hifiWidgets
    } as OverlaysConfig['widgets']
  }
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
      visible: Boolean(current?.enabled)
    } as OverlayListItem
  })
  return [
    ...items,
    ...hifiItems.filter((item) => !byId.has(item.id))
  ]
}

