import { fuelDeltaWidget, fuelLapsWidget, fuelPerLapWidget, fuelWidget } from './widgets'
import type { HifiWidgetModule } from '../types'

export const FUEL_WIDGETS: HifiWidgetModule[] = [fuelWidget, fuelLapsWidget, fuelPerLapWidget, fuelDeltaWidget]
