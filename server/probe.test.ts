import { describe, expect, test } from "bun:test"
import { loadHealthEnv, wsFromHttp } from "./env"
import { avgMs, pushHistory, uptimePct } from "./history"
import { classifyOverall, formatAge, formatMs, venueIsStale } from "./probe"

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
})
