/** Row models shared by the Engine API backend and the CLI backend. */

export interface DockerPortMapping {
  privatePort: number
  publicPort?: number
  type: string
  ip?: string
}

export interface DockerMountRow {
  type: string
  source: string
  destination: string
  mode: string
}

export interface DockerContainerRow {
  id: string
  name: string
  image: string
  imageId: string
  state: string
  status: string
  command: string
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  restartCount: number
  ports: DockerPortMapping[]
  labels: Record<string, string>
  networks: string[]
  mounts: DockerMountRow[]
}

export interface DockerImageRow {
  id: string
  repository: string
  tag: string
  size: number
  createdAt: number
  containers: number
  labels: Record<string, string>
}

export interface DockerVolumeRow {
  name: string
  driver: string
  mountpoint: string
  scope: string
  labels: Record<string, string>
  size: number | null
}

export interface DockerNetworkRow {
  id: string
  name: string
  driver: string
  scope: string
  internal: boolean
  ipv6: boolean
  createdAt: number
  labels: Record<string, string>
  containers: number
}

export interface DockerSystemInfo {
  name: string
  serverVersion: string
  os: string
  arch: string
  cpus: number
  memory: number
  containers: number
  containersRunning: number
  containersPaused: number
  containersStopped: number
  images: number
  driver: string
  dockerRootDir: string
  kernelVersion: string
  operatingSystem: string
}

export interface DockerStatsRow {
  id: string
  name: string
  cpuPercent: number
  memoryUsage: number
  memoryLimit: number
  memoryPercent: number
  networkRx: number
  networkTx: number
  blockRead: number
  blockWrite: number
  pids: number
}

export interface DockerVersionInfo {
  version: string
  apiVersion: string
  os: string
  arch: string
}

/** Parse `a=1,b=2` label strings produced by the Docker CLI. */
export function parseLabelString(raw: unknown): Record<string, string> {
  const labels: Record<string, string> = {}
  if (typeof raw !== 'string' || !raw.trim()) return labels
  for (const part of raw.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const idx = trimmed.indexOf('=')
    if (idx <= 0) {
      labels[trimmed] = ''
      continue
    }
    labels[trimmed.slice(0, idx)] = trimmed.slice(idx + 1)
  }
  return labels
}

/**
 * Parse the Docker CLI `Ports` column, e.g.
 * `0.0.0.0:8080->80/tcp, :::8080->80/tcp, 443/tcp`.
 */
export function parsePortsString(raw: unknown): DockerPortMapping[] {
  const ports: DockerPortMapping[] = []
  if (typeof raw !== 'string' || !raw.trim()) return ports
  for (const part of raw.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const arrow = trimmed.indexOf('->')
    if (arrow < 0) {
      const bare = trimmed.match(/^(\d+)\/(\w+)$/)
      if (bare) {
        ports.push({ privatePort: Number(bare[1]), type: bare[2] })
      }
      continue
    }
    const left = trimmed.slice(0, arrow).trim()
    const right = trimmed.slice(arrow + 2).trim()
    const rightMatch = right.match(/^(\d+)\/(\w+)$/)
    if (!rightMatch) continue
    const privatePort = Number(rightMatch[1])
    const type = rightMatch[2]
    if (!left) {
      ports.push({ privatePort, type })
      continue
    }
    const leftMatch = left.match(/^(?:\[?([^\]]*)\]?:)?(\d+)$/)
    if (!leftMatch) {
      ports.push({ privatePort, type })
      continue
    }
    const ip = leftMatch[1] || undefined
    const publicPort = Number(leftMatch[2])
    ports.push({ privatePort, publicPort, type, ip })
  }
  return ports
}

/** Parse a human readable byte size such as `1.5GB`, `652MB` or `12MiB`. */
export function parseSizeString(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw !== 'string') return 0
  const match = raw.trim().match(/^([\d.]+)\s*([KMGTP]?i?B)$/i)
  if (!match) return 0
  const value = Number(match[1])
  if (!Number.isFinite(value)) return 0
  const unit = match[2].toUpperCase()
  const factors: Record<string, number> = {
    B: 1,
    KB: 1024,
    KIB: 1024,
    MB: 1024 ** 2,
    MIB: 1024 ** 2,
    GB: 1024 ** 3,
    GIB: 1024 ** 3,
    TB: 1024 ** 4,
    TIB: 1024 ** 4,
    PB: 1024 ** 5,
    PIB: 1024 ** 5
  }
  return Math.round(value * (factors[unit] ?? 1))
}

/**
 * Parse the timestamp columns produced by the Docker CLI.
 *
 * Depending on the CLI version these are either unix seconds or a human
 * readable date such as `2026-11-02 16:03:41 +0800 CST`.
 */
export function parseCliTimestamp(raw: unknown): number {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return 0
    return raw > 1e12 ? raw : raw * 1000
  }
  if (typeof raw !== 'string') return 0
  const trimmed = raw.trim()
  if (!trimmed) return 0
  if (/^\d+$/.test(trimmed)) {
    const value = Number(trimmed)
    return value > 1e12 ? value : value * 1000
  }
  // Drop the trailing zone abbreviation (`CST`) and normalise the offset.
  const withoutZone = trimmed.replace(/\s+[A-Z]{2,5}$/, '')
  const isoLike = withoutZone
    .replace(' ', 'T')
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
    // The daemon reports nanosecond precision, ISO only allows milliseconds.
    .replace(/(\.\d{3})\d+/, '$1')
  const parsed = Date.parse(isoLike)
  if (!Number.isNaN(parsed)) return parsed
  const fallback = Date.parse(trimmed)
  return Number.isNaN(fallback) ? 0 : fallback
}
