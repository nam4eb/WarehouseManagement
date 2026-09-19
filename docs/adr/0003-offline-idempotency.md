# ADR 0003: Offline command idempotency

Status: Accepted

Every mobile mutation carries a UUID key, device, client timestamp, canonical payload hash and
optional aggregate version. The server persists the result. Same key plus same hash returns that
result; same key plus another hash is a conflict. Commands and result creation share a transaction.
