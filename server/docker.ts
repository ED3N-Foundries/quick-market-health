import { existsSync } from "node:fs"
import http from "node:http"
import type { HealthEnv } from "./env"

export type ContainerHealth = "starting" | "healthy" | "unhealthy" | "none"

export type ContainerSummary = {
  /** Container name as configured in the watch list. */
  name: string
  exists: boolean
  running: boolean
  restarting: boolean
  paused: boolean
  oomKilled: boolean
  dead: boolean
  exitCode: number | null
  error: string | null
  startedAt: number | null
  finishedAt: number | null
  /** Wall-clock ms since StartedAt while running, null otherwise. */
  uptimeMs: number | null
  /** Docker restart count, null when unknown. */
  restartCount: number | null
  health: ContainerHealth
  healthFailingStreak: number | null
  /** Raw State.Status from the engine (running, exited, created, …). */
  status: string
  /** One-shot engine stats (nulls when the socket is disabled or stats fail). */
  cpuPct: number | null
  memUsed: number | null
  memLimit: number | null
  memPct: number | null
  pids: number | null
  netRx: number | null
  netTx: number | null
}

export type DockerSnapshot = {
  available: boolean
  sock: string | null
  error: string | null
  at: number
  containers: ContainerSummary[]
}

export type LogTail = {
  container: string
  at: number
  tail: number
  lines: string[]
  truncated: boolean
  error: string | null
}

const SNAPSHOT_TTL_MS = 3_000
const LOGS_TTL_MS = 2_000
const MAX_LOG_BYTES = 256 * 1024

let snapshotCache: { at: number; key: string; value: DockerSnapshot } | null = null
const logsCache = new Map<string, { at: number; value: LogTail }>()

function cacheKey(env: HealthEnv): string {
  return `${env.dockerSock}|${env.dockerContainers.join(",")}|${env.dockerTimeoutMs}`
}

function dockerGet(sock: string, path: string, timeoutMs: number): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: sock, path, method: "GET" }, (res) => {
      const chunks: Buffer[] = []
      let size = 0
      res.on("data", (chunk: Buffer) => {
        // Cap memory: the logs endpoint can be large, inspect is tiny.
        if (size < MAX_LOG_BYTES * 2) {
          chunks.push(chunk)
          size += chunk.length
        }
      })
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }))
    })
    req.on("error", reject)
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`docker request timed out after ${timeoutMs}ms`)))
    req.end()
  })
}

function toMs(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null
  const ms = Date.parse(value)
  if (!Number.isFinite(ms) || ms <= 0) return null
  return ms
}

function missingContainer(name: string): ContainerSummary {
  return {
    name,
    exists: false,
    running: false,
    restarting: false,
    paused: false,
    oomKilled: false,
    dead: false,
    exitCode: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    uptimeMs: null,
    restartCount: null,
    health: "none",
    healthFailingStreak: null,
    status: "missing",
    cpuPct: null,
    memUsed: null,
    memLimit: null,
    memPct: null,
    pids: null,
    netRx: null,
    netTx: null,
  }
}

function parseInspect(name: string, body: unknown, now: number): ContainerSummary {
  if (!body || typeof body !== "object") return { ...missingContainer(name), status: "unknown" }
  const root = body as Record<string, unknown>
  const state = (root.State ?? {}) as Record<string, unknown>
  const health = (state.Health ?? {}) as Record<string, unknown>
  const rawHealth = typeof health.Status === "string" ? health.Status : ""
  const startedAt = toMs(state.StartedAt)
  const finishedAt = toMs(state.FinishedAt)
  const running = state.Running === true
  const status = typeof state.Status === "string" && state.Status ? state.Status : running ? "running" : "unknown"
  return {
    name,
    exists: true,
    running,
    restarting: state.Restarting === true,
    paused: state.Paused === true,
    oomKilled: state.OOMKilled === true,
    dead: state.Dead === true,
    exitCode: typeof state.ExitCode === "number" ? state.ExitCode : null,
    error: typeof state.Error === "string" && state.Error ? state.Error : null,
    startedAt,
    finishedAt,
    uptimeMs: running && startedAt != null ? Math.max(0, now - startedAt) : null,
    restartCount: typeof root.RestartCount === "number" ? root.RestartCount : null,
    health: rawHealth === "starting" || rawHealth === "healthy" || rawHealth === "unhealthy" ? rawHealth : "none",
    healthFailingStreak: typeof health.FailingStreak === "number" ? health.FailingStreak : null,
    status,
    cpuPct: null,
    memUsed: null,
    memLimit: null,
    memPct: null,
    pids: null,
    netRx: null,
    netTx: null,
  }
}

