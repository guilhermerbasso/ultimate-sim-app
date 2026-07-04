// Skin context + resolution helpers. Widgets read the active skin either from
// React context (SkinProvider) or directly from a dashboard element's style via
// `resolveElementSkin(style)`. Default is gt3/generic.
import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from 'react'
import { resolveSkin, gt3Base, type SkinToken, type SkinId, type BrandId } from './tokens'

const SkinContext = createContext<SkinToken>(gt3Base)

export interface SkinProviderProps {
  skin?: SkinId
  brand?: BrandId
  /** Provide a fully-resolved token directly (overrides skin/brand). */
  token?: SkinToken
  children: ReactNode
}

export function SkinProvider({ skin, brand, token, children }: SkinProviderProps): ReactElement {
  const value = useMemo(() => token ?? resolveSkin(skin, brand), [token, skin, brand])
  return <SkinContext.Provider value={value}>{children}</SkinContext.Provider>
}

/** The active skin token from context (default gt3/generic). */
export function useSkin(): SkinToken {
  return useContext(SkinContext)
}

/**
 * Resolve the effective skin for a dashboard element from its style. Pure — safe
 * to call in render or SSR. Falls back to gt3/generic when the fields are absent.
 */
export function resolveElementSkin(style?: { skin?: SkinId; brandStyle?: BrandId } | null): SkinToken {
  return resolveSkin(style?.skin, style?.brandStyle)
}
