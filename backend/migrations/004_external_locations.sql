ALTER TABLE locations ADD COLUMN tracks_balance boolean NOT NULL DEFAULT true;
UPDATE locations SET tracks_balance=false WHERE type IN ('SUPPLIER','RETURN_TO_VENDOR');
CREATE INDEX locations_external_boundary_idx ON locations(organization_id,type) WHERE tracks_balance=false;