export type ContainerStats = {
  cpuPct: number | null
  memUsed: number | null
  memLimit: number | null
  memPct: number | null
  pids: number | null
  netRx: number | null
  netTx: number | null
}

const STATS_TTL_MS = 5_000

let statsCache: { at: number; key: string; value: Map<string, ContainerStats> } | null = null

/** Previous CPU counters per watched container (for delta-based CPU %). */
const prevCpu = new Map<string, { total: number; sys: number; cpus: number }>()

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** CPU % from a one-shot stats sample: (cpu delta / system delta) * cpus * 100. */
export function calcCpuPct(stat: unknown): number | null {
  if (!stat || typeof stat !== "object") return null
  const s = stat as Record<string, unknown>
  const cpu = s.cpu_stats as Record<string, unknown> | undefined
  const pre = s.precpu_stats as Record<string, unknown> | undefined
  if (!cpu || !pre || typeof cpu !== "object" || typeof pre !== "object") return null
  const curUse = numOrNull((cpu.cpu_usage as Record<string, unknown> | undefined)?.total_usage)
  const preUse = numOrNull((pre.cpu_usage as Record<string, unknown> | undefined)?.total_usage)
  const curSys = numOrNull(cpu.system_cpu_usage)
  const preSys = numOrNull(pre.system_cpu_usage)
  if (curUse == null || preUse == null || curSys == null || preSys == null) return null
  const cpuDelta = curUse - preUse
  const sysDelta = curSys - preSys
  if (!(cpuDelta > 0) || !(sysDelta > 0)) return null
  let cpus = numOrNull(cpu.online_cpus)
  if (!(cpus != null && cpus > 0)) {
    const per = (cpu.cpu_usage as Record<string, unknown> | undefined)?.percpu_usage
    cpus = Array.isArray(per) && per.length > 0 ? per.length : 1
  }
  return (cpuDelta / sysDelta) * cpus * 100
}

/** Raw CPU counters from a stats sample (null when absent). */
export function cpuCounters(stat: unknown): { total: number; sys: number; cpus: number } | null {
  if (!stat || typeof stat !== "object") return null
  const s = stat as Record<string, unknown>
  const cpu = s.cpu_stats as Record<string, unknown> | undefined
  if (!cpu || typeof cpu !== "object") return null
  const total = numOrNull((cpu.cpu_usage as Record<string, unknown> | undefined)?.total_usage)
  const sys = numOrNull(cpu.system_cpu_usage)
  if (total == null || sys == null) return null
  let cpus = numOrNull(cpu.online_cpus)
  if (!(cpus != null && cpus > 0)) {
    const per = (cpu.cpu_usage as Record<string, unknown> | undefined)?.percpu_usage
    cpus = Array.isArray(per) && per.length > 0 ? per.length : 1
  }
  return { total, sys, cpus }
}

/** CPU % from two successive samples (the standard docker-stats approach). */
export function cpuPctBetween(prev: { total: number; sys: number; cpus: number } | null, cur: { total: number; sys: number; cpus: number } | null): number | null {
  if (!prev || !cur) return null
  const cpuDelta = cur.total - prev.total
  const sysDelta = cur.sys - prev.sys
  if (!(cpuDelta >= 0) || !(sysDelta > 0)) return null
  if (cpuDelta === 0) return 0
  return (cpuDelta / sysDelta) * cur.cpus * 100
}

