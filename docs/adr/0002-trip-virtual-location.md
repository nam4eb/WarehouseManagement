# ADR 0002: Trip as virtual location

Status: Accepted

Each trip owns a typed `TRIP` location. Dual-confirmed loading moves stock from staging to this
location and assigns driver custody. Delivery and return operations move stock onward from it. This
eliminates the ambiguous “in transit” flag and makes responsibility queryable from the ledger.
