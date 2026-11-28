# Shrtn — Production URL Shortener & Async Analytics API

A production-grade URL shortener built with **TypeScript, Node.js, Express 5, PostgreSQL (Drizzle ORM), Redis, and BullMQ**. Designed for low-latency redirects, non-blocking click analytics, and resilience under failure.

🔗 **Live Demo & API:** [https://url-shortener-k0cx.onrender.com](https://url-shortener-k0cx.onrender.com)

---

## Architecture

```text
Client
  │
  ├─► POST /api/v1/links ──► Rate Limiter (Redis ZSET) ──► PostgreSQL (collision retry)
  │
  ├─► GET /:code ──────────► Redis Cache-Aside (1h TTL)
  │                              ├─ HIT  ──► 302 Redirect (~1ms)
  │                              └─ MISS ──► PostgreSQL ──► Warm Redis ──► 302 Redirect
  │                              └─► Async push to BullMQ (non-blocking)
  │                                      └─► Analytics Worker ──► PostgreSQL (idempotent insert)
  │
  └─► GET /api/v1/links/:code/analytics ──► Rate Limiter ──► PostgreSQL (indexed range query)
```

---

## Engineering Decisions ("The Why")

- **Cache-Aside with Fail-Open Redis:** Redirects check Redis first (1-hour TTL). If Redis is unavailable, the app logs a warning and falls back cleanly to PostgreSQL rather than failing requests.
- **Async Click Tracking via BullMQ:** Redirects never wait on analytics DB writes. Click events are queued to Redis (`click-events`) and persisted by a background worker using `onConflictDoNothing` on `event_id` for idempotent retries.
- **Custom Sliding-Window Rate Limiter:** Implemented with atomic Redis `ZSET` pipelines (`ZREMRANGEBYSCORE`, `ZADD` with unique `${timestamp}:${rand}` members to prevent millisecond collisions, `ZCARD`, `EXPIRE`). Also fails open if Redis is down.
- **Collision-Safe Base62 Short Codes:** Uses `crypto.randomBytes(7)` mapped to Base62, with a 5-attempt retry loop catching PostgreSQL unique constraint violations (`23505`).
- **Observability:** Structured JSON logging with **Pino** and `pino-http` request correlation IDs (`req.id`), plus `pino-pretty` in development.
- **Cloud Stack:** Deployed on **Render** with **Neon** (serverless PostgreSQL), **Upstash** (TLS Redis), **Docker** multi-stage build, and **GitHub Actions** CI (`typecheck` → `test` → `build`).

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Service health check |
| `POST` | `/api/v1/links` | Create a short link (`{ "url": "https://..." }`) |
| `GET` | `/:code` | `302` redirect + async click event |
| `GET` | `/api/v1/links/:code/analytics` | Total clicks (optional `?from=<ISO>&to=<ISO>`) |

### Example

```bash
# Create short link
curl -X POST https://url-shortener-k0cx.onrender.com/api/v1/links \
  -H "Content-Type: application/json" \
  -d '{"url":"https://github.com"}'

# Check analytics
curl https://url-shortener-k0cx.onrender.com/api/v1/links/<code_here>/analytics
```

---

## Local Development

### Prerequisites
- Node.js 22+
- Docker & Docker Compose

### Setup

```bash
# 1. Clone & install
git clone https://github.com/ritesh-marve/url-shortener.git
cd url-shortener
npm install

# 2. Start PostgreSQL & Redis
docker compose up -d

# 3. Configure environment
cp .env.example .env

# 4. Run database migrations
npm run db:migrate

# 5. Start API (and worker in a second terminal for standalone mode)
npm run build && npm start
```

### Tests

```bash
npm run typecheck
npm test
```