export function parseStats(stat: unknown): ContainerStats {
  const blank: ContainerStats = { cpuPct: null, memUsed: null, memLimit: null, memPct: null, pids: null, netRx: null, netTx: null }
  if (!stat || typeof stat !== "object") return blank
  const s = stat as Record<string, unknown>
  const mem = s.memory_stats as Record<string, unknown> | undefined
  const memUsed = mem && typeof mem === "object" ? numOrNull(mem.usage) : null
  const memLimit = mem && typeof mem === "object" ? numOrNull(mem.limit) : null
  let netRx: number | null = null
  let netTx: number | null = null
  const networks = s.networks as Record<string, unknown> | undefined
  if (networks && typeof networks === "object") {
    let rx = 0
    let tx = 0
    let seen = false
    for (const value of Object.values(networks)) {
      if (!value || typeof value !== "object") continue
      const iface = value as Record<string, unknown>
      const r = numOrNull(iface.rx_bytes)
      const t = numOrNull(iface.tx_bytes)
      if (r != null) {
        rx += r
        seen = true
      }
      if (t != null) {
        tx += t
        seen = true
      }
    }
    if (seen) {
      netRx = rx
      netTx = tx
    }
  }
  return {
    cpuPct: calcCpuPct(stat),
    memUsed,
    memLimit,
    memPct: memUsed != null && memLimit != null && memLimit > 0 ? (memUsed / memLimit) * 100 : null,
    pids: s.pids_stats && typeof s.pids_stats === "object" ? numOrNull((s.pids_stats as Record<string, unknown>).current) : null,
    netRx,
    netTx,
  }
}

export async function fetchStatsMap(env: HealthEnv): Promise<Map<string, ContainerStats>> {
  const now = Date.now()
  const key = cacheKey(env)
  if (statsCache && statsCache.key === key && now - statsCache.at < STATS_TTL_MS) return statsCache.value
  const map = new Map<string, ContainerStats>()
  if (env.dockerSock && existsSync(env.dockerSock)) {
    await Promise.all(
      env.dockerContainers.map(async (name) => {
        try {
          const { status, body } = await dockerGet(
            env.dockerSock,
            `/containers/${encodeURIComponent(name)}/stats?stream=0&one-shot=1`,
            Math.max(env.dockerTimeoutMs, 5_000),
          )
          if (status < 200 || status >= 300) return
          try {
            const parsed: unknown = JSON.parse(body.toString("utf8"))
            const st = parseStats(parsed)
            // One-shot precpu_stats are zeroed, so CPU % needs the delta
            // against the previous sample (first sample stays null).
            const cur = cpuCounters(parsed)
            const prev = prevCpu.get(`${key}|${name}`)
            st.cpuPct = cpuPctBetween(prev ?? null, cur)
            if (cur) prevCpu.set(`${key}|${name}`, cur)
            map.set(name, st)
          } catch {
            // ignore malformed payloads
          }
        } catch {
          // Stats must never fail the snapshot; fields stay null.
        }
      }),
    )
  }
  statsCache = { at: now, key, value: map }
  return map
}

export async function getDockerSnapshot(env: HealthEnv, force = false): Promise<DockerSnapshot> {
  const now = Date.now()
  const key = cacheKey(env)
  if (!force && snapshotCache && snapshotCache.key === key && now - snapshotCache.at < SNAPSHOT_TTL_MS) {
    return snapshotCache.value
  }
  const fetchOnce = async (): Promise<DockerSnapshot> => {
    if (!env.dockerSock) {
      return { available: false, sock: null, error: null, at: now, containers: [] }
    }
    if (!existsSync(env.dockerSock)) {
      return { available: false, sock: env.dockerSock, error: `socket not found: ${env.dockerSock}`, at: now, containers: [] }
    }
    const containers: ContainerSummary[] = []
    for (const name of env.dockerContainers) {
      try {
        const { status, body } = await dockerGet(env.dockerSock, `/containers/${encodeURIComponent(name)}/json`, env.dockerTimeoutMs)
        if (status === 404) {
          containers.push(missingContainer(name))
          continue
        }
        if (status < 200 || status >= 300) {
          containers.push({ ...missingContainer(name), status: `error ${status}` })
          continue
        }
        let parsed: unknown = null
        try {
          parsed = JSON.parse(body.toString("utf8"))
        } catch {
          parsed = null
        }
        containers.push(parseInspect(name, parsed, now))
      } catch (error) {
        return {
          available: false,
          sock: env.dockerSock,
          error: error instanceof Error ? error.message : String(error),
          at: now,
          containers,
        }
      }
    }
    try {
      const stats = await fetchStatsMap(env)
      for (const c of containers) {
        const st = stats.get(c.name)
        if (st) Object.assign(c, st)
      }
    } catch {
      // Stats overlay is best effort; inspect data stands alone.
    }
    return { available: true, sock: env.dockerSock, error: null, at: now, containers }
  }
  const value = await fetchOnce()
  snapshotCache = { at: now, key, value }
  return value
}

