import { Client, type ClientChannel, type SFTPWrapper, type FileEntry } from 'ssh2'
import { promises as fsp } from 'fs'
import { dirname, join, basename } from 'path'
import { randomUUID } from 'crypto'
import type { SshNode } from './ssh-store'
import { connectViaJump, endClientChain } from './ssh-connect'

export interface SshShellStartOpts {
  nodeId: string
  cols?: number
  rows?: number
  term?: string
}

export interface SshShellData {
  sessionId: string
  data: string
}

export interface SshShellExit {
  sessionId: string
  reason?: string
}

export interface SshExecData {
  sessionId: string
  data: string
}

export interface SshTailExit {
  sessionId: string
  reason?: string
}

export interface SshSftpEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink' | 'other'
  size: number
  modifyTime: number
  accessTime: number
  owner?: number
  group?: number
  mode?: number
  /** true when the entry is a symbolic link; `type` is resolved to the link target */
  isSymlink?: boolean
}

export interface SshSftpReadResult {
  ok: boolean
  content?: string
  binary?: boolean
  truncated?: boolean
  size?: number
  maxBytes?: number
  error?: string
}

export const SSH_SFTP_READ_MAX_BYTES = 10 * 1024 * 1024

export interface SshSysInfoDisk {
  filesystem: string
  mount: string
  size: number
  used: number
  avail: number
  usePercent: number
}

export interface SshSysInfo {
  platform: 'linux' | 'darwin' | 'other'
  hostname: string
  os: { name: string; kernel: string; arch: string }
  cpu: { model: string; cores: number; usage: number | null }
  mem: { total: number; used: number }
  swap: { total: number; used: number }
  uptime: number
  loadavg: number[]
  disks: SshSysInfoDisk[]
}

export type SshSysInfoResult = { ok: true; info: SshSysInfo } | { ok: false; error: string }

export interface SshProcessInfo {
  pid: number
  ppid: number
  user: string
  cpu: number
  mem: number
  rss: number
  stat: string
  etimes: number
  cmd: string
}

export function parsePsOutput(raw: string): SshProcessInfo[] {
  const processes: SshProcessInfo[] = []
  const lines = raw.split(/\r?\n/)
  for (const line of lines) {
    if (!line) continue
    if (/^PID\s/.test(line)) continue
    const match = line.match(
      /^\s*(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.*)$/
    )
    if (!match) continue
    const [, pid, ppid, user, cpu, mem, rss, stat, etimes, cmd] = match
    processes.push({
      pid: Number(pid),
      ppid: Number(ppid),
      user,
      cpu: Number(cpu),
      mem: Number(mem),
      rss: Number(rss),
      stat,
      etimes: Number(etimes),
      cmd: cmd.trim()
    })
  }
  return processes
}

export interface SshServiceInfo {
  unit: string
  loaded: string
  active: string
  sub: string
  description: string
}

export interface SshPortInfo {
  protocol: string
  address: string
  port: number
  state: string
  pid: number | null
  process: string
}

export function parseSsOutput(raw: string): SshPortInfo[] {
  const ports: SshPortInfo[] = []
  const lines = raw.split(/\r?\n/)
  for (const line of lines) {
    if (!line.trim()) continue
    if (/^Netid\s/.test(line) || /^State\s/.test(line) || /^Proto\s/.test(line)) continue
    // ss -tulnp columns: Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port Process
    const match = line.match(/^\s*(\S+)\s+(\S+)\s+\S+\s+\S+\s+(\S+)\s+\S+\s+(.*)$/)
    if (!match) continue
    const [, protocol, state, local, rest] = match
    const port = parsePortFromAddr(local)
    if (port === null) continue
    const pid = parsePidFromProcess(rest)
    ports.push({
      protocol,
      address: stripPortFromAddr(local),
      port,
      state: state || '',
      pid,
      process: parseProcessFromText(rest)
    })
  }
  return ports
}

export function parseNetstatOutput(raw: string): SshPortInfo[] {
  const ports: SshPortInfo[] = []
  const lines = raw.split(/\r?\n/)
  for (const line of lines) {
    if (!line.trim()) continue
    if (/^Proto\s/.test(line) || /^Active/.test(line)) continue
    // netstat -tulnp columns: Proto Recv-Q Send-Q Local Address Foreign Address State PID/Program name
    const match = line.match(/^\s*(\S+)\s+\S+\s+\S+\s+(\S+)\s+\S+\s+(\S+)\s+(.*)$/)
    if (!match) continue
    const [, protocol, local, state, rest] = match
    const port = parsePortFromAddr(local)
    if (port === null) continue
    const pidMatch = rest.match(/^\s*(\d+)\/(\S+)/)
    ports.push({
      protocol,
      address: stripPortFromAddr(local),
      port,
      state: state || '',
      pid: pidMatch ? Number(pidMatch[1]) : null,
      process: pidMatch ? pidMatch[2] : rest.trim()
    })
  }
  return ports
}

function parsePortFromAddr(addr: string): number | null {
  if (!addr) return null
  // IPv6: [::]:8080 or *:8080 ; IPv4: 0.0.0.0:8080 ; host:port
  const m = addr.match(/^(?:\[[^\]]*\]|[^:]*):(\d+)$/)
  return m ? Number(m[1]) : null
}

function stripPortFromAddr(addr: string): string {
  if (!addr) return ''
  const m = addr.match(/^(\[[^\]]*\]|[^:]*):\d+$/)
  return m ? m[1] : addr
}

function parsePidFromProcess(text: string): number | null {
  const m = text.match(/pid=(\d+)/)
  return m ? Number(m[1]) : null
}

function parseProcessFromText(text: string): string {
  const m = text.match(/"([^"]+)"|users:\(\(([^,]+)/)
  if (!m) return text.trim()
  return (m[1] || m[2] || '').trim()
}

