import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  OverlayTriggerController,
  createDefaultOverlaysConfig,
  semanticOverlayTrigger,
  type OverlayTriggerResult
} from '../../src/shared/overlays'
import type { TelemetrySnapshot } from '../../src/shared/telemetry'
import { HIFI_WIDGETS_BY_ID } from '../../src/renderer/src/hifi/widgets/registry'
import { SideProximityWidget } from '../../src/renderer/src/overlay/widgets/SideProximityWidget'

interface Capture {
  name: string
  label: string
  html: string
  width: number
  height: number
}

function base(partial: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1,
    sessionUniqueId: 77,
    sessionNumber: 1,
    speedKmh: 160,
    rpm: 7200,
    gear: 4,
    throttle: 0.7,
    brake: 0,
    clutch: 0,
    flags: {
      green: false,
      yellow: false,
      blue: false,
      white: false,
      checkered: false,
      red: false,
      black: false,
      meatball: false,
      repair: false,
      disqualify: false,
      greenWhiteCheckered: false
    },
    ...partial
  }
}

function moduleCapture(
  name: string,
  moduleId: string,
  snapshot: TelemetrySnapshot,
  visibility: OverlayTriggerResult
): Capture {
  const module = HIFI_WIDGETS_BY_ID[moduleId]
  if (!module) throw new Error(`Missing ${moduleId}`)
  const html = visibility.visible
    ? renderToStaticMarkup(createElement(module.render, {
        snapshot,
        visibility,
        width: module.defaultSize.w,
        height: module.defaultSize.h
      }))
    : ''
  return {
    name,
    label: `${module.title} · ${visibility.phase}`,
    html,
    width: module.defaultSize.w,
    height: module.defaultSize.h
  }
}

function sideCapture(name: string, snapshot: TelemetrySnapshot, visibility: OverlayTriggerResult): Capture {
  const config = createDefaultOverlaysConfig().widgets.sideProximity
  return {
    name,
    label: `Side Proximity · ${visibility.phase}`,
    html: visibility.visible
      ? renderToStaticMarkup(createElement(SideProximityWidget, { snapshot, config, visibility }))
      : '',
    width: config.position.width,
    height: config.position.height
  }
}

export function render(): Capture[] {
  const captures: Capture[] = []

  const pace = new OverlayTriggerController()
  const paceTrigger = semanticOverlayTrigger('paceFlags')
  const paceActive = base({
    paceFlags: ['freePass'],
    drivers: [{
      carIdx: 63, name: 'Pace Car', carNumber: 'PC', position: 0, classPosition: 0,
      classId: 0, isPlayer: false, isPaceCar: true, inPits: false
    }]
  })
  const paceClear = base({
    paceFlags: [],
    drivers: [{ ...paceActive.drivers![0], inPits: true }]
  })
  captures.push(moduleCapture('release-a-pace-active', 'telemetry-paceFlags-competition', paceActive, pace.evaluate('pace', paceTrigger, paceActive, 0)))
  captures.push(moduleCapture('release-a-pace-held-clear', 'telemetry-paceFlags-competition', paceClear, pace.evaluate('pace', paceTrigger, paceClear, 100)))
  captures.push(moduleCapture('release-a-pace-inactive', 'telemetry-paceFlags-competition', paceClear, pace.evaluate('pace', paceTrigger, paceClear, 5100)))

  const drs = new OverlayTriggerController()
  const drsTrigger = semanticOverlayTrigger('drs')
  const drsActive = base({ drsState: 3, drs: true })
  const drsOff = base({ drsState: 0, drs: false })
  captures.push(moduleCapture('release-a-drs-active', 'telemetry-drs-competition', drsActive, drs.evaluate('drs', drsTrigger, drsActive, 0)))
  captures.push(moduleCapture('release-a-drs-held-deactivated', 'telemetry-drs-competition', drsOff, drs.evaluate('drs', drsTrigger, drsOff, 100)))
  captures.push(moduleCapture('release-a-drs-inactive', 'telemetry-drs-competition', drsOff, drs.evaluate('drs', drsTrigger, drsOff, 5100)))

  const service = new OverlayTriggerController()
  const serviceTrigger = semanticOverlayTrigger('pitServiceStatus')
  const servicing = base({
    onPitRoad: true,
    pit: { repairNeeded: true, optRepairNeeded: false, pitsOpen: false, inPitStall: true, svStatus: 1 }
  })
  const serviceDone = base({
    onPitRoad: false,
    pit: { repairNeeded: false, optRepairNeeded: false, pitsOpen: false, inPitStall: false, svStatus: 2 }
  })
  captures.push(moduleCapture('release-a-pit-service-active', 'telemetry-pitServiceStatus-competition', servicing, service.evaluate('service', serviceTrigger, servicing, 0)))
  captures.push(moduleCapture('release-a-pit-service-held-done', 'telemetry-pitServiceStatus-competition', serviceDone, service.evaluate('service', serviceTrigger, serviceDone, 100)))
  captures.push(moduleCapture('release-a-pit-service-inactive', 'telemetry-pitServiceStatus-competition', serviceDone, service.evaluate('service', serviceTrigger, serviceDone, 4100)))

  const side = new OverlayTriggerController()
  const sideTrigger = semanticOverlayTrigger('sideProximity')
  const sideActive = base({ carLeftRight: 'both', carLeftRightCount: 1 })
  const sideClear = base({ carLeftRight: 'clear' })
  captures.push(sideCapture('release-a-side-proximity-active', sideActive, side.evaluate('side', sideTrigger, sideActive, 0)))
  captures.push(sideCapture('release-a-side-proximity-inactive', sideClear, side.evaluate('side', sideTrigger, sideClear, 100)))

  const alert = new OverlayTriggerController()
  const alertTrigger = semanticOverlayTrigger('alert2WaterTempCritical')
  const alertActive = base({ waterTempC: 112 })
  const alertClear = base({ waterTempC: 95 })
  captures.push(moduleCapture('release-a-alerts2-active', 'alert2WaterTempCritical', alertActive, alert.evaluate('alert', alertTrigger, alertActive, 0)))
  captures.push(moduleCapture('release-a-alerts2-inactive', 'alert2WaterTempCritical', alertClear, alert.evaluate('alert', alertTrigger, alertClear, 100)))

  return captures
}
