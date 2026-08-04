# Pulse — API Monitoring & Incident Platform

Self-hosted, multi-region API monitoring: schedule probes, ingest samples into TimescaleDB, open incidents with vendor correlation, stream live results to a Next.js ops dashboard, and notify Slack/webhooks.

Built as a **pnpm + Turborepo** monorepo (NestJS workers + Next.js 14).

---

## Architecture (high level)

![Pulse system architecture](images/architecture.png)

```text
Browser (Next.js :3005)
        │  REST + SSE
        ▼
   API (:3000) ── Redis SUBSCRIBE live.probes ──► SSE /live/probes
        │
        │  Prisma (checks, incidents, notifiers)
        ▼
 PostgreSQL 16 + TimescaleDB
        ▲
        │  INSERT samples
   Ingestor (:3003) ◄── Kafka probes.results ──┐
        │                                       │
        │  PUBLISH live.probes                  │
        ▼                                       │
      Redis 7                                   │
                                                │
   Scheduler (:3002) ──► probes.jobs.{region} ──► Probe (:3001)
        │                     (us-east|eu-west|ap-south)     │
        │  Statuspage poll → vendor_* tables                 │
        ▼                                                    │
   Alerter (:3004) ◄── probes.results ───────────────────────┘
        │  Redis dedup · Prisma incidents · Slack/webhook
        └──► Kafka alerts.raised  (topic reserved; no consumer yet)
```

**Regions:** `us-east`, `eu-west`, `ap-south`. Locally one probe with `REGION=all` consumes all three job topics.

Demo tenant ID (seed + dashboard): `11111111-1111-1111-1111-111111111111`  
Demo tenant slug: `demo-acme`

---

## Repository structure

```text
apps/
  api/          Control-plane REST, metrics, SSE, notifiers, OpenAPI
  probe/        Kafka consumer → HTTP/TCP/DNS/synthetic executors → results
  scheduler/    Interval job dispatch + Statuspage poller + demo seed
  ingestor/     Persist samples to Timescale + Redis live fanout
  alerter/      Fingerprint/dedupe → incidents + Slack/webhook delivery
  web/          Next.js ops dashboard (/) + public status stub (/status)
packages/
  contracts/    Zod schemas for checks, samples, incidents, Kafka events
  core/         SLO math + alert fingerprinting (unit-tested)
  db/           Prisma schema, Timescale SQL migrations, bootstrap/seed
  runtime/      Kafka/Redis factories, env schema, topic names
  ui/           Shared React primitives (not wired into web yet)
deploy/         docker-compose, init-db.sh, Helm/K8s placeholders
benchmarks/     k6 health throughput starter
docs/           architecture, SLO, anomaly notes
images/         architecture diagram for README
scripts/        dev-stack.ps1, smoke-e2e.ps1
```

### Package dependency graph

```text
@pulse/web          → (HTTP only) @pulse/api
@pulse/api          → contracts, db, runtime
@pulse/probe        → contracts, runtime
@pulse/scheduler    → contracts, db, runtime
@pulse/ingestor     → contracts, db, runtime
@pulse/alerter      → contracts, core, db, runtime
@pulse/core         → (pure TS, no workspace deps)
@pulse/contracts    → zod
@pulse/db           → @prisma/client, pg
@pulse/runtime      → kafkajs, ioredis, zod
```

### Kafka / Redis map

| Channel | Type | Producer | Consumer |
|---------|------|----------|----------|
| `probes.jobs.us-east` / `eu-west` / `ap-south` | Kafka | scheduler | probe |
| `probes.results` | Kafka | probe | ingestor **and** alerter |
| `alerts.raised` | Kafka | alerter | *(none yet)* |
| `incidents.events` | Kafka | *(reserved)* | — |
| `live.probes` | Redis pub/sub | ingestor | api → SSE |
| `alert:fingerprint:*` | Redis key TTL 300s | alerter | alerter (dedup) |
| `probe:baseline-ok:*` | Redis key TTL 120s | alerter | alerter (noise suppress) |
| `statuspage:summary:*` | Redis cache 45s | scheduler | scheduler |

---

## Tech stack

| Layer | Choice |
|-------|--------|
| Language | TypeScript (strict) |
| Workspace | pnpm 9 + Turborepo |
| Services | NestJS 10 |
| Dashboard | Next.js 14 App Router + Tailwind |
| Metadata DB | PostgreSQL 16 (Prisma) |
| Time-series | TimescaleDB (`samples` hypertable + continuous aggregates) |
| Bus | Redpanda (Kafka API) via kafkajs |
| Cache / fanout | Redis 7 via ioredis |
| Validation | Zod (`@pulse/contracts`) |
| Tests | Vitest (`@pulse/core`, `@pulse/contracts`) |

---

## Prerequisites

- Node.js **20+**
- pnpm **9** (`corepack enable`)
- Docker Desktop (Postgres / Redis / Redpanda)
- Windows: PowerShell for `pnpm dev:stack*` scripts

---

## Setup

### 1. Install

```bash
pnpm install
```

### 2. Environment

Copy `.env.example` → `.env` if you want local overrides. Host-mode stack scripts set the critical vars for you:

