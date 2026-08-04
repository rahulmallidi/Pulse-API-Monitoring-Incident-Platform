# Pulse Architecture

Pulse is a TypeScript monorepo (pnpm + Turborepo) with NestJS microservices, a Next.js ops dashboard, PostgreSQL/TimescaleDB, Redis, and Redpanda (Kafka API).

## Services

| Service | Port | Responsibility |
|---------|------|----------------|
| **api** | 3000 | Control-plane REST (checks, incidents, metrics, notifiers), OpenAPI, SSE live stream |
| **probe** | 3001 | Consumes regional job topics; runs HTTP/TCP/DNS/synthetic checks; publishes results |
| **scheduler** | 3002 | Scans enabled checks every 5s; dispatches jobs; seeds demo targets; polls Statuspage |
| **ingestor** | 3003 | Writes samples to Timescale; publishes Redis `live.probes` |
| **alerter** | 3004 | Fingerprint/dedupe; opens incidents; Slack/webhook delivery; emits `alerts.raised` |
| **web** | 3005 | Ops dashboard + static public status page |

## Data plane

- **PostgreSQL 16 + TimescaleDB** — Prisma metadata (`checks`, `incidents`, `notifiers`, `vendor_*`) + `samples` hypertable
- **Redpanda** — Kafka-compatible bus for probe jobs/results
- **Redis 7** — live SSE fanout, alert dedup TTLs, Statuspage cache, baseline heartbeat keys

## Event flow

1. Scheduler reads `checks` → `probes.jobs.{us-east|eu-west|ap-south}`
2. Probe executes → `probes.results`
3. Ingestor persists + Redis publish → API SSE
4. Alerter evaluates failures → Redis NX dedup → `incidents` + notifiers → `alerts.raised`

Local probe uses `REGION=all` to subscribe to all three job topics. Production-style deploys use one process per region.

## Shared packages

- `@pulse/contracts` — Zod schemas for API/Kafka payloads
- `@pulse/core` — SLO math + alert fingerprints
- `@pulse/db` — Prisma + Timescale pool/migrations
- `@pulse/runtime` — Kafka/Redis helpers + topic constants
- `@pulse/ui` — shared React cards (optional; not required by web)

See root `README.md` for setup, env, API surface, and benchmarks.
