CREATE TABLE delivery_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  trip_id uuid NOT NULL UNIQUE REFERENCES trips(id),
  recipient_name text NOT NULL,
  signature_object_key text,
  photo_object_keys jsonb NOT NULL DEFAULT '[]',
  notes text,
  delivered_at timestamptz NOT NULL,
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(signature_object_key IS NOT NULL OR jsonb_array_length(photo_object_keys) > 0)
);

CREATE INDEX delivery_proofs_org_created_idx ON delivery_proofs(organization_id,created_at DESC);
