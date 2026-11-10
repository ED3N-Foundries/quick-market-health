import type { HealthEnv } from "./env"
import { getDockerSnapshot, type ContainerSummary, type DockerSnapshot } from "./docker"

export type CheckStatus = "ok" | "degraded" | "down"

/** What the market is doing right now, for humans. `status` stays probe-based
 *  (ok/degraded/down) for backwards compatibility; `lifecycle` folds in the
 *  container state so a boot shows as `starting` instead of a scary `down`. */
export type Lifecycle = "online" | "degraded" | "starting" | "offline" | "unknown"

export type CheckResult = {
  id: string
  label: string
  ok: boolean
  /** Measured latency in ms, null when the probe never got a response. */
  ms: number | null
  detail: string
  error?: string
}

export type VenueHealth = {
  venue: string
  price: string | null
  ageMs: number | null
  up: boolean
  role: string | null
  reason: string | null
  swing: string | null
  gap: string | null
  feed: string | null
  stale: boolean
}

export type MarketLastError = {
  message: string | null
  kind: string | null
  at: number | null
} | null

export type MarketPrevious = {
  bootId: string | null
  bootAt: number | null
  endedAt: number | null
  bootCount: number | null
  clean: boolean | null
  reason: string | null
  signal: string | null
} | null

export type MarketProcess = {
  bootId: string | null
  bootAt: number | null
  bootCount: number | null
  uptimeMs: number | null
  status: string | null
  reason: string | null
  lastError: MarketLastError
  lastSignal: string | null
  eventLoopLagMs: number | null
  diskUsed: number | null
  diskSize: number | null
  dbBytes: number | null
  memory: { rss: number | null; heapUsed: number | null; heapTotal: number | null } | null
  counters: { uncaught: number | null; unhandled: number | null; requestErrors: number | null; tickErrors: number | null } | null
} | null

export type TailStat = {
  count: number | null
  avgMs: number | null
  maxMs: number | null
  p50: number | null
  p90: number | null
  p95: number | null
  p99: number | null
}

export type HangEntry = {
  id: number | null
  ts: number | null
  durationMs: number | null
  kind: string | null
  name: string | null
  detail: string | null
}

export type HangSummary = {
  recent: HangEntry[]
  count: number | null
  maxMs: number | null
  lastTs: number | null
}

/** Latest 10s self-sample tail snapshot (null when the market is down/old). */
export type SelfTail = {
  at: number | null
  lagP99: number | null
  reqP99: number | null
  qP99: number | null
  tickP99: number | null
  boardP99: number | null
  peers: number | null
  diskUsed: number | null
  diskSize: number | null
  dbBytes: number | null
} | null

export type TrackerState = {
  restartCount: number
  lastRestartAt: number | null
  lastRestartReason: string | null
  lastBootId: string | null
  consecutiveDown: number
  downSince: number | null
  lastOkAt: number | null
  lastDownReason: string | null
}

export type HealthReport = {
  at: number
  target: string
  status: CheckStatus
  /** Container-aware state: online / degraded / starting / offline. */
  lifecycle: Lifecycle
  /** One-line human reason for the lifecycle (null when online). */
  lifecycleReason: string | null
  /** Docker state for each watched container (empty when DOCKER_SOCK is unset). */
  containers: ContainerSummary[]
  /** Wall-clock ms for the whole probe run. */
  totalMs: number
  checks: CheckResult[]
  /** Human reason for the current down/degraded state, null when ok. */
  downReason: string | null
  /** Market process vitals from /api/status (null when the market is unreachable). */
  process: MarketProcess
  /** Previous market run info (crash reason survives restarts), null when unknown. */
  previous: MarketPrevious
  tracking: TrackerState
  /** Hang suspects from the market's own stall detector (null-safe, never affects status). */
  hangs: HangSummary
  /** Merged-histogram pXX per route / query group over the last hour (bounded). */
  routeTails: Record<string, TailStat>
  queryTails: Record<string, TailStat>
  /** Latest 10s self-sample snapshot (disk + p99s for in-person debugging). */
  selfTail: SelfTail
  summary: {
    chainKey: string | null
    chainName: string | null
    chainId: number | null
    feed: string | null
    tickerPrice: string | null
    tickerVenue: string | null
    serverNow: number | null
    clockSkewMs: number | null
    tapePoints: number | null
    tapeAgeMs: number | null
    joinId: number | null
    liveId: number | null
    windowCloseInMs: number | null
    poolUpMicros: number | null
    poolDownMicros: number | null
    handoff: string | null
    switches: { at: number; from: string; to: string | null; reason: string }[]
    wsConnectMs: number | null
    wsFirstMsgMs: number | null
    wsRttMs: number | null
  }
  venues: VenueHealth[]
}

const VENUE_STALE_MS = 5_000

export function emptyTracker(): TrackerState {
  return {
    restartCount: 0,
    lastRestartAt: null,
    lastRestartReason: null,
    lastBootId: null,
    consecutiveDown: 0,
    downSince: null,
    lastOkAt: null,
    lastDownReason: null,
  }
}

