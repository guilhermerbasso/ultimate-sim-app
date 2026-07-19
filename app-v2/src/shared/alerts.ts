export type AlertType =
  // Legacy types (must keep working).
  | 'pitLimiter'
  | 'flag'
  | 'lowFuel'
  | 'shiftPoint'
  | 'incidentLimit'
  // New telemetry-derived types.
  | 'tyrePressure'
  | 'tyreTemp'
  | 'brakeTemp'
  | 'drsAvailable'
  | 'blueFlag'

export type AlertSeverity = 'info' | 'warning' | 'critical'

export const ALERT_SEVERITY_PRIORITY: Readonly<
  Record<AlertSeverity, number>
> = {
  info: 0,
  warning: 1,
  critical: 2
}

export function maxAlertSeverity(
  ...severities: Array<AlertSeverity | null | undefined>
): AlertSeverity {
  let resolved: AlertSeverity = 'info'
  for (const severity of severities) {
    if (
      severity &&
      ALERT_SEVERITY_PRIORITY[severity] >
        ALERT_SEVERITY_PRIORITY[resolved]
    ) {
      resolved = severity
    }
  }
  return resolved
}

export interface AlertEvent {
  id: string
  type: AlertType
  message: string
  severity: AlertSeverity
  timestamp: number
  sound?: AlertSoundPayload
  // Optional contextual data — present for new alert types that benefit from
  // showing exact readings in the feed and in serial/secondScreen templates.
  context?: AlertEventContext
}

export interface AlertSoundPayload {
  toneHz?: number
  durationMs?: number
  volume?: number
}

export interface AlertEventContext {
  // Identifies the corner (lf/rf/lr/rr) for tyre/brake alerts.
  corner?: 'lf' | 'rf' | 'lr' | 'rr'
  // Raw measurement that triggered the alert (kPa, °C, laps, etc.).
  value?: number
  // Threshold that was crossed (lower or upper bound).
  threshold?: number
  // Free-form unit string, useful for serial templates.
  unit?: string
  // Semantic qualifiers used by accessibility localization. These are bounded
  // enums/raw values, never pre-localized prose.
  flag?: 'blue' | 'yellow' | 'black' | 'meatball'
  direction?: 'low' | 'high'
  remaining?: number
  count?: number
  limit?: number
}

// ─── Output actions (NEW) ────────────────────────────────────────────────────
//
// Each rule may attach OPTIONAL outputs. When the rule fires, the alerts
// module dispatches every enabled output. Existing rules without `outputs`
// behave exactly as before (feed + beep).

export type AlertOutputButtonboxPreset =
  | 'startLedFlash'
  | 'revLightsPulse'
  | 'shiftBlink'
  | 'oledMessage'
  | 'bigNum'

export interface AlertOutputButtonbox {
  kind: 'buttonbox'
  enabled?: boolean
  preset: AlertOutputButtonboxPreset
  // Total duration of the transient effect in milliseconds (LED off / OLED
  // cleared after this delay). Ignored for `bigNum` (sticky until next push).
  durationMs?: number
  // Rev-lights level for `revLightsPulse` (0..4). Defaults to 4.
  revLevel?: number
  // OLED message lines (only for `oledMessage`). Each ≤ 16 chars. The runtime
  // expands `${message}`, `${severity}`, `${type}`, `${corner}`, `${value}`.
  oledLine1?: string
  oledLine2?: string
  oledLine3?: string
  // BigNum payload (only for `bigNum`). Same template expansion.
  bigNumValue?: string
}

export interface AlertOutputSerial {
  kind: 'serial'
  enabled?: boolean
  // Hub device id. Omit (or `'primary'`) to target the primary (SIM-X).
  deviceId?: string
  // Template string with `${value}` / `${field}` / `${message}` / `${severity}`
  // / `${type}` / `${corner}` / `${threshold}` / `${unit}` placeholders. The
  // template is rendered with the shared `interpolateTemplate` helper (no JS
  // eval) and sent via `SerialDevice.sendRaw`. No newline needed — the device
  // helper appends it.
  template: string
}

export interface AlertOutputSecondScreen {
  kind: 'secondScreen'
  enabled?: boolean
  // Named slot consumed by the second screen renderer. The payload follows
  // the existing `OutputSecondScreenUpdate` shape so consumers built for the
  // expression-engine routes work unchanged.
  slot: string
  // Optional template for `value`. Defaults to the alert message.
  template?: string
}

export interface AlertOutputSound {
  kind: 'sound'
  enabled?: boolean
  // Override the severity-based beep. All optional.
  toneHz?: number
  durationMs?: number
  volume?: number // 0..1
}

