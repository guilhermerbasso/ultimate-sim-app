import type { HifiWidgetModule } from '../types'
import {
  f296Abs,
  f296Dash,
  f296Delta,
  f296Fuel,
  f296Gear,
  f296LastLap,
  f296Map,
  f296RevLights,
  f296RpmBar,
  f296Speed,
  f296Tc
} from './ferrari296'

export const CARS_REAL_WIDGETS: HifiWidgetModule[] = [
  f296Dash,
  f296Gear,
  f296Speed,
  f296RevLights,
  f296RpmBar,
  f296Fuel,
  f296Tc,
  f296Abs,
  f296Map,
  f296LastLap,
  f296Delta
]
