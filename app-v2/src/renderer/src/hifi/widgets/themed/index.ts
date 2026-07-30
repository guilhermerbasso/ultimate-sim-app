import type { HifiWidgetModule } from '../types'
import {
  clusterAmg,
  clusterCorvette,
  clusterFerrari,
  clusterLambo,
  clusterMclaren,
  clusterPorsche,
  revThemedAmg,
  revThemedCorvette,
  revThemedFerrari,
  revThemedLambo,
  revThemedMclaren,
  revThemedPorsche
} from './widgets'

export const THEMED_WIDGETS: HifiWidgetModule[] = [
  revThemedFerrari,
  revThemedPorsche,
  revThemedAmg,
  revThemedMclaren,
  revThemedCorvette,
  revThemedLambo,
  clusterFerrari,
  clusterPorsche,
  clusterAmg,
  clusterMclaren,
  clusterCorvette,
  clusterLambo
]