export function parseSystemctlOutput(raw: string): SshServiceInfo[] {
  const services: SshServiceInfo[] = []
  const lines = raw.split(/\r?\n/)
  for (const line of lines) {
    if (!line) continue
    if (/^\s*UNIT\s/.test(line) || /LOADED\s+ACTIVE/.test(line)) continue
    const match = line.match(/^([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+(.*)$/)
    if (!match) continue
    const [, unit, loaded, active, sub, description] = match
    if (!unit.endsWith('.service')) continue
    services.push({ unit, loaded, active, sub, description: description.trim() })
  }
  return services
}

function normalizeSshError(message: string): string {
  if (/host key|host denied|verification failed/i.test(message)) return 'HOST_KEY_MISMATCH'
  if (
    /authentication failed|all configured authentication|permission denied|unable to authenticate/i.test(
      message
    )
  ) {
    return 'AUTH_FAILED'
  }
  return message
}

export interface SshClientManagerOptions {
  getNode: (nodeId: string) => SshNode | undefined
  verifyHostKey?: (host: string, port: number, key: Buffer) => boolean | Promise<boolean>
}

function posixJoin(base: string, name: string): string {
  if (base === '/' || base === '') return `/${name}`
  return `${base.replace(/\/+$/, '')}/${name}`
}

const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFLNK = 0o120000
const S_IFREG = 0o100000

function entryType(attrs: {
  mode?: number
  isDirectory?: () => boolean
  isSymbolicLink?: () => boolean
  isFile?: () => boolean
}): SshSftpEntry['type'] {
  if (typeof attrs.isDirectory === 'function') {
    if (attrs.isDirectory()) return 'directory'
    if (attrs.isSymbolicLink?.()) return 'symlink'
    if (attrs.isFile?.()) return 'file'
    return 'other'
  }
  const mode = attrs.mode ?? 0
  const type = mode & S_IFMT
  if (type === S_IFDIR) return 'directory'
  if (type === S_IFLNK) return 'symlink'
  if (type === S_IFREG) return 'file'
  return 'other'
}

interface ShellSession {
  sessionId: string
  nodeId: string
  client: Client
  jumpClients: Client[]
  channel: ClientChannel
}

interface SftpSession {
  nodeId: string
  client: Client
  jumpClients: Client[]
  sftp: SFTPWrapper
}

/** Collects system stats over `sh -s` (script fed via stdin) into a line-based `KEY|VAL` protocol. */
const SYSINFO_SCRIPT = `#!/bin/sh
uname_s=$(uname -s)
osname=$uname_s
cores=0
model=""
usage=""
memtotal=0
memavail=""
memfree=""
swaptotal=0
swapfree=""
up=0
la1=0
la2=0
la3=0
case "$uname_s" in
  Linux)
    if [ -r /etc/os-release ]; then
      osname=$(awk -F= '/^PRETTY_NAME=/{print $2}' /etc/os-release | tr -d '"')
    fi
    [ -n "$osname" ] || osname="$uname_s"
    cores=$(grep -c '^processor' /proc/cpuinfo 2>/dev/null)
    model=$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | sed 's/^[^:]*:[[:space:]]*//')
    [ -n "$model" ] || model=$(grep -m1 '^Hardware' /proc/cpuinfo 2>/dev/null | sed 's/^[^:]*:[[:space:]]*//')
    c1=$(grep '^cpu ' /proc/stat 2>/dev/null | sed 's/^cpu[[:space:]]*//')
    sleep 0.4
    c2=$(grep '^cpu ' /proc/stat 2>/dev/null | sed 's/^cpu[[:space:]]*//')
    set -- $c1
    u1=$1; n1=$2; s1=$3; i1=$4; w1=$5; ir1=$6; si1=$7; st1=$8
    set -- $c2
    u2=$1; n2=$2; s2=$3; i2=$4; w2=$5; ir2=$6; si2=$7; st2=$8
    idle1=$((i1 + w1)); idle2=$((i2 + w2))
    tot1=$((u1 + n1 + s1 + i1 + w1 + ir1 + si1 + st1))
    tot2=$((u2 + n2 + s2 + i2 + w2 + ir2 + si2 + st2))
    dt=$((tot2 - tot1)); di=$((idle2 - idle1))
    if [ "$dt" -gt 0 ]; then usage=$(((100 * (dt - di)) / dt)); else usage=0; fi
    memtotal_kb=$(awk '/^MemTotal:/{print $2}' /proc/meminfo 2>/dev/null)
    memavail_kb=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo 2>/dev/null)
    [ -n "$memavail_kb" ] || memavail_kb=$(awk '/^MemFree:/{print $2}' /proc/meminfo 2>/dev/null)
    swaptotal_kb=$(awk '/^SwapTotal:/{print $2}' /proc/meminfo 2>/dev/null)
    swapfree_kb=$(awk '/^SwapFree:/{print $2}' /proc/meminfo 2>/dev/null)
    [ -n "$memtotal_kb" ] || memtotal_kb=0
    [ -n "$memavail_kb" ] || memavail_kb=0
    [ -n "$swaptotal_kb" ] || swaptotal_kb=0
    [ -n "$swapfree_kb" ] || swapfree_kb=0
    memtotal=$((memtotal_kb * 1024))
    memavail=$((memavail_kb * 1024))
    swaptotal=$((swaptotal_kb * 1024))
    swapfree=$((swapfree_kb * 1024))
    up=$(awk '{print int($1)}' /proc/uptime 2>/dev/null)
    read la1 la2 la3 _ < /proc/loadavg 2>/dev/null
    ;;
  Darwin)
    osname=$(sw_vers -productName 2>/dev/null)
    osver=$(sw_vers -productVersion 2>/dev/null)
    [ -n "$osver" ] && osname="$osname $osver"
    [ -n "$osname" ] || osname="macOS"
    cores=$(sysctl -n hw.ncpu 2>/dev/null)
    model=$(sysctl -n machdep.cpu.brand_string 2>/dev/null)
    tline=$(top -l 2 -n 0 2>/dev/null | tail -n 1)
    idle=$(echo "$tline" | sed -n 's/.*CPU usage:[[:space:]]*\\([0-9][0-9.]*\\)% user, \\([0-9][0-9.]*\\)% sys, \\([0-9][0-9.]*\\)% idle.*/\\3/p')
    if [ -n "$idle" ]; then usage=$(awk -v i="$idle" 'BEGIN{printf "%.1f", 100-i}'); fi
    memtotal=$(sysctl -n hw.memsize 2>/dev/null)
    vs=$(vm_stat 2>/dev/null)
    pagesize=$(echo "$vs" | awk '/page size of/{print $8}')
    [ -n "$pagesize" ] || pagesize=4096
    fp=$(echo "$vs" | awk -F: '/Pages free/{gsub(/[^0-9]/,"",$2); print $2}')
    ia=$(echo "$vs" | awk -F: '/Pages inactive/{gsub(/[^0-9]/,"",$2); print $2}')
    sp=$(echo "$vs" | awk -F: '/Pages speculative/{gsub(/[^0-9]/,"",$2); print $2}')
    [ -n "$fp" ] || fp=0
    [ -n "$ia" ] || ia=0
    [ -n "$sp" ] || sp=0
    memfree=$(((fp + ia + sp) * pagesize))
    sw=$(sysctl -n vm.swapusage 2>/dev/null)
    swaptotal=$(echo "$sw" | awk -F'[ =]+' '{for(i=1;i<=NF;i++){if($i=="total"){v=$(i+2); u=$(i+3); break}} if(u=="G"){printf "%d", v*1024*1024*1024} else if(u=="K"){printf "%d", v*1024} else {printf "%d", v*1024*1024}}')
    swapfree=$(echo "$sw" | awk -F'[ =]+' '{for(i=1;i<=NF;i++){if($i=="free"){v=$(i+2); u=$(i+3); break}} if(u=="G"){printf "%d", v*1024*1024*1024} else if(u=="K"){printf "%d", v*1024} else {printf "%d", v*1024*1024}}')
    now=$(date +%s)
    boot=$(sysctl -n kern.boottime 2>/dev/null | sed -n 's/.*sec = \\([0-9]*\\).*/\\1/p')
    if [ -n "$boot" ]; then up=$((now - boot)); fi
    la=$(sysctl -n vm.loadavg 2>/dev/null | tr -d '{}')
    set -- $la
    la1=$1; la2=$2; la3=$3
    ;;
  *)
    echo "UNSUPPORTED|1"
    exit 0
    ;;
esac
echo "PLATFORM|$uname_s"
echo "OS|$osname"
echo "HOST|$(hostname 2>/dev/null)"
echo "KERNEL|$(uname -r)"
echo "ARCH|$(uname -m)"
echo "CORES|$cores"
echo "MODEL|$model"
echo "CPU_USAGE|$usage"
echo "MEM_TOTAL|$memtotal"
if [ -n "$memfree" ]; then echo "MEM_FREE|$memfree"; fi
if [ -n "$memavail" ]; then echo "MEM_AVAIL|$memavail"; fi
echo "SWAP_TOTAL|$swaptotal"
if [ -n "$swapfree" ]; then echo "SWAP_FREE|$swapfree"; fi
echo "UPTIME|$up"
echo "LOADAVG|$la1|$la2|$la3"
if command -v timeout >/dev/null 2>&1; then
  dfout=$(timeout 3 df -P -k 2>/dev/null)
else
  dfout=$(df -P -k 2>/dev/null)
fi
echo "$dfout" | {
  read hdr
  while read -r fs sz us av pct mnt; do
    [ -n "$fs" ] || continue
    case "$fs" in
      tmpfs|devtmpfs|sysfs|proc|devpts|cgroup*|mqueue|shm|hugetlbfs|debugfs|fusectl|pstore|configfs|ramfs|binfmt_misc|nsfs|bpf|tracefs|securityfs|autofs|overlay|aufs|none)
        continue ;;
    esac
    [ -n "$mnt" ] || mnt="$fs"
    pct=$(echo "$pct" | tr -d '%')
    printf 'DISK|%s|%s|%s|%s|%s|%s\n' "$fs" "$mnt" "$sz" "$us" "$av" "$pct"
  done
}
`

const SYSINFO_TIMEOUT_MS = 20000

function execShScript(
  client: Client,
  script: string,
  timeoutMs = SYSINFO_TIMEOUT_MS
): Promise<string> {
  return new Promise((resolve, reject) => {
    let channel: ClientChannel | null = null
    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []
    const timer = setTimeout(() => {
      try {
        channel?.close()
      } catch {
        // ignore
      }
      reject(new Error('SYSINFO_TIMEOUT'))
    }, timeoutMs)
    client.exec('sh -s', (err, ch) => {
      if (err || !ch) {
        clearTimeout(timer)
        reject(new Error(normalizeSshError(err?.message || 'SYSINFO_EXEC_FAILED')))
        return
      }
      channel = ch
      ch.on('data', (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })
      ch.stderr?.on('data', (chunk: Buffer | string) => {
        errChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })
      ch.on('close', () => {
        clearTimeout(timer)
        const out = Buffer.concat(chunks).toString('utf8')
        const err = Buffer.concat(errChunks).toString('utf8').trim()
        if (!out && err) {
          reject(new Error(`SYSINFO_CMD_FAILED: ${err.slice(0, 300)}`))
          return
        }
        resolve(out)
      })
      ch.on('error', () => {})
      ch.end(script)
    })
  })
}

const EXEC_TIMEOUT_MS = 30000

interface ExecRemoteResult {
  code: number
  stdout: string
  stderr: string
}

function execRemote(
  client: Client,
  command: string,
  timeoutMs = EXEC_TIMEOUT_MS
): Promise<ExecRemoteResult> {
  return new Promise((resolve, reject) => {
    let channel: ClientChannel | null = null
    const out: Buffer[] = []
    const err: Buffer[] = []
    const timer = setTimeout(() => {
      try {
        channel?.close()
      } catch {
        // ignore
      }
      reject(new Error('EXEC_TIMEOUT'))
    }, timeoutMs)
    client.exec(command, (e, ch) => {
      if (e || !ch) {
        clearTimeout(timer)
        reject(new Error(normalizeSshError(e?.message || 'EXEC_FAILED')))
        return
      }
      channel = ch
      ch.on('data', (d) => out.push(Buffer.isBuffer(d) ? d : Buffer.from(d)))
      ch.stderr?.on('data', (d) => err.push(Buffer.isBuffer(d) ? d : Buffer.from(d)))
      ch.on('close', (code) => {
        clearTimeout(timer)
        resolve({
          code: typeof code === 'number' ? code : -1,
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8')
        })
      })
      ch.on('error', () => {})
    })
  })
}

function parseSysInfoOutput(raw: string): SshSysInfo {
  const info: SshSysInfo = {
    platform: 'other',
    hostname: '',
    os: { name: '', kernel: '', arch: '' },
    cpu: { model: '', cores: 0, usage: null },
    mem: { total: 0, used: 0 },
    swap: { total: 0, used: 0 },
    uptime: 0,
    loadavg: [0, 0, 0],
    disks: []
  }
  let memTotal = 0
  let memAvail: number | undefined
  let memFree: number | undefined
  let swapTotal = 0
  let swapFree: number | undefined
  let sawPlatform = false
  const lines = raw.split(/\r?\n/)
  for (const line of lines) {
    if (!line) continue
    const sep = line.indexOf('|')
    if (sep <= 0) continue
    const key = line.slice(0, sep)
    const val = line.slice(sep + 1)
    switch (key) {
      case 'PLATFORM': {
        sawPlatform = true
        const p = val.toLowerCase()
        info.platform = p === 'linux' ? 'linux' : p === 'darwin' ? 'darwin' : 'other'
        break
      }
      case 'OS':
        info.os.name = val
        break
      case 'HOST':
        info.hostname = val
        break
      case 'KERNEL':
        info.os.kernel = val
        break
      case 'ARCH':
        info.os.arch = val
        break
      case 'CORES':
        info.cpu.cores = Number(val) || 0
        break
      case 'MODEL':
        info.cpu.model = val
        break
      case 'CPU_USAGE': {
        const n = Number(val)
        info.cpu.usage = val && Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null
        break
      }
      case 'MEM_TOTAL':
        memTotal = Number(val) || 0
        break
      case 'MEM_AVAIL':
        memAvail = Number(val) || 0
        break
      case 'MEM_FREE':
        memFree = Number(val) || 0
        break
      case 'SWAP_TOTAL':
        swapTotal = Number(val) || 0
        break
      case 'SWAP_FREE':
        swapFree = Number(val) || 0
        break
      case 'UPTIME':
        info.uptime = Number(val) || 0
        break
      case 'LOADAVG': {
        const parts = val.split('|').map((p) => Number(p) || 0)
        info.loadavg = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
        break
      }
      case 'DISK': {
        const parts = val.split('|')
        if (parts.length >= 6) {
          info.disks.push({
            filesystem: parts[0],
            mount: parts[1],
            size: (Number(parts[2]) || 0) * 1024,
            used: (Number(parts[3]) || 0) * 1024,
            avail: (Number(parts[4]) || 0) * 1024,
            usePercent: Number(parts[5]) || 0
          })
        }
        break
      }
      case 'UNSUPPORTED':
        throw new Error('SYSINFO_UNSUPPORTED')
    }
  }
  if (!sawPlatform) {
    const snippet = raw.trim().slice(0, 300)
    throw new Error(snippet ? `SYSINFO_UNPARSED: ${snippet}` : 'SYSINFO_EMPTY')
  }
  const avail = memAvail ?? (memFree !== undefined ? memTotal - memFree : 0)
  info.mem = { total: memTotal, used: Math.max(0, memTotal - avail) }
  info.swap = { total: swapTotal, used: Math.max(0, swapTotal - (swapFree ?? 0)) }
  info.disks.sort((a, b) => b.used - a.used)
  return info
}

interface ExecSession {
  nodeId: string
  client: Client
  jumpClients: Client[]
}

interface TailSession {
  sessionId: string
  nodeId: string
  client: Client
  channel: ClientChannel | null
}

export function createSshClientManager(options: SshClientManagerOptions): {
  startShell: (opts: SshShellStartOpts) => Promise<{ sessionId: string }>
  writeShell: (sessionId: string, dataBase64: string) => Promise<boolean>
  resizeShell: (sessionId: string, cols: number, rows: number) => Promise<boolean>
  stopShell: (sessionId: string) => Promise<boolean>
  sftpList: (nodeId: string, remotePath: string) => Promise<SshSftpEntry[]>
  sftpDownloadFile: (
    nodeId: string,
    remotePath: string,
    localPath: string
  ) => Promise<{ ok: boolean; error?: string }>
  sftpDownloadDir: (
    nodeId: string,
    remotePath: string,
    localDir: string
  ) => Promise<{ ok: boolean; count: number; error?: string }>
  sftpUploadFiles: (
    nodeId: string,
    remoteDir: string,
    localPaths: string[]
  ) => Promise<{ ok: boolean; count: number; error?: string }>
  sftpMkdir: (nodeId: string, remotePath: string) => Promise<{ ok: boolean; error?: string }>
  sftpWriteFile: (
    nodeId: string,
    remotePath: string,
    content?: string
  ) => Promise<{ ok: boolean; error?: string }>
  sftpReadFile: (
    nodeId: string,
    remotePath: string,
    maxBytes?: number
  ) => Promise<SshSftpReadResult>
  sysInfo: (nodeId: string) => Promise<SshSysInfoResult>
  listProcesses: (nodeId: string) => Promise<SshProcessInfo[]>
  killProcess: (nodeId: string, pid: number, signal?: string) => Promise<{ ok: boolean }>
  listServices: (nodeId: string) => Promise<SshServiceInfo[]>
  listPorts: (nodeId: string) => Promise<SshPortInfo[]>
  serviceAction: (
    nodeId: string,
    unit: string,
    action: 'start' | 'stop' | 'restart' | 'reload' | 'enable' | 'disable'
  ) => Promise<{ ok: boolean; output: string }>
  startLogTail: (nodeId: string, path: string) => Promise<{ sessionId: string }>
  stopLogTail: (sessionId: string) => boolean
  onExecData: (cb: (payload: SshExecData) => void) => () => void
  onTailExit: (cb: (payload: SshTailExit) => void) => () => void
  disconnectNode: (nodeId: string) => void
  disconnectSftp: (nodeId: string) => void
  disconnectSysInfo: (nodeId: string) => void
  stop: () => void
  onShellData: (cb: (data: SshShellData) => void) => () => void
  onShellExit: (cb: (data: SshShellExit) => void) => () => void
} {
  const shells = new Map<string, ShellSession>()
  const sftps = new Map<string, SftpSession>()
  const sftpInflight = new Map<string, Promise<SftpSession>>()
  const execSessions = new Map<string, ExecSession>()
  const execInflight = new Map<string, Promise<ExecSession>>()
  const shellDataListeners = new Set<(data: SshShellData) => void>()
  const shellExitListeners = new Set<(data: SshShellExit) => void>()
  const tailSessions = new Map<string, TailSession>()
  const execDataListeners = new Set<(payload: SshExecData) => void>()
  const tailExitListeners = new Set<(payload: SshTailExit) => void>()

  function emitExecData(payload: SshExecData): void {
    for (const cb of execDataListeners) cb(payload)
  }

  function emitTailExit(payload: SshTailExit): void {
    for (const cb of tailExitListeners) cb(payload)
  }

  function emitShellData(data: SshShellData): void {
    for (const cb of shellDataListeners) cb(data)
  }

  function emitShellExit(data: SshShellExit): void {
    for (const cb of shellExitListeners) cb(data)
  }

  function cleanupShell(sessionId: string, reason?: string, silent = false): void {
    const session = shells.get(sessionId)
    if (!session) return
    shells.delete(sessionId)
    try {
      session.channel.close()
    } catch {
      // ignore
    }
    endClientChain(session.client, session.jumpClients)
    if (!silent) emitShellExit({ sessionId, reason })
  }

  async function openClient(
    nodeId: string
  ): Promise<{ node: SshNode; client: Client; jumpClients: Client[] }> {
    const node = options.getNode(nodeId)
    if (!node) throw new Error('NODE_NOT_FOUND')
    const { client, jumpClients } = await connectViaJump(
      node,
      options.getNode,
      options.verifyHostKey
    )
    return { node, client, jumpClients }
  }

  async function ensureSftp(nodeId: string): Promise<SftpSession> {
    const existing = sftps.get(nodeId)
    if (existing) return existing
    const inflight = sftpInflight.get(nodeId)
    if (inflight) return inflight

    const promise = (async (): Promise<SftpSession> => {
      const { client, jumpClients } = await openClient(nodeId)
      try {
        return await new Promise<SftpSession>((resolve, reject) => {
          client.sftp((err, sftp) => {
            if (err || !sftp) {
              endClientChain(client, jumpClients)
              reject(new Error(err?.message || 'SFTP_FAILED'))
              return
            }
            const session: SftpSession = { nodeId, client, jumpClients, sftp }
            const prev = sftps.get(nodeId)
            if (prev && prev !== session) {
              endClientChain(prev.client, prev.jumpClients)
            }
            sftps.set(nodeId, session)
            client.on('close', () => {
              if (sftps.get(nodeId) === session) {
                sftps.delete(nodeId)
                endClientChain(null, jumpClients)
              }
            })
            client.on('error', () => {
              if (sftps.get(nodeId) === session) {
                sftps.delete(nodeId)
                endClientChain(client, jumpClients)
              }
            })
            resolve(session)
          })
        })
      } finally {
        sftpInflight.delete(nodeId)
      }
    })()

    sftpInflight.set(nodeId, promise)
    try {
      return await promise
    } catch (err) {
      sftpInflight.delete(nodeId)
      throw err
    }
  }

  const execClosePending = new Set<string>()

  function execClientAlive(client: Client): boolean {
    const sock = (client as unknown as { _sock?: { writable?: boolean } })._sock
    return Boolean(sock && sock.writable)
  }

  async function ensureExecSession(nodeId: string): Promise<ExecSession> {
    const existing = execSessions.get(nodeId)
    if (existing) {
      if (execClientAlive(existing.client)) return existing
      execSessions.delete(nodeId)
      endClientChain(existing.client, existing.jumpClients)
    }
    const inflight = execInflight.get(nodeId)
    if (inflight) return inflight

    const promise = (async (): Promise<ExecSession> => {
      const { client, jumpClients } = await openClient(nodeId)
      if (execClosePending.has(nodeId)) {
        // A disconnect was requested while this connection was being established.
        execClosePending.delete(nodeId)
        endClientChain(client, jumpClients)
        throw new Error('NODE_NOT_CONNECTED')
      }
      const session: ExecSession = { nodeId, client, jumpClients }
      execSessions.set(nodeId, session)
      client.on('close', () => {
        if (execSessions.get(nodeId) === session) execSessions.delete(nodeId)
      })
      client.on('error', () => {
        if (execSessions.get(nodeId) === session) execSessions.delete(nodeId)
      })
      return session
    })()

    execInflight.set(nodeId, promise)
    try {
      return await promise
    } finally {
      execInflight.delete(nodeId)
    }
  }

  function disconnectExecSession(nodeId: string): void {
    const session = execSessions.get(nodeId)
    if (session) {
      execSessions.delete(nodeId)
      endClientChain(session.client, session.jumpClients)
    } else if (execInflight.has(nodeId)) {
      // A connection is being established right now; cancel it once it lands.
      execClosePending.add(nodeId)
    }
  }

  function statFollow(
    sftp: SFTPWrapper,
    remotePath: string
  ): Promise<{ type: SshSftpEntry['type']; size: number; modifyTime: number }> {
    return new Promise((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err || !stats) {
          reject(new Error(err?.message || 'SFTP_STAT_FAILED'))
          return
        }
        resolve({
          type: entryType(stats),
          size: stats.size ?? 0,
          modifyTime: (stats.mtime ?? 0) * 1000
        })
      })
    })
  }

  async function listDir(sftp: SFTPWrapper, remotePath: string): Promise<SshSftpEntry[]> {
    const list = await new Promise<FileEntry[]>((resolve, reject) => {
      sftp.readdir(remotePath, (err, l) => {
        if (err) {
          reject(new Error(err.message || 'SFTP_LIST_FAILED'))
          return
        }
        resolve((l || []) as FileEntry[])
      })
    })
    const entries: SshSftpEntry[] = list.map((item) => {
      const attrs = item.attrs
      return {
        name: item.filename,
        path: posixJoin(remotePath === '.' ? '/' : remotePath, item.filename),
        type: entryType(attrs),
        size: attrs.size ?? 0,
        modifyTime: (attrs.mtime ?? 0) * 1000,
        accessTime: (attrs.atime ?? 0) * 1000,
        owner: attrs.uid,
        group: attrs.gid,
        mode: attrs.mode
      }
    })
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.type !== 'symlink') return
        try {
          const resolved = await statFollow(sftp, entry.path)
          entry.type = resolved.type
          entry.size = resolved.size
          entry.modifyTime = resolved.modifyTime
          entry.isSymlink = true
        } catch {
          entry.isSymlink = true
        }
      })
    )
    entries.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1
      if (a.type !== 'directory' && b.type === 'directory') return 1
      return a.name.localeCompare(b.name)
    })
    return entries
  }

  function downloadOneFile(
    sftp: SFTPWrapper,
    remotePath: string,
    localPath: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      sftp.fastGet(remotePath, localPath, (err) => {
        if (err) reject(new Error(err.message || 'SFTP_DOWNLOAD_FAILED'))
        else resolve()
      })
    })
  }

  function uploadOneFile(sftp: SFTPWrapper, localPath: string, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, (err) => {
        if (err) reject(new Error(err.message || 'SFTP_UPLOAD_FAILED'))
        else resolve()
      })
    })
  }

  function mkdirRemote(sftp: SFTPWrapper, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      sftp.mkdir(remotePath, (err) => {
        if (err) reject(new Error(err.message || 'SFTP_MKDIR_FAILED'))
        else resolve()
      })
    })
  }

  function writeRemoteFile(sftp: SFTPWrapper, remotePath: string, content: string): Promise<void> {
    return new Promise((resolve, reject) => {
      sftp.writeFile(remotePath, Buffer.from(content, 'utf8'), (err) => {
        if (err) reject(new Error(err.message || 'SFTP_WRITE_FAILED'))
        else resolve()
      })
    })
  }

  function readRemoteFile(sftp: SFTPWrapper, remotePath: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      sftp.readFile(remotePath, (err, data) => {
        if (err) reject(new Error(err.message || 'SFTP_READ_FAILED'))
        else resolve(Buffer.isBuffer(data) ? data : Buffer.from(data))
      })
    })
  }

  function looksBinary(buf: Buffer): boolean {
    const limit = Math.min(buf.length, 8192)
    for (let i = 0; i < limit; i++) {
      if (buf[i] === 0) return true
    }
    return false
  }

  function closeSftp(nodeId: string): void {
    const sftp = sftps.get(nodeId)
    if (!sftp) return
    sftps.delete(nodeId)
    endClientChain(sftp.client, sftp.jumpClients)
  }

  async function downloadTree(
    sftp: SFTPWrapper,
    remotePath: string,
    localDir: string
  ): Promise<number> {
    await fsp.mkdir(localDir, { recursive: true })
    const entries = await listDir(sftp, remotePath)
    let count = 0
    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue
      const localPath = join(localDir, entry.name)
      if (entry.type === 'directory' && !entry.isSymlink) {
        count += await downloadTree(sftp, entry.path, localPath)
      } else if (entry.type === 'file' || entry.type === 'symlink') {
        await fsp.mkdir(dirname(localPath), { recursive: true })
        await downloadOneFile(sftp, entry.path, localPath)
        count += 1
      }
    }
    return count
  }

  function statPath(
    sftp: SFTPWrapper,
    remotePath: string
  ): Promise<{ type: SshSftpEntry['type']; size: number }> {
    return new Promise((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err || !stats) {
          reject(new Error(err?.message || 'SFTP_STAT_FAILED'))
          return
        }
        resolve({ type: entryType(stats), size: stats.size ?? 0 })
      })
    })
  }

  return {
    async startShell(opts) {
      const cols = Math.max(2, opts.cols ?? 80)
      const rows = Math.max(1, opts.rows ?? 24)
      const term = opts.term || 'xterm-256color'
      const { client, jumpClients } = await openClient(opts.nodeId)
      return new Promise((resolve, reject) => {
        client.shell({ term, cols, rows }, (err, channel) => {
          if (err || !channel) {
            endClientChain(client, jumpClients)
            reject(new Error(normalizeSshError(err?.message || 'SHELL_FAILED')))
            return
          }
          const sessionId = randomUUID()
          const session: ShellSession = {
            sessionId,
            nodeId: opts.nodeId,
            client,
            jumpClients,
            channel
          }
          shells.set(sessionId, session)

          channel.on('data', (chunk: Buffer | string) => {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            emitShellData({ sessionId, data: buf.toString('base64') })
          })
          channel.stderr?.on('data', (chunk: Buffer | string) => {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            emitShellData({ sessionId, data: buf.toString('base64') })
          })
          channel.on('close', () => cleanupShell(sessionId))
          channel.on('exit', (_code, _signal, dump, desc) => {
            cleanupShell(sessionId, desc || (dump ? 'dump' : undefined))
          })
          client.on('close', () => cleanupShell(sessionId, 'closed'))
          client.on('error', () => cleanupShell(sessionId, 'error'))

          resolve({ sessionId })
        })
      })
    },

    async writeShell(sessionId, dataBase64) {
      const session = shells.get(sessionId)
      if (!session) return false
      session.channel.write(Buffer.from(dataBase64, 'base64'))
      return true
    },

    async resizeShell(sessionId, cols, rows) {
      const session = shells.get(sessionId)
      if (!session) return false
      try {
        session.channel.setWindow(Math.max(1, rows), Math.max(2, cols), 0, 0)
        return true
      } catch {
        return false
      }
    },

    async stopShell(sessionId) {
      const session = shells.get(sessionId)
      if (!session) return false
      cleanupShell(sessionId, 'stopped')
      return true
    },

    async sftpList(nodeId, remotePath) {
      const session = await ensureSftp(nodeId)
      const path = remotePath?.trim() || '/'
      return listDir(session.sftp, path)
    },

    async sftpDownloadFile(nodeId, remotePath, localPath) {
      try {
        const session = await ensureSftp(nodeId)
        await fsp.mkdir(dirname(localPath), { recursive: true })
        await downloadOneFile(session.sftp, remotePath, localPath)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },

    async sftpDownloadDir(nodeId, remotePath, localDir) {
      try {
        const session = await ensureSftp(nodeId)
        const stats = await statPath(session.sftp, remotePath)
        if (stats.type !== 'directory') {
          const fileName = basename(remotePath)
          const localPath = join(localDir, fileName)
          await fsp.mkdir(localDir, { recursive: true })
          await downloadOneFile(session.sftp, remotePath, localPath)
          return { ok: true, count: 1 }
        }
        const folderName = basename(remotePath.replace(/\/+$/, '') || 'download')
        const target = join(localDir, folderName)
        const count = await downloadTree(session.sftp, remotePath, target)
        return { ok: true, count }
      } catch (err) {
        return { ok: false, count: 0, error: (err as Error).message }
      }
    },

    async sftpUploadFiles(nodeId, remoteDir, localPaths) {
      try {
        const session = await ensureSftp(nodeId)
        const dir = remoteDir?.trim() || '/'
        let count = 0
        for (const localPath of localPaths) {
          const name = basename(localPath)
          if (!name) continue
          await uploadOneFile(session.sftp, localPath, posixJoin(dir, name))
          count += 1
        }
        return { ok: true, count }
      } catch (err) {
        return { ok: false, count: 0, error: (err as Error).message }
      }
    },

    async sftpMkdir(nodeId, remotePath) {
      try {
        const session = await ensureSftp(nodeId)
        await mkdirRemote(session.sftp, remotePath)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },

    async sftpWriteFile(nodeId, remotePath, content = '') {
      try {
        const session = await ensureSftp(nodeId)
        await writeRemoteFile(session.sftp, remotePath, content)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },

    async sftpReadFile(nodeId, remotePath, maxBytes = SSH_SFTP_READ_MAX_BYTES) {
      try {
        const session = await ensureSftp(nodeId)
        const stats = await statPath(session.sftp, remotePath)
        if (stats.type !== 'file') {
          return { ok: false, error: 'SFTP_READ_FAILED' }
        }
        if (stats.size > maxBytes) {
          return { ok: false, error: 'FILE_TOO_LARGE', size: stats.size, maxBytes }
        }
        const buf = await readRemoteFile(session.sftp, remotePath)
        if (buf.length > maxBytes) {
          return { ok: false, error: 'FILE_TOO_LARGE', size: buf.length, maxBytes }
        }
        if (looksBinary(buf)) {
          return { ok: true, binary: true, size: buf.length }
        }
        return { ok: true, content: buf.toString('utf8'), size: buf.length }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },

    async sysInfo(nodeId) {
      try {
        const session = await ensureExecSession(nodeId)
        const raw = await execShScript(session.client, SYSINFO_SCRIPT)
        const info = parseSysInfoOutput(raw)
        return { ok: true, info }
      } catch (err) {
        console.error('[ssh:sysInfo]', nodeId, err instanceof Error ? err.message : err)
        return { ok: false, error: (err as Error).message }
      }
    },

    async listProcesses(nodeId) {
      try {
        const session = await ensureExecSession(nodeId)
        const res = await execRemote(
          session.client,
          'ps -eo pid,ppid,user,%cpu,%mem,rss,stat,etimes,cmd --sort=-%cpu 2>/dev/null | head -200'
        )
        if (res.code !== 0 && !res.stdout.trim()) {
          throw new Error(res.stderr.trim() || 'PS_FAILED')
        }
        return parsePsOutput(res.stdout)
      } catch (err) {
        console.error('[ssh:listProcesses]', nodeId, err instanceof Error ? err.message : err)
        throw err
      }
    },

    async killProcess(nodeId, pid, signal = 'TERM') {
      try {
        if (!Number.isInteger(pid) || pid < 1) throw new Error('INVALID_PID')
        const sig = /^[A-Z0-9]+$/.test(String(signal)) ? String(signal) : 'TERM'
        const session = await ensureExecSession(nodeId)
        const res = await execRemote(session.client, `kill -${sig} ${pid}`)
        if (res.code !== 0) throw new Error(res.stderr.trim() || 'KILL_FAILED')
        return { ok: true }
      } catch (err) {
        console.error('[ssh:killProcess]', nodeId, pid, err instanceof Error ? err.message : err)
        throw err
      }
    },

    async listServices(nodeId) {
      try {
        const session = await ensureExecSession(nodeId)
        const res = await execRemote(
          session.client,
          'systemctl list-units --type=service --all --no-pager --no-legend 2>/dev/null | head -300'
        )
        if (res.code !== 0 && !res.stdout.trim()) {
          throw new Error(res.stderr.trim() || 'SYSTEMCTL_FAILED')
        }
        return parseSystemctlOutput(res.stdout)
      } catch (err) {
        console.error('[ssh:listServices]', nodeId, err instanceof Error ? err.message : err)
        throw err
      }
    },

    async serviceAction(nodeId, unit, action) {
      try {
        if (!/^[a-zA-Z0-9_.@-]+\.service$/.test(unit)) throw new Error('INVALID_UNIT')
        if (!['start', 'stop', 'restart', 'reload', 'enable', 'disable'].includes(action)) {
          throw new Error('INVALID_ACTION')
        }
        const session = await ensureExecSession(nodeId)
        const res = await execRemote(session.client, `systemctl ${action} ${unit} 2>&1 </dev/null`)
        if (res.code !== 0 && !res.stdout.trim()) {
          throw new Error(res.stderr.trim() || 'SERVICE_ACTION_FAILED')
        }
        return { ok: true, output: (res.stdout + res.stderr).trim() }
      } catch (err) {
        console.error(
          '[ssh:serviceAction]',
          nodeId,
          unit,
          action,
          err instanceof Error ? err.message : err
        )
        throw err
      }
    },

    async listPorts(nodeId) {
      try {
        const session = await ensureExecSession(nodeId)
        const res = await execRemote(session.client, 'ss -tulnp 2>/dev/null')
        let ports: SshPortInfo[] = []
        if (res.code === 0 && res.stdout.trim()) {
          ports = parseSsOutput(res.stdout)
        } else {
          const net = await execRemote(session.client, 'netstat -tulnp 2>/dev/null')
          if (net.code === 0 && net.stdout.trim()) {
            ports = parseNetstatOutput(net.stdout)
          }
        }
        if (!ports.length) throw new Error(res.stderr.trim() || 'SS_FAILED')
        ports.sort((a, b) => a.port - b.port || (a.protocol < b.protocol ? -1 : 1))
        return ports
      } catch (err) {
        console.error('[ssh:listPorts]', nodeId, err instanceof Error ? err.message : err)
        throw err
      }
    },

    async startLogTail(nodeId, path) {
      if (typeof path !== 'string' || !path.trim()) throw new Error('INVALID_PATH')
      if (path.includes('\0') || /[\n\r']/.test(path)) throw new Error('INVALID_PATH')
      const sessionId = randomUUID()
      const session = await ensureExecSession(nodeId)
      return new Promise<{ sessionId: string }>((resolve, reject) => {
        session.client.exec(`tail -n 200 -f -- '${path}'`, (err, ch) => {
          if (err || !ch) {
            reject(new Error(normalizeSshError(err?.message || 'TAIL_FAILED')))
            return
          }
          const tail: TailSession = { sessionId, nodeId, client: session.client, channel: ch }
          tailSessions.set(sessionId, tail)
          ch.on('data', (chunk: Buffer | string) => {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            emitExecData({ sessionId, data: buf.toString('base64') })
          })
          ch.stderr?.on('data', (chunk: Buffer | string) => {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            emitExecData({ sessionId, data: buf.toString('base64') })
          })
          ch.on('close', (code) => {
            tailSessions.delete(sessionId)
            emitTailExit({
              sessionId,
              reason: typeof code === 'number' && code !== 0 ? `exit-${code}` : undefined
            })
          })
          ch.on('error', () => {
            tailSessions.delete(sessionId)
            emitTailExit({ sessionId, reason: 'error' })
          })
          resolve({ sessionId })
        })
      })
    },

    stopLogTail(sessionId) {
      const tail = tailSessions.get(sessionId)
      if (!tail) return false
      tailSessions.delete(sessionId)
      try {
        tail.channel?.close()
      } catch {
        // ignore
      }
      return true
    },

    onExecData(cb) {
      execDataListeners.add(cb)
      return () => execDataListeners.delete(cb)
    },

    onTailExit(cb) {
      tailExitListeners.add(cb)
      return () => tailExitListeners.delete(cb)
    },

    disconnectSftp(nodeId) {
      closeSftp(nodeId)
    },

    disconnectSysInfo(nodeId) {
      disconnectExecSession(nodeId)
    },

    disconnectNode(nodeId) {
      for (const [id, session] of shells) {
        if (session.nodeId === nodeId) cleanupShell(id, 'node-removed')
      }
      closeSftp(nodeId)
      disconnectExecSession(nodeId)
      for (const [id, tail] of tailSessions) {
        if (tail.nodeId === nodeId) {
          tailSessions.delete(id)
          try {
            tail.channel?.close()
          } catch {
            // ignore
          }
          emitTailExit({ sessionId: id, reason: 'node-removed' })
        }
      }
    },

    stop() {
      for (const id of [...shells.keys()]) cleanupShell(id, 'stopped', true)
      for (const nodeId of [...sftps.keys()]) closeSftp(nodeId)
      for (const nodeId of [...execSessions.keys()]) disconnectExecSession(nodeId)
      for (const [id, tail] of tailSessions) {
        tailSessions.delete(id)
        try {
          tail.channel?.close()
        } catch {
          // ignore
        }
        emitTailExit({ sessionId: id, reason: 'stopped' })
      }
    },

    onShellData(cb) {
      shellDataListeners.add(cb)
      return () => shellDataListeners.delete(cb)
    },

    onShellExit(cb) {
      shellExitListeners.add(cb)
      return () => shellExitListeners.delete(cb)
    }
  }
}