| Variable | Default / meaning |
|----------|-------------------|
| `DATABASE_URL` | `postgresql://pulse:pulse@localhost:5432/pulse?schema=public` |
| `REDIS_URL` | `redis://localhost:6379` |
| `KAFKA_BROKERS` | `localhost:9092` |
| `REGION` | `all` (probe consumes all region topics) |
| `CORS_ORIGIN` | `http://localhost:3005,http://127.0.0.1:3005` |
| `CORS_ALLOW_VERCEL` | `false` locally; `true` when dashboard is on Vercel |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:3000` (on Vercel: your public API origin) |
| `SLACK_WEBHOOK_URL` / `ALERT_WEBHOOK_URL` | optional alerter fallbacks |
| `NEXT_PUBLIC_*_API_URL` | optional path overrides (see `.env.example`) |

### 3. Start everything (recommended)

```bash
pnpm dev:stack
```

What this does:

1. Optionally frees ports **3000–3005**
2. `docker compose up -d` for **postgres / redis / redpanda** only
3. Bootstraps DB (Prisma push + Timescale migrations + demo seed) unless `-SkipBootstrap`
4. Runs all apps via Turbo in one terminal

Variants:

```bash
pnpm dev:stack:fast    # skip DB bootstrap
pnpm dev:stack:force   # force-kill stale port holders, then fast start
pnpm dev:stack:down    # stop infra containers
```

### 4. Manual bootstrap (if needed)

```bash
pnpm --filter @pulse/db bootstrap
```

Steps: `prisma generate` → schema push → Timescale SQL → `seed-demo`.

### 5. Open

| Surface | URL |
|---------|-----|
| Dashboard | http://localhost:3005 |
| Public status | http://localhost:3005/status |
| API health | http://localhost:3000/health |
| OpenAPI | http://localhost:3000/openapi |

Service health ports: probe `3001`, scheduler `3002`, ingestor `3003`, alerter `3004`.

> Prefer **`http://localhost:3005`** (not `127.0.0.1`) so CORS matches defaults.

### Full Docker Compose (apps in containers)

```bash
cd deploy
docker compose up
```

Starts infra **and** all Node services with bind-mounted source. Host-mode `dev:stack` is usually faster for day-to-day work.

---

## Important code paths

Keep these in mind when navigating — not an exhaustive file list.

| Concern | Where |
|---------|--------|
| Zod event/check schemas | `packages/contracts/src/index.ts` |
| Kafka topic names + env | `packages/runtime/src/index.ts` |
| SLO + fingerprint helpers | `packages/core/src/{slo,fingerprint}.ts` |
| Job dispatch loop (5s) | `apps/scheduler/src/jobs/jobs.service.ts` |
| Probe executors | `apps/probe/src/executors/*` |
| Sample write + Redis publish | `apps/ingestor/src/samples/samples.service.ts` |
| Alert eval → incident → notify | `apps/alerter/src/alerts/{alerts,delivery}.service.ts` |
| Metrics SQL (summary/series/heatmap/regional) | `apps/api/src/metrics/metrics.service.ts` |
| SSE bridge | `apps/api/src/live/live.service.ts` |
| Dashboard + notifiers UI | `apps/web/app/components/operations-dashboard.tsx` |
| Prisma models | `packages/db/prisma/schema.prisma` |
| Timescale hypertable | `packages/db/migrations/timescale/001_init_timescale.sql` |

### Control-plane API (tenant header)

Most routes require header:

```http
x-tenant-id: 11111111-1111-1111-1111-111111111111
```

| Area | Routes |
|------|--------|
| Checks | `GET/POST /checks`, `GET /checks/:id` |
| Incidents | `GET /incidents`, `PATCH /incidents/:id/state`, `POST /incidents/:id/updates` |
| Live | `GET /live/probes` (SSE) |
| Metrics | `GET /metrics/{summary,latency-series,heatmap,regional}` |
| Notifiers | `GET/POST /notifiers`, `POST /notifiers/:id/test`, `DELETE /notifiers/:id` |

Metrics query params: `range` (`1h|24h|7d|30d`), `region`, `serviceGroup`, `environment`, `points`.

---

## Alerting (Slack / webhook)

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps) → **Incoming Webhooks** → copy URL.
2. Dashboard → **Alerts** tab → type **Slack** → paste URL → **Add** → **Test**.
3. Or set `SLACK_WEBHOOK_URL` / `ALERT_WEBHOOK_URL` and restart the alerter.

Delivery runs when the alerter **opens** an incident (after Redis fingerprint dedup).

---

## Tests & benchmarks

### Unit tests

```bash
pnpm test:unit
# or
pnpm --filter @pulse/core test
pnpm --filter @pulse/contracts test
```

Covers SLO / burn-rate math, alert fingerprints + dedupe window, and Zod contract envelopes.

### Load starter (optional)

