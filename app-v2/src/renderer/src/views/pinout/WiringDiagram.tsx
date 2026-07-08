import { type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactElement, type WheelEvent, useMemo, useRef, useState } from 'react'
import { PINOUT_COMPONENT_LIBRARY, type BoardCatalogEntry, type BoardPinCapability, type PinoutComponentRole } from '../../../../shared/board-catalog'
import { getConnectionKey, type Connection, type ConnectionTarget, type PinoutDesign, type PinoutDiagramNodeLayout, type PlacedComponent, type PlacedMux, type Point } from '../../../../shared/pinout'

const colors = {
  power5v: '#ef4444',
  power3v3: '#fb7185',
  ground: '#64748b',
  digital: '#60a5fa',
  analog: '#34d399',
  pwm: '#f59e0b',
  i2c: '#a78bfa',
  mux: '#22d3ee',
  body: 'var(--surface-sunken)',
  panel: '#07111f',
  stroke: '#475569',
  text: '#e5eefc',
  muted: '#94a3b8',
  danger: '#f87171',
  ok: '#86efac'
}

const boardBox = { id: 'board', x: 520, y: 170, width: 320, height: 620 }
const viewSize = { width: 1420, height: 920 }
const minNodeSize = { width: 190, height: 94 }

type Assignable = PlacedComponent | PlacedMux
type Interaction =
  | { kind: 'move'; nodeId: string; offset: Point }
  | { kind: 'resize'; nodeId: string; start: Point; width: number; height: number }
  | { kind: 'pan'; start: Point; pan: Point }
  | { kind: 'wire'; componentId: string; role: string; cursor: Point }

type TargetEndpoint =
  | { kind: 'board'; id: string; label: string; point: Point; target: ConnectionTarget; pin: BoardPinCapability; available: boolean; reason: string }
  | { kind: 'mux-channel'; id: string; label: string; point: Point; target: ConnectionTarget; muxId: string; channel: number; available: boolean; reason: string }

interface RoleEndpoint {
  id: string
  componentId: string
  role: PinoutComponentRole
  label: string
  point: Point
  color: string
  connection?: Connection
}

interface NodeBlock extends PinoutDiagramNodeLayout {
  item: Assignable
  label: string
  icon: string
  category: string
  roles: PinoutComponentRole[]
  power: string
  isMux: boolean
}

interface WiringDiagramProps {
  design: PinoutDesign
  board: BoardCatalogEntry
  id?: string
  busy?: boolean
  onChange(next: PinoutDesign): void
  onSave(next: PinoutDesign): void
}

