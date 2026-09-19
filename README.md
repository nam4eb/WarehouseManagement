# Warehouse Management & Delivery Control System

Phase 1 foundation for an auditable warehouse system. Inventory is a projection of an
append-only movement ledger; it is never stored as a mutable product quantity.

## Quick start

1. Copy `.env.example` to `.env` and replace secrets.
2. Run `docker compose -f infra/docker-compose.yml up -d --build`.
3. Open the API at `http://localhost:3100/api/v1/health/ready` and MinIO at
   `http://localhost:59001`.

The local Compose API automatically runs migrations and the idempotent demo seed before startup.

Quality gates: `npm run format`, `npm run lint`, `npm run typecheck`, `npm test`, and
`npm run build`.

For the deterministic local login and reconciliation walkthrough, see
[`docs/demo-scenario.md`](docs/demo-scenario.md). Never use the demo password outside local data.

Phase progress and database-backed exit criteria are tracked in
[`docs/phase-1-status.md`](docs/phase-1-status.md).

Architecture and operational assumptions are in [`docs/`](docs/).