/** First failing critical check, else first failing check, as a one-line reason. */
export function summarizeDownReason(
  checks: Pick<CheckResult, "id" | "ok" | "label" | "detail" | "error">[],
  processReason: string | null,
): string | null {
  const failing = checks.filter((c) => !c.ok)
  if (failing.length === 0) return processReason
  const critical = ["config", "state", "ws"]
  const firstCritical = failing.find((c) => critical.includes(c.id)) ?? failing[0]!
  const bits = `${firstCritical.label}: ${firstCritical.detail}`
  const withErr = firstCritical.error ? `${bits} [${firstCritical.error.slice(0, 160)}]` : bits
  if (failing.length > 1) return `${withErr} (+${failing.length - 1} more)`
  if (processReason && firstCritical.id !== "config") return `${withErr} · market says: ${processReason.slice(0, 160)}`
  return withErr
}

/** Container-level hint: the fetch never got an HTTP response. */
export function containerHintFor(error: string): string | null {
  const text = error.toLowerCase()
  if (/econnrefused|connection refused|fetch failed|socket|econnreset/.test(text)) {
    return "connection refused — container down or restarting"
  }
  if (/abort|timeout|timed out/.test(text)) return "timeout — container hung or overloaded"
  return null
}

/** Freshly started containers need a grace window before "running but silent"
 *  counts as offline: the market only listens after its chain boot finishes. */
export const BOOT_GRACE_MS = 60_000

export function deriveLifecycle(input: {
  status: CheckStatus
  checks: Pick<CheckResult, "id" | "ok" | "error">[]
  snapshot: DockerSnapshot
  primaryName: string
  /** Whether any probe has ever succeeded (tracking.lastOkAt != null). */
  everOk: boolean
  now: number
}): { lifecycle: Lifecycle; reason: string | null } {
  const { status, checks, snapshot, primaryName, everOk, now } = input
  if (status === "ok") return { lifecycle: "online", reason: null }
  if (status === "degraded") return { lifecycle: "degraded", reason: summarizeDownReason(checks, null) }
  const firstErr = checks.find((c) => !c.ok && c.error)?.error ?? ""
  const hint = firstErr ? containerHintFor(firstErr) : null
  if (!snapshot.available) {
    // No container signal: guess from probe errors + history.
    if (hint && !everOk) {
      return { lifecycle: "starting", reason: `market not reachable yet — probably still booting · ${hint}` }
    }
    return { lifecycle: "offline", reason: hint ? `market unreachable · ${hint}` : "market unreachable" }
  }
  const primary = snapshot.containers.find((c) => c.name === primaryName) ?? snapshot.containers[0]
  if (!primary) return { lifecycle: "offline", reason: "no containers watched" }
  if (!primary.exists) return { lifecycle: "offline", reason: `container ${primary.name} not found — not deployed?` }
  if (primary.restarting) return { lifecycle: "starting", reason: `container ${primary.name} restarting` }
  if (primary.paused) return { lifecycle: "offline", reason: `container ${primary.name} paused` }
  if (primary.dead) return { lifecycle: "offline", reason: `container ${primary.name} dead` }
  if (!primary.running) {
    if (primary.status === "created") return { lifecycle: "starting", reason: `container ${primary.name} created, not started yet` }
    const ago = primary.finishedAt != null ? ` ${formatAge(now - primary.finishedAt)} ago` : ""
    const code = primary.exitCode != null ? ` (exit ${primary.exitCode}${ago})` : ago ? ` (${ago.trim()})` : ""
    const oom = primary.oomKilled ? " — OOM-killed" : ""
    return { lifecycle: "offline", reason: `container ${primary.name} ${primary.status}${code}${oom}` }
  }
  if (primary.health === "starting") {
    return { lifecycle: "starting", reason: `container ${primary.name} healthcheck still starting — market is booting` }
  }
  if (primary.health === "unhealthy") {
    const streak = primary.healthFailingStreak != null ? ` (failing streak ${primary.healthFailingStreak})` : ""
    return { lifecycle: "offline", reason: `container ${primary.name} failing healthcheck${streak}` }
  }
  if (primary.oomKilled) return { lifecycle: "offline", reason: `container ${primary.name} OOM-killed` }
  if (primary.uptimeMs != null && primary.uptimeMs < BOOT_GRACE_MS) {
    return { lifecycle: "starting", reason: `container ${primary.name} started ${formatAge(primary.uptimeMs)} ago, API not up yet` }
  }
  const streak = primary.healthFailingStreak != null && primary.healthFailingStreak > 0 ? ` · healthcheck failing streak ${primary.healthFailingStreak}` : ""
  return { lifecycle: "offline", reason: hint ? `container running but API unreachable${streak} · ${hint}` : `container running but API unreachable${streak}` }
}

