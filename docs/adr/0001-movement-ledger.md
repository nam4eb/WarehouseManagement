# ADR 0001: Append-only movement ledger

Status: Accepted

Inventory truth is the ordered set of `stock_movements`. `stock_balances` is only an atomic,
rebuildable projection. Updates/deletes on movements are blocked by a database trigger. Errors use a
linked correction movement, preserving actor, reason, and document evidence.
