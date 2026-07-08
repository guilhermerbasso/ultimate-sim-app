import { BOARD_CATALOG, PINOUT_COMPONENT_LIBRARY, getBoardCatalogEntry, getRolePinDirection, pinSupportsRole, type BoardCatalogEntry, type BoardPinCapability, type PinDirection, type PinoutBoardId, type PinoutComponentDefinition, type PinoutComponentRole } from './board-catalog'

export const PINOUT_STORE_FILE = 'pinout-designs.json'
export const PINOUT_STORE_VERSION = 1

export const PINOUT_CHANNELS = {
  list: 'pinout:list',
  get: 'pinout:get',
  save: 'pinout:save',
  remove: 'pinout:remove',
  validate: 'pinout:validate',
  generateConfig: 'pinout:generateConfig',
  exportIno: 'pinout:exportIno',
  compile: 'pinout:compile',
  flash: 'pinout:flash',
  flashProgress: 'pinout:flashProgress'
} as const

// User-defined ("custom") component/board catalog. All channels live under the
// already allow-listed `pinout:` prefix so no preload change is needed.
export const PINOUT_CUSTOM_CHANNELS = {
  list: 'pinout:listCustomCatalog',
  saveComponent: 'pinout:saveCustomComponent',
  saveBoard: 'pinout:saveCustomBoard',
  remove: 'pinout:removeCustom',
  changed: 'pinout:customCatalogChanged'
} as const

export type PinoutCustomChannel = (typeof PINOUT_CUSTOM_CHANNELS)[keyof typeof PINOUT_CUSTOM_CHANNELS]

export type PinoutChannel = (typeof PINOUT_CHANNELS)[keyof typeof PINOUT_CHANNELS]
export type PinoutSeverity = 'error' | 'warning' | 'info'
export type ConnectionTarget = { kind: 'board'; pin: string } | { kind: 'mux-channel'; muxId: string; channel: number }

export interface Point { x: number; y: number }

