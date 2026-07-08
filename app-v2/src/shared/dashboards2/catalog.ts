import { CAR_FAMILIES } from '../car-families'
import type { Dashboard } from '../dashboards'
import { buildDashboard2, DASHBOARD2_LAYOUT_CLASSES, type Dashboard2Target } from './builders'

export const DASHBOARD2_TARGETS: Dashboard2Target[] = [
  { width: 800, height: 480 },
  { width: 1024, height: 600 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 600, height: 1024 }
]

export const DASHBOARDS2: Dashboard[] = CAR_FAMILIES.flatMap((family) =>
  DASHBOARD2_LAYOUT_CLASSES.flatMap((layoutClass) => DASHBOARD2_TARGETS.map((target) => buildDashboard2(family, layoutClass, target)))
)
