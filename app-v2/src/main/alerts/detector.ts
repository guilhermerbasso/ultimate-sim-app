import {
  ALERT_TYPE_DEFAULTS,
  type AlertEvent,
  type AlertEventContext,
  type AlertRuleConfig,
  type AlertsConfig,
  type AlertSeverity,
  type AlertType
} from '../../shared/alerts'
import { resolveShiftNow } from '../../shared/revlights'
import {
  fuelLapsRemainingOf,
  type Corners,
  type Flags,
  type TelemetrySnapshot,
  type TyreInfo
} from '../../shared/telemetry'
import { formatMeasurement, type UnitSystem } from '../../shared/units'

const FLAG_LABELS: Partial<Record<keyof Flags, string>> = {
  blue: 'Blue flag',
  yellow: 'Yellow flag',
  black: 'Black flag',
  meatball: 'Black-and-orange flag'
}

const WATCHED_FLAGS = Object.keys(FLAG_LABELS) as Array<keyof Flags>
const CORNERS = ['lf', 'rf', 'lr', 'rr'] as const

const CORNER_LABELS: Record<(typeof CORNERS)[number], string> = {
  lf: 'dianteiro esquerdo',
  rf: 'dianteiro direito',
  lr: 'traseiro esquerdo',
  rr: 'traseiro direito'
}

// Rule keys used for the per-rule firing bookkeeping (cooldown + repeat). We
// derive a sub-key per corner where relevant so independent corners can fire
// independently.
type FiringKey = string

interface DetectorState {
  pitLimiter?: boolean
  fuelLaps?: number
  shiftActive?: boolean
  incidentRemaining?: number
  incidentCount?: number
  drsAvailable?: boolean
  blueFlagActive?: boolean
  flags: Partial<Record<keyof Flags, boolean>>
  tyrePressureOut: Partial<Record<(typeof CORNERS)[number], boolean>>
  tyreTempOver: Partial<Record<(typeof CORNERS)[number], boolean>>
  brakeTempOver: Partial<Record<(typeof CORNERS)[number], boolean>>
  // Last firing timestamp per FiringKey — used for cooldown and repeat.
  lastFiredAt: Map<FiringKey, number>
  // Whether the condition for that key is currently active. Drives repeat.
  activeNow: Map<FiringKey, boolean>
}

function makeState(): DetectorState {
  return {
    flags: {},
    tyrePressureOut: {},
    tyreTempOver: {},
    brakeTempOver: {},
    lastFiredAt: new Map(),
    activeNow: new Map()
  }
}

// Read a rule from the config, tolerating new optional rules being absent
// (e.g. when an older AlertsConfig snapshot is persisted on disk).
function pickRule(config: AlertsConfig, key: keyof AlertsConfig): AlertRuleConfig | undefined {
  const candidate = config[key]
  if (candidate && typeof candidate === 'object' && 'enabled' in candidate) {
    return candidate as AlertRuleConfig
  }
  return undefined
}

export class AlertsDetector {
  private state: DetectorState = makeState()

  constructor(private config: AlertsConfig, private unitSystem: UnitSystem = 'metric') {}

  setConfig(config: AlertsConfig): void {
    this.config = config
  }

  setUnitSystem(unitSystem: UnitSystem): void {
    this.unitSystem = unitSystem
  }

  reset(): void {
    this.state = makeState()
  }

  process(snapshot: TelemetrySnapshot | null): AlertEvent[] {
    if (!snapshot?.connected) {
      this.reset()
      return []
    }

    const events: AlertEvent[] = []
    this.detectPitLimiter(snapshot, events)
    this.detectFlags(snapshot, events)
    this.detectLowFuel(snapshot, events)
    this.detectShiftPoint(snapshot, events)
    this.detectIncidentLimit(snapshot, events)
    this.detectTyrePressure(snapshot, events)
    this.detectTyreTemp(snapshot, events)
    this.detectBrakeTemp(snapshot, events)
    this.detectDrs(snapshot, events)
    this.detectBlueFlag(snapshot, events)

    this.applyRepeats(snapshot, events)
    return events
  }

  // ─── Detection helpers ────────────────────────────────────────────────────