export function WiringDiagram({ design, board, id = 'pinout-wiring-diagram', busy = false, onChange, onSave }: WiringDiagramProps): ReactElement {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [interaction, setInteraction] = useState<Interaction | null>(null)
  const [selectedWire, setSelectedWire] = useState<string | null>(null)
  const pan = design.diagramLayout?.pan ?? { x: 0, y: 0 }
  const zoom = design.diagramLayout?.zoom ?? 1
  const activeRole = interaction?.kind === 'wire' ? findRole(design, interaction.componentId, interaction.role) : null
  const model = useMemo(() => buildDiagramModel(design, board, activeRole), [design, board, activeRole])
  const activeSource = interaction?.kind === 'wire' ? model.roleEndpoints.get(getConnectionKey(interaction.componentId, interaction.role)) : undefined
  const hoverTarget = interaction?.kind === 'wire' ? findNearestTarget(interaction.cursor, model.targets, false) : null

  function toDiagramPoint(event: ReactPointerEvent<SVGElement> | WheelEvent<SVGSVGElement>): Point {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * viewSize.width
    const y = ((event.clientY - rect.top) / rect.height) * viewSize.height
    return { x: (x - pan.x) / zoom, y: (y - pan.y) / zoom }
  }

  function commitLayoutNode(nodeId: string, patch: Partial<PinoutDiagramNodeLayout>): void {
    const current = design.diagramLayout?.nodes[nodeId] ?? model.nodes.find((node) => node.id === nodeId)
    if (!current) return
    onChange({
      ...design,
      diagramLayout: {
        ...(design.diagramLayout ?? {}),
        nodes: {
          ...(design.diagramLayout?.nodes ?? {}),
          [nodeId]: { ...current, ...patch, id: nodeId }
        }
      },
      updatedAt: new Date().toISOString()
    })
  }

  function commitViewport(nextPan: Point, nextZoom = zoom): void {
    onChange({
      ...design,
      diagramLayout: {
        nodes: design.diagramLayout?.nodes ?? {},
        pan: nextPan,
        zoom: Math.max(0.35, Math.min(2.5, nextZoom))
      },
      updatedAt: new Date().toISOString()
    })
  }

  function setConnection(componentId: string, role: string, target: ConnectionTarget | null): void {
    const key = getConnectionKey(componentId, role)
    const rest = design.connections.filter((connection) => getConnectionKey(connection.componentId, connection.role) !== key)
    const nextConnections = target ? [...rest, { id: newId('conn'), componentId, role, target }] : rest
    onChange({ ...design, connections: nextConnections, updatedAt: new Date().toISOString() })
    setSelectedWire(null)
  }

  function startNodeMove(nodeId: string, event: ReactPointerEvent<SVGGElement>): void {
    const node = model.nodes.find((entry) => entry.id === nodeId)
    if (!node) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = toDiagramPoint(event)
    setInteraction({ kind: 'move', nodeId, offset: { x: point.x - node.x, y: point.y - node.y } })
  }

  function startResize(nodeId: string, event: ReactPointerEvent<SVGRectElement>): void {
    const node = model.nodes.find((entry) => entry.id === nodeId)
    if (!node) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setInteraction({ kind: 'resize', nodeId, start: toDiagramPoint(event), width: node.width, height: node.height })
  }

  function startWire(componentId: string, role: string, event: ReactPointerEvent<SVGCircleElement>): void {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelectedWire(null)
    setInteraction({ kind: 'wire', componentId, role, cursor: toDiagramPoint(event) })
  }

  function startPan(event: ReactPointerEvent<SVGSVGElement>): void {
    if (event.button !== 0 || interaction) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setInteraction({ kind: 'pan', start: { x: event.clientX, y: event.clientY }, pan })
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>): void {
    if (!interaction) return
    const point = toDiagramPoint(event)
    if (interaction.kind === 'move') {
      commitLayoutNode(interaction.nodeId, { x: point.x - interaction.offset.x, y: point.y - interaction.offset.y })
      return
    }
    if (interaction.kind === 'resize') {
      commitLayoutNode(interaction.nodeId, { width: Math.max(minNodeSize.width, interaction.width + point.x - interaction.start.x), height: Math.max(minNodeSize.height, interaction.height + point.y - interaction.start.y) })
      return
    }
    if (interaction.kind === 'wire') {
      setInteraction({ ...interaction, cursor: point })
      return
    }
    const dx = event.clientX - interaction.start.x
    const dy = event.clientY - interaction.start.y
    commitViewport({ x: interaction.pan.x + dx, y: interaction.pan.y + dy })
  }

  function handlePointerUp(): void {
    if (interaction?.kind === 'wire') {
      const target = findNearestTarget(interaction.cursor, model.targets, true)
      if (target?.available) setConnection(interaction.componentId, interaction.role, target.target)
    }
    setInteraction(null)
  }

  function handleWheel(event: WheelEvent<SVGSVGElement>): void {
    event.preventDefault()
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const screen = { x: ((event.clientX - rect.left) / rect.width) * viewSize.width, y: ((event.clientY - rect.top) / rect.height) * viewSize.height }
    const before = { x: (screen.x - pan.x) / zoom, y: (screen.y - pan.y) / zoom }
    const nextZoom = Math.max(0.35, Math.min(2.5, zoom * (event.deltaY > 0 ? 0.9 : 1.1)))
    commitViewport({ x: screen.x - before.x * nextZoom, y: screen.y - before.y * nextZoom }, nextZoom)
  }

  function resetLayout(): void {
    onChange({ ...design, diagramLayout: { nodes: {}, pan: { x: 0, y: 0 }, zoom: 1 }, updatedAt: new Date().toISOString() })
  }

  return (
    <div style={shellStyle}>
      <div style={toolbarStyle}>
        <div>
          <strong>{design.name}</strong>
          <p style={hintStyle}>Interactive wiring editor: drag/resize components, zoom/pan, then drag endpoints to rewire.</p>
        </div>
        <div style={buttonRowStyle}>
          <button type="button" style={toolButtonStyle} onClick={() => commitViewport(pan, zoom * 1.12)} aria-label="Zoom in">＋</button>
          <button type="button" style={toolButtonStyle} onClick={() => commitViewport(pan, zoom / 1.12)} aria-label="Zoom out">－</button>
          <button type="button" style={toolButtonStyle} onClick={resetLayout}>Auto layout</button>
          <button type="button" style={saveButtonStyle} disabled={busy} onClick={() => onSave(design)}>Save diagram + config</button>
        </div>
      </div>
      <svg
        ref={svgRef}
        id={id}
        viewBox={`0 0 ${viewSize.width} ${viewSize.height}`}
        role="application"
        aria-label={`Interactive wiring diagram editor for ${design.name}`}
        style={svgStyle}
        onPointerDown={startPan}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setInteraction(null)}
        onWheel={handleWheel}
      >
        <defs>
          <filter id="pinout-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#000" floodOpacity="0.35" /></filter>
          <pattern id="pinout-grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 32" fill="none" stroke="rgba(148,163,184,.12)" strokeWidth="1" /></pattern>
        </defs>
        <rect width={viewSize.width} height={viewSize.height} fill={colors.panel} />
        <rect width={viewSize.width} height={viewSize.height} fill="url(#pinout-grid)" opacity="0.65" />
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          <Board board={board} pinRows={model.pinRows} powerRows={model.powerRows} />
          <g aria-label="Wires">
            {model.lines.map((line) => (
              <g key={line.connection.id}>
                <path d={curvePath(line.from, line.to)} fill="none" stroke={line.color} strokeWidth={selectedWire === line.connection.id ? 4.5 : 2.6} strokeOpacity="0.9" onPointerDown={(event) => { event.stopPropagation(); setSelectedWire(line.connection.id) }} style={{ cursor: 'pointer' }} />
                <circle cx={line.to.x} cy={line.to.y} r="8" fill={line.color} stroke="#020617" strokeWidth="2" onPointerDown={(event) => startWire(line.connection.componentId, line.connection.role, event)} style={{ cursor: 'grab' }}>
                  <title>Drag to rewire {line.label}</title>
                </circle>
                <text x={(line.from.x + line.to.x) / 2} y={(line.from.y + line.to.y) / 2 - 8} fill={line.color} fontSize="11" textAnchor="middle" paintOrder="stroke" stroke="#020617" strokeWidth="4">{line.label}</text>
                {selectedWire === line.connection.id && <g transform={`translate(${(line.from.x + line.to.x) / 2 - 16}, ${(line.from.y + line.to.y) / 2 + 10})`} onPointerDown={(event) => { event.stopPropagation(); setConnection(line.connection.componentId, line.connection.role, null) }} style={{ cursor: 'pointer' }}>
                  <rect width="32" height="22" rx="11" fill="#7f1d1d" stroke={colors.danger} />
                  <text x="16" y="15" textAnchor="middle" fill="#fee2e2" fontSize="12" fontWeight="700">×</text>
                </g>}
              </g>
            ))}
            {activeSource && interaction?.kind === 'wire' && <path d={curvePath(activeSource.point, interaction.cursor)} fill="none" stroke={hoverTarget?.available ? colors.ok : hoverTarget ? colors.danger : activeSource.color} strokeWidth="3" strokeDasharray="7 5" />}
          </g>
          {model.targets.map((target) => <TargetHalo key={target.id} target={target} active={Boolean(activeRole)} hot={hoverTarget?.id === target.id} />)}
          {model.nodes.map((node) => <Node key={node.id} node={node} endpoints={model.endpointsByNode.get(node.id) ?? []} onMove={startNodeMove} onResize={startResize} onStartWire={startWire} />)}
        </g>
      </svg>
      <div style={statusStyle}>
        <span>Zoom {Math.round(zoom * 100)}%</span>
        <span>Drag a role dot to a green board pin or MUX channel. Red/gray targets are unavailable.</span>
      </div>
    </div>
  )
}

