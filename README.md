# Warehouse Management & Delivery Control System

Auditable warehouse system with inbound receiving, put-away, bundle-aware picking and an
operations web console. Inventory is a projection of an append-only movement ledger; it is
never stored as a mutable product quantity.

## Quick start

1. Copy `.env.example` to `.env` and replace secrets.
2. Run `docker compose -f infra/docker-compose.yml up -d --build`.
3. Open Admin Web at `http://localhost:3200`, API health at
   `http://localhost:3100/api/v1/health/ready`, and MinIO at `http://localhost:59001`.

Local Admin Web login: organization `DEMO`, email `admin@demo.local`, password
`Demo-Wms-Change-Me-2026!`.

Persona demo accounts use the same password:

- Super Admin: `admin@demo.local`, device `demo-device-warehouse-01`
- Warehouse Manager: `manager@demo.local`, device `demo-device-manager-01`
- Shipper: `shipper@demo.local`, device `demo-device-shipper-01`

The local Compose API automatically runs migrations and the idempotent demo seed before startup.

Quality gates: `npm run format`, `npm run lint`, `npm run typecheck`, `npm test`, and
`npm run build`.

For the deterministic local login and reconciliation walkthrough, see
[`docs/demo-scenario.md`](docs/demo-scenario.md). Never use the demo password outside local data.

Phase progress and database-backed exit criteria are tracked in
[`docs/phase-1-status.md`](docs/phase-1-status.md).

Architecture and operational assumptions are in [`docs/`](docs/).