export function updateTracker(prev: TrackerState, report: Pick<HealthReport, "at" | "status" | "downReason" | "process" | "previous">): TrackerState {
  const next: TrackerState = { ...prev }
  const bootId = report.process?.bootId ?? null
  if (bootId && prev.lastBootId && bootId !== prev.lastBootId) {
    next.restartCount = prev.restartCount + 1
    next.lastRestartAt = report.at
    const prevReason = report.previous?.reason ?? null
    next.lastRestartReason = prevReason ?? `market restarted (boot ${bootId.slice(0, 8)})`
    next.lastBootId = bootId
  } else if (bootId && !prev.lastBootId) {
    next.lastBootId = bootId
  }
  if (!bootId && prev.lastBootId && report.status === "down") {
    // Market unreachable: boot id unknown, keep lastBootId so the next
    // successful probe still counts as a restart.
  }
  if (report.status === "ok") {
    next.consecutiveDown = 0
    next.downSince = null
    next.lastOkAt = report.at
    next.lastDownReason = null
  } else {
    next.consecutiveDown = prev.consecutiveDown + 1
    next.downSince = prev.downSince ?? report.at
    next.lastDownReason = report.downReason
  }
  return next
}

export function classifyOverall(checks: Pick<CheckResult, "id" | "ok">[]): CheckStatus {
  const byId = new Map(checks.map((c) => [c.id, c.ok]))
  const critical: string[] = ["config", "state", "ws"]
  if (critical.some((id) => byId.get(id) === false)) return "down"
  if ([...byId.values()].some((ok) => ok === false)) return "degraded"
  if (checks.length === 0) return "degraded"
  return "ok"
}

export function venueIsStale(ageMs: number | null, up: boolean): boolean {
  if (!up) return true
  if (ageMs == null) return true
  return ageMs > VENUE_STALE_MS
}

export function formatMs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—"
  if (ms < 10) return `${ms.toFixed(1)} ms`
  return `${Math.round(ms)} ms`
}

export function formatAge(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—"
  if (ms < 0) return `${Math.round(ms)} ms`
  if (ms < 1_000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

async function timedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ ms: number; res: Response; text: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const start = performance.now()
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    const text = await res.text()
    return { ms: performance.now() - start, res, text }
  } finally {
    clearTimeout(timer)
  }
}

