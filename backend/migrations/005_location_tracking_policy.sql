UPDATE locations SET tracks_balance = (type NOT IN ('SUPPLIER','RETURN_TO_VENDOR'));
ALTER TABLE locations ADD CONSTRAINT locations_tracking_policy
  CHECK (tracks_balance = (type NOT IN ('SUPPLIER','RETURN_TO_VENDOR')));
