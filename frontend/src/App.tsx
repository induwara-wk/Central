import { useState, useEffect, useCallback } from 'react'

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface CpuData {
  usage:   number
  cores:   number
  model:   string
  perCore: number[]
}

interface RamData {
  total:          number
  used:           number
  free:           number
  available:      number
  percentage:     number
  swapTotal:      number
  swapUsed:       number
  swapPercentage: number
}

interface DiskData {
  fs:        string
  type:      string
  size:      number
  used:      number
  available: number
  use:       number
  mount:     string
}

interface OsData {
  hostname: string
  distro:   string
  release:  string
  arch:     string
}

interface NetData {
  iface: string
  rxSec: number
  txSec: number
}

interface SystemStats {
  cpu:       CpuData
  ram:       RamData
  storage:   DiskData[]
  uptime:    number
  os:        OsData
  network:   NetData[]
  timestamp: string
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const STATS_POLL_MS  = 2000   // CPU, RAM, disk, network, OS
const UPTIME_POLL_MS = 1000   // uptime only

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

function fmtBytes(bytes: number, d = 1): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i     = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : d)} ${units[i]}`
}

function fmtUptime(s: number): string {
  const d   = Math.floor(s / 86400)
  const h   = Math.floor((s % 86400) / 3600)
  const m   = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${sec}s`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

function fmtSpeed(bps: number): string {
  if (bps < 1024)      return `${bps.toFixed(0)} B/s`
  if (bps < 1024 ** 2) return `${(bps / 1024).toFixed(1)} KB/s`
  return `${(bps / 1024 ** 2).toFixed(2)} MB/s`
}

function pctText(pct: number): string {
  if (pct < 60) return 'text-teal'
  if (pct < 80) return 'text-amber'
  return 'text-rose'
}

function pctBg(pct: number): string {
  if (pct < 60) return 'bg-teal'
  if (pct < 80) return 'bg-amber'
  return 'bg-rose'
}

function pctStroke(pct: number): string {
  if (pct < 60) return '#00e0a0'
  if (pct < 80) return '#f0a030'
  return '#e04060'
}

// ═══════════════════════════════════════════════════════════════
// RING GAUGE
// ═══════════════════════════════════════════════════════════════

