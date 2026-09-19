ALTER TABLE user_roles DROP CONSTRAINT user_roles_pkey;
ALTER TABLE user_roles ALTER COLUMN warehouse_id DROP NOT NULL;
ALTER TABLE user_roles ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE user_roles ADD PRIMARY KEY(id);
ALTER TABLE user_roles ADD CONSTRAINT user_roles_scope_unique
  UNIQUE NULLS NOT DISTINCT(user_id, role_id, warehouse_id);
