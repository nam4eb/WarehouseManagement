# ADR 0004: Atomic projection and outbox

Status: Accepted

Movement, balance projection, audit event and outbox event commit atomically. Consumers are
at-least-once and deduplicate by event UUID. Projection rebuilds derive exclusively from movements
and are compared before replacement.