function RingGauge({ pct, size = 132 }: { pct: number; size?: number }) {
  const track    = 9
  const r        = (size - track) / 2
  const circ     = 2 * Math.PI * r
  const gap      = circ * 0.18
  const arc      = circ - gap
  const fill     = arc * Math.min(pct, 100) / 100
  const color    = pctStroke(pct)
  const rotation = 90 + (360 * 0.18) / 2

  return (
    <div className="relative inline-flex items-center justify-center select-none">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: `rotate(${rotation}deg)` }}
        aria-hidden
      >
        {/* Track */}
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke="#1e1e32"
          strokeWidth={track}
          strokeDasharray={`${arc} ${gap}`}
          strokeLinecap="round"
        />
        {/* Fill */}
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke={color}
          strokeWidth={track}
          strokeDasharray={`${fill} ${circ - fill}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.5s ease, stroke 0.3s' }}
        />
      </svg>

      {/* Centre label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span
          className={`font-mono font-bold tabular leading-none text-2xl ${pctText(pct)}`}
          style={{ textShadow: `0 0 12px ${color}55` }}
        >
          {pct.toFixed(1)}
        </span>
        <span className="text-dim text-xs mt-0.5 font-mono">%</span>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// BAR
// ═══════════════════════════════════════════════════════════════

function Bar({ pct, thin = false }: { pct: number; thin?: boolean }) {
  const h = thin ? 'h-1' : 'h-1.5'
  return (
    <div className={`w-full bg-edge rounded-full ${h} overflow-hidden`}>
      <div
        className={`${h} rounded-full transition-all duration-500 ${pctBg(pct)}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// CARD
// ═══════════════════════════════════════════════════════════════

function Card({
  title,
  badge,
  children,
  className = '',
}: {
  title:      string
  badge?:     string
  children:   React.ReactNode
  className?: string
}) {
  return (
    <section className={`bg-surface border border-edge rounded-2xl p-5 ${className}`}>
      <header className="flex items-center justify-between mb-4">
        <h2 className="text-ink font-semibold tracking-wide text-sm uppercase">{title}</h2>
        {badge && (
          <span className="font-mono text-xs text-dim bg-edge px-2 py-0.5 rounded-lg">
            {badge}
          </span>
        )}
      </header>
      {children}
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════
// STAT ROW
// ═══════════════════════════════════════════════════════════════

function StatRow({
  label,
  value,
  accent = false,
}: {
  label:   string
  value:   string
  accent?: boolean
}) {
  return (
    <div className="flex justify-between items-baseline text-sm">
      <span className="text-dim">{label}</span>
      <span className={`font-mono tabular ${accent ? 'text-teal' : 'text-ink'}`}>{value}</span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// LOADING SCREEN
// ═══════════════════════════════════════════════════════════════

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-base flex items-center justify-center">
      <div className="text-center space-y-5">
        <div className="relative mx-auto w-12 h-12">
          <div className="absolute inset-0 rounded-full border-2 border-edge" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-teal animate-spin" />
        </div>
        <div className="space-y-1">
          <p className="font-mono font-bold text-teal tracking-widest text-sm uppercase">
            Central
          </p>
          <p className="font-mono text-dim text-xs tracking-widest uppercase">
            connecting…
          </p>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// CORE GRID
// ═══════════════════════════════════════════════════════════════

function CoreGrid({ perCore }: { perCore: number[] }) {
  const cores = perCore.slice(0, 16)
  const cols  = cores.length > 8 ? 'grid-cols-8' : 'grid-cols-4'

  return (
    <div className={`grid ${cols} gap-x-2 gap-y-1.5 mt-1`}>
      {cores.map((load, i) => (
        <div key={i} className="flex flex-col items-center gap-0.5">
          <div
            className="w-full rounded-sm bg-edge overflow-hidden"
            style={{ height: 28 }}
            title={`Core ${i}: ${load.toFixed(1)}%`}
          >
            <div
              className={`w-full rounded-sm transition-all duration-500 ${pctBg(load)}`}
              style={{
                height:   `${Math.max(load, 2)}%`,
                position: 'relative',
                top:      `${100 - Math.max(load, 2)}%`,
              }}
            />
          </div>
          <span className="font-mono text-dim tabular" style={{ fontSize: 9 }}>
            {load.toFixed(0)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════

export default function App() {
  const [stats,      setStats]      = useState<SystemStats | null>(null)
  const [liveUptime, setLiveUptime] = useState<number | null>(null)
  const [error,      setError]      = useState<string | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [updatedAt,  setUpdatedAt]  = useState<Date | null>(null)

  // Fetches everything: CPU, RAM, disk, network, OS, uptime
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/stats')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: SystemStats = await res.json()
      setStats(data)
      setLiveUptime(data.uptime)   // seed the fast uptime from the full response
      setUpdatedAt(new Date())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed')
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetches only uptime — lightweight, runs every 1s
  const fetchUptime = useCallback(async () => {
    try {
      const res = await fetch('/api/uptime')
      if (!res.ok) return
      const data: { uptime: number } = await res.json()
      setLiveUptime(data.uptime)
    } catch {
      // silently ignore — the main stats poll handles error display
    }
  }, [])

  // Full stats every 2s
  useEffect(() => {
    fetchStats()
    const id = setInterval(fetchStats, STATS_POLL_MS)
    return () => clearInterval(id)
  }, [fetchStats])

  // Uptime only every 1s — starts after the first stats load so there is
  // always a valid uptime value before this interval fires
  useEffect(() => {
    if (!stats) return            // wait until the first full load
    const id = setInterval(fetchUptime, UPTIME_POLL_MS)
    return () => clearInterval(id)
  }, [stats, fetchUptime])

  // ── Loading state ────────────────────────────────────────────
  if (loading) return <LoadingScreen />

  // ── Hard error (no data at all yet) ─────────────────────────
  if (!stats) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="font-mono font-bold text-teal tracking-widest uppercase mb-4">Central</p>
          <p className="font-mono text-rose font-semibold">Connection failed</p>
          <p className="text-dim text-sm font-mono">{error}</p>
          <p className="text-dim text-xs">Is the API container running?</p>
        </div>
      </div>
    )
  }

  const { cpu, ram, storage, os: sysOs, network } = stats

  // liveUptime updates every 1s; falls back to stats.uptime on the very
  // first render before the fast interval has fired
  const displayUptime = liveUptime ?? stats.uptime

  const activeNet = network.filter(n => n.rxSec > 0 || n.txSec > 0).slice(0, 3)

  // ── Dashboard ────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-base text-ink">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">

        {/* ── Header ─────────────────────────────────────────── */}
        <header className="flex items-start justify-between">
          <div>
            <h1
              className="font-mono font-bold tracking-widest uppercase"
              style={{ fontSize: '1.1rem', color: '#00e0a0', textShadow: '0 0 20px rgba(0,224,160,0.3)' }}
            >
              Central
            </h1>
            <p className="font-mono text-sm text-ink mt-0.5">
              <span className="text-dim mr-1">//</span>
              {sysOs.hostname}
            </p>
            <p className="text-dim text-xs font-mono mt-0.5">
              {sysOs.distro}
              {sysOs.release ? ` ${sysOs.release}` : ''}
              {' · '}{sysOs.arch}
            </p>
          </div>

          <div className="text-right space-y-1">
            <div className="flex items-center justify-end gap-2">
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${error ? 'bg-rose' : 'bg-teal'}`}
                style={error ? undefined : { boxShadow: '0 0 6px #00e0a0' }}
              />
              <span className="font-mono text-xs text-dim">
                {error ? 'offline' : 'live'}
              </span>
            </div>
            {updatedAt && (
              <p className="font-mono text-xs" style={{ color: '#2e2e4a' }}>
                {updatedAt.toLocaleTimeString()}
              </p>
            )}
            {error && (
              <p className="font-mono text-xs text-rose">{error}</p>
            )}
          </div>
        </header>

        {/* ── Top row: CPU · RAM · System ────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

          {/* CPU */}
          <Card title="CPU" badge={`${cpu.cores} cores`}>
            <div className="flex justify-center mb-3">
              <RingGauge pct={cpu.usage} />
            </div>
            <p
              className="font-mono text-xs text-dim text-center truncate mb-3"
              title={cpu.model}
            >
              {cpu.model}
            </p>
            {cpu.perCore.length > 0 && (
              <CoreGrid perCore={cpu.perCore} />
            )}
          </Card>

          {/* RAM */}
          <Card title="Memory" badge="RAM">
            <div className="flex justify-center mb-3">
              <RingGauge pct={ram.percentage} />
            </div>
            <div className="space-y-2">
              <StatRow label="Used"      value={fmtBytes(ram.used)} />
              <StatRow label="Available" value={fmtBytes(ram.available)} />
              <StatRow label="Total"     value={fmtBytes(ram.total)} />
              {ram.swapTotal > 0 && (
                <div className="pt-2 mt-2 border-t border-edge space-y-1.5">
                  <StatRow
                    label="Swap"
                    value={`${fmtBytes(ram.swapUsed)} / ${fmtBytes(ram.swapTotal)}`}
                  />
                  <Bar pct={ram.swapPercentage} thin />
                </div>
              )}
            </div>
          </Card>

          {/* System */}
          <Card title="System" badge="Info">
            <div className="flex flex-col items-center py-4 mb-4">
              <span className="text-dim text-xs font-mono uppercase tracking-widest mb-2">
                uptime
              </span>
              <span
                className="font-mono font-bold text-teal tabular"
                style={{
                  fontSize:   '1.75rem',
                  lineHeight: 1,
                  textShadow: '0 0 18px rgba(0,224,160,0.35)',
                }}
              >
                {fmtUptime(displayUptime)}
              </span>
            </div>

            <div className="space-y-2">
              <StatRow label="Distro"  value={sysOs.distro} />
              <StatRow label="Version" value={sysOs.release || '—'} />
              <StatRow label="Arch"    value={sysOs.arch} />
            </div>

            {activeNet.length > 0 && (
              <div className="mt-4 pt-3 border-t border-edge space-y-1.5">
                <p className="text-dim text-xs font-mono uppercase tracking-widest">
                  Network
                </p>
                {activeNet.map(n => (
                  <div
                    key={n.iface}
                    className="flex justify-between items-center text-xs font-mono"
                  >
                    <span className="text-dim">{n.iface}</span>
                    <span>
                      <span className="text-teal">↓ {fmtSpeed(n.rxSec)}</span>
                      <span className="text-edge mx-1">·</span>
                      <span style={{ color: '#60a0f0' }}>↑ {fmtSpeed(n.txSec)}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ── Storage ────────────────────────────────────────── */}
        <Card
          title="Storage"
          badge={`${storage.length} device${storage.length !== 1 ? 's' : ''}`}
        >
          {storage.length === 0 ? (
            <p className="text-dim text-sm font-mono text-center py-6">
              No physical devices detected.
              <br />
              <span className="text-xs">
                Ensure <code className="text-teal">/:/host:ro</code> is mounted in docker-compose.
              </span>
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {storage.map(disk => (
                <div
                  key={disk.mount}
                  className="bg-base border border-edge rounded-xl p-4 space-y-2"
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 mr-3">
                      <p className="font-mono font-semibold text-ink text-sm truncate">
                        {disk.mount}
                      </p>
                      <p className="font-mono text-xs text-dim truncate">
                        {disk.fs} · {disk.type}
                      </p>
                    </div>
                    <span
                      className={`font-mono font-bold tabular text-xl shrink-0 ${pctText(disk.use)}`}
                      style={{ textShadow: `0 0 10px ${pctStroke(disk.use)}44` }}
                    >
                      {disk.use.toFixed(1)}%
                    </span>
                  </div>

                  <Bar pct={disk.use} />

                  <div className="flex justify-between text-xs font-mono text-dim">
                    <span>{fmtBytes(disk.used)} used</span>
                    <span>{fmtBytes(disk.available)} free</span>
                    <span>{fmtBytes(disk.size)} total</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ── Footer ─────────────────────────────────────────── */}
        <footer className="text-center">
          <p className="font-mono text-xs" style={{ color: '#1e1e32' }}>
            Made with ❤️ by Induwara
          </p>
        </footer>

      </div>
    </div>
  )
}