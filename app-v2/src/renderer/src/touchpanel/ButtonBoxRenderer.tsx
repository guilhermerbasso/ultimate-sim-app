import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement
} from 'react'
import type { ExpressionValue } from '../../../shared/expr'
import {
  CONTROL_REPEAT_DEFAULT_DELAY_MS,
  CONTROL_REPEAT_DEFAULT_INTERVAL_MS,
  primaryButtonAction,
  type ButtonAction,
  type ButtonBoxButton,
  type ButtonBoxPanel,
  type TouchActionPhase,
  type TouchControlStateDefaults,
  type TouchRepeatConfig
} from '../../../shared/touch-panel'
import { materialClass } from './keyMaterials'
import { KeyFace } from './KeyFace'

export interface TouchControlActionEvent {
  button: ButtonBoxButton
  index: number
  zone: string
  action: ButtonAction
  phase: TouchActionPhase
  token: string
}

export interface TouchActionResult {
  ok: boolean
  message?: string
}

export interface TouchRuntimeFeedback extends TouchActionResult {
  controlId: string
  pending?: boolean
}

export interface ButtonBoxRendererProps {
  panel: ButtonBoxPanel
  /** Runtime action adapter. The renderer owns pointer lifecycle, not IPC. */
  onAction?: (event: TouchControlActionEvent) => void | TouchActionResult | Promise<void | TouchActionResult>
  /** Editor mode: selecting a control replaces all runtime hit zones. */
  onSelect?: (button: ButtonBoxButton, index: number) => void
  onFeedback?: (feedback: TouchRuntimeFeedback) => void
  selectedId?: string | null
  /** False keeps semantic markup visible but disables every action hit target. */
  interactive?: boolean
  /** Existing expression-engine values keyed by ExpressionDef.id. No store is duplicated here. */
  expressionValues?: Readonly<Record<string, ExpressionValue | undefined>>
}

interface ResolvedState {
  active: boolean
  pressed: boolean
  disabled: boolean
  warning: boolean
  value: ExpressionValue | undefined
}

function expressionBoolean(value: ExpressionValue | undefined): boolean {
  if (value === null || value === undefined || value === false || value === 0 || value === '') return false
  if (typeof value === 'string' && ['false', 'off', 'no', 'disabled'].includes(value.trim().toLowerCase())) return false
  return true
}

function resolveState(
  button: ButtonBoxButton,
  expressionValues: Readonly<Record<string, ExpressionValue | undefined>> | undefined
): ResolvedState {
  const defaults: TouchControlStateDefaults = button.state ?? {}
  const result: ResolvedState = {
    active: Boolean(defaults.active),
    pressed: Boolean(defaults.pressed),
    disabled: Boolean(defaults.disabled),
    warning: Boolean(defaults.warning),
    value: defaults.value
  }
  if (!expressionValues || !button.stateBindings) return result
  for (const destination of ['active', 'pressed', 'disabled', 'warning', 'value'] as const) {
    const binding = button.stateBindings[destination]
    if (!binding || !Object.prototype.hasOwnProperty.call(expressionValues, binding.expressionId)) continue
    const value = expressionValues[binding.expressionId]
    if (destination === 'value') result.value = value
    else result[destination] = expressionBoolean(value)
  }
  return result
}

function buttonStyle(button: ButtonBoxButton): CSSProperties {
  const special =
    button.material === 'rgb'
      ? rgbButtonStyle(button)
      : button.material === 'selector'
        ? selectorButtonStyle(button)
        : button.material === 'led_ring'
          ? ledRingButtonStyle(button)
          : {}
  return {
    color: button.textColor,
    borderColor: button.borderColor,
    borderWidth: `${button.borderWidth}px`,
    ['--bb-body' as string]: button.bodyColor,
    ['--bb-border' as string]: button.borderColor,
    ['--bb-glow' as string]: button.borderColor,
    ['--bb-active-bg' as string]: button.activeColor ?? button.bodyColor,
    ['--bb-active-fg' as string]: button.activeTextColor ?? button.textColor,
    ['--bb-pressed-bg' as string]: button.pressedColor ?? button.activeColor ?? button.bodyColor,
    ['--bb-pressed-fg' as string]: button.pressedTextColor ?? button.activeTextColor ?? button.textColor,
    ['--bb-disabled-bg' as string]: button.disabledColor ?? '#252b34',
    ['--bb-disabled-fg' as string]: button.disabledTextColor ?? '#9ca3af',
    ['--bb-warning-bg' as string]: button.warningColor ?? '#7f1d1d',
    ['--bb-warning-fg' as string]: button.warningTextColor ?? '#ffffff',
    ...special
  }
}