function parseJson(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

type Cfg = {
  chainKey?: string
  chainName?: string
  chainId?: number
  windowSeconds?: number
  marketSeconds?: number
  feeBps?: number
  source?: string
  usdc?: string
  treasury?: string
}

const CHAIN_RPC: Record<string, string> = {
  base: "https://mainnet.base.org",
  "base-sepolia": "https://sepolia.base.org",
  "near-testnet": "https://rpc.testnet.near.org",
}

async function probeWs(url: string, timeoutMs: number): Promise<{
  ok: boolean
  connectMs: number | null
  firstMsgMs: number | null
  rttMs: number | null
  detail: string
  error?: string
}> {
  return new Promise((resolve) => {
    const t0 = performance.now()
    let connectMs: number | null = null
    let firstMsgMs: number | null = null
    let settled = false
    let ws: WebSocket | null = null
    const finish = (out: Omit<Awaited<ReturnType<typeof probeWs>>, never>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        ws?.close()
      } catch {
        // ignore
      }
      resolve(out)
    }
    const timer = setTimeout(() => {
      finish({
        ok: false,
        connectMs,
        firstMsgMs,
        rttMs: null,
        detail: connectMs == null ? "no websocket open" : "no round message",
        error: `timeout after ${timeoutMs}ms`,
      })
    }, timeoutMs)
    try {
      ws = new WebSocket(url)
    } catch (error) {
      finish({ ok: false, connectMs: null, firstMsgMs: null, rttMs: null, detail: "connect threw", error: String(error) })
      return
    }
    ws.addEventListener("open", () => {
      connectMs = performance.now() - t0
    })
    ws.addEventListener("message", (event) => {
      let body: Record<string, unknown> | null = null
      try {
        body = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (firstMsgMs == null && body?.type === "round") {
        firstMsgMs = performance.now() - t0 - (connectMs ?? 0)
        // Measure server round-trip with the lag echo endpoint.
        try {
          ws?.send(JSON.stringify({ type: "lag", t: Date.now() }))
          ;(ws as unknown as { __lagAt?: number }).__lagAt = performance.now()
        } catch {
          finish({
            ok: true,
            connectMs,
            firstMsgMs,
            rttMs: null,
            detail: `open ${formatMs(connectMs)}, first round ${formatMs(firstMsgMs)}`,
          })
        }
        // Give the lag reply a short extra window without extending past outer timeout.
        return
      }
      if (body?.type === "lag" && firstMsgMs != null) {
        const lagAt = (ws as unknown as { __lagAt?: number }).__lagAt ?? performance.now()
        const rttMs = performance.now() - lagAt
        const count = 1
        void count
        finish({
          ok: true,
          connectMs,
          firstMsgMs,
          rttMs,
          detail: `open ${formatMs(connectMs)}, first round ${formatMs(firstMsgMs)}, lag rtt ${formatMs(rttMs)}`,
        })
      }
    })
    ws.addEventListener("error", () => {
      if (firstMsgMs != null) return
      finish({
        ok: false,
        connectMs,
        firstMsgMs,
        rttMs: null,
        detail: connectMs == null ? "websocket error before open" : "websocket error before round",
        error: "ws error event",
      })
    })
    ws.addEventListener("close", () => {
      if (settled || firstMsgMs != null) return
      // If we never got a round message, the close is the verdict.
      if (connectMs != null) {
        finish({
          ok: false,
          connectMs,
          firstMsgMs,
          rttMs: null,
          detail: "socket closed before first round message",
          error: "early close",
        })
      }
    })
  })
}

async function probeRpc(chainKey: string | null, env: HealthEnv): Promise<CheckResult> {
  const started = performance.now()
  if (!chainKey) {
    return { id: "rpc", label: "chain RPC", ok: false, ms: null, detail: "skipped: no chainKey from /api/config", error: "no chain" }
  }
  try {
    if (chainKey === "near-testnet") {
      const url = env.rpcUrl || CHAIN_RPC[chainKey]!
      const { ms, res, text } = await timedFetch(url.endsWith("/status") ? url : `${url.replace(/\/+$/, "")}/status`, {}, env.requestTimeoutMs)
      if (!res.ok) return { id: "rpc", label: "NEAR RPC /status", ok: false, ms, detail: `HTTP ${res.status}`, error: text.slice(0, 200) }
      const body = parseJson(text) as { chain_id?: string; sync_info?: { latest_block_height?: number } } | null
      const height = body?.sync_info?.latest_block_height
      return {
        id: "rpc",
        label: "NEAR RPC /status",
        ok: true,
        ms,
        detail: `${body?.chain_id ?? "testnet"} @ height ${height ?? "?"}`,
      }
    }
    const url = env.rpcUrl || CHAIN_RPC[chainKey]!
    const headers = { "content-type": "application/json" }
    const chainCall = await timedFetch(
      url,
      { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) },
      env.requestTimeoutMs,
    )
    if (!chainCall.res.ok) {
      return { id: "rpc", label: "EVM RPC eth_chainId", ok: false, ms: chainCall.ms, detail: `HTTP ${chainCall.res.status}`, error: chainCall.text.slice(0, 200) }
    }
    const chainBody = parseJson(chainCall.text) as { result?: string } | null
    const gotId = chainBody?.result ? parseInt(chainBody.result, 16) : NaN
    const blockCall = await timedFetch(
      url,
      { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_blockNumber", params: [] }) },
      env.requestTimeoutMs,
    )
    const blockBody = parseJson(blockCall.text) as { result?: string } | null
    const block = blockBody?.result ? parseInt(blockBody.result, 16) : NaN
    const totalMs = performance.now() - started
    if (!blockCall.res.ok || !Number.isFinite(block)) {
      return { id: "rpc", label: "EVM RPC eth_blockNumber", ok: false, ms: totalMs, detail: `HTTP ${blockCall.res.status}`, error: blockCall.text.slice(0, 200) }
    }
    return {
      id: "rpc",
      label: `EVM RPC (${url.replace(/^https?:\/\//, "").split("/")[0]})`,
      ok: true,
      ms: totalMs,
      detail: `chainId ${Number.isFinite(gotId) ? gotId : "?"} @ block ${block}`,
    }
  } catch (error) {
    const ms = performance.now() - started
    const message = error instanceof Error ? error.message : String(error)
    return { id: "rpc", label: "chain RPC", ok: false, ms: message.includes("abort") ? ms : ms, detail: "request failed", error: message.slice(0, 300) }
  }
}

type ProcessProbe = {
  process: MarketProcess
  previous: MarketPrevious
  reached: boolean
  hangs: HangSummary
  routeTails: Record<string, TailStat>
  queryTails: Record<string, TailStat>
  selfTail: SelfTail
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function strOrNull(value: unknown, max = 300): string | null {
  if (typeof value !== "string") return null
  return value.slice(0, max)
}

/** Parse a {name: {count/avgMs/maxMs/p50/p90/p95/p99}} map; caps keys, drops junk. */
export function parseTailMap(value: unknown, cap = 32): Record<string, TailStat> {
  const out: Record<string, TailStat> = {}
  if (!value || typeof value !== "object" || Array.isArray(value)) return out
  const entries = Object.entries(value as Record<string, unknown>)
  // Worst-first by p99 so the cap keeps the interesting rows for hang forensics.
  entries.sort(([, a], [, b]) => {
    const pa = (a as Record<string, unknown> | null)?.p99
    const pb = (b as Record<string, unknown> | null)?.p99
    return (typeof pb === "number" ? pb : -1) - (typeof pa === "number" ? pa : -1)
  })
  for (const [name, raw] of entries.slice(0, cap)) {
    if (!name || typeof raw !== "object" || !raw) continue
    const row = raw as Record<string, unknown>
    const count = numOrNull(row.count)
    if (count == null || count <= 0) continue
    out[name.slice(0, 96)] = {
      count,
      avgMs: numOrNull(row.avgMs),
      maxMs: numOrNull(row.maxMs),
      p50: numOrNull(row.p50),
      p90: numOrNull(row.p90),
      p95: numOrNull(row.p95),
      p99: numOrNull(row.p99),
    }
  }
  return out
}

/** Parse the market's hang forensics blob; always returns a shape, never throws. */
export function parseHangs(value: unknown, cap = 20): HangSummary {
  const empty: HangSummary = { recent: [], count: null, maxMs: null, lastTs: null }
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty
  const body = value as Record<string, unknown>
  const recentRaw = Array.isArray(body.recent) ? body.recent.slice(0, cap) : []
  const recent: HangEntry[] = []
  for (const item of recentRaw) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const durationMs = numOrNull(row.durationMs ?? row.duration_ms)
    if (durationMs == null) continue
    recent.push({
      id: numOrNull(row.id),
      ts: numOrNull(row.ts),
      durationMs,
      kind: strOrNull(row.kind, 32),
      name: strOrNull(row.name, 96),
      detail: strOrNull(row.detail, 300),
    })
  }
  recent.sort((a, b) => (b.durationMs ?? -1) - (a.durationMs ?? -1))
  const hour = body.hour && typeof body.hour === "object" ? (body.hour as Record<string, unknown>) : null
  return {
    recent,
    count: hour ? numOrNull(hour.count) : null,
    maxMs: hour ? numOrNull(hour.maxMs ?? hour.m) : null,
    lastTs: hour ? numOrNull(hour.lastTs ?? hour.t) : null,
  }
}

/** Latest self-sample: p99 tails + disk/db bytes for the in-person view. */
export function parseSelfTail(value: unknown): SelfTail {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const body = value as Record<string, unknown>
  const samplesRaw = body.samples
  const samples = Array.isArray(samplesRaw) ? samplesRaw : Array.isArray((body as { selfHealth?: unknown }).selfHealth) ? [] : []
  const latest = samples.length > 0 && typeof samples[0] === "object" ? (samples[0] as Record<string, unknown>) : null
  if (!latest) return null
  const tail: Exclude<SelfTail, null> = {
    at: numOrNull(latest.ts),
    lagP99: numOrNull(latest.lag_p99),
    reqP99: numOrNull(latest.req_p99),
    qP99: numOrNull(latest.q_p99),
    tickP99: numOrNull(latest.tick_p99),
    boardP99: numOrNull(latest.board_p99),
    peers: numOrNull(latest.peers),
    diskUsed: numOrNull(latest.disk_used),
    diskSize: numOrNull(latest.disk_size),
    dbBytes: numOrNull(latest.db_bytes),
  }
  if (
    tail.at == null && tail.lagP99 == null && tail.reqP99 == null && tail.qP99 == null &&
    tail.tickP99 == null && tail.boardP99 == null && tail.diskUsed == null && tail.dbBytes == null
  ) {
    return null
  }
  return tail
}

function asMarketProcess(value: unknown): { process: MarketProcess; previous: MarketPrevious } {
  if (!value || typeof value !== "object") return { process: null, previous: null }
  const body = value as Record<string, unknown>
  const raw = (body.process ?? body) as Record<string, unknown>
  if (!raw || typeof raw !== "object") return { process: null, previous: null }
  const mem = raw.memory as Record<string, unknown> | undefined
  const counters = raw.counters as Record<string, unknown> | undefined
  const lastError = raw.lastError as Record<string, unknown> | null | undefined
  const proc: NonNullable<MarketProcess> = {
    bootId: typeof raw.bootId === "string" ? raw.bootId : null,
    bootAt: typeof raw.bootAt === "number" ? raw.bootAt : null,
    bootCount: typeof raw.bootCount === "number" ? raw.bootCount : null,
    uptimeMs: typeof raw.uptimeMs === "number" ? raw.uptimeMs : null,
    status: typeof raw.status === "string" ? raw.status : null,
    reason: typeof raw.reason === "string" ? raw.reason : null,
    lastError: lastError && typeof lastError === "object"
      ? {
          message: typeof lastError.message === "string" ? lastError.message : null,
          kind: typeof lastError.kind === "string" ? lastError.kind : null,
          at: typeof lastError.at === "number" ? lastError.at : null,
        }
      : null,
    lastSignal: typeof raw.lastSignal === "string" ? raw.lastSignal : null,
    eventLoopLagMs: typeof raw.eventLoopLagMs === "number" ? raw.eventLoopLagMs : null,
    diskUsed: typeof raw.diskUsed === "number" ? raw.diskUsed : null,
    diskSize: typeof raw.diskSize === "number" ? raw.diskSize : null,
    dbBytes: typeof raw.dbBytes === "number" ? raw.dbBytes : null,
    memory: mem && typeof mem === "object"
      ? {
          rss: typeof mem.rss === "number" ? mem.rss : null,
          heapUsed: typeof mem.heapUsed === "number" ? mem.heapUsed : null,
          heapTotal: typeof mem.heapTotal === "number" ? mem.heapTotal : null,
        }
      : null,
    counters: counters && typeof counters === "object"
      ? {
          uncaught: typeof counters.uncaught === "number" ? counters.uncaught : null,
          unhandled: typeof counters.unhandled === "number" ? counters.unhandled : null,
          requestErrors: typeof counters.requestErrors === "number" ? counters.requestErrors : null,
          tickErrors: typeof counters.tickErrors === "number" ? counters.tickErrors : null,
        }
      : null,
  }
  const prevRaw = (body.previous ?? raw.previous) as Record<string, unknown> | null | undefined
  const previous: MarketPrevious =
    prevRaw && typeof prevRaw === "object"
      ? {
          bootId: typeof prevRaw.bootId === "string" ? prevRaw.bootId : null,
          bootAt: typeof prevRaw.bootAt === "number" ? prevRaw.bootAt : null,
          endedAt: typeof prevRaw.endedAt === "number" ? prevRaw.endedAt : null,
          bootCount: typeof prevRaw.bootCount === "number" ? prevRaw.bootCount : null,
          clean: typeof prevRaw.clean === "boolean" ? prevRaw.clean : null,
          reason: typeof prevRaw.reason === "string" ? prevRaw.reason : null,
          signal: typeof prevRaw.signal === "string" ? prevRaw.signal : null,
        }
      : null
  return { process: proc.bootId || proc.reason || proc.lastError ? proc : proc, previous }
}

async function probeMarketProcess(base: string, env: HealthEnv): Promise<ProcessProbe> {
  const empty = (): ProcessProbe => ({ process: null, previous: null, reached: false, hangs: { recent: [], count: null, maxMs: null, lastTs: null }, routeTails: {}, queryTails: {}, selfTail: null })
  // Prefer the dedicated internal endpoint; fall back to /api/health on older markets.
  for (const path of ["/api/status", "/api/health"]) {
    try {
      const { res, text } = await timedFetch(`${base}${path}`, {}, Math.min(env.requestTimeoutMs, 5000))
      if (!res.ok) continue
      const body = parseJson(text)
      const { process, previous } = asMarketProcess(body)
      if (!process) continue
      const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
      return {
        process,
        previous,
        reached: true,
        hangs: parseHangs(obj.hangs),
        routeTails: parseTailMap(obj.routePctl ?? obj.routePctlAll),
        queryTails: parseTailMap(obj.queryPctl ?? obj.queryPctlAll),
        selfTail: parseSelfTail(obj.selfHealth),
      }
    } catch {
      // try the next path
    }
  }
  return empty()
}

export async function runProbe(env: HealthEnv, prevTracking: TrackerState = emptyTracker()): Promise<HealthReport> {
  const t0 = performance.now()
  const base = env.targetUrl
  const checks: CheckResult[] = []
  let cfg: Cfg | null = null
  let state: Record<string, unknown> | null = null
  let feeds: Record<string, unknown> | null = null
  // Container state resolves in parallel with the HTTP probes (cached ~3s).
  const dockerPromise = getDockerSnapshot(env).catch(
    (): DockerSnapshot => ({ available: false, sock: env.dockerSock || null, error: "docker snapshot threw", at: Date.now(), containers: [] }),
  )

  // 1. /api/config
  try {
    const { ms, res, text } = await timedFetch(`${base}/api/config`, {}, env.requestTimeoutMs)
    if (!res.ok) {
      checks.push({ id: "config", label: "GET /api/config", ok: false, ms, detail: `HTTP ${res.status}`, error: text.slice(0, 300) })
    } else {
      cfg = (parseJson(text) as Cfg) ?? null
      checks.push({
        id: "config",
        label: "GET /api/config",
        ok: true,
        ms,
        detail: `${cfg?.chainKey ?? "?"} · win ${cfg?.windowSeconds ?? "?"}s / mkt ${cfg?.marketSeconds ?? "?"}s · fee ${cfg?.feeBps ?? "?"}bps`,
      })
    }
  } catch (error) {
    checks.push({ id: "config", label: "GET /api/config", ok: false, ms: null, detail: "no response", error: String(error).slice(0, 300) })
  }

  // 2. /api/health
  try {
    const { ms, res, text } = await timedFetch(`${base}/api/health`, {}, env.requestTimeoutMs)
    const body = parseJson(text) as { ok?: boolean; treasury?: unknown } | null
    if (!res.ok || body?.ok !== true) {
      checks.push({ id: "health", label: "GET /api/health", ok: false, ms, detail: `HTTP ${res.status}`, error: text.slice(0, 300) })
    } else {
      checks.push({ id: "health", label: "GET /api/health", ok: true, ms, detail: "ok:true" })
    }
  } catch (error) {
    checks.push({ id: "health", label: "GET /api/health", ok: false, ms: null, detail: "no response", error: String(error).slice(0, 300) })
  }

  // 3. /api/state
  let serverNow: number | null = null
  let tapePoints: number | null = null
  let tapeAgeMs: number | null = null
  let clockSkewMs: number | null = null
  try {
    const { ms, res, text } = await timedFetch(`${base}/api/state`, {}, env.requestTimeoutMs)
    if (!res.ok) {
      checks.push({ id: "state", label: "GET /api/state", ok: false, ms, detail: `HTTP ${res.status}`, error: text.slice(0, 300) })
    } else {
      state = (parseJson(text) as Record<string, unknown>) ?? null
      serverNow = typeof state?.serverNow === "number" ? (state.serverNow as number) : null
      const tape = Array.isArray(state?.tape) ? (state.tape as { t?: number }[]) : []
      tapePoints = tape.length
      const lastT = tape.length > 0 ? tape[tape.length - 1]?.t : null
      if (serverNow != null && typeof lastT === "number") tapeAgeMs = serverNow - lastT
      if (serverNow != null) clockSkewMs = serverNow - Date.now()
      const board = state?.board as Record<string, unknown> | undefined
      const join = board?.join as { id?: number } | null | undefined
      checks.push({
        id: "state",
        label: "GET /api/state",
        ok: true,
        ms,
        detail: `feed ${String(state?.feed ?? "?")} · tape ${tapePoints}pts${tapeAgeMs != null ? ` · age ${formatAge(tapeAgeMs)}` : ""} · join ${join?.id ?? "—"}`,
      })
    }
  } catch (error) {
    checks.push({ id: "state", label: "GET /api/state", ok: false, ms: null, detail: "no response", error: String(error).slice(0, 300) })
  }

  // 4. /api/feeds
  let venues: VenueHealth[] = []
  try {
    const { ms, res, text } = await timedFetch(`${base}/api/feeds`, {}, env.requestTimeoutMs)
    if (!res.ok) {
      checks.push({ id: "feeds", label: "GET /api/feeds", ok: false, ms, detail: `HTTP ${res.status}`, error: text.slice(0, 300) })
    } else {
      feeds = (parseJson(text) as Record<string, unknown>) ?? null
      const at = typeof feeds?.at === "number" ? (feeds.at as number) : Date.now()
      const rows = Array.isArray(feeds?.venues) ? (feeds.venues as Record<string, unknown>[]) : []
      venues = rows.map((row) => {
        const venueAt = typeof row.at === "number" ? (row.at as number) : 0
        const ageMs = venueAt > 0 ? at - venueAt : null
        const up = row.up === true
        return {
          venue: String(row.venue ?? "?"),
          price: typeof row.price === "string" ? (row.price as string) : null,
          ageMs,
          up,
          role: typeof row.role === "string" ? (row.role as string) : null,
          reason: typeof row.reason === "string" ? (row.reason as string) : null,
          swing: typeof row.swing === "string" ? (row.swing as string) : null,
          gap: typeof row.gap === "string" ? (row.gap as string) : row.gap == null ? null : String(row.gap),
          feed: typeof row.feed === "string" ? (row.feed as string) : null,
          stale: venueIsStale(ageMs, up),
        }
      })
      const ready = venues.filter((v) => !v.stale).length
      checks.push({
        id: "feeds",
        label: "GET /api/feeds",
        ok: true,
        ms,
        detail: `active ${String(feeds?.active ?? "?")} · ${ready}/${venues.length} fresh · anchor ${typeof feeds?.anchor === "string" ? feeds.anchor : "—"}`,
      })
    }
  } catch (error) {
    checks.push({ id: "feeds", label: "GET /api/feeds", ok: false, ms: null, detail: "no response", error: String(error).slice(0, 300) })
  }

  // 5. /api/rounds
  try {
    const { ms, res, text } = await timedFetch(`${base}/api/rounds?limit=1`, {}, env.requestTimeoutMs)
    if (!res.ok) {
      checks.push({ id: "rounds", label: "GET /api/rounds", ok: false, ms, detail: `HTTP ${res.status}`, error: text.slice(0, 300) })
    } else {
      const body = parseJson(text) as { rounds?: unknown[] } | null
      checks.push({ id: "rounds", label: "GET /api/rounds", ok: true, ms, detail: `history readable (${body?.rounds?.length ?? 0} row)` })
    }
  } catch (error) {
    checks.push({ id: "rounds", label: "GET /api/rounds", ok: false, ms: null, detail: "no response", error: String(error).slice(0, 300) })
  }

  // 6. websocket
  let wsConnectMs: number | null = null
  let wsFirstMsgMs: number | null = null
  let wsRttMs: number | null = null
  try {
    const ws = await probeWs(env.wsTarget, Math.min(env.requestTimeoutMs, 8_000))
    wsConnectMs = ws.connectMs
    wsFirstMsgMs = ws.firstMsgMs
    wsRttMs = ws.rttMs
    checks.push({
      id: "ws",
      label: "WS /ws first round",
      ok: ws.ok,
      ms: ws.connectMs != null && ws.firstMsgMs != null ? ws.connectMs + ws.firstMsgMs : (ws.connectMs ?? null),
      detail: ws.detail,
      ...(ws.error ? { error: ws.error } : {}),
    })
  } catch (error) {
    checks.push({ id: "ws", label: "WS /ws first round", ok: false, ms: null, detail: "probe threw", error: String(error).slice(0, 300) })
  }

  // 7. chain RPC (uses chainKey from config)
  checks.push(await probeRpc(cfg?.chainKey ?? null, env))

  // 8. market process vitals (internal crash-reason endpoint; never affects status)
  const proc = await probeMarketProcess(base, env)

  // Summary fields from state/feeds
  const board = (state?.board as Record<string, unknown> | undefined) ?? null
  const ticker = (state?.ticker as Record<string, unknown> | undefined) ?? null
  const join = (board?.join as { id?: number; poolUpMicros?: number; poolDownMicros?: number } | null | undefined) ?? null
  const live = (board?.live as { id?: number } | null | undefined) ?? null
  const handoff = (state?.handoff as { from?: string; to?: string | null } | null | undefined) ?? (feeds?.handoff as { from?: string; to?: string | null } | null | undefined) ?? null
  const windowEndsAt = typeof board?.windowEndsAt === "number" ? (board.windowEndsAt as number) : null
  const switches = Array.isArray(feeds?.switches)
    ? (feeds.switches as { at?: number; from?: string; to?: string | null; reason?: string }[]).map((s) => ({
        at: typeof s.at === "number" ? s.at : 0,
        from: String(s.from ?? "?"),
        to: s.to == null ? null : String(s.to),
        reason: String(s.reason ?? ""),
      }))
    : []

  const status = classifyOverall(checks)
  const processReason = proc.process?.reason ?? null
  let downReason = status === "ok" ? processReason : summarizeDownReason(checks, processReason)
  // Surface a container-level hint when the market never answered.
  if (status === "down" && (!proc.process || !proc.reached)) {
    const firstErr = checks.find((c) => !c.ok && c.error)?.error ?? ""
    const hint = firstErr ? containerHintFor(firstErr) : null
    if (hint && downReason && !downReason.includes(hint)) downReason = `${downReason} · ${hint}`
    else if (hint && !downReason) downReason = hint
  }
  const partial: Pick<HealthReport, "at" | "status" | "downReason" | "process" | "previous"> = {
    at: Date.now(),
    status,
    downReason,
    process: proc.process,
    previous: proc.previous,
  }
  const tracking = updateTracker(prevTracking, partial)
  const docker = await dockerPromise
  const primaryName = env.dockerContainers[0] ?? "quick-market"
  const { lifecycle, reason: lifecycleReason } = deriveLifecycle({
    status,
    checks,
    snapshot: docker,
    primaryName,
    everOk: prevTracking.lastOkAt != null,
    now: partial.at,
  })
  const report: HealthReport = {
    at: partial.at,
    target: base,
    status,
    lifecycle,
    lifecycleReason,
    containers: docker.containers,
    totalMs: performance.now() - t0,
    checks,
    downReason,
    process: proc.process,
    previous: proc.previous,
    tracking,
    hangs: proc.hangs,
    routeTails: proc.routeTails,
    queryTails: proc.queryTails,
    selfTail: proc.selfTail,
    summary: {
      chainKey: cfg?.chainKey ?? null,
      chainName: cfg?.chainName ?? null,
      chainId: typeof cfg?.chainId === "number" ? cfg.chainId : null,
      feed: typeof state?.feed === "string" ? (state.feed as string) : null,
      tickerPrice: typeof ticker?.price === "string" ? (ticker.price as string) : null,
      tickerVenue: typeof ticker?.venue === "string" ? (ticker.venue as string) : null,
      serverNow,
      clockSkewMs,
      tapePoints,
      tapeAgeMs,
      joinId: typeof join?.id === "number" ? join.id : null,
      liveId: typeof live?.id === "number" ? live.id : null,
      windowCloseInMs: serverNow != null && windowEndsAt != null ? windowEndsAt - serverNow : null,
      poolUpMicros: typeof join?.poolUpMicros === "number" ? join.poolUpMicros : null,
      poolDownMicros: typeof join?.poolDownMicros === "number" ? join.poolDownMicros : null,
      handoff: handoff ? `${handoff.from ?? "?"} → ${handoff.to ?? "waiting"}` : null,
      switches,
      wsConnectMs,
      wsFirstMsgMs,
      wsRttMs,
    },
    venues,
  }
  return report
}
