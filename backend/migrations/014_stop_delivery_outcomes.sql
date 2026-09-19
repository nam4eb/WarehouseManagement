ALTER TABLE delivery_proofs ADD COLUMN customer_location_id uuid REFERENCES locations(id);

UPDATE delivery_proofs dp SET customer_location_id=(
  SELECT ts.customer_location_id FROM trip_stops ts
  WHERE ts.trip_id=dp.trip_id ORDER BY ts.stop_sequence LIMIT 1
);

ALTER TABLE delivery_proofs ALTER COLUMN customer_location_id SET NOT NULL;
ALTER TABLE delivery_proofs DROP CONSTRAINT delivery_proofs_trip_id_key;
ALTER TABLE delivery_proofs ADD CONSTRAINT delivery_proofs_trip_stop_unique
  UNIQUE(trip_id,customer_location_id);

CREATE TABLE delivery_stop_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  trip_id uuid NOT NULL REFERENCES trips(id),
  customer_location_id uuid NOT NULL REFERENCES locations(id),
  reason_code text NOT NULL CHECK(reason_code IN ('CUSTOMER_ABSENT','CUSTOMER_REJECTED','DAMAGED','SHORT_SHIPMENT','ACCESS_BLOCKED','OTHER')),
  affected_quantity numeric(18,3) NOT NULL CHECK(affected_quantity > 0),
  notes text NOT NULL,
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(trip_id,customer_location_id)
);

CREATE INDEX delivery_stop_exceptions_org_created_idx
  ON delivery_stop_exceptions(organization_id,created_at DESC);
