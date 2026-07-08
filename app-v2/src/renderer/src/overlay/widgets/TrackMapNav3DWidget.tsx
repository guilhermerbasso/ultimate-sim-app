import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react'
// @ts-ignore three is shipped JS-only in this app (no @types/three dependency).
import * as THREE from 'three'
// @ts-ignore three examples are shipped JS-only in this app.
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { DriverEntry } from '../../../../shared/telemetry'
import type { TrackMapRenderable, TrackMapSamplePoint } from '../../lib/track-map'
import { useTrackMapData } from '../../lib/track-map'
import type { WidgetProps } from './types'
import { TrackMapWidget } from './TrackMapWidget'

const DEFAULT_W = 560
const DEFAULT_H = 360
const CYAN = '#45e9ff'

type WorldPoint = { x: number; z: number }

type RivalMarker = {
  key: string
  x: number
  z: number
  color: string
  closest: boolean
  label: string
}

type NavSceneModel = {
  ribbon: any
  edgeLeft: any
  edgeRight: any
  curbs: Array<{ key: string; x: number; z: number; angle: number; color: string }>
  player: WorldPoint
  heading: number
  rivals: RivalMarker[]
  cameraDistance: number
  lookAhead: number
}

export function TrackMapNav3DWidget(props: WidgetProps): ReactElement {
  const { snapshot, config } = props
  const [webglReady, setWebglReady] = useState(false)
  const [follow, setFollow] = useState(true)
  const { renderable } = useTrackMapData()
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))
  const sceneModel = useMemo(() => buildNavSceneModel(renderable, snapshot?.lapDistPct, snapshot?.drivers ?? [], snapshot?.playerCarIdx), [renderable, snapshot?.lapDistPct, snapshot?.drivers, snapshot?.playerCarIdx])

  useEffect(() => {
    setWebglReady(canUseWebGL())
  }, [])

  if (!webglReady) {
    return (
      <div data-widget="trackMapNav3D" data-fallback="svg" style={fallbackWrapStyle(W, H)}>
        <TrackMapWidget {...props} />
      </div>
    )
  }

  if (!sceneModel || !snapshot || !Number.isFinite(snapshot.lapDistPct ?? NaN)) {
    return <IdleNavMap width={W} height={H} />
  }

  return (
    <div data-widget="trackMapNav3D" style={rootStyle(W, H)}>
      <Canvas
        camera={{ position: [0, 34, 52], fov: 54, near: 0.1, far: 420 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        dpr={[1, 1.6]}
        onCreated={({ scene }) => {
          scene.background = new THREE.Color('#020712')
          scene.fog = new THREE.FogExp2('#020712', 0.012)
        }}
      >
        <NavScene model={sceneModel} follow={follow} setFollow={setFollow} />
      </Canvas>
      <div style={cornerCalloutStyle} aria-label="upcoming corner marker">
        <span style={turnArrowStyle}>↱</span>
        <span>1</span>
      </div>
      <button type="button" style={recenterStyle(follow)} onClick={() => setFollow(true)}>
        {follow ? 'FOLLOW' : 'RECENTER'}
      </button>
      <div style={hintStyle}>wheel zoom · drag rotate · right-drag pan</div>
    </div>
  )
}

function NavScene({ model, follow, setFollow }: { model: NavSceneModel; follow: boolean; setFollow: (next: boolean) => void }): ReactElement {
  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight position={[20, 42, 16]} intensity={1.2} color="#dff8ff" />
      <pointLight position={[model.player.x, 2.5, model.player.z]} intensity={3.2} distance={28} color={CYAN} />
      <FollowCamera model={model} follow={follow} setFollow={setFollow} />
      <GroundGrid />
      <TrackRibbon model={model} />
      <PlayerChevron x={model.player.x} z={model.player.z} heading={model.heading} />
      {model.rivals.map((rival) => (
        <RivalDot key={rival.key} rival={rival} />
      ))}
    </>
  )
}

