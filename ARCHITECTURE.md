# URL Shortener — System Architecture & Deep Dive Guide

**Version:** 2.0  
**Current Milestone:** Milestone 2 Complete (Redis Caching, BullMQ & Analytics)  
**Last Updated:** 22 November 2026  

---

## 1. System Architecture: Distributed Decoupled Monolith

The system uses a **layered, event-driven architecture** separating synchronous HTTP redirects from asynchronous background analytics:

```text
               ┌────────────────────────────────────────────────────────┐
               │                     Client / Browser                   │
               └──────────────┬───────────────────────────▲─────────────┘
                              │ HTTP Request              │ HTTP Response
                              ▼                           │
┌───────────────────────────────────────────────────────────────────────┐
│ Express Web Application (src/app.ts)                                  │
│                                                                       │
│  [Middleware Pipeline]                                                │
│   ├── express.json() (body parsing)                                   │
│   │                                                                   │
│  [Route Layer] (src/routes/)                                          │
│   ├── links.routes.ts    ── Create link & query aggregate analytics   │
│   └── redirect.routes.ts ── 302 Redirect & non-blocking click trigger │
│             │                                                         │
│             ▼                                                         │
│  [Service Layer] (src/modules/links/link.service.ts)                  │
│   ├── Business rules & collision retry loop (catches Postgres 23505)  │
│   └── Cache-Aside orchestrator (checks Redis before PostgreSQL)       │
│             │                                                         │
│             ├───▶ [Cache Layer] (src/cache/redis.ts)                  │
│             │      └── In-memory cache ({ id, destinationUrl }, TTL)  │
│             │                                                         │
│             ├───▶ [Queue Layer] (src/queue/clickQueue.ts)             │
│             │      └── Non-blocking BullMQ event producer             │
│             │                                                         │
│             ▼                                                         │
│  [Repository Layer] (src/modules/links/link.repository.ts)           │
│   └── Drizzle ORM queries for links and analytics counts              │
│             │                                                         │
│             ▼                                                         │
│  [Database Client & Pool] (src/db/index.ts)                           │
│   └── Reusable TCP connection pool (pg.Pool)                          │
│                                                                       │
│  [Global Error Handler] (src/middleware/errorHandler.ts)              │
│   └── Catches uncaught errors; enforces standardized JSON output      │
└─────────────┬─────────────────────────────────────────────────────────┘
              │                                      │
              │ TCP (Port 6379)                      │ TCP (Port 5432)
              ▼                                      ▼
┌───────────────────────────────┐     ┌─────────────────────────────────┐
│ Redis Container (redis:7)     │     │ PostgreSQL Container (pg:16)    │
│  ├── In-Memory Cache (TTL)    │     │  ├── "links" table              │
│  └── BullMQ "click-events"    │     │  └── "click_events" table       │
└─────────────┬─────────────────┘     └──────────────▲──────────────────┘
              │ BullMQ Job Stream                    │
              ▼                                      │
┌─────────────────────────────────────────┐          │
│ Analytics Worker (analyticsWorker.ts)   │──────────┘
│  └── Asynchronous worker consumer       │ Idempotent Insert
│      (concurrency: 5, ON CONFLICT)      │ (ON CONFLICT DO NOTHING)
└─────────────────────────────────────────┘
```

---

## 2. Tech Stack & Architectural Justifications

| Technology | Selection Rationale | Alternatives Considered & Trade-offs |
|---|---|---|
| **Node.js + Express 5** | Non-blocking event loop ideal for high-throughput I/O-bound redirect operations. Express 5 natively handles asynchronous route errors. | Avoided multi-threaded bloat (e.g., Java Spring) to maintain a lightweight, single-language microservice. |
| **TypeScript (`NodeNext`)** | Compile-time type verification. Prevents runtime `undefined` bugs and provides strong developer tooling. | Pure JavaScript allows faster prototyping but introduces runtime fragility at scale. |
| **PostgreSQL 16** | ACID-compliant relational storage with rock-solid uniqueness enforcement and high-performance B-tree indexing. | Avoided NoSQL (e.g., MongoDB) because URL shorteners strictly require relational consistency on codes. |
| **Redis 7 & ioredis** | Sub-millisecond in-memory cache and reliable message broker. | Avoided in-memory Node Maps (which lose cache on restart and cannot be shared across multiple web instances). |
| **BullMQ** | Battle-tested, Redis-backed message queue with concurrency control, delayed jobs, and retries. | Avoided Kafka / RabbitMQ which add heavy operational complexity for a portfolio-grade service. |
| **Drizzle ORM & Kit** | Zero-dependency, lightweight SQL query builder. Direct SQL feel without heavy runtime query engine binaries. | Avoided Prisma due to its heavy Rust query engine overhead and higher latency floor. |
| **Zod** | Runtime boundary validation for untrusted external inputs (environment variables, HTTP request bodies, and query params). | Manual `if (!req.body.url)` checks are brittle and prone to validation bypasses. |
| **Docker Compose** | Fully isolated, reproducible local environment with persistent named volumes and multi-container orchestration. | Local Windows `.exe` installers pollute registry and require manual setup per machine. |