function Board({ board, pinRows, powerRows }: { board: BoardCatalogEntry; pinRows: Array<{ pin: BoardPinCapability; side: 'left' | 'right'; point: Point }>; powerRows: Array<{ pin: BoardPinCapability; point: Point }> }): ReactElement {
  return <g filter="url(#pinout-shadow)">
    <rect x={boardBox.x} y={boardBox.y} width={boardBox.width} height={boardBox.height} rx="24" fill={colors.body} stroke="var(--accent-primary)" strokeOpacity="0.78" strokeWidth="2" />
    <text x={boardBox.x + boardBox.width / 2} y={boardBox.y + 36} textAnchor="middle" fill={colors.text} fontSize="19" fontWeight="800">{board.name}</text>
    <text x={boardBox.x + boardBox.width / 2} y={boardBox.y + 60} textAnchor="middle" fill={colors.muted} fontSize="12">{board.mcu} · logic {board.lapge}</text>
    <text x={boardBox.x + boardBox.width / 2} y={boardBox.y + boardBox.height - 20} textAnchor="middle" fill={colors.muted} fontSize="11">Board signal pins are drop targets; used pins turn unavailable.</text>
    {pinRows.map((row) => <PinRow key={row.pin.pin} pin={row.pin} point={row.point} side={row.side} />)}
    {powerRows.map((row) => <PowerPill key={row.pin.pin} pin={row.pin} point={row.point} />)}
  </g>
}

