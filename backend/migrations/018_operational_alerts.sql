CREATE TABLE operational_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  alert_type text NOT NULL CHECK(alert_type IN ('STOP_OVERDUE','CUSTODY_UNRESOLVED')),
  severity text NOT NULL CHECK(severity IN ('WARNING','CRITICAL')),
  status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  fingerprint text NOT NULL,
  trip_id uuid NOT NULL REFERENCES trips(id),
  customer_location_id uuid REFERENCES locations(id),
  title text NOT NULL,
  message text NOT NULL,
  acknowledged_by uuid REFERENCES users(id),
  acknowledged_at timestamptz,
  acknowledgement_note text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,fingerprint)
);

CREATE INDEX operational_alerts_active_idx
  ON operational_alerts(organization_id,status,severity,created_at DESC)
  WHERE status<>'RESOLVED';