  private detectPitLimiter(snapshot: TelemetrySnapshot, events: AlertEvent[]): void {
    const rule = this.config.pitLimiter
    const active = snapshot.pitLimiter === true
    const key = 'pitLimiter'
    this.state.activeNow.set(key, rule.enabled && active)
    if (rule.enabled && active && this.state.pitLimiter !== true) {
      this.fire(rule, 'pitLimiter', 'Pit limiter ligado', key, snapshot.timestamp, events)
    }
    this.state.pitLimiter = active
  }

  private detectFlags(snapshot: TelemetrySnapshot, events: AlertEvent[]): void {
    const rule = this.config.flags
    const flags = snapshot.flags
    if (!flags) {
      this.state.flags = {}
      for (const flag of WATCHED_FLAGS) this.state.activeNow.set(`flag:${flag}`, false)
      return
    }

    for (const flag of WATCHED_FLAGS) {
      const active = flags[flag] === true
      const key = `flag:${flag}`
      this.state.activeNow.set(key, rule.enabled && active)
      if (rule.enabled && active && this.state.flags[flag] !== true) {
        const defaultSeverity: AlertSeverity =
          flag === 'black' || flag === 'meatball' ? 'critical' : 'warning'
        this.fire(
          rule,
          'flag',
          `${FLAG_LABELS[flag]} acionada`,
          key,
          snapshot.timestamp,
          events,
          defaultSeverity
        )
      }
      this.state.flags[flag] = active
    }
  }

  private detectLowFuel(snapshot: TelemetrySnapshot, events: AlertEvent[]): void {
    const rule = this.config.lowFuel
    const fuelLaps = fuelLapsRemainingOf(snapshot)
    const key = 'lowFuel'
    if (fuelLaps === undefined) {
      this.state.fuelLaps = undefined
      this.state.activeNow.set(key, false)
      return
    }

    const below = fuelLaps < rule.lapsThreshold
    this.state.activeNow.set(key, rule.enabled && below)
    if (
      rule.enabled &&
      below &&
      (this.state.fuelLaps === undefined || this.state.fuelLaps >= rule.lapsThreshold)
    ) {
      this.fire(
        rule,
        'lowFuel',
        `Fuel is low: ${fuelLaps.toFixed(1)} laps remaining`,
        key,
        snapshot.timestamp,
        events,
        'critical',
        { value: fuelLaps, threshold: rule.lapsThreshold, unit: 'laps' }
      )
    }
    this.state.fuelLaps = fuelLaps
  }

  private detectShiftPoint(snapshot: TelemetrySnapshot, events: AlertEvent[]): void {
    const rule = this.config.shiftPoint
    const shiftPct = snapshot.shiftIndicatorPct ?? 0
    const rpmPct = snapshot.maxRpm && snapshot.maxRpm > 0 ? snapshot.rpm / snapshot.maxRpm : 0
    const active = resolveShiftNow(
      snapshot.revLights?.blink,
      shiftPct >= rule.shiftIndicatorPct || rpmPct >= rule.rpmPct
    )
    const key = 'shiftPoint'
    this.state.activeNow.set(key, rule.enabled && active)
    if (rule.enabled && active && this.state.shiftActive !== true) {
      this.fire(rule, 'shiftPoint', 'Ponto de troca', key, snapshot.timestamp, events)
    }
    this.state.shiftActive = active
  }

  private detectIncidentLimit(snapshot: TelemetrySnapshot, events: AlertEvent[]): void {
    const rule = this.config.incidentLimit
    const key = 'incidentLimit'
    if (snapshot.incidentCount === undefined || snapshot.incidentLimit === undefined) {
      this.state.incidentRemaining = undefined
      this.state.incidentCount = undefined
      this.state.activeNow.set(key, false)
      return
    }

    const remaining = snapshot.incidentLimit - snapshot.incidentCount
    const within = remaining <= rule.remainingThreshold
    const crossedThreshold =
      this.state.incidentRemaining === undefined || this.state.incidentRemaining > rule.remainingThreshold
    const countChanged = this.state.incidentCount !== undefined && snapshot.incidentCount > this.state.incidentCount

    this.state.activeNow.set(key, rule.enabled && within)
    if (rule.enabled && within && (crossedThreshold || countChanged)) {
      const severity: AlertSeverity = remaining <= 1 ? 'critical' : 'warning'
      this.fire(
        rule,
        'incidentLimit',
        `Incidentes perto do limite: ${snapshot.incidentCount}/${snapshot.incidentLimit}x`,
        key,
        snapshot.timestamp,
        events,
        severity,
        { value: snapshot.incidentCount, threshold: snapshot.incidentLimit, unit: 'incidents' }
      )
    }

    this.state.incidentRemaining = remaining
    this.state.incidentCount = snapshot.incidentCount
  }

