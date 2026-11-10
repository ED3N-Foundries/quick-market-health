import { loadHealthEnv } from "./env"
import { avgMs, pushHistory, uptimePct, type HistorySample } from "./history"
import { renderPage } from "./page"
import { runProbe, type HealthReport } from "./probe"

const env = loadHealthEnv()

let latest: HealthReport | null = null
let history: HistorySample[] = []
let probing = false

async function probeOnce(reason: string): Promise<HealthReport> {
  if (probing && latest) return latest
  probing = true
  try {
    const report = await runProbe(env)
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
        return json(report)
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
      })
    }
    return json({ error: "Not found" }, 404)
  },
})

console.log(`quick-market-health on http://127.0.0.1:${server.port} → ${env.targetUrl}`)