function PinRow({ pin, point, side }: { pin: BoardPinCapability; point: Point; side: 'left' | 'right' }): ReactElement {
  const color = pinColor(pin)
  const textAnchor = side === 'left' ? 'end' : 'start'
  const labelX = side === 'left' ? point.x - 14 : point.x + 14
  return <g>
    <circle cx={point.x} cy={point.y} r="6" fill={color} stroke="#020617" strokeWidth="2" />
    <text x={labelX} y={point.y + 4} textAnchor={textAnchor} fill={color} fontSize="12" fontWeight="800">{pin.pin}</text>
    <text x={labelX + (side === 'left' ? -52 : 52)} y={point.y + 4} textAnchor={textAnchor} fill={colors.muted} fontSize="9">{pinTags(pin).join(' ')}</text>
  </g>
}

function PowerPill({ pin, point }: { pin: BoardPinCapability; point: Point }): ReactElement {
  return <g><rect x={point.x} y={point.y} width="58" height="24" rx="12" fill="rgba(15,23,42,.94)" stroke={pinColor(pin)} /><text x={point.x + 29} y={point.y + 16} fill={pinColor(pin)} fontSize="10" textAnchor="middle" fontWeight="800">{pin.pin}</text></g>
}

function Node({ node, endpoints, onMove, onResize, onStartWire }: { node: NodeBlock; endpoints: RoleEndpoint[]; onMove(nodeId: string, event: ReactPointerEvent<SVGGElement>): void; onResize(nodeId: string, event: ReactPointerEvent<SVGRectElement>): void; onStartWire(componentId: string, role: string, event: ReactPointerEvent<SVGCircleElement>): void }): ReactElement {
  const stroke = node.isMux ? colors.mux : roleColor(node.roles[0]?.kind ?? 'digital')
  return <g filter="url(#pinout-shadow)" onPointerDown={(event) => onMove(node.id, event)} style={{ cursor: 'grab' }}>
    <rect x={node.x} y={node.y} width={node.width} height={node.height} rx="20" fill={node.isMux ? '#082f49' : colors.body} stroke={stroke} strokeWidth="2" />
    <text x={node.x + 18} y={node.y + 29} fill={colors.text} fontSize="16" fontWeight="800">{node.icon} {node.label}</text>
    <text x={node.x + 18} y={node.y + 49} fill={colors.muted} fontSize="11">{node.category} · Power: {node.power}</text>
    {endpoints.map((endpoint) => <g key={endpoint.id}>
      <text x={endpoint.point.x + (endpoint.point.x < node.x + node.width / 2 ? 14 : -14)} y={endpoint.point.y + 4} textAnchor={endpoint.point.x < node.x + node.width / 2 ? 'start' : 'end'} fill={endpoint.color} fontSize="11" fontWeight="700">{endpoint.label}</text>
      <circle cx={endpoint.point.x} cy={endpoint.point.y} r="8" fill={endpoint.connection ? endpoint.color : '#111827'} stroke={endpoint.color} strokeWidth="2.4" onPointerDown={(event) => onStartWire(endpoint.componentId, endpoint.role.role, event)} style={{ cursor: 'crosshair' }}>
        <title>{endpoint.connection ? 'Drag to rewire' : 'Drag to create wire'}: {node.label} / {endpoint.label}</title>
      </circle>
    </g>)}
    {node.isMux && Array.from({ length: 16 }, (_, channel) => {
      const column = channel % 4
      const row = Math.floor(channel / 4)
      const x = node.x + 18 + column * 42
      const y = node.y + node.height - 86 + row * 18
      return <text key={channel} x={x} y={y} fill={colors.muted} fontSize="10">C{channel}</text>
    })}
    <rect x={node.x + node.width - 18} y={node.y + node.height - 18} width="14" height="14" rx="3" fill="rgba(148,163,184,.28)" stroke={colors.muted} onPointerDown={(event) => onResize(node.id, event)} style={{ cursor: 'nwse-resize' }} />
  </g>
}

