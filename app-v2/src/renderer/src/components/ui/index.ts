/*
 * Modern UI primitives (glassmorphism / neon), styled entirely through the
 * themed CSS variables. Import from anywhere in the renderer:
 *
 *   import { GlassCard, NeonStatTile } from '../components/ui'
 *
 * These reskin automatically when the active theme changes — no per-component
 * theming needed.
 */
export { GlassCard, type GlassCardProps } from './GlassCard'
export { NeonStatTile, type NeonStatTileProps, type StatTone } from './NeonStatTile'
export { GradientBar, type GradientBarProps, type GradientBarTone } from './GradientBar'
export { PillToggle, type PillToggleProps } from './PillToggle'
export { GlowIcon, type GlowIconProps, type GlowIconTone, type GlowIconSize } from './GlowIcon'
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption
} from './SegmentedControl'
