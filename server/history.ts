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