export interface PinoutDiagramNodeLayout {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface PinoutDiagramLayout {
  nodes: Record<string, PinoutDiagramNodeLayout>
  pan?: Point
  zoom?: number
}

export interface PlacedComponent {
  id: string
  definitionId: string
  label: string
  x: number
  y: number
  settings?: Record<string, string | number | boolean>
}

export interface PlacedMux {
  id: string
  definitionId: 'cd74hc4067'
  label: string
  x: number
  y: number
  sigMode: 'digital' | 'analog'
}

export interface Connection {
  id: string
  componentId: string
  role: string
  target: ConnectionTarget
}

export interface PinoutDesign {
  id: string
  name: string
  boardId: PinoutBoardId
  components: PlacedComponent[]
  muxes: PlacedMux[]
  connections: Connection[]
  createdAt: string
  updatedAt: string
  diagramLayout?: PinoutDiagramLayout
  notes?: string
}

export interface PinoutValidationIssue {
  severity: PinoutSeverity
  code: string
  message: string
  componentId?: string
  muxId?: string
  role?: string
  pin?: string
}

export interface FreePinInfo extends BoardPinCapability {
  recommendedFor: string[]
}

export interface PinoutValidationResult {
  ok: boolean
  issues: PinoutValidationIssue[]
  freePins: FreePinInfo[]
  usedPins: Record<string, string[]>
  usedMuxChannels: Record<string, number[]>
}

export interface PinoutAssignmentOwner {
  componentId: string
  role: string
  label: string
}

export interface PinoutAssignmentUsage {
  boardPins: Record<string, PinoutAssignmentOwner[]>
  muxChannels: Record<string, Record<number, PinoutAssignmentOwner[]>>
}

export interface PinoutDesignsPayload {
  version: number
  designs: PinoutDesign[]
  updatedAt: string
}

export interface PinoutConfigPayload {
  protocol: 'ubb.pinout.config.v1'
  designId: string
  name: string
  boardId: PinoutBoardId
  generatedAt: string
  pins: Array<{ componentId: string; component: string; role: string; pin: string; direction: PinDirection }>
  muxes: Array<{ id: string; label: string; sigPin: string; sigMode: 'digital' | 'analog'; enPin: string; selectPins: [string, string, string, string]; channels: Array<{ channel: number; componentId: string; role: string; component: string }> }>
  components: Array<{ id: string; definitionId: string; label: string; protocolKey: string; settings?: Record<string, string | number | boolean> }>
}

export interface PinoutCompileRequest { design: PinoutDesign; sketchName?: string }
export interface PinoutCompileResult { ok: boolean; message: string; sketchPath?: string; buildDir?: string; hexPath?: string; fqbn?: string; log: string[] }
export interface PinoutExportInoRequest { design: PinoutDesign }
export interface PinoutFlashRequest { design: PinoutDesign; port: string; baudId?: string }
export interface PinoutFlashResult { ok: boolean; message: string; log: string[] }

export function createEmptyPinoutDesign(name = 'Novo pinout', boardId: PinoutBoardId = 'nano'): PinoutDesign {
  const now = new Date().toISOString()
  return { id: `pinout-${Date.now().toString(36)}`, name, boardId, components: [], muxes: [], connections: [], createdAt: now, updatedAt: now }
}

export function defaultPinoutPayload(): PinoutDesignsPayload {
  return { version: PINOUT_STORE_VERSION, designs: [], updatedAt: new Date(0).toISOString() }
}

export function isPinoutBoardId(value: unknown): value is PinoutBoardId {
  return typeof value === 'string' && value in BOARD_CATALOG
}

export function getConnectionKey(componentId: string, role: string): string {
  return `${componentId}:${role}`
}

export function findDefinition(definitionId: string, library: PinoutComponentDefinition[] = PINOUT_COMPONENT_LIBRARY): PinoutComponentDefinition | null {
  return library.find((definition) => definition.id === definitionId) ?? null
}

export function buildPinoutAssignmentUsage(design: PinoutDesign, library: PinoutComponentDefinition[] = PINOUT_COMPONENT_LIBRARY): PinoutAssignmentUsage {
  const boardPins: PinoutAssignmentUsage['boardPins'] = {}
  const muxChannels: PinoutAssignmentUsage['muxChannels'] = {}
  const items = [...design.components, ...design.muxes]
  const itemMap = new Map(items.map((item) => [item.id, item]))

  for (const connection of design.connections) {
    const item = itemMap.get(connection.componentId)
    const definition = item ? findDefinition(item.definitionId, library) : null
    const role = definition?.roles.find((entry) => entry.role === connection.role)
    const owner: PinoutAssignmentOwner = {
      componentId: connection.componentId,
      role: connection.role,
      label: `${item?.label ?? connection.componentId} / ${role?.label ?? connection.role}`
    }

    if (connection.target.kind === 'board') {
      boardPins[connection.target.pin] = [...(boardPins[connection.target.pin] ?? []), owner]
    } else {
      const channels = muxChannels[connection.target.muxId] ?? {}
      channels[connection.target.channel] = [...(channels[connection.target.channel] ?? []), owner]
      muxChannels[connection.target.muxId] = channels
    }
  }

  return { boardPins, muxChannels }
}

export function normalizePinoutDesign(input: Partial<PinoutDesign>): PinoutDesign {
  const now = new Date().toISOString()
  // Preserve any non-empty boardId string so user-defined ("custom") boards
  // survive a round-trip; lookups elsewhere fall back to a safe default board.
  const boardId: PinoutBoardId = typeof input.boardId === 'string' && input.boardId ? input.boardId : 'nano'
  return {
    id: typeof input.id === 'string' && input.id ? input.id : `pinout-${Date.now().toString(36)}`,
    name: typeof input.name === 'string' && input.name ? input.name : 'Novo pinout',
    boardId,
    components: Array.isArray(input.components) ? input.components.filter(isPlacedComponent) : [],
    muxes: Array.isArray(input.muxes) ? input.muxes.filter(isPlacedMux) : [],
    connections: Array.isArray(input.connections) ? input.connections.filter(isConnection) : [],
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : now,
    diagramLayout: isPinoutDiagramLayout(input.diagramLayout) ? input.diagramLayout : undefined,
    notes: typeof input.notes === 'string' ? input.notes : undefined
  }
}

export function validatePinout(design: PinoutDesign, catalog: BoardCatalogEntry = getBoardCatalogEntry(design.boardId), library: PinoutComponentDefinition[] = PINOUT_COMPONENT_LIBRARY): PinoutValidationResult {
  const issues: PinoutValidationIssue[] = []
  const pinMap = new Map(catalog.pins.map((pin) => [pin.pin, pin]))
  const usedPins = new Map<string, string[]>()
  const usedPinKinds = new Map<string, string[]>()
  const roleConnections = new Map<string, Connection>()
  const usedMuxChannels = new Map<string, Set<number>>()
  const componentMap = new Map(design.components.map((component) => [component.id, component]))
  const muxMap = new Map(design.muxes.map((mux) => [mux.id, mux]))

  function add(issue: PinoutValidationIssue): void { issues.push(issue) }
  function rememberPin(pin: string, owner: string, kind: string): void {
    const list = usedPins.get(pin) ?? []
    list.push(owner)
    usedPins.set(pin, list)
    const kinds = usedPinKinds.get(pin) ?? []
    kinds.push(kind)
    usedPinKinds.set(pin, kinds)
  }

  for (const mux of design.muxes) {
    const definition = findDefinition(mux.definitionId, library)
    if (!definition) add({ severity: 'error', code: 'unknown-mux', message: `Multiplexer ?${mux.label}? does not exist in the catalog.`, muxId: mux.id })
    for (const role of definition?.roles ?? []) {
      const connection = design.connections.find((item) => item.componentId === mux.id && item.role === role.role)
      if (!connection) {
        add({ severity: role.optional ? 'warning' : 'error', code: 'missing-role', message: `Fhigh ligar ${mux.label} → ${role.label}.`, muxId: mux.id, role: role.role })
      }
    }
  }

  for (const component of design.components) {
    const definition = findDefinition(component.definitionId, library)
    if (!definition) {
      add({ severity: 'error', code: 'unknown-component', message: `Component ?${component.label}? does not exist in the catalog.`, componentId: component.id })
      continue
    }
    for (const role of definition.roles) {
      const key = getConnectionKey(component.id, role.role)
      const connection = design.connections.find((item) => getConnectionKey(item.componentId, item.role) === key)
      if (!connection) {
        add({ severity: role.optional ? 'warning' : 'error', code: 'missing-role', message: `Fhigh ligar ${component.label} → ${role.label}.`, componentId: component.id, role: role.role })
      }
    }
  }

  for (const connection of design.connections) {
    const owner = componentMap.get(connection.componentId) ?? muxMap.get(connection.componentId)
    if (!owner) {
      add({ severity: 'error', code: 'dangling-connection', message: 'Connection points to a removed component.', componentId: connection.componentId, role: connection.role })
      continue
    }
    const definition = findDefinition(owner.definitionId, library)
    const role = definition?.roles.find((entry) => entry.role === connection.role)
    if (!definition || !role) {
      add({ severity: 'error', code: 'unknown-role', message: `Role ?${connection.role}? does not exist on ${owner.label}.`, componentId: connection.componentId, role: connection.role })
      continue
    }
    const key = getConnectionKey(connection.componentId, connection.role)
    if (roleConnections.has(key)) {
      add({ severity: 'error', code: 'role-duplicate', message: `${owner.label} → ${role.label} foi ligado mais de uma vez.`, componentId: connection.componentId, role: connection.role })
    }
    roleConnections.set(key, connection)

    if (connection.target.kind === 'board') {
      const pin = pinMap.get(connection.target.pin)
      if (!pin) {
        add({ severity: 'error', code: 'unknown-pin', message: `Pin ?${connection.target.pin}? does not exist on ${catalog.name}.`, componentId: connection.componentId, role: connection.role, pin: connection.target.pin })
        continue
      }
      rememberPin(pin.pin, `${owner.label} / ${role.label}`, role.kind)
      validatePinCapability(pin, role, owner.label, role.label, issues, connection.componentId, connection.role)
      if (definition.type === 'multiplexer' && role.role === 'sig' && !pin.power) {
        // CD74HC4067 SIG is declared kind:'any', so the capability checks above skip it.
        // Enforce the SIG mode: analog common needs an ADC pin, digital needs a digital pin.
        const sigMux = muxMap.get(connection.componentId)
        if (sigMux?.sigMode === 'analog' && !pin.analogIn) {
          add({ severity: 'error', code: 'mux-sig-need-analog', message: `${owner.label} ? ${role.label} is in analog mode, but ${pin.pin} has no analog input.`, componentId: connection.componentId, role: connection.role, pin: pin.pin })
        } else if (sigMux?.sigMode === 'digital' && !pin.digital) {
          add({ severity: 'error', code: 'mux-sig-need-digital', message: `${owner.label} ? ${role.label} is in digital mode, but ${pin.pin} is not a digital pin.`, componentId: connection.componentId, role: connection.role, pin: pin.pin })
        }
      }
    } else {
      const mux = muxMap.get(connection.target.muxId)
      if (!mux) {
        add({ severity: 'error', code: 'unknown-mux-target', message: `Canal aponta para um multiplexer removido.`, componentId: connection.componentId, role: connection.role })
        continue
      }
      if (definition.type === 'multiplexer' || !role.muxCapable) {
        add({ severity: 'error', code: 'role-not-muxable', message: `${owner.label} ? ${role.label} must go directly to the board, not through a MUX channel.`, componentId: connection.componentId, role: connection.role })
      }
      if (connection.target.channel < 0 || connection.target.channel > 15 || !Number.isInteger(connection.target.channel)) {
        add({ severity: 'error', code: 'mux-channel-range', message: `Canal do ${mux.label} precisa estar entre C0 e C15.`, muxId: mux.id, componentId: connection.componentId })
      } else {
        const set = usedMuxChannels.get(mux.id) ?? new Set<number>()
        if (set.has(connection.target.channel)) {
          add({ severity: 'error', code: 'mux-channel-conflict', message: `${mux.label} C${connection.target.channel} is already in use.`, muxId: mux.id, componentId: connection.componentId })
        }
        set.add(connection.target.channel)
        usedMuxChannels.set(mux.id, set)
      }
    }
  }

  for (const [pin, owners] of usedPins) {
    if (owners.length > 1) {
      const catalogPin = pinMap.get(pin)
      const kinds = usedPinKinds.get(pin) ?? []
      const sharedI2cBus = Boolean(catalogPin?.i2c) && kinds.every((kind) => kind === 'i2c')
      const sharedPowerRail = Boolean(catalogPin?.power) && kinds.every((kind) => kind === 'power')
      add({
        severity: sharedI2cBus || sharedPowerRail ? 'warning' : 'error',
        code: sharedI2cBus ? 'i2c-shared-bus' : sharedPowerRail ? 'power-shared-rail' : 'pin-conflict',
        message: sharedI2cBus ? `${pin} is shared on the I2C bus by: ${owners.join(', ')}. Confirm different I2C addresses.` : sharedPowerRail ? `${pin} is shared as a power bus by: ${owners.join(', ')}.` : `${pin} is in use by: ${owners.join(', ')}.`,
        pin
      })
    }
  }

  // ── Researched robustness checks (mirror real Arduino failure modes so an
  //    invalid design is caught before flashing): I2C address collisions,
  //    rotary-encoder interrupt pins, addressable-LED power/level-shift/RAM
  //    budgets and AVR timer sharing between Servo/tone()/PWM. ─────────────────
  const boardLogic3v3 = catalog.lapge === '3.3V'
  const isAvr328 = /atmega(328|168)/i.test(catalog.mcu)
  const isAvr32u4 = /atmega32u4/i.test(catalog.mcu)
  const isAvr2560 = /atmega2560/i.test(catalog.mcu)
  const sramBytes = isAvr328 ? 2048 : isAvr32u4 ? 2560 : isAvr2560 ? 8192 : 0

  // (1) I2C address conflicts: every device on the shared SDA/SCL bus must use a
  // distinct address (two SSD1306 at 0x3C, or a PCF8574 + MCP23017 both at 0x20,
  // silently fight on the bus). Group connected I2C devices by effective address.
  const i2cByAddress = new Map<string, string[]>()
  for (const component of design.components) {
    const definition = findDefinition(component.definitionId, library)
    if (!definition) continue
    const hasConnectedI2c = definition.roles.some((entry) => entry.kind === 'i2c' && roleConnections.has(getConnectionKey(component.id, entry.role)))
    if (!hasConnectedI2c) continue
    const rawAddress = component.settings?.address ?? definition.defaults?.address
    if (rawAddress === undefined || rawAddress === null || `${rawAddress}`.trim() === '') continue
    const address = `${rawAddress}`.trim().toLowerCase()
    const owners = i2cByAddress.get(address) ?? []
    owners.push(component.label)
    i2cByAddress.set(address, owners)
  }
  for (const [address, owners] of i2cByAddress) {
    if (owners.length > 1) add({ severity: 'error', code: 'i2c-address-conflict', message: `I2C address ${address} is repeated on: ${owners.join(', ')}. Devices on the same SDA/SCL bus need different addresses (change one device address jumper/strap).` })
  }

  // (2) Rotary (quadrature) encoders want interrupt-capable pins for reliable
  // counts; on a non-interrupt pin a fast spin drops steps. Warn + note polling.
  for (const component of design.components) {
    const definition = findDefinition(component.definitionId, library)
    if (!definition) continue
    const isQuadratureEncoder = definition.roles.some((entry) => entry.role === 'clk') && definition.roles.some((entry) => entry.role === 'dt')
    if (!isQuadratureEncoder) continue
    for (const roleName of ['clk', 'dt']) {
      const connection = roleConnections.get(getConnectionKey(component.id, roleName))
      if (!connection || connection.target.kind !== 'board') continue
      const pin = pinMap.get(connection.target.pin)
      if (pin && !pin.interrupt) add({ severity: 'warning', code: 'encoder-no-interrupt', message: `${component.label} ? ${roleName.toUpperCase()} is on ${pin.pin}, which has no interrupt. Fast turns may miss steps; prefer an interrupt pin or accept polling reads.`, componentId: component.id, role: roleName, pin: pin.pin })
    }
  }

  // (3) Addressable LEDs: high counts can't be fed from the board regulator and,
  // on 3.3V logic, the 5V strip often ignores a 3.3V data line without a level
  // shifter; the pixel buffer can also overflow small AVR SRAM.
  let ledBufferBytes = 0
  for (const component of design.components) {
    const definition = findDefinition(component.definitionId, library)
    if (!definition) continue
    if (definition.type !== 'rgbStrip' && definition.type !== 'rgbMatrix') continue
    const chip = `${component.settings?.chip ?? definition.defaults?.chip ?? 'ws2812'}`.toLowerCase()
    const isAddressable = /ws2812|sk6812|apa102|sk9822|neopixel/.test(chip)
    if (!isAddressable) continue
    const width = Number(component.settings?.width ?? definition.defaults?.width ?? 0)
    const height = Number(component.settings?.height ?? definition.defaults?.height ?? 0)
    const ledCount = Number(component.settings?.ledCount ?? definition.defaults?.ledCount ?? 0) || width * height
    if (ledCount <= 0) continue
    ledBufferBytes += ledCount * (/sk6812|rgbw/.test(chip) ? 4 : 3)
    if (ledCount > 30) add({ severity: 'warning', code: 'led-power-budget', message: `${component.label} has ${ledCount} addressable LEDs (up to ~${Math.ceil(ledCount * 0.06)} A at full white/brightness). Use a dedicated external 5V supply with common GND; do not power it from the board 5V pin.`, componentId: component.id })
    if (boardLogic3v3 && /ws2812|sk6812|neopixel/.test(chip)) add({ severity: 'warning', code: 'led-level-shift', message: `${component.label} is WS2812/SK6812 (5V logic) controlled by a 3.3V board. Use a 3.3V?5V level shifter on DIN (or power the strip at ~4.3V) so data is recognized reliably.`, componentId: component.id, role: 'data' })
  }
  if (sramBytes > 0 && ledBufferBytes > sramBytes * 0.4) add({ severity: 'warning', code: 'resource-budget', message: `The addressable LED buffer (~${ledBufferBytes} bytes) uses much of ${catalog.name} RAM (${sramBytes} bytes). Reduce the LED count or use a board with more memory to avoid RAM-related crashes.` })

  // (4) AVR timer sharing: the Servo library (Timer1) disables analogWrite() on
  // pins 9/10; tone() for a passive buzzer (Timer2) disables it on 3/11. Warn
  // when a PWM output lands on a pin a library will take over.
  if (isAvr328 || isAvr32u4) {
    const hasServo = design.components.some((component) => /gauge\.servo/.test(findDefinition(component.definitionId, library)?.protocolKey ?? ''))
    const hasPassiveBuzzer = design.components.some((component) => (findDefinition(component.definitionId, library)?.protocolKey ?? '') === 'buzzer')
    for (const connection of design.connections) {
      if (connection.target.kind !== 'board') continue
      const owner = componentMap.get(connection.componentId)
      if (!owner) continue
      const definition = findDefinition(owner.definitionId, library)
      const role = definition?.roles.find((entry) => entry.role === connection.role)
      if (role?.kind !== 'pwm') continue
      const isServoSignal = /gauge\.servo/.test(definition?.protocolKey ?? '')
      if (hasServo && !isServoSignal && (connection.target.pin === 'D9' || connection.target.pin === 'D10')) add({ severity: 'warning', code: 'timer-conflict', message: `${owner.label} usa PWM em ${connection.target.pin}, mas a biblioteca Servo ocupa o Timer1 e desliga o analogWrite dos pinos 9 e 10. Mova este PWM para 3, 5, 6 ou 11.`, componentId: connection.componentId, role: connection.role, pin: connection.target.pin })
      if (hasPassiveBuzzer && (connection.target.pin === 'D3' || connection.target.pin === 'D11')) add({ severity: 'warning', code: 'timer-conflict', message: `${owner.label} usa PWM em ${connection.target.pin}, mas tone() (buzzer passivo) usa o Timer2 e desliga o analogWrite dos pinos 3 e 11. Use 5, 6, 9 ou 10, ou troque por um buzzer ativo.`, componentId: connection.componentId, role: connection.role, pin: connection.target.pin })
    }
  }

  const freePins = catalog.pins
    .filter((pin) => pin.digital || pin.analogIn || pin.pwm || pin.i2c || pin.spi || pin.uart)
    .filter((pin) => !usedPins.has(pin.pin))
    .map((pin) => ({ ...pin, recommendedFor: recommendPin(pin) }))

  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    issues,
    freePins,
    usedPins: Object.fromEntries([...usedPins.entries()]),
    usedMuxChannels: Object.fromEntries([...usedMuxChannels.entries()].map(([muxId, set]) => [muxId, [...set].sort((a, b) => a - b)]))
  }
}