  private detectTyrePressure(snapshot: TelemetrySnapshot, events: AlertEvent[]): void {
    const rule = pickRule(this.config, 'tyrePressure') as AlertsConfig['tyrePressure'] | undefined
    if (!rule) return
    const tyres = snapshot.tyres
    if (!tyres) {
      this.state.tyrePressureOut = {}
      for (const corner of CORNERS) this.state.activeNow.set(`tyrePressure:${corner}`, false)
      return
    }

    const minKpa = rule.minKpa ?? 0
    const maxKpa = rule.maxKpa ?? Number.POSITIVE_INFINITY
    for (const corner of CORNERS) {
      const info: TyreInfo | undefined = tyres[corner]
      const pressure = info?.pressureKpa
      const out = pressure !== undefined && (pressure < minKpa || pressure > maxKpa)
      const key = `tyrePressure:${corner}`
      this.state.activeNow.set(key, rule.enabled && out)
      if (rule.enabled && out && this.state.tyrePressureOut[corner] !== true) {
        const direction = pressure < minKpa ? 'baixa' : 'high'
        const threshold = pressure < minKpa ? minKpa : maxKpa
        this.fire(
          rule,
          'tyrePressure',
          `Pressure ${direction} on ${CORNER_LABELS[corner]}: ${formatMeasurement(pressure, 'pressure-kpa', this.unitSystem, { decimals: this.unitSystem === 'imperial' ? 1 : 0, includeUnit: true }).display}`,
          key,
          snapshot.timestamp,
          events,
          undefined,
          { corner, value: pressure, threshold, unit: 'kPa' }
        )
      }
      this.state.tyrePressureOut[corner] = out
    }
  }

  private detectTyreTemp(snapshot: TelemetrySnapshot, events: AlertEvent[]): void {
    const rule = pickRule(this.config, 'tyreTemp') as AlertsConfig['tyreTemp'] | undefined
    if (!rule) return
    const tyres = snapshot.tyres
    if (!tyres) {
      this.state.tyreTempOver = {}
      for (const corner of CORNERS) this.state.activeNow.set(`tyreTemp:${corner}`, false)
      return
    }

    const maxC = rule.maxC ?? Number.POSITIVE_INFINITY
    this.detectCornerOver(
      rule,
      'tyreTemp',
      tyres,
      (info) => info?.tempC,
      maxC,
      this.state.tyreTempOver,
      (corner, value) =>
        `Hot tire on ${CORNER_LABELS[corner]}: ${formatMeasurement(value, 'temperature-c', this.unitSystem, { decimals: 0, includeUnit: true }).display}`,
      snapshot.timestamp,
      events
    )
  }

  private detectBrakeTemp(snapshot: TelemetrySnapshot, events: AlertEvent[]): void {
    const rule = pickRule(this.config, 'brakeTemp') as AlertsConfig['brakeTemp'] | undefined
    if (!rule) return
    const brakes = snapshot.brakeTempC
    if (!brakes) {
      this.state.brakeTempOver = {}
      for (const corner of CORNERS) this.state.activeNow.set(`brakeTemp:${corner}`, false)
      return
    }

    const maxC = rule.maxC ?? Number.POSITIVE_INFINITY
    this.detectCornerOver(
      rule,
      'brakeTemp',
      brakes,
      (value) => value,
      maxC,
      this.state.brakeTempOver,
      (corner, value) =>
        `Hot brake on ${CORNER_LABELS[corner]}: ${formatMeasurement(value, 'temperature-c', this.unitSystem, { decimals: 0, includeUnit: true }).display}`,
      snapshot.timestamp,
      events
    )
  }

  private detectCornerOver<T>(
    rule: AlertRuleConfig,
    type: AlertType,
    source: Corners<T>,
    pick: (value: T) => number | undefined,
    maxC: number,
    cache: Partial<Record<(typeof CORNERS)[number], boolean>>,
    formatMessage: (corner: (typeof CORNERS)[number], value: number) => string,
    timestamp: number,
    events: AlertEvent[]
  ): void {
    for (const corner of CORNERS) {
      const value = pick(source[corner])
      const over = value !== undefined && value > maxC
      const key = `${type}:${corner}`
      this.state.activeNow.set(key, rule.enabled && over)
      if (rule.enabled && over && cache[corner] !== true) {
        this.fire(rule, type, formatMessage(corner, value as number), key, timestamp, events, undefined, {
          corner,
          value,
          threshold: maxC,
          unit: '°C'
        })
      }
      cache[corner] = over
    }
  }