function FollowCamera({ model, follow, setFollow }: { model: NavSceneModel; follow: boolean; setFollow: (next: boolean) => void }): null {
  const { camera, gl } = useThree()
  const controlsRef = useRef<any>(null)

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.enablePan = true
    controls.enableZoom = true
    controls.enableRotate = true
    controls.minDistance = 18
    controls.maxDistance = 150
    controls.maxPolarAngle = Math.PI * 0.47
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    }
    const stopFollow = (): void => setFollow(false)
    controls.addEventListener('start', stopFollow)
    controlsRef.current = controls
    return () => {
      controls.removeEventListener('start', stopFollow)
      controls.dispose()
      controlsRef.current = null
    }
  }, [camera, gl.domElement, setFollow])

  useFrame(() => {
    const controls = controlsRef.current
    if (follow) {
      const forward = new THREE.Vector3(Math.sin(model.heading), 0, Math.cos(model.heading))
      const player = new THREE.Vector3(model.player.x, 0, model.player.z)
      const target = player.clone().addScaledVector(forward, model.lookAhead)
      const desired = player.clone().addScaledVector(forward, -model.cameraDistance).add(new THREE.Vector3(0, model.cameraDistance * 0.72, 0))
      camera.position.lerp(desired, 0.16)
      if (controls) controls.target.lerp(target, 0.22)
      camera.lookAt(controls?.target ?? target)
    }
    controls?.update()
  })

  return null
}

function GroundGrid(): ReactElement {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.12, 0]}>
        <planeGeometry args={[420, 420, 1, 1]} />
        <meshStandardMaterial color="#020813" roughness={0.96} metalness={0.05} />
      </mesh>
      <gridHelper args={[420, 42, '#06314a', '#031b2b']} position={[0, -0.08, 0]} />
    </group>
  )
}

function TrackRibbon({ model }: { model: NavSceneModel }): ReactElement {
  return (
    <group>
      <mesh geometry={model.ribbon} receiveShadow>
        <meshStandardMaterial color="#121a21" roughness={0.86} metalness={0.16} emissive="#02070b" />
      </mesh>
      <GlowLine geometry={model.edgeLeft} />
      <GlowLine geometry={model.edgeRight} />
      {model.curbs.map((curb) => (
        <mesh key={curb.key} position={[curb.x, 0.08, curb.z]} rotation={[0, curb.angle, 0]}>
          <boxGeometry args={[1.15, 0.12, 2.6]} />
          <meshStandardMaterial color={curb.color} emissive={curb.color === '#f2f7ff' ? '#8fb7c8' : '#5b0707'} emissiveIntensity={0.35} roughness={0.5} />
        </mesh>
      ))}
    </group>
  )
}

function GlowLine({ geometry }: { geometry: any }): ReactElement {
  const line = useMemo(() => new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: CYAN, linewidth: 2, toneMapped: false })), [geometry])
  return <primitive object={line} />
}

function PlayerChevron({ x, z, heading }: { x: number; z: number; heading: number }): ReactElement {
  const shape = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(0, 3.9)
    s.lineTo(3.1, -3.4)
    s.lineTo(0, -1.55)
    s.lineTo(-3.1, -3.4)
    s.lineTo(0, 3.9)
    return s
  }, [])
  return (
    <group position={[x, 0.35, z]} rotation={[Math.PI / 2, 0, -heading]}>
      <mesh>
        <shapeGeometry args={[shape]} />
        <meshBasicMaterial color={CYAN} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, -0.02]} scale={[1.32, 1.32, 1]}>
        <shapeGeometry args={[shape]} />
        <meshBasicMaterial color="#0aa9d6" transparent opacity={0.22} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <pointLight position={[0, 0, 2]} intensity={2.7} distance={18} color={CYAN} />
    </group>
  )
}

function RivalDot({ rival }: { rival: RivalMarker }): ReactElement {
  return (
    <group position={[rival.x, 0.42, rival.z]}>
      <mesh>
        <sphereGeometry args={[rival.closest ? 1.55 : 1.15, 20, 12]} />
        <meshBasicMaterial color={rival.color} toneMapped={false} />
      </mesh>
      <pointLight intensity={rival.closest ? 2.8 : 1.4} distance={14} color={rival.color} />
    </group>
  )
}

function buildNavSceneModel(map: TrackMapRenderable | null, playerPctRaw: number | undefined, drivers: DriverEntry[], playerCarIdx?: number): NavSceneModel | null {
  const playerPct = clamp01(playerPctRaw)
  if (!map || map.totalLength <= 0 || playerPct === null) return null
  const samples = sampleLoop(map, 260)
  if (samples.length < 12) return null
  const world = normalizePoints(samples, map.viewBox)
  const playerPt = map.sample(playerPct)
  if (!playerPt) return null
  const player = normalizePoint(playerPt, map.viewBox)
  const heading = headingAt(map, playerPct, map.viewBox)
  const roadWidth = Math.max(5.2, 10 - Math.min(3.2, map.viewBox[2] + map.viewBox[3]))
  const ribbon = buildRibbonGeometry(world, roadWidth)
  const { left, right } = buildEdgeGeometries(world, roadWidth)
  const curbs = buildCurbs(world, roadWidth)
  const rivals = buildRivals(map, map.viewBox, drivers, playerCarIdx, playerPct)
  return {
    ribbon,
    edgeLeft: left,
    edgeRight: right,
    curbs,
    player,
    heading,
    rivals,
    cameraDistance: 46,
    lookAhead: 22
  }
}

