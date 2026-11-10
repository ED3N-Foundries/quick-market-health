import { loadHealthEnv } from "../server/env"
import { runProbe } from "../server/probe"

const env = loadHealthEnv()
const report = await runProbe(env)
console.log(`target=${report.target} status=${report.status} total=${report.totalMs.toFixed(1)}ms`)
for (const c of report.checks) {
  console.log(`- ${c.ok ? "ok  " : "FAIL"} ${c.label} ${c.ms == null ? "—" : `${c.ms.toFixed(1)}ms`} :: ${c.detail}${c.error ? ` [${c.error}]` : ""}`)
}
console.log(`venues: ${report.venues.map((v) => `${v.venue}:${v.price ?? "—"}:${v.stale ? "stale" : "fresh"}`).join(" ")}`)
if (report.status === "down") process.exitCode = 2
