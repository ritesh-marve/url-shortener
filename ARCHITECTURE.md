# URL Shortener — System Architecture & Deep Dive Guide

**Version:** 1.0  
**Current Milestone:** Milestone 1 Complete (PostgreSQL + Docker MVP)  
**Last Updated:** 19 November 2026  

---

## 1. System Architecture: Layered Modular Monolith

Rather than throwing database queries, business rules, and HTTP handling into one controller, the system implements a strict **Separation of Concerns** using a layered architecture:

```text
               ┌────────────────────────────────────────────────────────┐
               │                     Client / Browser                   │
               └──────────────┬───────────────────────────▲─────────────┘
                              │ HTTP Request              │ HTTP Response
                              ▼                           │
┌───────────────────────────────────────────────────────────────────────┐
│ Express Application (src/app.ts)                                      │
│                                                                       │
│  [Middleware Pipeline]                                                │
│   ├── express.json() (body parsing)                                   │
│   │                                                                   │
│  [Route Layer] (src/routes/)                                          │
│   ├── links.routes.ts    ── Validates input via Zod                   │
│   └── redirect.routes.ts ── Captures short code parameter             │
│             │                                                         │
│             ▼                                                         │
│  [Service Layer] (src/modules/links/link.service.ts)                  │
│   ├── Business rules & short-code orchestration                       │
│   └── Collision retry loop (catches Postgres 23505)                   │
│             │                                                         │
│             ▼                                                         │
│  [Repository Layer] (src/modules/links/link.repository.ts)           │
│   └── SQL abstraction & Drizzle ORM operations                        │
│             │                                                         │
│             ▼                                                         │
│  [Database Client & Pool] (src/db/index.ts)                           │
│   └── Reusable TCP connections (pg.Pool)                              │
│                                                                       │
│  [Global Error Handler] (src/middleware/errorHandler.ts)              │
│   └── Catches uncaught errors; enforces standardized JSON output      │
└─────────────────────────────┬─────────────────────────────────────────┘
                              │ TCP (Port 5432)
                              ▼
┌───────────────────────────────────────────────────────────────────────┐
│ Docker Container (postgres:16-alpine)                                 │
│  └── Persistent Volume (pgdata) & Unique Constraint on `code`         │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 2. Tech Stack & Architectural Justifications

| Technology | Selection Rationale | Alternatives Considered & Trade-offs |
|---|---|---|
| **Node.js + Express 5** | Non-blocking event loop ideal for high-throughput I/O-bound redirect operations. Express 5 natively handles asynchronous route errors. | Avoided multi-threaded bloat (e.g., Java Spring) to maintain a lightweight, single-language microservice. |
| **TypeScript (`NodeNext`)** | Compile-time type verification. Prevents runtime `undefined` bugs and provides strong developer tooling. | Pure JavaScript allows faster prototyping but introduces runtime fragility at scale. |
| **PostgreSQL 16** | ACID-compliant relational storage with rock-solid uniqueness enforcement and high-performance B-tree indexing. | Avoided NoSQL (e.g., MongoDB) because URL shorteners strictly require relational consistency on codes. |
| **Drizzle ORM & Kit** | Zero-dependency, lightweight SQL query builder. Direct SQL feel without heavy runtime query engine binaries. | Avoided Prisma due to its heavy Rust query engine overhead and higher latency floor. |
| **Zod** | Runtime boundary validation for untrusted external inputs (environment variables and HTTP request bodies). | Manual `if (!req.body.url)` checks are brittle and prone to validation bypasses. |
| **Docker Compose** | Fully isolated, reproducible local environment with persistent named volumes and zero host pollution. | Local Windows `.exe` installers pollute registry and require manual setup per machine. |

---

## 3. Component Deep Dive

### 3.1 Configuration & Environment (`src/config/env.ts`)
* **Role:** Loads environment variables using Node's native `process.loadEnvFile()` and validates them using Zod.
* **Key Design Pattern:** **Fail-Fast Principle**. If `DATABASE_URL` or `PORT` is missing or invalid, the process halts on boot with a descriptive error before any HTTP requests or DB connections occur.

### 3.2 Global Error Handler (`src/middleware/errorHandler.ts`)
* **Role:** Express 4-argument error barrier `(err, req, res, next)`.
* **Key Design Pattern:** **Defensive Information Shielding**. By default, Express returns stack traces and server file structures in HTML. This middleware intercepts all exceptions and outputs a clean, predictable contract:
  ```json
  {
    "error": {
      "code": "INTERNAL_ERROR",
      "message": "Something went wrong"
    }
  }
  ```

### 3.3 Cryptographic Code Generator (`src/modules/links/codeGenerator.ts`)
* **Role:** Generates 7-character base62 strings using `crypto.randomBytes()`.
* **Entropy & Collision Mathematics:**
  - Base62 alphabet: `[A-Za-z0-9]` ($62$ characters).
  - Combinations: $62^7 = 3,521,614,606,208$ ($\approx 3.52$ trillion unique codes).
  - Uses cryptographically secure random bytes rather than `Math.random()` to prevent code-guessing or enumeration attacks.

### 3.4 Data Schema (`src/db/schema/links.ts`)
* **Role:** Drizzle PostgreSQL table definition:
  - `id`: UUID primary key. Generated at the application layer via `crypto.randomUUID()` to avoid requiring PostgreSQL extensions (`uuid-ossp` / `pgcrypto`).
  - `code`: `varchar(255)` with unique constraint and B-tree index.
  - `destination_url`: `text`. Supports large URLs up to 1GB (handling long query parameters and tracking tags).
  - `created_at`: `timestamptz`, defaults to database `now()`.

### 3.5 Connection Pool & Database Client (`src/db/index.ts`)
* **Role:** Instantiates a shared `pg.Pool` connection pool wrapped by Drizzle.
* **Why Connection Pooling:** Opening and authenticating a new PostgreSQL TCP connection per request incurs $20\text{--}50\text{ ms}$ overhead. A connection pool keeps a pool of warm connections alive, reducing query overhead to $< 2\text{ ms}$.

### 3.6 Link Repository (`src/modules/links/link.repository.ts`)
* **Role:** Data access abstraction containing all Drizzle queries (`insertLink`, `findLinkByCode`).
* **Design Pattern:** **Repository Pattern**. Isolates query syntax so that the service layer remains pure business logic.

### 3.7 Link Service & Collision Recovery (`src/modules/links/link.service.ts`)
* **Role:** Coordinates link creation, code generation, and lookup.
* **System Design Insight (Collision Handling):**
  Even with $3.52$ trillion codes, concurrent requests could theoretically generate the same random code.
  - The PostgreSQL unique constraint rejects duplicate inserts with error code `23505`.
  - The service catches `23505` and retries with a new code up to $5$ times:
  ```typescript
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await insertLink({ id: randomUUID(), code, destinationUrl });
    } catch (err: any) {
      if (err.code === "23505") continue; // Collision: retry with new code
      throw err;
    }
  }
  ```

### 3.8 Route Handlers (`src/routes/`)
* **`POST /api/v1/links` (`links.routes.ts`):** Validates the URL format via Zod and returns `201 Created` with code, shortUrl, and destination.
* **`GET /:code` (`redirect.routes.ts`):** Looks up code and returns `302 Found` or `404 Not Found`.
* **Why HTTP `302 Found` instead of `301 Moved Permanently`:**
  - `301` instructs browsers to cache the destination indefinitely on the client machine; subsequent clicks bypass the backend entirely, breaking analytics.
  - `302` (or `307`) ensures every click hits the server for real-time tracking.

---

## 4. End-to-End Execution Flows

### Flow A: Link Creation (`POST /api/v1/links`)
```text
1. Client sends POST {"url": "https://example.com"}
2. links.routes.ts parses body and runs createLinkSchema.safeParse()
   ├── Failed? ──▶ Responds immediately with 400 VALIDATION_ERROR
   └── Passed? ──▶ Calls link.service.createLink(url)
