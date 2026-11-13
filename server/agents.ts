/** A running snapshot older than this is stale: the listener is up and the tick is stuck. */
export const AGENT_STALE_MS = 15_000

export type AgentAverages = {
  online: number | null
  bookLagMs: number | null
  p50: number | null
  p90: number | null
}

export type AgentBook = {
  roundId: number | null
  upMicros: number
  downMicros: number
  botUpMicros: number
  botDownMicros: number
  buyIns: number
  skips: number
  p50: number
  p90: number
}

export type AgentMoney = {
  seedMicros: number
  mintMicros: number
  burnMicros: number
  stakeMicros: number
  histogram: { band: string; count: number }[]
}

export type AgentBoot = {
  ok: true
  running: false
  at: null
  ageMs: null
  stale: false
}

export type AgentLive = {
  ok: true
  running: boolean
  at: number
  ageMs: number
  stale: boolean
  manila: string
  phase: string
  hour: number
  window: [number, number]
  online: number
  enrolled: number | null
  pid: number | null
  spring: number
  target: number
  arrivedMinute: number
  leftMinute: number
  trace: number[]
  book: AgentBook
  money: AgentMoney
  lastError: string | null
  bookLagMs: number | null
  buyInPaused: boolean
  bleed: boolean
  mode: string
  pin: number | null
  apiHost: string | null
  apiIp: string | null
  onlineAvg: number | null
  skipRate: number | null
  averages?: AgentAverages
}

export type AgentFailure = { ok: false; error: string }

export type AgentStats = AgentBoot | AgentLive | AgentFailure

/** Keep the public swarm fields. Anything else, including keys and addresses, is dropped. */
export function parseAgentStats(body: unknown, now = Date.now()): AgentBoot | AgentLive | null {
  if (!body || typeof body !== "object") return null
  const row = body as Record<string, unknown>
  if (row.ok !== true) return null
  if (typeof row.at !== "number" || !Number.isFinite(row.at)) {
    if (row.running === false && row.at == null) return { ok: true, running: false, at: null, ageMs: null, stale: false }
    return null
  }
  const book = parseBook(row.book)
  const money = parseMoney(row.money)
  if (!book || !money) return null
  const trace = parseTrace(row.trace)
  const ageMs = Math.max(0, now - row.at)
  const running = row.running === true
  const buyIns = book.buyIns
  const skips = book.skips
  const decided = buyIns + skips
  return {
    ok: true,
    running,
    at: row.at,
    ageMs,
    stale: running && ageMs > AGENT_STALE_MS,
    manila: text(row.manila, 32) ?? "",
    phase: text(row.phase, 32) ?? "",
    hour: num(row.hour),
    window: parseWindow(row.window),
    online: num(row.online),
    enrolled: numOrNull(row.enrolled),
    pid: numOrNull(row.pid),
    spring: num(row.spring),
    target: num(row.target),
    arrivedMinute: num(row.arrivedMinute),
    leftMinute: num(row.leftMinute),
    trace,
    book,
    money,
    lastError: text(row.lastError, 300),
    bookLagMs: numOrNull(row.bookLagMs),
    buyInPaused: row.buyInPaused === true,
    bleed: row.bleed !== false,
    mode: text(row.mode, 32) ?? "clock",
    pin: numOrNull(row.pin),
    apiHost: text(row.apiHost, 200),
    apiIp: text(row.apiIp, 200),
    onlineAvg: trace.length === 0 ? null : trace.reduce((sum, value) => sum + value, 0) / trace.length,
    skipRate: decided > 0 ? skips / decided : null,
  }
}

function parseBook(value: unknown): AgentBook | null {
  if (!value || typeof value !== "object") return null
  const row = value as Record<string, unknown>
  return {
    roundId: numOrNull(row.roundId),
    upMicros: num(row.upMicros),
    downMicros: num(row.downMicros),
    botUpMicros: num(row.botUpMicros),
    botDownMicros: num(row.botDownMicros),
    buyIns: num(row.buyIns),
    skips: num(row.skips),
    p50: num(row.p50),
    p90: num(row.p90),
  }
}

function parseMoney(value: unknown): AgentMoney | null {
  if (!value || typeof value !== "object") return null
  const row = value as Record<string, unknown>
  const histogram = Array.isArray(row.histogram)
    ? row.histogram.slice(0, 8).flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const band = text((item as Record<string, unknown>).band, 32)
        const count = (item as Record<string, unknown>).count
        if (!band || typeof count !== "number" || !Number.isFinite(count)) return []
        return [{ band, count }]
      })
    : []
  return {
    seedMicros: num(row.seedMicros),
    mintMicros: num(row.mintMicros),
    burnMicros: num(row.burnMicros),
    stakeMicros: num(row.stakeMicros),
    histogram,
  }
}

function parseWindow(value: unknown): [number, number] {
  if (!Array.isArray(value)) return [0, 0]
  return [num(value[0]), num(value[1])]
}

function parseTrace(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)).slice(-180)
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}
