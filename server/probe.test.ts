import { describe, expect, test } from "bun:test"
import { internalFrom, loadHealthEnv, wsFromHttp } from "./env"
import { avgMs, pushHistory, uptimePct } from "./history"
import { classifyOverall, containerHintFor, emptyTracker, formatAge, formatMs, isLiveSocketMessage, parseFunding, parseHangs, parseSelfTail, parseTailMap, summarizeDownReason, updateTracker, venueIsStale } from "./probe"

describe("wsFromHttp", () => {
  test("maps http/https to ws/wss + /ws", () => {
    expect(wsFromHttp("http://127.0.0.1:3001")).toBe("ws://127.0.0.1:3001/ws")
    expect(wsFromHttp("https://qm.example.com/")).toBe("wss://qm.example.com/ws")
    expect(wsFromHttp("http://quick-market:3001/")).toBe("ws://quick-market:3001/ws")
  })
})

describe("isLiveSocketMessage", () => {
  test("accepts the current snapshot and the older round message", () => {
    expect(isLiveSocketMessage("snapshot")).toBe(true)
    expect(isLiveSocketMessage("round")).toBe(true)
    expect(isLiveSocketMessage("tick")).toBe(false)
    expect(isLiveSocketMessage(null)).toBe(false)
  })
})

describe("parseFunding", () => {
  test("keeps public funding fields and drops a body that is not a chain list", () => {
    expect(parseFunding({ ok: true })).toBeNull()
    const parsed = parseFunding({
      at: 5,
      chains: [{
        chainKey: "base-sepolia",
        chainName: "Base Sepolia",
        chainId: 84532,
        treasury: "0x826020c36F4e1b6320e5E3dCade1a888E9fbDeF6",
        token: "0xabc",
        tokenLabel: "QM USDC",
        native: { symbol: "ETH", have: "0", need: "0.00005", short: true },
        tokenBalance: { symbol: "QM USDC", have: "1", need: "7", short: true },
        explorer: "https://sepolia.basescan.org/address/0x826020c36F4e1b6320e5E3dCade1a888E9fbDeF6",
        lines: [],
        shortAgents: [],
        error: null,
        privateKey: "nope",
      }],
    })
    expect(parsed?.chains[0]?.treasury).toBe("0x826020c36F4e1b6320e5E3dCade1a888E9fbDeF6")
    expect(parsed?.chains[0]?.native.short).toBe(true)
    expect(JSON.stringify(parsed)).not.toContain("privateKey")
  })
})

describe("loadHealthEnv", () => {
  test("defaults and trims", () => {
    const env = loadHealthEnv({})
    expect(env.port).toBe(3101)
    expect(env.targetUrl).toBe("http://127.0.0.1:3001")
    expect(env.internalUrl).toBe("http://127.0.0.1:3002")
    expect(internalFrom("http://quick-market:3001")).toBe("http://quick-market:3002")
    expect(loadHealthEnv({ INTERNAL_URL: "http://quick-market:3002/" }).internalUrl).toBe("http://quick-market:3002")
    expect(env.wsTarget).toBe("ws://127.0.0.1:3001/ws")
    expect(loadHealthEnv({ TARGET_URL: "http://quick-market:3001/" }).wsTarget).toBe("ws://quick-market:3001/ws")
    expect(loadHealthEnv({ WS_TARGET: "ws://custom/ws" }).wsTarget).toBe("ws://custom/ws")
  })
  test("docker opts default to disabled socket with watched containers", () => {
    const env = loadHealthEnv({})
    expect(env.dockerSock).toBe("")
    expect(env.dockerContainers).toEqual(["quick-market", "quick-market-agent"])
    expect(env.dockerLogsTail).toBe(200)
    const custom = loadHealthEnv({ DOCKER_SOCK: "/var/run/docker.sock", DOCKER_CONTAINERS: "a,b , c", DOCKER_LOGS_TAIL: "50" })
    expect(custom.dockerSock).toBe("/var/run/docker.sock")
    expect(custom.dockerContainers).toEqual(["a", "b", "c"])
    expect(custom.dockerLogsTail).toBe(50)
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

describe("hang forensics parsing", () => {
  test("tails sort worst-first and cap keys", () => {
    const tails = parseTailMap({
      fast: { count: 100, avgMs: 2, maxMs: 5, p50: 2, p90: 3, p95: 4, p99: 5 },
      slow: { count: 10, avgMs: 50, maxMs: 1500, p50: 4, p90: 100, p95: 800, p99: 1200 },
      empty: { count: 0, avgMs: 0, maxMs: 0, p50: 0, p90: 0, p95: 0, p99: 0 },
    })
    expect(Object.keys(tails)).toEqual(["slow", "fast"])
    expect(tails.slow?.p99).toBe(1200)
    expect(parseTailMap(null)).toEqual({})
    expect(parseTailMap({ bad: "nope" })).toEqual({})
  })
  test("hangs parse snake_case, sort worst-first, tolerate junk", () => {
    const hz = parseHangs({
      recent: [
        { id: 1, ts: 1000, duration_ms: 300, kind: "lag", name: "event-loop", detail: "slow-query:advance 150ms" },
        { id: 2, ts: 2000, durationMs: 1500, kind: "slow-query", name: "advance", detail: null },
        { junk: true },
      ],
      hour: { count: 2, maxMs: 1500, lastTs: 2000 },
    })
    expect(hz.recent.length).toBe(2)
    expect(hz.recent[0]?.durationMs).toBe(1500)
    expect(hz.count).toBe(2)
    expect(parseHangs(null).recent).toEqual([])
    expect(parseHangs({ recent: "no" }).recent).toEqual([])
  })
  test("self tail lifts p99s and disk bytes with MB-ready numbers", () => {
    const tail = parseSelfTail({
      samples: [{ ts: 123, lag_p99: 260, req_p99: 40, q_p99: 120, tick_p99: 8, board_p99: 12, peers: 3, disk_used: 10485760, disk_size: 104857600, db_bytes: 5242880 }],
    })
    expect(tail?.lagP99).toBe(260)
    expect(tail?.diskUsed).toBe(10485760)
    expect(tail?.dbBytes).toBe(5242880)
    expect(parseSelfTail({})).toBeNull()
    expect(parseSelfTail(null)).toBeNull()
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