export type AlertOutput =
  | AlertOutputButtonbox
  | AlertOutputSerial
  | AlertOutputSecondScreen
  | AlertOutputSound

// ─── Rule shape ──────────────────────────────────────────────────────────────

// All new fields are OPTIONAL so older persisted configs and the RaceProfile
// round-trip in `RaceProfilesView` keep working without any edits there.
export interface AlertRuleConfig {
  enabled: boolean
  severity?: AlertSeverity
  // Minimum ms between two firings of this rule (>= 0). Falls back to a
  // per-type default in the detector.
  cooldownMs?: number
  // While the condition stays true, optionally re-fire every `repeatMs`. Set
  // to 0 / undefined to disable repeats (default).
  repeatMs?: number
  outputs?: AlertOutput[]
}

export interface BrakePressureLowAlertPolicy {
  brakeInputMin: number
  maxLinePressureBar: number
}

export interface AlertsConfig {
  audioEnabled: boolean
  pitLimiter: AlertRuleConfig
  flags: AlertRuleConfig
  lowFuel: AlertRuleConfig & {
    lapsThreshold: number
  }
  shiftPoint: AlertRuleConfig & {
    shiftIndicatorPct: number
    rpmPct: number
  }
  incidentLimit: AlertRuleConfig & {
    remainingThreshold: number
  }
  // ─── Optional NEW rules. Older configs (and the RaceProfile round-trip)
  // simply omit them — the detector applies defaults at load time.
  tyrePressure?: AlertRuleConfig & {
    minKpa?: number
    maxKpa?: number
  }
  tyreTemp?: AlertRuleConfig & {
    maxC?: number
  }
  brakeTemp?: AlertRuleConfig & {
    maxC?: number
  }
  brakePressureLow?: BrakePressureLowAlertPolicy
  drsAvailable?: AlertRuleConfig
  blueFlag?: AlertRuleConfig
}

export type AlertsConfigPatch = Partial<{
  audioEnabled: boolean
  pitLimiter: Partial<AlertRuleConfig>
  flags: Partial<AlertRuleConfig>
  lowFuel: Partial<AlertsConfig['lowFuel']>
  shiftPoint: Partial<AlertsConfig['shiftPoint']>
  incidentLimit: Partial<AlertsConfig['incidentLimit']>
  tyrePressure: Partial<NonNullable<AlertsConfig['tyrePressure']>>
  tyreTemp: Partial<NonNullable<AlertsConfig['tyreTemp']>>
  brakeTemp: Partial<NonNullable<AlertsConfig['brakeTemp']>>
  brakePressureLow: Partial<NonNullable<AlertsConfig['brakePressureLow']>>
  drsAvailable: Partial<AlertRuleConfig>
  blueFlag: Partial<AlertRuleConfig>
}>

export const DEFAULT_ALERTS_CONFIG: AlertsConfig = {
  audioEnabled: true,
  pitLimiter: { enabled: true },
  flags: { enabled: true },
  lowFuel: { enabled: true, lapsThreshold: 3 },
  shiftPoint: { enabled: true, shiftIndicatorPct: 0.92, rpmPct: 0.96 },
  incidentLimit: { enabled: true, remainingThreshold: 3 },
  tyrePressure: { enabled: false, minKpa: 150, maxKpa: 230 },
  tyreTemp: { enabled: false, maxC: 110 },
  brakeTemp: { enabled: false, maxC: 700 },
  // Compatibility defaults for the brake-pressure overlay. They are user policy,
  // not universal motorsport limits.
  brakePressureLow: { brakeInputMin: 0.35, maxLinePressureBar: 25 },
  drsAvailable: { enabled: false },
  blueFlag: { enabled: false }
}

// Per-type defaults used by the detector when a rule doesn't set its own.
export const ALERT_TYPE_DEFAULTS: Record<
  AlertType,
  { severity: AlertSeverity; cooldownMs: number }
> = {
  pitLimiter: { severity: 'info', cooldownMs: 1500 },
  flag: { severity: 'warning', cooldownMs: 1500 },
  lowFuel: { severity: 'critical', cooldownMs: 5000 },
  shiftPoint: { severity: 'info', cooldownMs: 1500 },
  incidentLimit: { severity: 'warning', cooldownMs: 2000 },
  tyrePressure: { severity: 'warning', cooldownMs: 4000 },
  tyreTemp: { severity: 'warning', cooldownMs: 4000 },
  brakeTemp: { severity: 'warning', cooldownMs: 4000 },
  drsAvailable: { severity: 'info', cooldownMs: 1500 },
  blueFlag: { severity: 'warning', cooldownMs: 2000 }
}
