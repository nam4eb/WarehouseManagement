# Current implementation state

## Running stack

The local Docker Compose stack contains the Next.js Admin Web, NestJS API, PostgreSQL 17, Redis,
and MinIO. All services expose health checks and run together from
`infra/docker-compose.yml`.

## Implemented workflows

- Organization-scoped authentication, device control, RBAC, audit and idempotent offline commands.
- Append-only movement ledger with atomic balance and serial projections.
- Ledger-level enforcement that serial-controlled products cannot move without a concrete serial
  identity, with full transaction rollback on rejection.
- Product, barcode, bundle-component and warehouse-location master data.
- Purchase receipt, scan receiving, confirmation and put-away.
- Sales order creation, bundle-aware picking, staging and exact completion checks.
- Delivery trip manifests, virtual trip custody, loading, departure, customer delivery, quarantine
  return and reconciliation.
- Proof-of-delivery signatures/photos through scoped presigned MinIO uploads, object verification
  and atomic audit metadata.
- Supervisor-only trip exception approval with unresolved custody snapshots, required reasons and
  append-only audit evidence.
- Admin Web views for products, inbound receipts, picking work and delivery trips.
- Warehouse-scoped operational reporting with date filters, daily throughput, completion times,
  POD coverage, exceptions and movement volume.
- Transactional outbox delivery to the Redis `wms.events` stream, with bounded exponential retry,
  dead-letter tracking and organization-scoped operational status. Consumers can use `eventId` as
  the idempotency key for at-least-once delivery.
- Installable driver PWA with cached trip manifests, barcode/serial resolution, offline movement
  queue, idempotent replay and connectivity-aware delivery controls.
- Driver proof-of-delivery capture with mobile camera input, on-screen recipient signature, direct
  presigned MinIO uploads and verified atomic POD recording.
- Ordered trip stops with customer address/coordinates, per-stop custody progress, audited route
  reordering and Google Maps navigation handoff in the driver PWA.
- Stop-specific POD plus audited failed/partial-delivery outcomes with controlled reason codes and
  affected quantities.
- Dispatch control tower with expected stop arrivals, overdue and missing-outcome alerts, unresolved
  vehicle custody, expandable stop detail and 30-second refresh.
- Configurable appointment windows plus audited driver/vehicle reassignment with immutable assignment
  history and required operational reasons.
- Assignment timeline, active workload counts and transaction-locked overlap detection preventing
  a driver or vehicle from being scheduled on concurrent trips.
- Background operational-alert detection with warning/critical severity, deduplication, automatic
  resolution and audited dispatcher acknowledgement in the control tower.
- Persona-aware RBAC and UX for Super Admin, warehouse managers and shippers, including role-specific
  navigation, client route guards, warehouse scopes and assigned-driver trip isolation.

## Verified state

- Migrations `001` through `019` execute on PostgreSQL 17.
- Formatting, linting, strict TypeScript and production builds pass.
- All 27 automated tests pass when run against the Docker PostgreSQL instance.
- A real delivery walkthrough completed with 5 loaded, 4 delivered, 1 returned, zero unresolved
  custody, and an exact ledger/projection match.

## Next increments

- Role-administration forms, user activation controls and password/device lifecycle UX.
- Redis consumer-group projections and subscriber delivery integrations.
