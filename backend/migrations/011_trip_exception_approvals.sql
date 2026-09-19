CREATE TABLE trip_exception_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  trip_id uuid NOT NULL UNIQUE REFERENCES trips(id),
  unresolved_quantity numeric(18,3) NOT NULL CHECK(unresolved_quantity > 0),
  resolution_code text NOT NULL CHECK(resolution_code IN ('ACCEPT_VARIANCE','LOSS_CONFIRMED','INVESTIGATE_LATER')),
  reason text NOT NULL CHECK(length(trim(reason)) >= 10),
  approved_by uuid NOT NULL REFERENCES users(id),
  approved_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trip_exception_approvals_org_idx ON trip_exception_approvals(organization_id,approved_at DESC);

INSERT INTO permissions(code,description)
VALUES('delivery.exception.approve','Approve unresolved delivery custody exceptions')
ON CONFLICT(code) DO UPDATE SET description=EXCLUDED.description;