  private detectDrs(snapshot: TelemetrySnapshot, events: AlertEvent[]): void {
    const rule = pickRule(this.config, 'drsAvailable')
    if (!rule) return
    const active = snapshot.drs === true
    const key = 'drsAvailable'
    this.state.activeNow.set(key, rule.enabled && active)
    if (rule.enabled && active && this.state.drsAvailable !== true) {
      this.fire(rule, 'drsAvailable', 'DRS available', key, snapshot.timestamp, events)
    }
    this.state.drsAvailable = active
  }

  private detectBlueFlag(snapshot: TelemetrySnapshot, events: AlertEvent[]): void {
    const rule = pickRule(this.config, 'blueFlag')
    if (!rule) return
    const active = snapshot.flags?.blue === true
    const key = 'blueFlag'
    this.state.activeNow.set(key, rule.enabled && active)
    // Use a DEDICATED rising-edge tracker — NOT `state.flags.blue`, which
    // detectFlags() (run earlier in process()) already overwrote this tick, so
    // reading it here would make the guard permanently false.
    if (rule.enabled && active && this.state.blueFlagActive !== true) {
      this.fire(rule, 'blueFlag', 'Faster car approaching (blue flag)', key, snapshot.timestamp, events)
    }
    this.state.blueFlagActive = active
  }

  // ─── Repeat & firing infrastructure ───────────────────────────────────────

  private applyRepeats(snapshot: TelemetrySnapshot, events: AlertEvent[]): void {
    const now = snapshot.timestamp
    for (const [key, active] of this.state.activeNow.entries()) {
      if (!active) continue
      const lastAt = this.state.lastFiredAt.get(key)
      if (lastAt === undefined) continue
      const ruleInfo = this.lookupRuleByKey(key)
      if (!ruleInfo) continue
      const repeatMs = ruleInfo.rule.repeatMs
      if (!repeatMs || repeatMs <= 0) continue
      if (now - lastAt < repeatMs) continue
      this.fire(
        ruleInfo.rule,
        ruleInfo.type,
        ruleInfo.repeatMessage ?? ruleInfo.lastMessage ?? `Alert ${ruleInfo.type} still active`,
        key,
        now,
        events,
        undefined,
        ruleInfo.lastContext,
        true
      )
    }
  }

  // Cache of last firing metadata per key — used by applyRepeats so a repeat
  // shows the same message/context as the original event.
  private lastByKey = new Map<
    string,
    { rule: AlertRuleConfig; type: AlertType; lastMessage: string; lastContext?: AlertEventContext; repeatMessage?: string }
  >()

  private lookupRuleByKey(
    key: string
  ): { rule: AlertRuleConfig; type: AlertType; lastMessage?: string; lastContext?: AlertEventContext; repeatMessage?: string } | undefined {
    return this.lastByKey.get(key)
  }

  private fire(
    rule: AlertRuleConfig,
    type: AlertType,
    message: string,
    key: FiringKey,
    timestamp: number,
    events: AlertEvent[],
    defaultSeverity?: AlertSeverity,
    context?: AlertEventContext,
    isRepeat = false
  ): void {
    const defaults = ALERT_TYPE_DEFAULTS[type]
    const cooldownMs = rule.cooldownMs ?? defaults.cooldownMs
    const lastAt = this.state.lastFiredAt.get(key)
    if (lastAt !== undefined && timestamp - lastAt < cooldownMs) return

    const severity = rule.severity ?? defaultSeverity ?? defaults.severity
    const event: AlertEvent = {
      id: `${timestamp}-${type}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      message,
      severity,
      timestamp,
      context
    }
    events.push(event)
    this.state.lastFiredAt.set(key, timestamp)
    if (!isRepeat) {
      this.lastByKey.set(key, { rule, type, lastMessage: message, lastContext: context })
    } else {
      const cached = this.lastByKey.get(key)
      if (cached) this.lastByKey.set(key, { ...cached, lastMessage: message, lastContext: context })
    }
  }
}
