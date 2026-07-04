// Barrel for the two-skin design system (v2.39). Every widget consumes these.
export {
  SKIN_IDS,
  BRAND_IDS,
  gt3Base,
  hudBase,
  resolveSkin,
  zoneColor
} from './tokens'
export type {
  SkinId,
  BrandId,
  ColorToken,
  Ms,
  LedZone,
  LedProfile,
  SegmentStyle,
  Material,
  TelltaleColors,
  TelltaleSet,
  Typography,
  Palette,
  LogoSlot,
  Motion,
  SkinToken
} from './tokens'

export { FitText, computeFit } from './FitText'
export type { FitTextProps, OverflowStrategy } from './FitText'

export { SkinProvider, useSkin, resolveElementSkin } from './SkinContext'
export type { SkinProviderProps } from './SkinContext'

export { makeGrid, WHEEL_GRID } from './SafeGrid'
export type { SafeGrid, Rect } from './SafeGrid'
