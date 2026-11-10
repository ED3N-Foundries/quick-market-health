# quick-market-health

Standalone health status page for `quick-market`. Runs as its own container
(`quick-market-health`), lives in its own repository, and never touches the
market database. It probes the market over HTTP + websocket exactly like a
client would, times every piece in ms, and shows what is working vs wrong.

## What it checks (each with its own ms)

| piece | how |
|---|---|
| `GET /api/config` | chain, windows, fee, treasury |
| `GET /api/health` | market process alive (includes `status`, `reason`, `process`, `previous`) |
| `GET /api/status` | internal crash-reason endpoint: boot id/count, uptime, last error/signal, previous unclean shutdown, memory — no DB touch |
| `GET /api/state` | feed live/stale, ticker, board, tape points + age, clock skew |
| `GET /api/feeds` | per-venue price, age, role, swing, gap, socket |
| `GET /api/rounds?limit=1` | history readable |
| `WS /ws` | connect ms, first `round` msg ms, `lag` echo round-trip ms |
| chain RPC | EVM `eth_chainId` + `eth_blockNumber`, or NEAR `/status` |

Overall is `ok` / `degraded` (non-critical fails, e.g. RPC) / `down`
(a critical piece — config, state, or ws — fails). Every report also carries
`downReason` (first failing critical check plus the market's own `reason`),
`process` (from `/api/status`, null when unreachable), `previous` (the last
run's crash info, which survives restarts via the market's data volume), and
`tracking` (restarts seen, outage window, consecutive failures). The dashboard
renders these in the “crash reasons · restarts · outage” card; `/api/history`
samples keep `downReason` + `bootId` so sparse crashes stay visible.

## Run locally

```bash
cp .env.example .env   # optional; defaults target http://127.0.0.1:3001
bun install
bun test
TARGET_URL=http://127.0.0.1:3001 bun run scripts/smoke.ts  # one probe in the terminal
bun run dev   # page on http://127.0.0.1:3101
```

## Run as a container

```bash
docker build -t ed3n/quick-market-health:latest .
docker run -d --name quick-market-health -p 3101:3101 \
  -e TARGET_URL=http://quick-market:3001 \
  ed3n/quick-market-health:latest
```

Or with compose (same network as the market):

```bash
TARGET_URL=http://quick-market:3001 docker compose up -d --build
```

Page: `http://<host>:3101` · JSON: `/api/check?fresh=1`, `/api/history`, `/api/health`.

## Endpoints

- `/` — dashboard (auto-refresh, no build step, no external assets)
- `/api/check?fresh=1` — full live probe report with per-check ms
- `/api/history` — ring buffer of recent probes, uptime %, avg ms per piece
- `/api/health` — this service's own liveness (`{"ok":true}`)

## Env

| var | default | meaning |
|---|---|---|
| `PORT` | `3101` | health page port |
| `TARGET_URL` | `http://127.0.0.1:3001` | quick-market API base |
| `WS_TARGET` | derived (`TARGET_URL` http→ws + `/ws`) | websocket override |
| `RPC_URL` | chain default | chain RPC override |
| `CHECK_INTERVAL_MS` | `10000` | background re-probe |
| `HISTORY_N` | `180` | samples kept |
| `REFRESH_MS` | `5000` | page refresh |
| `REQUEST_TIMEOUT_MS` | `8000` | per-probe timeout |