3. link.service.ts runs attempt loop:
   ├── Generates 7-character base62 code (crypto.randomBytes)
   ├── Generates UUID (crypto.randomUUID)
   └── Calls link.repository.insertLink(...)
4. PostgreSQL executes INSERT into "links"
   ├── Code collision (23505)? ──▶ Service catches error and retries
   └── Success?                ──▶ Row inserted and returned
5. Route responds: 201 Created with JSON payload
```

### Flow B: Link Redirection (`GET /:code`)
```text
1. Visitor navigates to: http://localhost:3000/:code
2. Express matches GET /:code in redirect.routes.ts
3. link.service.getLinkByCode(code) queries PostgreSQL
4. Decision:
   ├── Not found? ──▶ Responds with 404 NOT_FOUND JSON
   └── Found?     ──▶ Responds with HTTP 302 Found & Header Location: destinationUrl
5. Browser immediately redirects visitor to destination
```

---

## 5. Roadmap & What Comes Next

| Feature | Milestone | Technical Solution |
|---|:---:|---|
| **High-Throughput Caching** | Milestone 2 | **Redis Cache-Aside**: Cache destination URLs in memory (`link:<code>`) to avoid hitting PostgreSQL on every redirect ($< 1\text{ ms}$ resolution). |
| **Non-blocking Analytics** | Milestone 2 | **BullMQ Queue**: Enqueue click events asynchronously in Redis during redirect. Worker process persists click counts to Postgres in background. |
| **Rate Limiting** | Milestone 2 | Redis token-bucket / sliding-window rate limiter for sensitive endpoints. |
| **Automated Testing** | Milestone 3 | Vitest unit and HTTP integration tests (Supertest). |
| **Containerized Stack** | Milestone 3 | Multi-stage production `Dockerfile` and complete multi-service `docker-compose.yml`. |