function TargetHalo({ target, active, hot }: { target: TargetEndpoint; active: boolean; hot: boolean }): ReactElement {
  const fill = !active ? 'transparent' : target.available ? 'rgba(134,239,172,.18)' : 'rgba(248,113,113,.12)'
  const stroke = !active ? 'transparent' : hot ? (target.available ? colors.ok : colors.danger) : target.available ? 'rgba(134,239,172,.65)' : 'rgba(248,113,113,.38)'
  return <g pointerEvents="none">
    <circle cx={target.point.x} cy={target.point.y} r={hot ? 18 : 13} fill={fill} stroke={stroke} strokeWidth={hot ? 3 : 2} />
    {active && hot && <text x={target.point.x} y={target.point.y - 22} textAnchor="middle" fill={target.available ? colors.ok : colors.danger} fontSize="11" paintOrder="stroke" stroke="#020617" strokeWidth="4">{target.available ? target.label : target.reason}</text>}
  </g>
}

function buildDiagramModel(design: PinoutDesign, board: BoardCatalogEntry, activeRole: { item: Assignable; role: PinoutComponentRole } | null) {
  const signalPins = board.pins.filter((pin) => pin.digital || pin.analogIn || pin.pwm || pin.i2c)
  const leftPins = signalPins.slice(0, Math.ceil(signalPins.length / 2))
  const rightPins = signalPins.slice(Math.ceil(signalPins.length / 2))
  const leftStep = Math.min(28, (boardBox.height - 150) / Math.max(1, leftPins.length - 1))
  const rightStep = Math.min(28, (boardBox.height - 150) / Math.max(1, rightPins.length - 1))
  const pinRows = [
    ...leftPins.map((pin, index) => ({ pin, side: 'left' as const, point: { x: boardBox.x, y: boardBox.y + 92 + index * leftStep } })),
    ...rightPins.map((pin, index) => ({ pin, side: 'right' as const, point: { x: boardBox.x + boardBox.width, y: boardBox.y + 92 + index * rightStep } }))
  ]
  const powerRows = board.pins.filter((pin) => pin.power).map((pin, index) => ({ pin, point: { x: boardBox.x + 28 + (index % 4) * 66, y: boardBox.y + boardBox.height - 70 + Math.floor(index / 4) * 28 } }))
  const pinPoint = new Map(pinRows.map((row) => [row.pin.pin, row.point]))
  const pinSide = new Map(pinRows.map((row) => [row.pin.pin, row.side]))
  const items: Assignable[] = [...design.muxes, ...design.components]
  const nodes = items.map((item, index) => buildNode(item, index, design, pinSide))
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))
  const roleEndpoints = new Map<string, RoleEndpoint>()
  const endpointsByNode = new Map<string, RoleEndpoint[]>()
  const connectionsByRole = new Map(design.connections.map((connection) => [getConnectionKey(connection.componentId, connection.role), connection]))

  for (const node of nodes) {
    const side: 'left' | 'right' = node.x + node.width / 2 < boardBox.x + boardBox.width / 2 ? 'right' : 'left'
    const endpoints = node.roles.map((role, roleIndex) => {
      const point = { x: side === 'right' ? node.x + node.width : node.x, y: node.y + 78 + roleIndex * 26 }
      const key = getConnectionKey(node.id, role.role)
      return { id: key, componentId: node.id, role, label: role.label, point, color: roleColor(role.kind), connection: connectionsByRole.get(key) }
    })
    endpointsByNode.set(node.id, endpoints)
    for (const endpoint of endpoints) roleEndpoints.set(endpoint.id, endpoint)
  }

  const muxChannelPoints = new Map<string, Point>()
  for (const mux of design.muxes) {
    const node = nodeMap.get(mux.id)
    if (!node) continue
    for (let channel = 0; channel < 16; channel += 1) {
      muxChannelPoints.set(`${mux.id}:${channel}`, { x: node.x + node.width, y: node.y + node.height - 92 + Math.floor(channel / 4) * 18 })
    }
  }

  const targets: TargetEndpoint[] = []
  for (const row of pinRows) {
    const availability = activeRole ? boardTargetAvailability(design, activeRole.item, activeRole.role, row.pin) : { available: false, reason: '' }
    targets.push({ kind: 'board', id: `board:${row.pin.pin}`, label: row.pin.pin, point: row.point, target: { kind: 'board', pin: row.pin.pin }, pin: row.pin, available: availability.available, reason: availability.reason })
  }
  for (const mux of design.muxes) {
    for (let channel = 0; channel < 16; channel += 1) {
      const point = muxChannelPoints.get(`${mux.id}:${channel}`)
      if (!point) continue
      const availability = activeRole ? muxTargetAvailability(design, activeRole.item, activeRole.role, mux.id, channel) : { available: false, reason: '' }
      targets.push({ kind: 'mux-channel', id: `mux:${mux.id}:${channel}`, label: `${mux.label} C${channel}`, point, target: { kind: 'mux-channel', muxId: mux.id, channel }, muxId: mux.id, channel, available: availability.available, reason: availability.reason })
    }
  }

  const lines = design.connections.flatMap((connection) => {
    const from = roleEndpoints.get(getConnectionKey(connection.componentId, connection.role))
    if (!from) return []
    const target = connection.target
    const to = target.kind === 'board' ? pinPoint.get(target.pin) : muxChannelPoints.get(`${target.muxId}:${target.channel}`)
    if (!to) return []
    const targetPin = target.kind === 'board' ? target.pin : ''
    const color = target.kind === 'mux-channel'
      ? colors.mux
      : pinColor(board.pins.find((pin) => pin.pin === targetPin) ?? { pin: '', digital: true, analogIn: false, pwm: false })
    const label = `${from.label} → ${target.kind === 'board' ? target.pin : `C${target.channel}`}`
    return [{ connection, from: from.point, to, color, label }]
  })

  return { nodes, pinRows, powerRows, roleEndpoints, endpointsByNode, targets, lines }
}

