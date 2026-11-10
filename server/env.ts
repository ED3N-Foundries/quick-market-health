export type HealthEnv = {
  port: number
  targetUrl: string
  wsTarget: string
  rpcUrl: string
  checkIntervalMs: number
  historyN: number
  refreshMs: number
  requestTimeoutMs: number
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

export function wsFromHttp(base: string): string {
  const clean = base.replace(/\/+$/, "")
  if (clean.startsWith("https://")) return `wss://${clean.slice("https://".length)}/ws`
  if (clean.startsWith("http://")) return `ws://${clean.slice("http://".length)}/ws`
  return `${clean}/ws`
}

export function loadHealthEnv(env: Record<string, string | undefined> = process.env): HealthEnv {
  const targetUrl = str(env.TARGET_URL, "http://127.0.0.1:3001").replace(/\/+$/, "")
  return {
    port: num(env.PORT, 3101),
    targetUrl,
    wsTarget: str(env.WS_TARGET, "") || wsFromHttp(targetUrl),
    rpcUrl: str(env.RPC_URL, ""),
    checkIntervalMs: num(env.CHECK_INTERVAL_MS, 10_000),
    historyN: Math.min(Math.max(Math.floor(num(env.HISTORY_N, 180)), 10), 1000),
    refreshMs: num(env.REFRESH_MS, 5_000),
    requestTimeoutMs: num(env.REQUEST_TIMEOUT_MS, 8_000),
  }
}