function rgbButtonStyle(button: ButtonBoxButton): CSSProperties {
  return {
    background:
      'radial-gradient(circle at 50% 42%, rgba(255,255,255,0.18) 0 8%, #151a21 32%, #06080c 64%, #030407 100%)',
    boxShadow: [
      `0 0 0 3px ${button.borderColor}`,
      '0 0 22px rgba(34, 211, 238, 0.35)',
      `0 0 30px -3px ${button.borderColor}`,
      'inset 0 2px 7px rgba(255,255,255,0.22)',
      'inset 0 -16px 24px rgba(0,0,0,0.72)'
    ].join(', ')
  }
}

function selectorButtonStyle(button: ButtonBoxButton): CSSProperties {
  return {
    background: `linear-gradient(180deg, rgba(255,255,255,0.06), rgba(0,0,0,0.44)), radial-gradient(circle at 50% 42%, ${button.bodyColor} 0%, #090c11 62%)`,
    boxShadow: [
      `0 0 22px -3px ${button.borderColor}`,
      `inset 0 0 0 1px ${button.borderColor}`,
      'inset 0 -16px 22px rgba(0,0,0,0.62)'
    ].join(', ')
  }
}

function ledRingButtonStyle(button: ButtonBoxButton): CSSProperties {
  return {
    background: `radial-gradient(circle at 50% 45%, ${button.activeColor ?? button.borderColor} 0 22%, ${button.bodyColor} 38%, #090c11 64%, #030407 100%)`,
    boxShadow: [
      `0 0 0 2px ${button.borderColor}`,
      `0 0 24px -2px ${button.borderColor}`,
      `inset 0 0 0 6px color-mix(in srgb, ${button.borderColor} 72%, transparent)`,
      'inset 0 3px 8px rgba(255,255,255,0.28)',
      'inset 0 -18px 28px rgba(0,0,0,0.62)'
    ].join(', ')
  }
}

function SelectorChrome({ color }: { color: string }): ReactElement {
  return (
    <>
      <span className="bb-selector-track" aria-hidden="true" />
      <span className="bb-selector-minus" aria-hidden="true" style={{ color }}>‹</span>
      <span className="bb-selector-plus" aria-hidden="true" style={{ color }}>›</span>
    </>
  )
}

function RgbHalo(): ReactElement {
  return <span className="bb-rgb-halo" aria-hidden="true" />
}

function RockerChrome({ color }: { color: string }): ReactElement {
  return (
    <>
      <span className="bb-rocker-split" aria-hidden="true" />
      <span className="bb-rocker-minus" aria-hidden="true" style={{ color }}>−</span>
      <span className="bb-rocker-plus" aria-hidden="true" style={{ color }}>+</span>
    </>
  )
}

function LedRingChrome({ color }: { color: string }): ReactElement {
  return <span className="bb-led-ring" aria-hidden="true" style={{ borderColor: color }} />
}

function stateText(state: ResolvedState, armed: boolean): string | null {
  if (state.disabled) return 'DISABLED'
  if (state.warning) return '⚠ WARN'
  if (armed) return 'GUARD OPEN'
  if (state.active) return '● ACTIVE'
  return null
}

