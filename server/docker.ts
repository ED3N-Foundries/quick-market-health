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
  }
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
  logsCache.clear()
}
