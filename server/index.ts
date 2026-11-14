import { loadHealthEnv } from "./env"
import { agentAvg, avgMs, pushHistory, uptimePct, withAgentAverages, type HistorySample } from "./history"
import { renderPage } from "./page"
import { emptyTracker, fetchAgentRoster, runProbe, type HealthReport, type TrackerState } from "./probe"
import { clampTail, fetchContainerLogs, getDockerSnapshot } from "./docker"

const env = loadHealthEnv()

let latest: HealthReport | null = null
let history: HistorySample[] = []
let tracking: TrackerState = emptyTracker()
let probing = false

// Collapses concurrent 5s UI polls into one upstream fetch. Never blocks the market probe.
const rosterCache = new Map<string, { at: number; body: unknown }>()
const ROSTER_CACHE_MS = 4_500
const ROSTER_CHAINS = new Set(["base-sepolia", "near-testnet"])
const ROSTER_FILTERS = new Set(["all", "woke", "richest", "stuck", "slept"])
const ROSTER_SORTS = new Set(["bankroll", "wins", "updated", "idx", "woke", "slept"])

function rosterQuery(url: URL): string {
  const chain = url.searchParams.get("chain")?.trim() ?? ""
  const filter = url.searchParams.get("filter")?.trim() ?? ""
  const sort = url.searchParams.get("sort")?.trim() ?? ""
  const dir = url.searchParams.get("dir")?.trim().toLowerCase() ?? ""
  const offset = url.searchParams.get("offset")?.trim() ?? ""
  const limit = url.searchParams.get("limit")?.trim() ?? ""
  const out = new URLSearchParams()
  out.set("chain", ROSTER_CHAINS.has(chain) ? chain : "near-testnet")
  out.set("filter", ROSTER_FILTERS.has(filter) ? filter : "all")
  out.set("sort", ROSTER_SORTS.has(sort) ? sort : "bankroll")
  out.set("dir", dir === "asc" ? "asc" : "desc")
  const off = Number(offset)
  out.set("offset", Number.isFinite(off) ? String(Math.min(Math.max(0, Math.floor(off)), 10_000)) : "0")
  const lim = Number(limit)
  out.set("limit", Number.isFinite(lim) ? String(Math.min(Math.max(1, Math.floor(lim)), 50)) : "25")
  return `?${out.toString()}`
}

async function probeOnce(reason: string): Promise<HealthReport> {
  if (probing && latest) return latest
  probing = true
  try {
    const report = await runProbe(env, tracking)
    tracking = report.tracking
    latest = report
    history = pushHistory(history, report, env.historyN)
    return report
  } finally {
    probing = false
  }
}

void probeOnce("boot").catch((error) => console.error("initial probe failed:", error))
setInterval(() => {
  void probeOnce("interval").catch((error) => console.error("interval probe failed:", error))
}, env.checkIntervalMs)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  })
}

const server = Bun.serve({
  port: env.port,
  hostname: "0.0.0.0",
  // A full probe run can take ~60s when the market is hung (each piece times
  // out at REQUEST_TIMEOUT_MS). Keep the socket open past Bun's 10s default.
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url)
    if (req.method === "GET" && url.pathname === "/") {
      return new Response(renderPage(env), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } })
    }
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json({ ok: true, service: "quick-market-health", target: env.targetUrl, at: Date.now() })
    }
    if (req.method === "GET" && url.pathname === "/api/check") {
      try {
        const report = url.searchParams.get("fresh") === "0" && latest ? latest : await probeOnce("ondemand")
        return json(withAgentAverages(report, history))
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 502)
      }
    }
    if (req.method === "GET" && url.pathname === "/api/history") {
      return json({
        target: env.targetUrl,
        samples: history,
        uptimePct: uptimePct(history),
        avgMs: Object.fromEntries(["config", "health", "state", "feeds", "rounds", "ws", "rpc"].map((id) => [id, avgMs(history, id)])),
        agentAvg: agentAvg(history),
      })
    }
    if (req.method === "GET" && url.pathname === "/api/containers") {
      try {
        const snapshot = url.searchParams.get("fresh") === "0" ? await getDockerSnapshot(env) : await getDockerSnapshot(env, true)
        return json(snapshot)
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 502)
      }
    }
    if (req.method === "GET" && url.pathname === "/api/logs") {
      try {
        const container = url.searchParams.get("container")?.trim() || env.dockerContainers[0] || "quick-market"
        const tail = clampTail(url.searchParams.get("tail"), env.dockerLogsTail)
        return json(await fetchContainerLogs(env, container, tail))
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 502)
      }
    }
    if (req.method === "GET" && url.pathname === "/api/agents/roster") {
      try {
        const query = rosterQuery(url)
        const cached = rosterCache.get(query)
        if (cached && Date.now() - cached.at < ROSTER_CACHE_MS) return json(cached.body)
        const body = await fetchAgentRoster(env, query)
        rosterCache.set(query, { at: Date.now(), body })
        if (rosterCache.size > 40) {
          const oldest = [...rosterCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
          if (oldest) rosterCache.delete(oldest[0])
        }
        return json(body)
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 502)
      }
    }
    return json({ error: "Not found" }, 404)
  },
})

console.log(`quick-market-health on http://127.0.0.1:${server.port} → ${env.targetUrl}`)
