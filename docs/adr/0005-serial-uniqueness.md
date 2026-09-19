# ADR 0005: Organization-wide serial uniqueness

Status: Accepted

A serial identifies one physical item within an organization and has quantity one. Its current
location is locked and advanced in the same transaction as its movement, preventing two-device
double moves. Organization-wide uniqueness is stricter and safer than per-product uniqueness.