function stateLabel(state: ResolvedState): string {
  const parts: string[] = []
  if (state.disabled) parts.push('disabled')
  if (state.warning) parts.push('warning')
  if (state.active) parts.push('active')
  if (state.value !== undefined && state.value !== null && state.value !== '') parts.push(`value ${String(state.value)}`)
  return parts.length > 0 ? parts.join(', ') : 'inactive'
}

function repeatFor(action: ButtonAction, configured?: TouchRepeatConfig): TouchRepeatConfig | undefined {
  if (configured) return configured
  if (action.kind !== 'keyboard' || action.command.mode !== 'repeat') return undefined
  return {
    delayMs: CONTROL_REPEAT_DEFAULT_DELAY_MS,
    intervalMs: action.command.repeatMs ?? CONTROL_REPEAT_DEFAULT_INTERVAL_MS
  }
}

interface HitHandlers {
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void
  onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
  onKeyUp: (event: KeyboardEvent<HTMLButtonElement>) => void
}

function isActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' '
}

export function ButtonBoxKey({
  button,
  index,
  selected,
  interactive,
  expressionValues,
  onAction,
  onFeedback,
  onSelect
}: {
  button: ButtonBoxButton
  index: number
  selected: boolean
  interactive: boolean
  expressionValues?: Readonly<Record<string, ExpressionValue | undefined>>
  onAction?: ButtonBoxRendererProps['onAction']
  onFeedback?: ButtonBoxRendererProps['onFeedback']
  onSelect?: ButtonBoxRendererProps['onSelect']
}): ReactElement {
  const external = resolveState(button, expressionValues)
  const [localActive, setLocalActive] = useState(external.active)
  const [localPressed, setLocalPressed] = useState(false)
  const [pressedZone, setPressedZone] = useState<string | null>(null)
  const [guardArmed, setGuardArmed] = useState(false)
  const [selectorChoiceId, setSelectorChoiceId] = useState(
    button.control.kind === 'selector' ? button.control.initialChoiceId : ''
  )
  const [feedback, setFeedback] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')
  const repeatDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const repeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const guardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activePressRef = useRef<{ action: ButtonAction; zone: string } | null>(null)
  const activePointerIdRef = useRef<number | null>(null)
  const activeLatchingKeyboardRef = useRef<{ action: ButtonAction; token: string } | null>(null)
  const keyboardActiveRef = useRef(false)
  const controlSignature = JSON.stringify(button.control)
  const previousControlSignatureRef = useRef(controlSignature)
  const state = {
    ...external,
    active: button.stateBindings?.active ? external.active : localActive,
    pressed: external.pressed || localPressed
  }
  const disabled = !interactive || state.disabled

  useEffect(() => {
    if (button.stateBindings?.active) setLocalActive(external.active)
  }, [button.stateBindings?.active, external.active])

  useEffect(
    () => () => {
      if (repeatDelayRef.current) clearTimeout(repeatDelayRef.current)
      if (repeatIntervalRef.current) clearInterval(repeatIntervalRef.current)
      if (guardTimerRef.current) clearTimeout(guardTimerRef.current)
      activePointerIdRef.current = null
      const active = activePressRef.current
      if (active?.action.kind === 'keyboard' && active.action.command.mode === 'hold' && onAction) {
        void Promise.resolve(
          onAction({
            button,
            index,
            zone: active.zone,
            action: active.action,
            phase: 'cancel',
            token: `${button.id}:${active.zone}`
          })
        ).catch(() => undefined)
      }
      const latching = activeLatchingKeyboardRef.current
      if (latching && onAction) {
        activeLatchingKeyboardRef.current = null
        void Promise.resolve(
          onAction({
            button,
            index,
            zone: 'teardown',
            action: latching.action,
            phase: 'cancel',
            token: latching.token
          })
        ).catch(() => undefined)
      }
    },
    []
  )

  const clearRepeat = (): void => {
    if (repeatDelayRef.current) clearTimeout(repeatDelayRef.current)
    if (repeatIntervalRef.current) clearInterval(repeatIntervalRef.current)
    repeatDelayRef.current = null
    repeatIntervalRef.current = null
  }

  const emit = (action: ButtonAction, phase: TouchActionPhase, zone: string, tokenZone = zone): void => {
    if (action.kind === 'none' || !onAction) return
    const token = `${button.id}:${tokenZone}`
    setFeedback('pending')
    onFeedback?.({ controlId: button.id, ok: true, pending: true, message: `${button.label}: pending` })
    try {
      const response = onAction({ button, index, zone, action, phase, token })
      void Promise.resolve(response)
        .then((result) => {
          const resolved = result ?? { ok: true }
          setFeedback(resolved.ok ? 'success' : 'error')
          onFeedback?.({ controlId: button.id, ok: resolved.ok, message: resolved.message })
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Action failed.'
          setFeedback('error')
          onFeedback?.({ controlId: button.id, ok: false, message })
        })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Action failed.'
      setFeedback('error')
      onFeedback?.({ controlId: button.id, ok: false, message })
    }
  }

  const beginLifecycle = (action: ButtonAction, zone: string, configuredRepeat?: TouchRepeatConfig): void => {
    activePressRef.current = { action, zone }
    setPressedZone(zone)
    setLocalPressed(true)
    if (action.kind === 'keyboard' && action.command.mode === 'hold') {
      emit(action, 'begin', zone)
      return
    }
    emit(action, 'trigger', zone)
    const repeat = repeatFor(action, configuredRepeat)
    if (!repeat || action.kind === 'none') return
    repeatDelayRef.current = setTimeout(() => {
      emit(action, 'trigger', zone)
      repeatIntervalRef.current = setInterval(() => emit(action, 'trigger', zone), repeat.intervalMs)
    }, repeat.delayMs)
  }

  const finishLifecycle = (phase: 'end' | 'cancel'): void => {
    const active = activePressRef.current
    clearRepeat()
    activePressRef.current = null
    activePointerIdRef.current = null
    keyboardActiveRef.current = false
    setPressedZone(null)
    setLocalPressed(false)
    if (active?.action.kind === 'keyboard' && active.action.command.mode === 'hold') {
      emit(active.action, phase, active.zone)
    }
  }

  useEffect(() => {
    if (previousControlSignatureRef.current === controlSignature) return
    previousControlSignatureRef.current = controlSignature
    clearRepeat()
    if (guardTimerRef.current) clearTimeout(guardTimerRef.current)
    guardTimerRef.current = null

    const activePress = activePressRef.current
    activePressRef.current = null
    if (activePress?.action.kind === 'keyboard' && activePress.action.command.mode === 'hold') {
      emit(activePress.action, 'cancel', activePress.zone)
    }
    const activeLatch = activeLatchingKeyboardRef.current
    activeLatchingKeyboardRef.current = null
    if (activeLatch) emit(activeLatch.action, 'cancel', 'teardown', 'latching')

    activePointerIdRef.current = null
    keyboardActiveRef.current = false
    setLocalPressed(false)
    setPressedZone(null)
    setGuardArmed(false)
    setLocalActive(external.active)
  }, [controlSignature])
  const makeHandlers = (
    begin: () => void,
    finish: (phase: 'end' | 'cancel') => void = finishLifecycle
  ): HitHandlers => ({
    onPointerDown: (event) => {
      if (disabled || event.button !== 0 || keyboardActiveRef.current) return
      // One control has one physical lifecycle. Reject additional fingers rather
      // than overwriting the owner and losing the first pointer's release.
      if (activePointerIdRef.current !== null) {
        event.preventDefault()
        return
      }
      event.preventDefault()
      activePointerIdRef.current = event.pointerId
      event.currentTarget.setPointerCapture?.(event.pointerId)
      begin()
    },
    onPointerUp: (event) => {
      if (activePointerIdRef.current !== event.pointerId) return
      event.preventDefault()
      activePointerIdRef.current = null
      finish('end')
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    },
    onPointerCancel: (event) => {
      if (activePointerIdRef.current !== event.pointerId) return
      event.preventDefault()
      activePointerIdRef.current = null
      finish('cancel')
    },
    onLostPointerCapture: (event) => {
      if (activePointerIdRef.current !== event.pointerId) return
      activePointerIdRef.current = null
      finish('cancel')
    },
    onKeyDown: (event) => {
      if (
        disabled ||
        event.repeat ||
        keyboardActiveRef.current ||
        activePointerIdRef.current !== null ||
        !isActivationKey(event.key)
      ) return
      event.preventDefault()
      keyboardActiveRef.current = true
      begin()
    },
    onKeyUp: (event) => {
      if (!isActivationKey(event.key) || !keyboardActiveRef.current) return
      event.preventDefault()
      finish('end')
    }
  })

  const discreteHandlers = (activate: () => void): HitHandlers =>
    makeHandlers(
      () => {
        setLocalPressed(true)
        activate()
      },
      () => {
        keyboardActiveRef.current = false
        setLocalPressed(false)
        setPressedZone(null)
      }
    )

  const control = button.control
  const selectorChoices = control.kind === 'selector' ? control.choices : []
  const selectorIndex = Math.max(0, selectorChoices.findIndex((choice) => choice.id === selectorChoiceId))
  const selectedChoice = selectorChoices[selectorIndex]
  const displayedValue =
    state.value ??
    (control.kind === 'selector'
      ? selectedChoice?.value
      : control.kind === 'status-led' || control.kind === 'value-tile'
        ? control.value
        : undefined)
  const displayedUnit = control.kind === 'value-tile' ? control.unit : undefined
  const resolvedTextColor = state.disabled
    ? button.disabledTextColor ?? '#9ca3af'
    : state.warning
      ? button.warningTextColor ?? '#ffffff'
      : state.pressed
        ? button.pressedTextColor ?? button.activeTextColor ?? button.textColor
        : state.active
          ? button.activeTextColor ?? button.textColor
          : button.textColor
  const resolvedAccentColor = state.warning ? button.warningColor ?? '#ef4444' : button.borderColor
  const cue = stateText(state, guardArmed)
  const isDisplay = control.kind === 'status-led' || control.kind === 'value-tile'
  const isEmpty =
    !button.label &&
    !button.image &&
    !button.icon &&
    displayedValue === undefined &&
    primaryButtonAction(control).kind === 'none'
  const className = [
    'bb-btn',
    materialClass(button.material),
    `bb-shape-${button.shape}`,
    `bb-kind-${control.kind}`,
    state.pressed ? 'is-pressed' : '',
    state.active ? 'is-active' : '',
    state.disabled ? 'is-disabled' : '',
    state.warning ? 'is-warning' : '',
    guardArmed ? 'is-armed' : '',
    pressedZone ? `is-zone-${pressedZone}` : '',
    feedback === 'pending' ? 'is-pending' : '',
    feedback === 'error' ? 'is-error' : '',
    isEmpty ? 'is-empty' : '',
    selected ? 'is-selected' : ''
  ]
    .filter(Boolean)
    .join(' ')

  const commonHitProps = {
    type: 'button' as const,
    className: 'bb-hit',
    disabled,
    draggable: false
  }

  let hits: ReactElement | null = null
  if (onSelect) {
    hits = (
      <button
        {...commonHitProps}
        className="bb-hit bb-hit-full"
        aria-label={`Edit ${button.label || `control ${index + 1}`}`}
        onClick={() => onSelect(button, index)}
      />
    )
  } else if (!isDisplay) {
    switch (control.kind) {
      case 'momentary':
        hits = (
          <button
            {...commonHitProps}
            className="bb-hit bb-hit-full"
            aria-label={`${button.label || `Control ${index + 1}`}, momentary, ${stateLabel(state)}`}
            {...makeHandlers(() => beginLifecycle(control.action, 'main', control.repeat))}
          />
        )
        break
      case 'latching-toggle':
        hits = (
          <button
            {...commonHitProps}
            className="bb-hit bb-hit-full"
            aria-label={`${button.label || `Control ${index + 1}`}, latching toggle, ${stateLabel(state)}`}
            aria-pressed={state.active}
            {...discreteHandlers(() => {
              const next = !state.active
              const stableToken = `${button.id}:latching`
              setLocalActive(next)
              if (next) {
                if (control.onAction.kind === 'keyboard' && control.onAction.command.mode === 'toggle') {
                  activeLatchingKeyboardRef.current = { action: control.onAction, token: stableToken }
                }
                emit(control.onAction, 'trigger', 'on', 'latching')
                return
              }
              const activeToggle = activeLatchingKeyboardRef.current
              activeLatchingKeyboardRef.current = null
              if (control.offAction.kind === 'keyboard' && control.offAction.command.mode === 'toggle') {
                emit(control.offAction, 'trigger', 'off', 'latching')
              } else {
                if (activeToggle) emit(activeToggle.action, 'cancel', 'teardown', 'latching')
                emit(control.offAction, 'trigger', 'off')
              }
            })}
          />
        )
        break
      case 'guarded-two-step':
        hits = (
          <button
            {...commonHitProps}
            className="bb-hit bb-hit-full"
            aria-label={`${button.label || `Control ${index + 1}`}, guard ${guardArmed ? 'open; activate' : 'closed; open guard first'}`}
            aria-pressed={guardArmed}
            {...makeHandlers(
              () => {
                setLocalPressed(true)
                if (!guardArmed) {
                  setGuardArmed(true)
                  if (guardTimerRef.current) clearTimeout(guardTimerRef.current)
                  guardTimerRef.current = setTimeout(() => setGuardArmed(false), control.armTimeoutMs)
                  return
                }
                if (guardTimerRef.current) clearTimeout(guardTimerRef.current)
                setGuardArmed(false)
                beginLifecycle(control.action, 'guarded')
              },
              (phase) => {
                if (activePressRef.current) finishLifecycle(phase)
                else {
                  keyboardActiveRef.current = false
                  setLocalPressed(false)
                }
              }
            )}
          />
        )
        break
      case 'two-position-rocker':
        hits = (
          <>
            <button
              {...commonHitProps}
              className="bb-hit bb-hit-negative"
              aria-label={`${button.label || 'Rocker'}, ${control.negativeLabel}`}
              {...makeHandlers(() => beginLifecycle(control.negativeAction, 'negative', control.repeat))}
            />
            <button
              {...commonHitProps}
              className="bb-hit bb-hit-positive"
              aria-label={`${button.label || 'Rocker'}, ${control.positiveLabel}`}
              {...makeHandlers(() => beginLifecycle(control.positiveAction, 'positive', control.repeat))}
            />
          </>
        )
        break
      case 'rotary':
        hits = (
          <>
            <button
              {...commonHitProps}
              className="bb-hit bb-hit-negative"
              aria-label={`${button.label || 'Rotary'}, ${control.decrementLabel}`}
              {...makeHandlers(() => beginLifecycle(control.decrementAction, 'decrement', control.repeat))}
            />
            <button
              {...commonHitProps}
              className="bb-hit bb-hit-positive"
              aria-label={`${button.label || 'Rotary'}, ${control.incrementLabel}`}
              {...makeHandlers(() => beginLifecycle(control.incrementAction, 'increment', control.repeat))}
            />
          </>
        )
        break
      case 'selector': {
        const choose = (direction: -1 | 1): void => {
          const count = selectorChoices.length
          if (count === 0) return
          const nextIndex = (selectorIndex + direction + count) % count
          const choice = selectorChoices[nextIndex]
          setSelectorChoiceId(choice.id)
          setPressedZone(direction < 0 ? 'previous' : 'next')
          emit(choice.action, 'trigger', `choice:${choice.id}`)
        }
        hits = (
          <>
            <button
              {...commonHitProps}
              className="bb-hit bb-hit-negative"
              aria-label={`${button.label || 'Selector'}, previous choice`}
              {...discreteHandlers(() => choose(-1))}
            />
            <button
              {...commonHitProps}
              className="bb-hit bb-hit-positive"
              aria-label={`${button.label || 'Selector'}, next choice`}
              {...discreteHandlers(() => choose(1))}
            />
          </>
        )
        break
      }
    }
  }

  return (
    <div
      className={className}
      style={buttonStyle(button)}
      role={isDisplay ? 'status' : 'group'}
      aria-label={
        isDisplay
          ? `${button.label || `Display ${index + 1}`}, ${stateLabel(state)}, value ${String(displayedValue ?? '')}${displayedUnit ? ` ${displayedUnit}` : ''}`
          : control.kind === 'selector'
            ? `${button.label || `Selector ${index + 1}`}, selected ${selectedChoice?.label ?? displayedValue ?? ''}`
            : button.label || `Control ${index + 1}`
      }
      aria-disabled={state.disabled || undefined}
      aria-busy={feedback === 'pending' || undefined}
      data-control-id={button.id}
      data-control-kind={control.kind}
      data-shape={button.shape}
      data-state-active={state.active ? 'true' : 'false'}
      data-state-pressed={state.pressed ? 'true' : 'false'}
      data-state-disabled={state.disabled ? 'true' : 'false'}
      data-state-warning={state.warning ? 'true' : 'false'}
      data-feedback={feedback}
    >
      {button.material === 'selector' || control.kind === 'selector' ? <SelectorChrome color={resolvedAccentColor} /> : null}
      {button.material === 'rgb' ? <RgbHalo /> : null}
      {button.material === 'rocker' || control.kind === 'two-position-rocker' ? <RockerChrome color={resolvedAccentColor} /> : null}
      {button.material === 'led_ring' || button.shape === 'led-ring' ? <LedRingChrome color={resolvedAccentColor} /> : null}
      {button.image ? <img className="bb-btn-image" src={button.image} alt="" /> : null}
      {button.label || button.icon ? (
        <KeyFace
          label={button.label}
          icon={displayedValue !== undefined || control.kind === 'two-position-rocker' ? undefined : button.icon}
          textColor={resolvedTextColor}
          iconColor={resolvedAccentColor}
          bottomLabel={Boolean(button.image) || control.kind === 'rotary'}
          topLabel={displayedValue !== undefined || control.kind === 'two-position-rocker'}
          maxFont={button.fontSize}
        />
      ) : null}
      {displayedValue !== undefined && displayedValue !== null && displayedValue !== '' ? (
        <span className="bb-value-display" aria-hidden="true">
          {String(displayedValue)}{displayedUnit ? <small>{displayedUnit}</small> : null}
        </span>
      ) : null}
      {cue ? <span className="bb-state-cue" aria-hidden="true">{cue}</span> : null}
      {feedback === 'error' ? <span className="bb-error-cue" aria-hidden="true">!</span> : null}
      {hits}
    </div>
  )
}

export function ButtonBoxRenderer({
  panel,
  onAction,
  onSelect,
  onFeedback,
  selectedId = null,
  interactive = true,
  expressionValues
}: ButtonBoxRendererProps): ReactElement {
  const gridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${panel.columns}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${Math.max(1, panel.rows)}, minmax(0, 1fr))`,
    gridAutoRows: 'minmax(0, 1fr)',
    gap: `${panel.gap}px`,
    padding: `${panel.gap}px`,
    background: panel.background
  }
  return (
    <div className="bb-stage" style={{ background: panel.background }}>
      <div className="bb-grid" style={gridStyle} data-panel-schema={panel.schemaVersion}>
        {panel.buttons.map((button, index) => (
          <ButtonBoxKey
            key={button.id}
            button={button}
            index={index}
            selected={selectedId === button.id}
            interactive={interactive}
            expressionValues={expressionValues}
            onAction={onAction}
            onFeedback={onFeedback}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}