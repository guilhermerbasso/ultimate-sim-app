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
import { PORSCHECUP_WIDGETS } from './porschecup'
import { MUSTANGGTD_WIDGETS } from './mustanggtd'
import { CORVETTEGT3R_WIDGETS } from './corvettegt3r'
import { LAMBOHURACAN_WIDGETS } from './lambohuracan'

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
  f296Delta,
  ...PORSCHECUP_WIDGETS,
  ...MUSTANGGTD_WIDGETS,
  ...CORVETTEGT3R_WIDGETS,
  ...LAMBOHURACAN_WIDGETS
]