Install [k6](https://k6.io/), then:

```bash
k6 run benchmarks/probe-throughput.js
```

### Smoke e2e

```bash
pnpm smoke:e2e
```

Creates a deliberately failing check, waits for an incident, checks SSE.  
Default script base URL is `http://localhost:3100` — pass your API port if different:

```powershell
powershell -File ./scripts/smoke-e2e.ps1 -ApiBaseUrl http://localhost:3000
```

---

## Database notes

**Prisma (relational):** tenants, users, checks, incidents, updates, notifiers, alert rules, maintenance windows, SLOs, vendor_* correlation tables.

**Timescale:** `samples` hypertable keyed by `(check_id, region, time)`; continuous aggregates `samples_1m/5m/1h/1d`; compression after 7d; retention 180d; timing columns from migration `002`.

---

## Deploy

### Recommended: Render (frontend + backend together)

Pulse needs long-running workers, Redis, Kafka (Redpanda), and TimescaleDB. **Render Blueprints** can host all of that from one `render.yaml`.

**Cost:** private services + workers need a **paid Starter plan** (not free tier). Expect multiple Starter instances (API, web, 4 workers, Redis, Timescale, Redpanda).

#### Step-by-step

1. Push latest code to GitHub (this repo).
2. Open [https://dashboard.render.com/blueprints/new](https://dashboard.render.com/blueprints/new).
3. Connect the GitHub repo `Pulse-API-Monitoring-Incident-Platform`.
4. Render detects root `render.yaml` → review services → **Apply**.
5. Wait until `pulse-api`, `pulse-web`, workers, `pulse-timescale`, `pulse-redpanda`, and `pulse-redis` are live.
6. Open **pulse-api** → **Shell** and run DB migrate/seed once:

```bash
pnpm --filter @pulse/db migrate:prod
```

7. Open the **pulse-web** URL (e.g. `https://pulse-web.onrender.com`).
8. Optional: set `SLACK_WEBHOOK_URL` / `ALERT_WEBHOOK_URL` on **pulse-alerter** (Blueprint marks them as dashboard secrets).

If your API public URL is not exactly `https://pulse-api.onrender.com` (custom name/region), update `NEXT_PUBLIC_API_BASE_URL` on **pulse-web** and redeploy web.

#### What the Blueprint starts

| Service | Role |
|---------|------|
| `pulse-web` | Next.js dashboard (public) |
| `pulse-api` | Control-plane API + SSE (public) |
| `pulse-scheduler` / `probe` / `ingestor` / `alerter` | Background workers |
| `pulse-timescale` | TimescaleDB (private) |
| `pulse-redpanda` | Kafka-compatible bus (private) |
| `pulse-redis` | Redis / Key Value |

Files: `render.yaml`, `deploy/Dockerfile`, `deploy/render-start.sh`.

---

### Alternative: Vercel dashboard only

Use this if you only want the UI on Vercel and will host API/workers elsewhere.

1. [vercel.com/new](https://vercel.com/new) → import repo.
2. **Root Directory:** `apps/web`
3. Env: `NEXT_PUBLIC_API_BASE_URL=https://<your-public-api>`
4. On the API host: `CORS_ALLOW_VERCEL=true` and your Vercel origin in `CORS_ORIGIN`

---

### Local / VM Docker Compose

```bash
pnpm dev:stack:force
# or: docker compose -f deploy/docker-compose.yml up
```

| Path | Purpose |
|------|---------|
| `deploy/docker-compose.yml` | Local full stack |
| `render.yaml` | Render full-stack Blueprint |
| `apps/web/vercel.json` | Vercel web-only config |

Production-style multi-region would run separate probe processes per `REGION` instead of `REGION=all`.

---

## Implementation status

**Done**

- End-to-end probe pipeline (schedule → probe → ingest → metrics/SSE)
- Multi-region job topics with local `REGION=all` consumer
- Incidents + Redis dedup + Slack/webhook notifiers
- Statuspage vendor correlation inputs
- Ops dashboard (latency, heatmap, regional, env/region filters, alerts tab)
- Shared contracts/core/runtime/db packages + Vitest coverage on core monitoring logic

**Next**

- Maintenance windows enforced in alerter/scheduler
- Persisted SLO CRUD APIs
- Email notifiers
- Blast-radius / dependency graph
- CI + Testcontainers integration tests
- Consume / act on `alerts.raised` and `incidents.events`

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Docker / DB unreachable | Start Docker Desktop; `pnpm dev:stack:down` then `pnpm dev:stack:force` |
| Port already in use | `pnpm dev:stack:force` |
| Dashboard `Failed to fetch` | Local: use `localhost:3005`. Render: confirm `NEXT_PUBLIC_API_BASE_URL` and API CORS. Vercel: set API base + `CORS_ALLOW_VERCEL=true` |
| Render migrate errors | Wait for `pulse-timescale` healthy, then Shell on `pulse-api`: `pnpm --filter @pulse/db migrate:prod` |
| Only us-east has samples | Probe must run with `REGION=all` (set by `dev-stack.ps1` / Render probe worker) |
| No Slack delivery | Alerter running? Notifier saved or env URL set? Incident actually opened? |
| Vercel build fails on pnpm | Root Directory must be `apps/web`; lockfile `pnpm-lock.yaml` should be committed |

---

## License / attribution

Probe targets and Statuspage hosts: see `SOURCE.md`.
