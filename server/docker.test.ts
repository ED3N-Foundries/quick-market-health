import { describe, expect, test } from "bun:test"
import { clampTail, demuxDockerLogs, type ContainerSummary, type DockerSnapshot } from "./docker"
import { deriveLifecycle, type CheckStatus } from "./probe"

function container(over: Partial<ContainerSummary> = {}): ContainerSummary {
  return {
    name: "quick-market",
    exists: true,
    running: true,
    restarting: false,
    paused: false,
    oomKilled: false,
    dead: false,
    exitCode: 0,
    error: null,
    startedAt: Date.now() - 600_000,
    finishedAt: null,
    uptimeMs: 600_000,
    restartCount: 0,
    health: "healthy",
    healthFailingStreak: 0,
    status: "running",
    ...over,
  }
}

function snapshot(containers: ContainerSummary[], available = true): DockerSnapshot {
  return { available, sock: "/var/run/docker.sock", error: null, at: Date.now(), containers }
}

function derive(status: CheckStatus, snap: DockerSnapshot, opts: { everOk?: boolean; err?: string } = {}) {
  const checks =
    status === "down"
      ? [{ id: "config", ok: false, error: opts.err ?? "fetch failed: connection refused" }]
      : [{ id: "config", ok: true }]
  return deriveLifecycle({ status, checks, snapshot: snap, primaryName: "quick-market", everOk: opts.everOk ?? true, now: Date.now() })
}

describe("deriveLifecycle", () => {
  test("ok maps to online, degraded stays degraded", () => {
    expect(derive("ok", snapshot([])).lifecycle).toBe("online")
    expect(derive("degraded", snapshot([])).lifecycle).toBe("degraded")
  })

  test("without docker: never-ok + refused means starting, previous ok means offline", () => {
    const noDocker: DockerSnapshot = { available: false, sock: null, error: null, at: Date.now(), containers: [] }
    const first = derive("down", noDocker, { everOk: false })
    expect(first.lifecycle).toBe("starting")
    expect(first.reason).toContain("booting")
    const later = derive("down", noDocker, { everOk: true })
    expect(later.lifecycle).toBe("offline")
  })

  test("restarting or health-starting containers mean starting", () => {
    expect(derive("down", snapshot([container({ restarting: true })])).lifecycle).toBe("starting")
    expect(derive("down", snapshot([container({ health: "starting", uptimeMs: 20_000, startedAt: Date.now() - 20_000 })])).lifecycle).toBe("starting")
    expect(derive("down", snapshot([container({ status: "created", running: false, uptimeMs: null })])).lifecycle).toBe("starting")
  })

  test("missing / exited / dead containers mean offline with detail", () => {
    const missing = derive("down", snapshot([{ ...container(), exists: false, running: false, status: "missing", uptimeMs: null }]))
    expect(missing.lifecycle).toBe("offline")
    expect(missing.reason).toContain("not found")
    const exited = derive("down", snapshot([container({ running: false, status: "exited", exitCode: 1, uptimeMs: null, finishedAt: Date.now() - 60_000 })]))
    expect(exited.lifecycle).toBe("offline")
    expect(exited.reason).toContain("exit 1")
    const dead = derive("down", snapshot([container({ dead: true })]))
    expect(dead.lifecycle).toBe("offline")
  })

  test("running + unhealthy is offline, fresh running is starting, old running is offline", () => {
    expect(derive("down", snapshot([container({ health: "unhealthy", healthFailingStreak: 5 })])).lifecycle).toBe("offline")
    const fresh = derive("down", snapshot([container({ uptimeMs: 10_000, startedAt: Date.now() - 10_000 })]))
    expect(fresh.lifecycle).toBe("starting")
    expect(fresh.reason).toContain("ago")
    const hung = derive("down", snapshot([container({ uptimeMs: 900_000, startedAt: Date.now() - 900_000 })]))
    expect(hung.lifecycle).toBe("offline")
    expect(hung.reason).toContain("unreachable")
  })
})

describe("demuxDockerLogs", () => {
  function frame(text: string): Buffer {
    const payload = Buffer.from(text, "utf8")
    const header = Buffer.alloc(8)
    header[0] = 1
    header.writeUInt32BE(payload.length, 4)
    return Buffer.concat([header, payload])
  }

  test("decodes multiplexed frames", () => {
    const buf = Buffer.concat([frame("hello\n"), frame("world\n")])
    expect(demuxDockerLogs(buf)).toBe("hello\nworld\n")
  })

  test("passes raw TTY output through", () => {
    expect(demuxDockerLogs(Buffer.from("plain text\nno headers", "utf8"))).toBe("plain text\nno headers")
    expect(demuxDockerLogs(Buffer.alloc(0))).toBe("")
  })
})

describe("clampTail", () => {
  test("clamps to 10..2000 with fallback", () => {
    expect(clampTail("500", 200)).toBe(500)
    expect(clampTail("5", 200)).toBe(10)
    expect(clampTail("99999", 200)).toBe(2000)
    expect(clampTail("junk", 200)).toBe(200)
  })
})
