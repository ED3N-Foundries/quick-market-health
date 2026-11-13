import type { AgentAverages } from "./agents"
import type { HealthReport } from "./probe"

export type HistorySample = {
  at: number
  status: HealthReport["status"]
  lifecycle: HealthReport["lifecycle"]
  totalMs: number
  checks: { id: string; ok: boolean; ms: number | null }[]
  downReason: string | null
  bootId: string | null
  hangCount: number | null
  /** Latest agent point. Null when that probe had no live snapshot. */
  agent: AgentAverages | null
}

export function pushHistory(list: HistorySample[], report: HealthReport, cap: number): HistorySample[] {
  const next: HistorySample = {
    at: report.at,
    status: report.status,
    lifecycle: report.lifecycle,
    totalMs: report.totalMs,
    checks: report.checks.map((c) => ({ id: c.id, ok: c.ok, ms: c.ms })),
    downReason: report.downReason ?? null,
    bootId: report.process?.bootId ?? null,
    hangCount: report.hangs?.count ?? null,
    agent: agentPoint(report),
  }
  const out = [...list, next]
  while (out.length > cap) out.shift()
  return out
}

export function uptimePct(list: HistorySample[]): number | null {
  if (list.length === 0) return null
  const ok = list.filter((s) => s.status === "ok").length
  return (ok / list.length) * 100
}

export function avgMs(list: HistorySample[], id: string): number | null {
  const vals = list.map((s) => s.checks.find((c) => c.id === id)?.ms).filter((v): v is number => typeof v === "number")
  if (vals.length === 0) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

/** Mean of the stored agent points. Null fields and missed probes are left out. */
export function agentAvg(list: { agent?: AgentAverages | null }[]): AgentAverages {
  const mean = (pick: (point: AgentAverages) => number | null): number | null => {
    const values: number[] = []
    for (const sample of list) {
      const point = sample.agent
      if (!point) continue
      const value = pick(point)
      if (typeof value === "number" && Number.isFinite(value)) values.push(value)
    }
    if (values.length === 0) return null
    return values.reduce((sum, value) => sum + value, 0) / values.length
  }
  return {
    online: mean((point) => point.online),
    bookLagMs: mean((point) => point.bookLagMs),
    p50: mean((point) => point.p50),
    p90: mean((point) => point.p90),
  }
}

/** Attach the history rollup to a live agent snapshot. A miss stays a miss. */
export function withAgentAverages(report: HealthReport, samples: HistorySample[]): HealthReport {
  const agents = report.agents
  if (!agents || agents.ok !== true || agents.at == null) return report
  return { ...report, agents: { ...agents, averages: agentAvg(samples) } }
}

function agentPoint(report: HealthReport): AgentAverages | null {
  const agents = report.agents
  if (!agents || agents.ok !== true || agents.at == null) return null
  return {
    online: finiteOrNull(agents.online),
    bookLagMs: finiteOrNull(agents.bookLagMs),
    p50: finiteOrNull(agents.book.p50),
    p90: finiteOrNull(agents.book.p90),
  }
}

function finiteOrNull(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
