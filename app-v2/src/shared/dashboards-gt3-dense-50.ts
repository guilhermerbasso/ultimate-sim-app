import type { DashboardPreset } from './dashboards'
import {
  GT3_DENSE_50_QUALI_MATRIX,
  GT3_DENSE_50_QUALI_PRESETS
} from './dashboards-gt3-dense-50-quali'
import {
  GT3_DENSE_50_SPRINT_MATRIX,
  GT3_DENSE_50_SPRINT_PRESETS
} from './dashboards-gt3-dense-50-sprint'
import {
  GT3_DENSE_50_RACE_MATRIX,
  GT3_DENSE_50_RACE_PRESETS
} from './dashboards-gt3-dense-50-race'
import {
  GT3_DENSE_50_ENDURANCE_MATRIX,
  GT3_DENSE_50_ENDURANCE_PRESETS
} from './dashboards-gt3-dense-50-endurance'

export type {
  DenseDashboardCondition,
  DenseDashboardFocus,
  DenseDashboardMatrixEntry,
  DenseDashboardSession
} from './dashboards-gt3-dense-50-kit'

export const GT3_DENSE_50_MATRIX = [
  ...GT3_DENSE_50_QUALI_MATRIX,
  ...GT3_DENSE_50_SPRINT_MATRIX,
  ...GT3_DENSE_50_RACE_MATRIX,
  ...GT3_DENSE_50_ENDURANCE_MATRIX
] as const

export const GT3_DENSE_50_PRESETS: DashboardPreset[] = [
  ...GT3_DENSE_50_QUALI_PRESETS,
  ...GT3_DENSE_50_SPRINT_PRESETS,
  ...GT3_DENSE_50_RACE_PRESETS,
  ...GT3_DENSE_50_ENDURANCE_PRESETS
]