function buildNode(item: Assignable, index: number, design: PinoutDesign, pinSide: Map<string, 'left' | 'right'>): NodeBlock {
  const definition = PINOUT_COMPONENT_LIBRARY.find((entry) => entry.id === item.definitionId)
  const roles = definition?.roles ?? []
  const isMux = item.definitionId === 'cd74hc4067'
  const width = isMux ? 285 : 260
  const height = Math.max(isMux ? 170 : 112, 88 + roles.length * 26)
  const stored = design.diagramLayout?.nodes[item.id]
  const auto = autoNodeLayout(item, index, design, pinSide, width, height)
  return { ...auto, ...(stored ?? {}), id: item.id, width: stored?.width ?? width, height: stored?.height ?? height, item, label: item.label, icon: definition?.icon ?? (isMux ? '⑯' : '□'), category: definition?.category ?? 'Custom', roles, power: definition?.power.join(' / ') ?? 'documented separately', isMux }
}

function autoNodeLayout(item: Assignable, index: number, design: PinoutDesign, pinSide: Map<string, 'left' | 'right'>, width: number, height: number): PinoutDiagramNodeLayout {
  if (item.definitionId === 'cd74hc4067') return { id: item.id, x: boardBox.x - width - 145, y: 160 + design.muxes.findIndex((mux) => mux.id === item.id) * 220, width, height }
  const componentIndex = design.components.findIndex((component) => component.id === item.id)
  const targetSides = design.connections.filter((connection) => connection.componentId === item.id && connection.target.kind === 'board').map((connection) => connection.target.kind === 'board' ? pinSide.get(connection.target.pin) : undefined)
  const usesMux = design.connections.some((connection) => connection.componentId === item.id && connection.target.kind === 'mux-channel')
  const x = usesMux || targetSides.includes('left') ? boardBox.x - width - 460 : boardBox.x + boardBox.width + 145
  return { id: item.id, x, y: 150 + componentIndex * Math.max(128, height + 18), width, height }
}