function sampleLoop(map: TrackMapRenderable, count: number): TrackMapSamplePoint[] {
  const points: TrackMapSamplePoint[] = []
  for (let i = 0; i < count; i++) {
    const pt = map.sample(i / count)
    if (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) points.push(pt)
  }
  return points
}

function normalizePoints(points: TrackMapSamplePoint[], viewBox: [number, number, number, number]): WorldPoint[] {
  return points.map((pt) => normalizePoint(pt, viewBox))
}

function normalizePoint(pt: TrackMapSamplePoint, viewBox: [number, number, number, number]): WorldPoint {
  const [x, y, w, h] = viewBox
  const scale = 156 / Math.max(w, h, 0.001)
  return {
    x: (pt.x - (x + w / 2)) * scale,
    z: -(pt.y - (y + h / 2)) * scale
  }
}

function headingAt(map: TrackMapRenderable, pct: number, viewBox: [number, number, number, number]): number {
  const before = map.sample(pct - 0.004)
  const after = map.sample(pct + 0.004)
  if (!before || !after) return 0
  const a = normalizePoint(before, viewBox)
  const b = normalizePoint(after, viewBox)
  return Math.atan2(b.x - a.x, b.z - a.z)
}

function buildRibbonGeometry(points: WorldPoint[], width: number): any {
  const vertices: number[] = []
  const indices: number[] = []
  const normals = pointNormals(points)
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const n = normals[i]
    vertices.push(p.x + n.x * width * 0.5, 0, p.z + n.z * width * 0.5)
    vertices.push(p.x - n.x * width * 0.5, 0, p.z - n.z * width * 0.5)
  }
  for (let i = 0; i < points.length; i++) {
    const next = (i + 1) % points.length
    const a = i * 2
    const b = next * 2
    indices.push(a, a + 1, b, a + 1, b + 1, b)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function buildEdgeGeometries(points: WorldPoint[], width: number): { left: any; right: any } {
  const normals = pointNormals(points)
  const left: THREE.Vector3[] = []
  const right: THREE.Vector3[] = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const n = normals[i]
    left.push(new THREE.Vector3(p.x + n.x * width * 0.56, 0.18, p.z + n.z * width * 0.56))
    right.push(new THREE.Vector3(p.x - n.x * width * 0.56, 0.18, p.z - n.z * width * 0.56))
  }
  left.push(left[0].clone())
  right.push(right[0].clone())
  return {
    left: new THREE.BufferGeometry().setFromPoints(left),
    right: new THREE.BufferGeometry().setFromPoints(right)
  }
}

function buildCurbs(points: WorldPoint[], width: number): NavSceneModel['curbs'] {
  const normals = pointNormals(points)
  const curbs: NavSceneModel['curbs'] = []
  for (let i = 5; i < points.length; i += 7) {
    const prev = points[(i - 4 + points.length) % points.length]
    const p = points[i]
    const next = points[(i + 4) % points.length]
    const turn = Math.abs(angleDelta(Math.atan2(p.x - prev.x, p.z - prev.z), Math.atan2(next.x - p.x, next.z - p.z)))
    if (turn < 0.18) continue
    const n = normals[i]
    const side = i % 2 === 0 ? 1 : -1
    curbs.push({
      key: `curb-${i}`,
      x: p.x + n.x * width * 0.7 * side,
      z: p.z + n.z * width * 0.7 * side,
      angle: Math.atan2(next.x - prev.x, next.z - prev.z),
      color: curbs.length % 2 === 0 ? '#d83232' : '#f2f7ff'
    })
  }
  return curbs.slice(0, 28)
}

