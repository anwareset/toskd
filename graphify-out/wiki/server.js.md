# server.js

> 61 nodes · cohesion 0.05

## Key Concepts

- **server.js** (41 connections) — `src/server.js`
- **otel.js** (19 connections) — `src/otel.js`
- **logger.js** (6 connections) — `src/logger.js`
- **tracked-request.js** (6 connections) — `src/tracked-request.js`
- **errorField()** (5 connections) — `src/logger.js`
- **isTrackedRequest()** (5 connections) — `src/tracked-request.js`
- **test-logger-redact.mjs** (5 connections) — `tests/test-logger-redact.mjs`
- **CriticalRouteRatioSampler** (4 connections) — `src/otel.js`
- **isAdminRequest()** (4 connections) — `src/server.js`
- **requireAdmin()** (4 connections) — `src/server.js`
- **isTrackedPath()** (4 connections) — `src/tracked-request.js`
- **isTrackedUrl()** (4 connections) — `src/tracked-request.js`
- **test-otel-exporter-env.mjs** (4 connections) — `tests/test-otel-exporter-env.mjs`
- **test-tracked-request.mjs** (4 connections) — `tests/test-tracked-request.mjs`
- **shutdownTelemetry()** (3 connections) — `src/otel.js`
- **withSpan()** (3 connections) — `src/otel.js`
- **isTkp()** (3 connections) — `src/server.js`
- **readSession()** (3 connections) — `src/server.js`
- **setSessionCookie()** (3 connections) — `src/server.js`
- **shouldUseSecureCookie()** (3 connections) — `src/server.js`
- **shutdown()** (3 connections) — `src/server.js`
- **createLogger()** (2 connections) — `src/logger.js`
- **logger** (2 connections) — `src/logger.js`
- **REDACT_PATHS** (2 connections) — `src/logger.js`
- **activeServerSpan()** (2 connections) — `src/otel.js`
- *... and 36 more nodes in this community*

## Relationships

- [image-uploader.js](image-uploader.js.md) (2 shared connections)

## Source Files

- `src/logger.js`
- `src/otel.js`
- `src/server.js`
- `src/tracked-request.js`
- `tests/test-logger-redact.mjs`
- `tests/test-otel-exporter-env.mjs`
- `tests/test-tracked-request.mjs`

## Audit Trail

- EXTRACTED: 97 (99%)
- INFERRED: 1 (1%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*