function boardTargetAvailability(design: PinoutDesign, item: Assignable, role: PinoutComponentRole, pin: BoardPinCapability): { available: boolean; reason: string } {
  const key = getConnectionKey(item.id, role.role)
  if (!compatiblePin(pin, role)) return { available: false, reason: 'incompatible pin' }
  const owners = design.connections.filter((connection) => getConnectionKey(connection.componentId, connection.role) !== key && connection.target.kind === 'board' && connection.target.pin === pin.pin)
  const blockingOwners = role.kind === 'i2c' && pin.i2c ? owners.filter((connection) => getConnectionRoleKind(design, connection) !== 'i2c') : owners
  if (blockingOwners.length > 0) return { available: false, reason: 'already used' }
  if (item.definitionId === 'cd74hc4067' && role.role === 'sig') {
    const mux = item as PlacedMux
    if (mux.sigMode === 'analog' && !pin.analogIn) return { available: false, reason: 'SIG needs analog' }
    if (mux.sigMode === 'digital' && !pin.digital) return { available: false, reason: 'SIG needs digital' }
  }
  return { available: true, reason: '' }
}

function muxTargetAvailability(design: PinoutDesign, item: Assignable, role: PinoutComponentRole, muxId: string, channel: number): { available: boolean; reason: string } {
  const key = getConnectionKey(item.id, role.role)
  if (item.definitionId === 'cd74hc4067' || !role.muxCapable) return { available: false, reason: 'not MUX-capable' }
  const owner = design.connections.find((connection) => getConnectionKey(connection.componentId, connection.role) !== key && connection.target.kind === 'mux-channel' && connection.target.muxId === muxId && connection.target.channel === channel)
  return owner ? { available: false, reason: 'channel used' } : { available: true, reason: '' }
}