---

## 3. Component Deep Dive

### 3.1 Configuration & Environment (`src/config/env.ts`)
* **Role:** Loads environment variables using Node's native `process.loadEnvFile()` and validates them using Zod (`DATABASE_URL`, `REDIS_URL`, `PORT`, `NODE_ENV`).
* **Design Pattern:** **Fail-Fast Principle**. If any critical variable is missing or malformed, the process halts immediately on startup.

### 3.2 Global Error Handler (`src/middleware/errorHandler.ts`)
* **Role:** Express 4-argument error barrier `(err, req, res, next)`.
* **Design Pattern:** **Defensive Information Shielding**. Intercepts all uncaught exceptions, logs details server-side, and guarantees sanitized JSON output `{ error: { code, message } }`.

### 3.3 Cryptographic Code Generator (`src/modules/links/codeGenerator.ts`)
* **Role:** Generates 7-character base62 strings using `crypto.randomBytes()`.
* **Entropy & Collision Mathematics:**
  - Base62 alphabet: `[A-Za-z0-9]` ($62$ characters).
  - Combinations: $62^7 = 3,521,614,606,208$ ($\approx 3.52$ trillion unique codes).
  - Cryptographically secure random bytes prevent code enumeration and URL scraping attacks.

### 3.4 Data Schemas (`src/db/schema/`)
* **`links.ts`:**
  - `id`: UUID primary key. Generated at the application layer via `crypto.randomUUID()` to avoid requiring PostgreSQL extensions.
  - `code`: `varchar(255)` with unique constraint and B-tree index.
  - `destination_url`: `text`. Supports large URLs up to 1GB.
  - `created_at`: `timestamptz`, defaults to database `now()`.
* **`clicks.ts`:**
  - `event_id`: UUID primary key for idempotency.
  - `link_id`: Foreign key referencing `links.id` (on delete cascade).
  - `clicked_at`: `timestamptz`.
  - **Composite Index:** `index("click_events_link_clicked_idx").on(table.linkId, table.clickedAt)` ensures date-range bounded queries execute in sub-milliseconds.

### 3.5 In-Memory Cache (`src/cache/redis.ts`)
* **Role:** High-speed RAM layer in front of disk PostgreSQL.
* **Key Design Pattern (Resilient Fallback):**
  - Caches `{ id, destinationUrl }` as JSON with a 1-hour expiration TTL (`EX 3600`).
  - All Redis operations are wrapped in `try/catch`. If Redis is down, it logs a warning and returns `null` (cache miss), allowing the app to seamlessly fall back to PostgreSQL without dropping user requests.

### 3.6 BullMQ Queue Producer (`src/queue/clickQueue.ts`)
* **Role:** Defines the `click-events` queue backed by Redis.
* **Key Design Rule:** Configures `maxRetriesPerRequest: null` required by BullMQ for non-blocking Redis commands.

### 3.7 Analytics Worker Process (`src/workers/analyticsWorker.ts`)
* **Role:** Standalone consumer process listening for jobs on `click-events`.
* **Key Design Pattern (Worker Idempotency):**
  - Consumes jobs with concurrency of 5.
  - Writes to PostgreSQL using `.onConflictDoNothing({ target: clickEvents.eventId })`.
  - If a job is redelivered due to a network timeout, the duplicate insert is safely ignored rather than double-counting clicks.

### 3.8 Redis Sliding Window Rate Limiter (`src/middleware/rateLimiter.ts`)
* **Role:** Protects endpoints from abuse, spam, and DoS attacks using rolling time windows.
* **Algorithm & Concurrency Design:**
  - Implemented using Redis Sorted Sets (`ZSET`) inside an atomic Redis pipeline.
  - Purges entries older than the window: `ZREMRANGEBYSCORE key 0 (now - windowMs)`.
  - Records timestamp as score with guaranteed unique member suffix: `${now}:${random}` to prevent millisecond duplicate-member collision drops.
  - Counts remaining hits in window via `ZCARD` and compares against configured limit.
  - Sets standard headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `Retry-After`.
  - Rejects excess requests with HTTP `429 Too Many Requests`.
  - **Fail-Open Strategy:** If Redis encounters an error, the limiter logs a warning and calls `next()`, ensuring cache blips never take down production traffic.

