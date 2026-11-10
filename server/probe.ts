import type { HealthEnv } from "./env"

export type CheckStatus = "ok" | "degraded" | "down"

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

export type HealthReport = {
  at: number
  target: string
  status: CheckStatus
  /** Wall-clock ms for the whole probe run. */
  totalMs: number
  checks: CheckResult[]
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

export async function runProbe(env: HealthEnv): Promise<HealthReport> {
  const t0 = performance.now()
  const base = env.targetUrl
  const checks: CheckResult[] = []
  let cfg: Cfg | null = null
  let state: Record<string, unknown> | null = null
  let feeds: Record<string, unknown> | null = null

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

  const report: HealthReport = {
    at: Date.now(),
    target: base,
    status: classifyOverall(checks),
    totalMs: performance.now() - t0,
    checks,
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