export function buildPinoutConfigPayload(design: PinoutDesign, library: PinoutComponentDefinition[] = PINOUT_COMPONENT_LIBRARY): PinoutConfigPayload {
  const components = design.components.map((component) => {
    const definition = findDefinition(component.definitionId, library)
    return { id: component.id, definitionId: component.definitionId, label: component.label, protocolKey: definition?.protocolKey ?? 'custom', settings: component.settings }
  })
  const pins: PinoutConfigPayload['pins'] = []
  const muxes: PinoutConfigPayload['muxes'] = []

  for (const connection of design.connections) {
    if (connection.target.kind !== 'board') continue
    if (design.muxes.some((mux) => mux.id === connection.componentId)) continue
    const component = design.components.find((item) => item.id === connection.componentId)
    if (!component) continue
    const definition = findDefinition(component.definitionId, library)
    const role = definition?.roles.find((entry) => entry.role === connection.role)
    if (role?.kind === 'power') continue
    pins.push({ componentId: component.id, component: component.label, role: connection.role, pin: connection.target.pin, direction: getRolePinDirection(definition, role) })
  }

  for (const mux of design.muxes) {
    const byRole = new Map(design.connections.filter((item) => item.componentId === mux.id && item.target.kind === 'board').map((item) => [item.role, item.target.kind === 'board' ? item.target.pin : '']))
    const channels = design.connections
      .filter((item) => item.target.kind === 'mux-channel' && item.target.muxId === mux.id)
      .map((item) => {
        const component = design.components.find((entry) => entry.id === item.componentId)
        return { channel: item.target.kind === 'mux-channel' ? item.target.channel : 0, componentId: item.componentId, role: item.role, component: component?.label ?? item.componentId }
      })
      .sort((a, b) => a.channel - b.channel)
    muxes.push({ id: mux.id, label: mux.label, sigPin: byRole.get('sig') ?? '', sigMode: mux.sigMode, enPin: byRole.get('en') ?? '', selectPins: [byRole.get('s0') ?? '', byRole.get('s1') ?? '', byRole.get('s2') ?? '', byRole.get('s3') ?? ''], channels })
  }

  return { protocol: 'ubb.pinout.config.v1', designId: design.id, name: design.name, boardId: design.boardId, generatedAt: new Date().toISOString(), pins, muxes, components }
}

