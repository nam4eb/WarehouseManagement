# Assumptions

- One SKU is unique within an organization.
- A serial is unique within an organization regardless of SKU. This is the safest initial policy.
- Quantities use `numeric(18,3)` to support piece and measured stock; serialized movements require 1.
- Every operational location belongs to one warehouse. Supplier and customer endpoints are
  represented as typed locations owned by a designated logical warehouse until external-party
  location ownership is modeled.
- A trip location is created per trip and is never reused.
- Stock may not become negative unless a future reason-code policy explicitly permits it.
- UTC is stored in PostgreSQL; device time is evidence, not transaction ordering authority.
- JWT plumbing and full identity flows will be completed with the first admin/mobile client; Phase 1
  lays down users, roles, permissions, devices, and backend authorization boundaries.
- MVP bundle compatibility uses an explicit bundle-to-component SKU mapping with one unique
  component role (for example `INDOOR` or `OUTDOOR`) per bundle. Attribute-driven substitution of
  alternative component SKUs is deferred; scanning a serial from any SKU outside the fixed mapping
  is rejected by the picking line and serial-product invariant.
