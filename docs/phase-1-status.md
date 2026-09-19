# Phase 1 status

## Implemented

- npm workspace, formatting, linting, strict TypeScript, build and PostgreSQL-backed CI.
- Docker Compose for PostgreSQL, Redis and S3-compatible object storage.
- Organization, warehouse, nested location, product, barcode, serial, user, role, permission and
  device schema/API foundations.
- Short-lived access tokens, opaque refresh rotation, reuse detection and device revocation.
- Backend-enforced permission and warehouse scope.
- Append-only movement ledger and audit log, atomic balance/serial/audit/outbox transaction.
- External inventory boundaries without fabricated supplier balances.
- Universal scan resolve, inventory balance/timeline, offline sync batch/status and stable
  idempotency semantics.
- Projection verification and guarded rebuild from the immutable ledger.
- Deterministic local seed and documented 25 → 22 → 3 reconciliation scenario.
- OpenAPI skeleton and architecture decisions.

## Evidence

- Local: format, lint, typecheck and production build pass.
- Local: 14 tests pass; PostgreSQL-only tests are skipped without `TEST_DATABASE_URL`.
- CI: PostgreSQL 17 service runs migrations, concurrent retry tests, duplicate-serial enforcement,
  two-device serial race, and projection verification.
- Production dependency audit reports zero known vulnerabilities.

## Database-backed exit criteria

- Migrations 001–005 executed successfully on the local Docker PostgreSQL 17 instance.
- All 16 tests pass, including concurrent idempotency and two-device serial race cases.
- Projection verification reports an exact match with the immutable ledger.
- Docker API readiness, demo login and seeded staging balance of 25 were verified over HTTP.

The Phase 1 database-backed exit criteria now pass. The complete 25 → 22 → 3 mutation walkthrough
remains available as an explicit demo operation rather than being run automatically at startup.
