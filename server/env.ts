export type HealthEnv = {
  port: number
  targetUrl: string
  /** Market admin port. Process vitals and the funding view. Not published. */
  internalUrl: string
  wsTarget: string
  rpcUrl: string
  checkIntervalMs: number
  historyN: number
  refreshMs: number
  requestTimeoutMs: number
  /** Agent stats origin. Empty skips the probe. Not published on the host. */
  agentUrl: string
  /** Unix socket path for the Docker Engine API. Empty = docker status/logs disabled. */
  dockerSock: string
  /** Container names watched for lifecycle state + log tails. First entry is the primary (the market). */
  dockerContainers: string[]
  dockerTimeoutMs: number
  dockerLogsTail: number
}

function num(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === "") return fallback
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function str(value: string | undefined, fallback: string): string {
  const t = value?.trim()
  return t ? t : fallback
}

export function internalFrom(target: string): string {
  if (/:\d+$/.test(target)) return target.replace(/:\d+$/, ":3002")
  return `${target}:3002`
}

export function wsFromHttp(base: string): string {
  const clean = base.replace(/\/+$/, "")
  if (clean.startsWith("https://")) return `wss://${clean.slice("https://".length)}/ws`
  if (clean.startsWith("http://")) return `ws://${clean.slice("http://".length)}/ws`
  return `${clean}/ws`
}

function agentUrlFrom(value: string | undefined): string {
  if (value == null) return "http://127.0.0.1:3011"
  return value.trim().replace(/\/+$/, "")
}

function list(value: string | undefined, fallback: string[]): string[] {
  if (value == null || value.trim() === "") return fallback
  const items = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return items.length > 0 ? items : fallback
}

export function loadHealthEnv(env: Record<string, string | undefined> = process.env): HealthEnv {
  const targetUrl = str(env.TARGET_URL, "http://127.0.0.1:3001").replace(/\/+$/, "")
  return {
    port: num(env.PORT, 3101),
    targetUrl,
    internalUrl: (str(env.INTERNAL_URL, "") || internalFrom(targetUrl)).replace(/\/+$/, ""),
    wsTarget: str(env.WS_TARGET, "") || wsFromHttp(targetUrl),
    rpcUrl: str(env.RPC_URL, ""),
    checkIntervalMs: num(env.CHECK_INTERVAL_MS, 10_000),
    historyN: Math.min(Math.max(Math.floor(num(env.HISTORY_N, 180)), 10), 1000),
    refreshMs: num(env.REFRESH_MS, 5_000),
    requestTimeoutMs: num(env.REQUEST_TIMEOUT_MS, 8_000),
    agentUrl: agentUrlFrom(env.AGENT_URL),
    dockerSock: str(env.DOCKER_SOCK, ""),
    dockerContainers: list(env.DOCKER_CONTAINERS, ["quick-market", "quick-market-agent"]),
    dockerTimeoutMs: num(env.DOCKER_TIMEOUT_MS, 2_500),
    dockerLogsTail: Math.min(2000, Math.max(10, Math.floor(num(env.DOCKER_LOGS_TAIL, 200)))),
  }
}