function getConnectionRoleKind(design: PinoutDesign, connection: Connection): string | undefined {
  const owner = [...design.muxes, ...design.components].find((item) => item.id === connection.componentId)
  const definition = owner ? PINOUT_COMPONENT_LIBRARY.find((entry) => entry.id === owner.definitionId) : undefined
  return definition?.roles.find((role) => role.role === connection.role)?.kind
}

function findNearestTarget(point: Point, targets: TargetEndpoint[], availableOnly: boolean): TargetEndpoint | null {
  let best: { target: TargetEndpoint; distance: number } | null = null
  for (const target of targets) {
    if (availableOnly && !target.available) continue
    const distance = Math.hypot(point.x - target.point.x, point.y - target.point.y)
    if (distance <= 24 && (!best || distance < best.distance)) best = { target, distance }
  }
  return best?.target ?? null
}

function findRole(design: PinoutDesign, componentId: string, roleId: string): { item: Assignable; role: PinoutComponentRole } | null {
  const item = [...design.muxes, ...design.components].find((entry) => entry.id === componentId)
  const definition = item ? PINOUT_COMPONENT_LIBRARY.find((entry) => entry.id === item.definitionId) : undefined
  const role = definition?.roles.find((entry) => entry.role === roleId)
  return item && role ? { item, role } : null
}

function curvePath(from: Point, to: Point): string {
  const dx = Math.max(70, Math.abs(to.x - from.x) * 0.45)
  const c1 = { x: from.x + (to.x >= from.x ? dx : -dx), y: from.y }
  const c2 = { x: to.x - (to.x >= from.x ? dx : -dx), y: to.y }
  return `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`
}

function compatiblePin(pin: BoardPinCapability, role: PinoutComponentRole): boolean {
  if (pin.power) return false
  if (role.kind === 'any') return pin.digital || pin.analogIn || pin.pwm || Boolean(pin.i2c)
  if (role.kind === 'digital') return pin.digital
  if (role.kind === 'analog') return pin.analogIn
  if (role.kind === 'pwm') return pin.pwm
  if (role.kind === 'i2c') return role.role === 'sda' ? pin.i2c === 'sda' : role.role === 'scl' ? pin.i2c === 'scl' : Boolean(pin.i2c)
  return false
}

function pinColor(pin: BoardPinCapability): string {
  if (pin.power === 'gnd') return colors.ground
  if (pin.power === '3v3') return colors.power3v3
  if (pin.power) return colors.power5v
  if (pin.i2c) return colors.i2c
  if (pin.analogIn) return colors.analog
  if (pin.pwm) return colors.pwm
  return pin.digital ? colors.digital : colors.muted
}

function roleColor(kind: string): string {
  if (kind === 'analog') return colors.analog
  if (kind === 'pwm') return colors.pwm
  if (kind === 'i2c') return colors.i2c
  if (kind === 'any') return colors.mux
  return colors.digital
}

function pinTags(pin: BoardPinCapability): string[] {
  const tags: string[] = []
  if (pin.digital) tags.push('D')
  if (pin.analogIn) tags.push('A')
  if (pin.pwm) tags.push('PWM')
  if (pin.i2c) tags.push(pin.i2c.toUpperCase())
  if (pin.spi) tags.push(`SPI-${pin.spi.toUpperCase()}`)
  return tags
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

const shellStyle: CSSProperties = { display: 'grid', gap: 10 }
const toolbarStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 8 }
const buttonRowStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }
const toolButtonStyle: CSSProperties = { border: '1px solid rgba(148,163,184,.28)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', background: '#111827', color: colors.text, cursor: 'pointer', fontWeight: 800 }
const saveButtonStyle: CSSProperties = { ...toolButtonStyle, background: 'var(--accent-primary)', borderColor: 'var(--border-strong)' }
const svgStyle: CSSProperties = { width: '100%', minHeight: 620, background: colors.panel, borderRadius: 'var(--radius-sm)', touchAction: 'none', cursor: 'grab' }
const hintStyle: CSSProperties = { margin: '4px 0 0', color: colors.muted, fontSize: 12, lineHeight: 1.4 }
const statusStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, color: colors.muted, fontSize: 12 }
