# Demo: load 25, deliver 22, reconcile 3

Run migrations and `npm run seed -w backend`, then log in with organization `DEMO`, email
`admin@demo.local`, device fingerprint `demo-device-warehouse-01`, and `DEMO_ADMIN_PASSWORD`
(local default: `Demo-Wms-Change-Me-2026!`).

The seed places 25 units of product `00000000-0000-4000-8000-000000000030` in staging. Send three
movement commands with a new UUID `Idempotency-Key` each time:

1. staging `...0011` → trip `...0012`, quantity 25, reason `LOAD`;
2. trip `...0012` → customer `...0013`, quantity 22, reason `DELIVERY`;
3. trip `...0012` → quarantine `...0014`, quantity 3, reason `TRIP_RETURN`.

`GET /api/v1/inventory/balances` must report trip zero, customer 22, and quarantine 3. For the
mismatch variant, reset the seed and return only 2 in step 3. The remaining trip balance of 1 is the
evidence consumed by the Phase 3 discrepancy workflow. Automated tests cover both variants now.
