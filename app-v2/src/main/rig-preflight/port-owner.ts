import { execFile } from 'node:child_process'
import type { RigPortOwnerState } from '../../shared/rig-preflight'

export interface PortOwnerRow {
  localAddress: string
  localPort: number
  ownerPid: number
  ownerName?: string
}

export interface PortOwnershipProbe {
  port: number
  state: RigPortOwnerState
  ownerPid?: number
  ownerName?: string
  detail: string
}

export type PortProbeRunner = (
  executable: string,
  args: string[]
) => Promise<{ stdout: string; stderr: string }>

const defaultRunner: PortProbeRunner = (executable, args) =>
  new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      { windowsHide: true, timeout: 3_000, maxBuffer: 256 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(error)
          return
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) })
      }
    )
  })

function rowFromJson(value: unknown): PortOwnerRow | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const localPort = Number(row.LocalPort ?? row.localPort)
  const ownerPid = Number(row.OwningProcess ?? row.ownerPid)
  const localAddress = String(row.LocalAddress ?? row.localAddress ?? '')
  const ownerNameRaw = row.ProcessName ?? row.ownerName
  if (!Number.isInteger(localPort) || !Number.isInteger(ownerPid) || ownerPid <= 0) return null
  return {
    localAddress,
    localPort,
    ownerPid,
    ownerName: typeof ownerNameRaw === 'string' && ownerNameRaw.trim() ? ownerNameRaw.trim() : undefined
  }
}

export function parsePowerShellPortOwners(stdout: string): PortOwnerRow[] {
  const trimmed = stdout.replace(/^\uFEFF/, '').trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed) as unknown
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    return rows.map(rowFromJson).filter((row): row is PortOwnerRow => row !== null)
  } catch {
    return []
  }
}

function parseLocalPort(endpoint: string): number | null {
  const bracketed = /\]:(\d+)$/.exec(endpoint)
  const plain = /:(\d+)$/.exec(endpoint)
  const value = Number((bracketed ?? plain)?.[1])
  return Number.isInteger(value) ? value : null
}

export function parseNetstatPortOwners(stdout: string, port: number): PortOwnerRow[] {
  const rows: PortOwnerRow[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/)
    if (columns.length < 5 || columns[0].toUpperCase() !== 'TCP') continue
    if (columns[3].toUpperCase() !== 'LISTENING') continue
    const localPort = parseLocalPort(columns[1])
    const ownerPid = Number(columns[4])
    if (localPort !== port || !Number.isInteger(ownerPid) || ownerPid <= 0) continue
    rows.push({
      localAddress: columns[1],
      localPort,
      ownerPid
    })
  }
  return rows
}

function selectOwner(rows: PortOwnerRow[], appPid: number): PortOwnerRow | null {
  return rows.find((row) => row.ownerPid === appPid) ?? rows[0] ?? null
}

export async function probePortOwnership(
  port: number,
  appPid = process.pid,
  runner: PortProbeRunner = defaultRunner,
  platform: NodeJS.Platform = process.platform
): Promise<PortOwnershipProbe> {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return { port, state: 'unknown', detail: 'No valid TCP port was selected.' }
  }
  if (platform !== 'win32') {
    return { port, state: 'unknown', detail: 'OS port ownership probe is implemented for Windows.' }
  }

  const command = [
    `$rows = @(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | ForEach-Object {`,
    `  [pscustomobject]@{ LocalAddress=$_.LocalAddress; LocalPort=$_.LocalPort; OwningProcess=$_.OwningProcess; ProcessName=(Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName }`,
    '});',
    '$rows | ConvertTo-Json -Compress'
  ].join(' ')

  try {
    const { stdout } = await runner('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      command
    ])
    const owner = selectOwner(parsePowerShellPortOwners(stdout), appPid)
    if (!owner) return { port, state: 'free', detail: `No listening TCP owner found on port ${port}.` }
    return {
      port,
      state: owner.ownerPid === appPid ? 'app' : 'foreign',
      ownerPid: owner.ownerPid,
      ownerName: owner.ownerName,
      detail: `Windows Get-NetTCPConnection reported ${owner.localAddress}:${port}.`
    }
  } catch {
    try {
      const { stdout } = await runner('netstat.exe', ['-ano', '-p', 'tcp'])
      const owner = selectOwner(parseNetstatPortOwners(stdout, port), appPid)
      if (!owner) return { port, state: 'free', detail: `No netstat listener found on port ${port}.` }
      return {
        port,
        state: owner.ownerPid === appPid ? 'app' : 'foreign',
        ownerPid: owner.ownerPid,
        detail: `Windows netstat reported a listening owner on port ${port}.`
      }
    } catch (error) {
      return {
        port,
        state: 'unknown',
        detail: `Port ownership query failed: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }
}