function validatePinCapability(pin: BoardPinCapability, pinRole: PinoutComponentRole, component: string, role: string, issues: PinoutValidationIssue[], componentId: string, roleId: string): void {
  const kind = pinRole.kind
  if (kind === 'power') {
    if (!pinSupportsRole(pin, pinRole)) issues.push({ severity: 'error', code: 'need-power-rail', message: `${component} ? ${role} needs compatible power; ${pin.pin} is not the correct bus.`, componentId, role: roleId, pin: pin.pin })
    return
  }
  if (pin.power) {
    issues.push({ severity: 'error', code: 'power-pin-signal', message: `${component} ? ${role} needs a signal, but ${pin.pin} is power/GND.`, componentId, role: roleId, pin: pin.pin })
    return
  }
  if (kind === 'digital' && !pin.digital) issues.push({ severity: 'error', code: 'need-digital', message: `${component} ? ${role} needs a digital pin; ${pin.pin} is not digital.`, componentId, role: roleId, pin: pin.pin })
  if (kind === 'analog' && !pin.analogIn) issues.push({ severity: 'error', code: 'need-analog', message: `${component} ? ${role} needs an analog input; ${pin.pin} is digital-only.`, componentId, role: roleId, pin: pin.pin })
  if (kind === 'pwm' && !pin.pwm) issues.push({ severity: 'error', code: 'need-pwm', message: `${component} ? ${role} needs PWM; ${pin.pin} has no PWM.`, componentId, role: roleId, pin: pin.pin })
  if (kind === 'i2c' && !pin.i2c) issues.push({ severity: 'error', code: 'need-i2c', message: `${component} ? ${role} needs SDA/SCL; ${pin.pin} is not an I2C pin.`, componentId, role: roleId, pin: pin.pin })
  if ((roleId === 'sda' && pin.i2c !== 'sda') || (roleId === 'scl' && pin.i2c !== 'scl')) issues.push({ severity: 'error', code: 'wrong-i2c-role', message: `${component} ? ${role} must go to the ${roleId.toUpperCase()} pin, not ${pin.pin}.`, componentId, role: roleId, pin: pin.pin })
  if (kind === 'spi' && !pinSupportsRole(pin, pinRole)) issues.push({ severity: 'error', code: 'need-spi', message: `${component} ? ${role} needs a compatible SPI pin; ${pin.pin} does not support that role.`, componentId, role: roleId, pin: pin.pin })
  if (kind === 'uart' && !pinSupportsRole(pin, pinRole)) issues.push({ severity: 'error', code: 'need-uart', message: `${component} ? ${role} needs a compatible UART pin; ${pin.pin} does not support that role.`, componentId, role: roleId, pin: pin.pin })
}