/**
 * Decode the Docker multiplexed log stream (8-byte header per frame:
 * 1-byte stream id, 3 zero bytes, 4-byte big-endian length). Containers
 * started with a TTY return raw text instead — pass that through.
 */
export function demuxDockerLogs(buf: Buffer): string {
  if (buf.length === 0) return ""
  let out = ""
  let off = 0
  let framed = false
  while (off + 8 <= buf.length) {
    const type = buf[off]!
    const len = buf.readUInt32BE(off + 4)
    if ((type === 0 || type === 1 || type === 2) && buf[off + 1] === 0 && buf[off + 2] === 0 && buf[off + 3] === 0 && off + 8 + len <= buf.length) {
      framed = true
      if (len > 0) out += buf.subarray(off + 8, off + 8 + len).toString("utf8")
      off += 8 + len
    } else {
      break
    }
  }
  if (!framed) return buf.toString("utf8")
  // Trailing bytes that don't form a full frame (shouldn't happen, but don't lose them).
  if (off < buf.length) out += buf.subarray(off).toString("utf8")
  return out
}

const ANSI_RE = /\[[0-9;]*m/g

export function cleanLogText(text: string): string {
  return text.replace(ANSI_RE, "").replace(/\r\n/g, "\n")
}

export function clampTail(tail: unknown, fallback: number): number {
  const n = typeof tail === "string" ? Number(tail) : typeof tail === "number" ? tail : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(2000, Math.max(10, Math.floor(n)))
}

export async function fetchContainerLogs(env: HealthEnv, container: string, tail: number): Promise<LogTail> {
  const at = Date.now()
  const wanted = clampTail(tail, env.dockerLogsTail)
  const key = `${env.dockerSock}|${container}|${wanted}`
  const cached = logsCache.get(key)
  if (cached && at - cached.at < LOGS_TTL_MS) return cached.value
  const load = async (): Promise<LogTail> => {
    if (!env.dockerSock) return { container, at, tail: wanted, lines: [], truncated: false, error: "docker logs not configured (DOCKER_SOCK empty)" }
    if (!env.dockerContainers.includes(container)) {
      return { container, at, tail: wanted, lines: [], truncated: false, error: `refusing to read unwatched container "${container}"` }
    }
    if (!existsSync(env.dockerSock)) {
      return { container, at, tail: wanted, lines: [], truncated: false, error: `socket not found: ${env.dockerSock}` }
    }
    try {
      const { status, body } = await dockerGet(
        env.dockerSock,
        `/containers/${encodeURIComponent(container)}/logs?stdout=1&stderr=1&tail=${wanted}&timestamps=1`,
        Math.max(env.dockerTimeoutMs, 5_000),
      )
      if (status === 404) return { container, at, tail: wanted, lines: [], truncated: false, error: `no such container: ${container}` }
      if (status < 200 || status >= 300) {
        return { container, at, tail: wanted, lines: [], truncated: false, error: `docker logs HTTP ${status}` }
      }
      const sliced = body.length > MAX_LOG_BYTES ? body.subarray(body.length - MAX_LOG_BYTES) : body
      const text = cleanLogText(demuxDockerLogs(sliced))
      const lines = text.split("\n").filter((line) => line.length > 0)
      return { container, at, tail: wanted, lines, truncated: body.length > MAX_LOG_BYTES, error: null }
    } catch (error) {
      return { container, at, tail: wanted, lines: [], truncated: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  const value = await load()
  logsCache.set(key, { at, value })
  if (logsCache.size > 32) {
    const oldest = [...logsCache.keys()][0]!
    logsCache.delete(oldest)
  }
  return value
}

/** Test hook: clear the module caches. */
export function __resetDockerForTest(): void {
  snapshotCache = null
  statsCache = null
  prevCpu.clear()
  logsCache.clear()
}