### 3.9 Link Service & Collision Recovery (`src/modules/links/link.service.ts`)
* **`createLink(url)`:** Retries up to 5 times on Postgres error code `23505` (unique violation).
* **`resolveLink(code)`:** Executes the Cache-Aside pattern (check Redis $\rightarrow$ on miss query Postgres $\rightarrow$ populate Redis).
* **`getAnalytics(code, from, to)`:** Fetches aggregate metrics and validates date boundaries.

### 3.10 Route Handlers (`src/routes/`)
* **`POST /api/v1/links`:** Validates input URL via Zod and creates link.
* **`GET /:code`:** Resolves link via Cache-Aside, fires non-blocking queue event (`clickQueue.add(...).catch(...)`), and immediately returns HTTP `302 Found`.
* **`GET /api/v1/links/:code/analytics`:** Validates optional `from` and `to` ISO timestamps and returns aggregate metrics.

---

## 4. End-to-End Execution Flows

### Flow A: Link Creation (`POST /api/v1/links`)
```text
Client ──▶ POST /api/v1/links ──▶ Zod validate body ──▶ link.service.createLink()
                                                             │
                                          ┌──────────────────┴──────────────────┐
                                          ▼                                     ▼
                               crypto.randomBytes(7)                  crypto.randomUUID()
                                          │                                     │
                                          └──────────────────┬──────────────────┘
                                                             ▼
                                                link.repository.insertLink()
                                                             │
                                        PostgreSQL INSERT into "links" (retry 23505)
                                                             │
Client ◀── 201 Created { code, shortUrl, destinationUrl, createdAt }
```

### Flow B: Link Redirection & Async Click Enqueue (`GET /:code`)
```text
Visitor ──▶ GET /:code
              │
              ▼
     resolveLink(code)
              │
    ┌─────────┴─────────┐
    ▼                   ▼
Cache HIT           Cache MISS
    │                   │
    │         Query PostgreSQL & populate Redis (TTL 1h)
    │                   │
    └─────────┬─────────┘
              │ Returns { id, destinationUrl }
              │
              ├──▶ [Non-blocking] clickQueue.add("click", { eventId, linkId, clickedAt })
              │                               │
              │                               ▼
              │                     Pushed to Redis Queue (< 1ms)
              │
Visitor ◀─────┴── HTTP 302 Found & Location: destinationUrl (Instant Redirect)
```

### Flow C: Asynchronous Worker Ingestion (Background)
```text
Redis BullMQ "click-events" ──▶ Analytics Worker picks up job
                                           │
                                           ▼
                                 Extract { eventId, linkId, clickedAt }
                                           │
                                           ▼
                                 PostgreSQL INSERT into "click_events"
                                 ON CONFLICT (event_id) DO NOTHING
                                           │
                                           ▼
                                 Job marked COMPLETED in Redis
```

### Flow D: Analytics Retrieval (`GET /api/v1/links/:code/analytics`)
```text
Client ──▶ GET /api/v1/links/:code/analytics?from=...&to=...
              │
              ▼
       Zod validate ISO timestamps & range (from <= to)
              │
              ▼
       link.repository.getLinkAnalytics(linkId, from, to)
              │
       SELECT count(*) FROM click_events
       WHERE link_id = $1 AND clicked_at >= $2 AND clicked_at <= $3
       (Utilizes composite index: click_events_link_clicked_idx)
              │
Client ◀── 200 OK { code, destinationUrl, totalClicks, from, to, createdAt }
```

---

## 5. Roadmap & What Comes Next

| Feature | Milestone | Technical Solution | Status |
|---|:---:|---|:---:|
| **Local MVP & Database** | Milestone 1 | PostgreSQL, Drizzle ORM, Zod, and 302 Redirects | ✅ Done |
| **High-Throughput Caching** | Milestone 2 | **Redis Cache-Aside**: In-memory `{ id, destinationUrl }` cache ($< 1\text{ ms}$ resolution). | ✅ Done |
| **Non-blocking Analytics** | Milestone 2 | **BullMQ Queue & Worker**: Asynchronous idempotent click ingestion. | ✅ Done |
| **Analytics Query API** | Milestone 2 | Composite index aggregation with date-range filtering. | ✅ Done |
| **Abuse Protection** | Milestone 2 | **Redis Sliding Window Rate Limiting**: ZSET with unique members. | ✅ Done |
| **Automated Testing** | Milestone 3 | Vitest unit and HTTP integration tests (Supertest). | 🟡 Up Next |
| **Production Containerization** | Milestone 3 | Multi-stage production `Dockerfile` and CI pipeline (GitHub Actions). | ⚪ Planned |
| **Cloud Deployment** | Milestone 4 | Deploy Web & Worker to Render, Managed Postgres (Neon/Supabase), Upstash Redis. | ⚪ Planned |
