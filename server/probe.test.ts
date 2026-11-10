import { describe, expect, test } from "bun:test"
import { loadHealthEnv, wsFromHttp } from "./env"
import { avgMs, pushHistory, uptimePct } from "./history"
import { classifyOverall, containerHintFor, emptyTracker, formatAge, formatMs, summarizeDownReason, updateTracker, venueIsStale } from "./probe"

describe("wsFromHttp", () => {
  test("maps http/https to ws/wss + /ws", () => {
    expect(wsFromHttp("http://127.0.0.1:3001")).toBe("ws://127.0.0.1:3001/ws")
    expect(wsFromHttp("https://qm.example.com/")).toBe("wss://qm.example.com/ws")
    expect(wsFromHttp("http://quick-market:3001/")).toBe("ws://quick-market:3001/ws")
  })
})

describe("loadHealthEnv", () => {
  test("defaults and trims", () => {
    const env = loadHealthEnv({})
    expect(env.port).toBe(3101)
    expect(env.targetUrl).toBe("http://127.0.0.1:3001")
    expect(env.wsTarget).toBe("ws://127.0.0.1:3001/ws")
    expect(loadHealthEnv({ TARGET_URL: "http://quick-market:3001/" }).wsTarget).toBe("ws://quick-market:3001/ws")
    expect(loadHealthEnv({ WS_TARGET: "ws://custom/ws" }).wsTarget).toBe("ws://custom/ws")
  })
})

describe("classifyOverall", () => {
  test("down when a critical piece fails", () => {
    expect(classifyOverall([{ id: "config", ok: true }, { id: "state", ok: false }, { id: "ws", ok: true }])).toBe("down")
    expect(classifyOverall([{ id: "config", ok: true }, { id: "state", ok: true }, { id: "ws", ok: false }])).toBe("down")
  })
  test("degraded when only non-critical fails", () => {
    expect(
      classifyOverall([
        { id: "config", ok: true },
        { id: "state", ok: true },
        { id: "ws", ok: true },
        { id: "rpc", ok: false },
      ]),
    ).toBe("degraded")
  })
  test("ok when all pass", () => {
    expect(
      classifyOverall([
        { id: "config", ok: true },
        { id: "state", ok: true },
        { id: "ws", ok: true },
      ]),
    ).toBe("ok")
  })
})

describe("venues", () => {
  test("stale rules: down, missing or older than 5s", () => {
    expect(venueIsStale(100, true)).toBe(false)
    expect(venueIsStale(6_000, true)).toBe(true)
    expect(venueIsStale(null, true)).toBe(true)
    expect(venueIsStale(100, false)).toBe(true)
  })
})

describe("formatting", () => {
  test("ms and age never throw", () => {
    expect(formatMs(null)).toBe("—")
    expect(formatMs(4.567)).toContain("ms")
    expect(formatAge(1_500)).toBe("1.5s")
    expect(formatAge(90_000)).toBe("1.5m")
  })
})

describe("history", () => {
  test("caps length and computes uptime", () => {
    let list = pushHistory([], { at: 1, status: "ok", totalMs: 10, checks: [] } as never, 2)
    list = pushHistory(list, { at: 2, status: "down", totalMs: 20, checks: [] } as never, 2)
    list = pushHistory(list, { at: 3, status: "ok", totalMs: 30, checks: [] } as never, 2)
    expect(list.length).toBe(2)
    expect(uptimePct(list)).toBe(50)
    expect(avgMs(list, "config")).toBeNull()
  })
  test("stores down reason and boot id", () => {
    const list = pushHistory(
      [],
      { at: 1, status: "down", totalMs: 10, checks: [], downReason: "GET /api/state: no response", process: { bootId: "abc" } } as never,
      10,
    )
    expect(list[0]?.downReason).toContain("/api/state")
    expect(list[0]?.bootId).toBe("abc")
  })
})

describe("down reasons", () => {
  test("prefers the failing critical check", () => {
    const reason = summarizeDownReason(
      [
        { id: "config", ok: true, label: "GET /api/config", detail: "ok", error: undefined },
        { id: "state", ok: false, label: "GET /api/state", detail: "no response", error: "fetch failed" },
        { id: "rpc", ok: false, label: "chain RPC", detail: "request failed", error: "timeout" },
      ],
      null,
    )
    expect(reason).toContain("GET /api/state")
  })
  test("returns market reason when checks pass", () => {
    expect(summarizeDownReason([{ id: "config", ok: true, label: "x", detail: "ok" }], "tick failed: boom")).toBe("tick failed: boom")
  })
  test("container hints for refused and hung connects", () => {
    expect(containerHintFor("fetch failed: connection refused")).toContain("restarting")
    expect(containerHintFor("timeout after 8000ms")).toContain("hung")
    expect(containerHintFor("HTTP 500")).toBeNull()
  })
})

describe("tracking", () => {
  test("counts restarts on boot id change and tracks outage windows", () => {
    let t = emptyTracker()
    t = updateTracker(t, { at: 1000, status: "ok", downReason: null, process: { bootId: "a" }, previous: null } as never)
    expect(t.lastBootId).toBe("a")
    expect(t.lastOkAt).toBe(1000)
    t = updateTracker(t, { at: 2000, status: "down", downReason: "no response", process: null, previous: null } as never)
    expect(t.consecutiveDown).toBe(1)
    expect(t.downSince).toBe(2000)
    t = updateTracker(
      t,
      { at: 3000, status: "ok", downReason: null, process: { bootId: "b" }, previous: { reason: "unclean shutdown" } } as never,
    )
    expect(t.restartCount).toBe(1)
    expect(t.lastRestartReason).toContain("unclean")
    expect(t.consecutiveDown).toBe(0)
  })
})