function buildRivals(map: TrackMapRenderable, viewBox: [number, number, number, number], drivers: DriverEntry[], playerCarIdx: number | undefined, playerPct: number): RivalMarker[] {
  const candidates = drivers
    .filter((driver) => !driver.isPlayer && driver.carIdx !== playerCarIdx && Number.isFinite(driver.lapDistPct ?? NaN))
    .map((driver) => ({ driver, distance: lapDistance(playerPct, driver.lapDistPct ?? 0) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 12)
  const closestIdx = candidates[0]?.driver.carIdx
  return candidates
    .map(({ driver }) => {
      const pt = map.sample(driver.lapDistPct ?? 0)
      if (!pt) return null
      const world = normalizePoint(pt, viewBox)
      const closest = driver.carIdx === closestIdx
      return {
        key: String(driver.carIdx),
        x: world.x,
        z: world.z,
        color: closest ? '#ff4b55' : driver.classColor ?? '#b05cff',
        closest,
        label: driver.name
      }
    })
    .filter((rival): rival is RivalMarker => rival !== null)
}

function pointNormals(points: WorldPoint[]): WorldPoint[] {
  return points.map((point, i) => {
    const prev = points[(i - 1 + points.length) % points.length]
    const next = points[(i + 1) % points.length]
    const dx = next.x - prev.x
    const dz = next.z - prev.z
    const len = Math.hypot(dx, dz) || 1
    return { x: -dz / len, z: dx / len }
  })
}

function lapDistance(a: number, b: number): number {
  const delta = Math.abs(a - b) % 1
  return Math.min(delta, 1 - delta)
}

function angleDelta(a: number, b: number): number {
  let delta = (b - a + Math.PI) % (Math.PI * 2) - Math.PI
  if (delta < -Math.PI) delta += Math.PI * 2
  return delta
}

function clamp01(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) return null
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function canUseWebGL(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

function IdleNavMap({ width, height }: { width: number; height: number }): ReactElement {
  return (
    <div data-widget="trackMapNav3D" data-state="idle" style={rootStyle(width, height)}>
      <div style={idleGridStyle} />
      <div style={idleTextStyle}>Waiting for track-map telemetry</div>
    </div>
  )
}

function rootStyle(width: number, height: number): CSSProperties {
  return {
    width: '100%',
    height: '100%',
    minWidth: width,
    minHeight: height,
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 18,
    background: 'radial-gradient(circle at 50% 88%, rgba(14, 231, 255, 0.16), transparent 22%), linear-gradient(180deg, #02050d 0%, #06111b 58%, #02060d 100%)',
    boxShadow: 'inset 0 0 0 1px rgba(74, 232, 255, 0.16), inset 0 -42px 88px rgba(0, 0, 0, 0.42)'
  }
}

function fallbackWrapStyle(width: number, height: number): CSSProperties {
  return {
    width: '100%',
    height: '100%',
    minWidth: width,
    minHeight: height,
    position: 'relative'
  }
}

const cornerCalloutStyle: CSSProperties = {
  position: 'absolute',
  left: '50%',
  top: 14,
  transform: 'translateX(-50%)',
  display: 'grid',
  placeItems: 'center',
  width: 42,
  height: 56,
  border: '1px solid rgba(69, 233, 255, 0.72)',
  borderRadius: 7,
  color: '#dffbff',
  background: 'rgba(2, 9, 18, 0.7)',
  boxShadow: '0 0 20px rgba(69, 233, 255, 0.22)',
  font: '700 13px Inter, system-ui, sans-serif',
  pointerEvents: 'none'
}

const turnArrowStyle: CSSProperties = { color: CYAN, fontSize: 28, lineHeight: 1, marginBottom: -10 }

function recenterStyle(follow: boolean): CSSProperties {
  return {
    position: 'absolute',
    right: 12,
    top: 12,
    border: '1px solid rgba(69, 233, 255, 0.45)',
    borderRadius: 999,
    padding: '6px 10px',
    background: follow ? 'rgba(69, 233, 255, 0.18)' : 'rgba(4, 12, 20, 0.72)',
    color: '#dffbff',
    font: '800 10px Inter, system-ui, sans-serif',
    letterSpacing: 0.8,
    cursor: 'pointer'
  }
}

const hintStyle: CSSProperties = {
  position: 'absolute',
  left: 12,
  bottom: 10,
  color: 'rgba(210, 246, 255, 0.62)',
  font: '700 10px Inter, system-ui, sans-serif',
  letterSpacing: 0.3,
  pointerEvents: 'none'
}

const idleGridStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  backgroundImage: 'linear-gradient(rgba(69, 233, 255, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(69, 233, 255, 0.08) 1px, transparent 1px)',
  backgroundSize: '34px 34px',
  maskImage: 'linear-gradient(180deg, transparent, black 30%, black 70%, transparent)',
  opacity: 0.42
}

const idleTextStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  color: 'rgba(216, 246, 255, 0.72)',
  font: '800 13px Inter, system-ui, sans-serif',
  letterSpacing: 0.6,
  textTransform: 'uppercase'
}


