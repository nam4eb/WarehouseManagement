CREATE TABLE refresh_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id), device_id uuid NOT NULL REFERENCES devices(id),
  token_hash text NOT NULL UNIQUE, family_id uuid NOT NULL, expires_at timestamptz NOT NULL,
  rotated_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_sessions_active_idx ON refresh_sessions(user_id, device_id, expires_at) WHERE revoked_at IS NULL;
CREATE TABLE reason_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  code text NOT NULL, description text NOT NULL, movement_enabled boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true, UNIQUE(organization_id, code)
);
