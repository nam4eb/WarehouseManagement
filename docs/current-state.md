# Repository assessment

## State at inspection

The repository was empty, had no Git metadata, README, package manifests, migrations, tests,
or `AGENTS.md`. Node.js 24/npm 11 are installed. Docker is not installed on the current host.

## Gap and phased response

All requested product capabilities were absent. Phase 1 therefore establishes the architecture,
schema, API contract, ledger domain, local infrastructure definition, and executable tests. Admin
and Flutter applications are deliberately reserved for later phases because no existing convention
exists and the brief explicitly prohibits attempting the entire system in one pass.

## Migration risks

- PostgreSQL exclusion/constraint semantics must remain the ultimate concurrency boundary.
- Adding organization-level serial-policy variants later may require rebuilding unique indexes.
- Ledger rows are immutable; schema evolution must add columns or companion tables, never rewrite
  historical business facts.
- Projection changes require versioned rebuild logic and reconciliation before deployment.
- The first migration is additive, but it has not been executed here because Docker/PostgreSQL is
  unavailable on this host.