function recommendPin(pin: BoardPinCapability): string[] {
  const out: string[] = []
  if (pin.analogIn) out.push('eixo analog / potenciômetro')
  if (pin.i2c) out.push(pin.i2c === 'sda' ? 'SDA de OLED/I2C' : 'SCL de OLED/I2C')
  if (pin.spi) out.push(`SPI ${pin.spi.toUpperCase()}`)
  if (pin.uart) out.push(`UART ${pin.uart.toUpperCase()}`)
  if (pin.pwm) out.push('servo gauge / PWM')
  if (pin.digital) out.push('button / encoder / LED data')
  return out
}

function isPlacedComponent(value: unknown): value is PlacedComponent {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<PlacedComponent>
  return typeof item.id === 'string' && typeof item.definitionId === 'string' && typeof item.label === 'string' && typeof item.x === 'number' && typeof item.y === 'number'
}

function isPlacedMux(value: unknown): value is PlacedMux {
  if (!isPlacedComponent(value)) return false
  const item = value as Partial<PlacedMux>
  return item.definitionId === 'cd74hc4067' && (item.sigMode === 'digital' || item.sigMode === 'analog')
}

function isConnection(value: unknown): value is Connection {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<Connection>
  if (typeof item.id !== 'string' || typeof item.componentId !== 'string' || typeof item.role !== 'string' || !item.target) return false
  if (item.target.kind === 'board') return typeof item.target.pin === 'string'
  if (item.target.kind === 'mux-channel') return typeof item.target.muxId === 'string' && typeof item.target.channel === 'number'
  return false
}

function isPinoutDiagramLayout(value: unknown): value is PinoutDiagramLayout {
  if (!value || typeof value !== 'object') return false
  const layout = value as Partial<PinoutDiagramLayout>
  if (!layout.nodes || typeof layout.nodes !== 'object' || Array.isArray(layout.nodes)) return false
  return Object.values(layout.nodes).every((node) => {
    if (!node || typeof node !== 'object') return false
    const item = node as Partial<PinoutDiagramNodeLayout>
    return typeof item.id === 'string' && typeof item.x === 'number' && typeof item.y === 'number' && typeof item.width === 'number' && typeof item.height === 'number'
  })
}
