import { type CSSProperties, type ReactElement, useState } from 'react'
import type { PinoutComponentDefinition, PinoutComponentRole } from '../../../../shared/board-catalog'
import {
  getConnectionKey,
  type Connection,
  type ConnectionTarget,
  type PinoutDesign,
  type PinoutValidationResult,
  type PlacedComponent,
  type PlacedMux
} from '../../../../shared/pinout'

const MUX_CHANNEL_COUNT = 16

// A mux-capable component role that can be wired into one of the 16 channels.
export interface MuxCandidate {
  component: PlacedComponent
  role: PinoutComponentRole
  definition: PinoutComponentDefinition | undefined
}

interface MuxConnectionTreeProps {
  mux: PlacedMux
  design: PinoutDesign
  candidates: MuxCandidate[]
  validation: PinoutValidationResult
  connectionMap: Map<string, Connection>
  onConnect(componentId: string, role: string, target: ConnectionTarget | null): void
}

// Expandable per-multiplexer tree: the mux node opens to its 16 channels, and
// each channel node shows the component/role assigned to it (or an assign
// picker when empty). Mirrors the board connection flow: a channel already in
// use is locked until it is cleared, so the same slot can never be double-booked.
export function MuxConnectionTree({ mux, design, candidates, validation, connectionMap, onConnect }: MuxConnectionTreeProps): ReactElement {
  // Default open so adding a multiplexer visibly reveals its channel tree.
  const [expanded, setExpanded] = useState(true)

  // Resolve, for each channel, the candidate currently wired into it.
  const occupants = new Map<number, MuxCandidate>()
  for (const candidate of candidates) {
    const connection = connectionMap.get(getConnectionKey(candidate.component.id, candidate.role.role))
    if (connection?.target.kind === 'mux-channel' && connection.target.muxId === mux.id) {
      occupants.set(connection.target.channel, candidate)
    }
  }
  const takenChannels = new Set(validation.usedMuxChannels[mux.id] ?? [])
  const assignedCount = takenChannels.size

  function describeLocation(candidate: MuxCandidate): string {
    const connection = connectionMap.get(getConnectionKey(candidate.component.id, candidate.role.role))
    if (!connection) return ''
    const target = connection.target
    if (target.kind === 'board') return ` · on pin ${target.pin} → moves here`
    if (target.muxId === mux.id) return ` · on C${target.channel} → moves here`
    const otherMux = design.muxes.find((item) => item.id === target.muxId)
    return ` · on ${otherMux?.label ?? 'another MUX'} C${target.channel} → moves here`
  }

  return (
    <section style={treePanelStyle}>
      <button type="button" style={treeHeaderStyle} onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={twistyStyle}>{expanded ? '▾' : '▸'}</span>
          <span><b>{mux.label}</b> connection tree</span>
        </span>
        <span style={countBadgeStyle}>{assignedCount}/{MUX_CHANNEL_COUNT} channels used</span>
      </button>
      {expanded && (
        <div style={{ display: 'grid', gap: 6 }}>
          <p style={hintStyle}>Assign a mux-capable component to each channel C0–C15. A channel in use is locked until you clear it, so two parts can never share a channel.</p>
          {candidates.length === 0 ? (
            <p style={hintStyle}>Add buttons, pots, sensors or other mux-capable components to fill these channels.</p>
          ) : (
            <ul style={treeListStyle}>
              {Array.from({ length: MUX_CHANNEL_COUNT }, (_, channel) => {
                const occupant = occupants.get(channel)
                const reserved = takenChannels.has(channel)
                return (
                  <li key={channel} style={channelRowStyle}>
                    <span style={channelLabelStyle}>C{channel}</span>
                    {occupant ? (
                      <span style={occupantStyle}>
                        <span style={dotStyle('#34d399')} />
                        <span>
                          <b>{occupant.component.label}</b>
                          <small style={hintStyle}> {occupant.definition?.shortName ?? occupant.component.definitionId} · {occupant.role.label} · {occupant.role.kind.toUpperCase()}</small>
                        </span>
                        <button type="button" style={clearButtonStyle} onClick={() => onConnect(occupant.component.id, occupant.role.role, null)}>Clear</button>
                      </span>
                    ) : reserved ? (
                      <span style={occupantStyle}>
                        <span style={dotStyle('#f59e0b')} />
                        <small style={hintStyle}>Reserved by another assignment</small>
                      </span>
                    ) : (
                      <select
                        value=""
                        style={selectStyle}
                        onChange={(event) => {
                          const raw = event.target.value
                          if (!raw) return
                          const separator = raw.indexOf('::')
                          if (separator < 0) return
                          const componentId = raw.slice(0, separator)
                          const role = raw.slice(separator + 2)
                          onConnect(componentId, role, { kind: 'mux-channel', muxId: mux.id, channel })
                        }}
                      >
                        <option value="">○ Empty — choose a component…</option>
                        {candidates.map((candidate) => (
                          <option key={`${candidate.component.id}::${candidate.role.role}`} value={`${candidate.component.id}::${candidate.role.role}`}>
                            {candidate.component.label} · {candidate.role.label} ({candidate.role.kind}){describeLocation(candidate)}
                          </option>
                        ))}
                      </select>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

const treePanelStyle: CSSProperties = { display: 'grid', gap: 10, marginTop: 12, padding: 12, border: '1px solid rgba(20,184,166,.28)', borderRadius: 'var(--radius-sm)', background: 'rgba(13,148,136,.08)' }
const treeHeaderStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%', textAlign: 'left', border: '1px solid rgba(20,184,166,.32)', borderRadius: 'var(--radius-sm)', background: 'rgba(13,148,136,.16)', color: '#e5eefc', padding: '10px 12px', cursor: 'pointer', fontSize: 14 }
const twistyStyle: CSSProperties = { display: 'inline-flex', width: 16, justifyContent: 'center', color: '#5eead4' }
const countBadgeStyle: CSSProperties = { fontSize: 12, color: '#99f6e4', whiteSpace: 'nowrap' }
const treeListStyle: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6, borderLeft: '2px solid rgba(20,184,166,.32)', paddingLeft: 12, marginLeft: 8 }
const channelRowStyle: CSSProperties = { display: 'grid', gridTemplateColumns: '48px 1fr', gap: 10, alignItems: 'center' }
const channelLabelStyle: CSSProperties = { fontWeight: 700, color: '#5eead4', fontSize: 13 }
const occupantStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }
const clearButtonStyle: CSSProperties = { marginLeft: 'auto', border: '1px solid rgba(148,163,184,.25)', background: '#111827', color: '#e5eefc', borderRadius: 'var(--radius-sm)', padding: '6px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }
const selectStyle: CSSProperties = { width: '100%', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(148,163,184,.35)', background: 'var(--surface-sunken)', color: '#e5eefc', padding: '8px 10px' }
const hintStyle: CSSProperties = { color: '#9ca3af', fontSize: 12, lineHeight: 1.45 }
const dotStyle = (color: string): CSSProperties => ({ width: 8, height: 8, borderRadius: 'var(--radius-sm)', background: color, flex: '0 0 auto' })
