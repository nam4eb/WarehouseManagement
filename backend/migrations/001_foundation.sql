CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE location_type AS ENUM ('SUPPLIER','RECEIVING','AVAILABLE','RACK','OUTBOUND_STAGING','TRIP','CUSTOMER','RETURN_QUARANTINE','OPEN_BOX','DAMAGED','WARRANTY','RETURN_TO_VENDOR');
CREATE TYPE serial_status AS ENUM ('IN_STOCK','IN_TRANSIT','DELIVERED','QUARANTINED','DISPOSED');
CREATE TYPE trip_status AS ENUM ('DRAFT','READY_TO_LOAD','LOADING','LOADED','DEPARTED','IN_PROGRESS','RETURNING','RECONCILING','RECONCILIATION_REQUIRED','COMPLETED','COMPLETED_WITH_EXCEPTION');
CREATE TYPE sync_status AS ENUM ('PROCESSING','SUCCEEDED','CONFLICT','FAILED');

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  code text NOT NULL, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id), parent_id uuid REFERENCES locations(id),
  type location_type NOT NULL, code text NOT NULL, name text NOT NULL, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (warehouse_id, code)
);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  email text NOT NULL, display_name text NOT NULL, password_hash text NOT NULL, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id, email)
);
CREATE TABLE roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), code text NOT NULL, name text NOT NULL, UNIQUE(organization_id, code));
CREATE TABLE permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, description text NOT NULL);
CREATE TABLE user_roles (user_id uuid NOT NULL REFERENCES users(id), role_id uuid NOT NULL REFERENCES roles(id), warehouse_id uuid REFERENCES warehouses(id), PRIMARY KEY(user_id, role_id, warehouse_id));
CREATE TABLE role_permissions (role_id uuid NOT NULL REFERENCES roles(id), permission_id uuid NOT NULL REFERENCES permissions(id), PRIMARY KEY(role_id, permission_id));
CREATE TABLE devices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), user_id uuid REFERENCES users(id), fingerprint text NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id, fingerprint));

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  sku text NOT NULL, name text NOT NULL, serial_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id, sku)
);
CREATE TABLE product_barcodes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), product_id uuid NOT NULL REFERENCES products(id), barcode text NOT NULL, UNIQUE(organization_id, barcode));
CREATE TABLE product_components (bundle_product_id uuid NOT NULL REFERENCES products(id), component_product_id uuid NOT NULL REFERENCES products(id), quantity numeric(18,3) NOT NULL CHECK(quantity > 0), compatibility_rule jsonb NOT NULL DEFAULT '{}', PRIMARY KEY(bundle_product_id, component_product_id));
CREATE TABLE serial_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  product_id uuid NOT NULL REFERENCES products(id), serial_number text NOT NULL, current_location_id uuid REFERENCES locations(id),
  condition_code text NOT NULL DEFAULT 'NEW', status serial_status NOT NULL DEFAULT 'IN_STOCK', version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id, serial_number)
);

CREATE TABLE vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), registration text NOT NULL, active boolean NOT NULL DEFAULT true, UNIQUE(organization_id, registration));
CREATE TABLE trips (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), warehouse_id uuid NOT NULL REFERENCES warehouses(id), trip_location_id uuid UNIQUE REFERENCES locations(id), vehicle_id uuid REFERENCES vehicles(id), driver_user_id uuid REFERENCES users(id), status trip_status NOT NULL DEFAULT 'DRAFT', service_date date NOT NULL, version integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX trips_status_date_idx ON trips(organization_id, status, service_date);

CREATE TABLE sync_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key uuid NOT NULL, device_id uuid NOT NULL REFERENCES devices(id), payload_hash text NOT NULL,
  command_type text NOT NULL, status sync_status NOT NULL DEFAULT 'PROCESSING', result_reference jsonb,
  client_occurred_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, idempotency_key)
);
CREATE TABLE stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  product_id uuid NOT NULL REFERENCES products(id), serial_item_id uuid REFERENCES serial_items(id),
  source_location_id uuid NOT NULL REFERENCES locations(id), destination_location_id uuid NOT NULL REFERENCES locations(id),
  quantity numeric(18,3) NOT NULL CHECK(quantity > 0), reason_code text NOT NULL,
  reference_type text, reference_id uuid, reverses_movement_id uuid REFERENCES stock_movements(id),
  sync_command_id uuid UNIQUE REFERENCES sync_commands(id), actor_id uuid NOT NULL REFERENCES users(id), device_id uuid REFERENCES devices(id),
  client_occurred_at timestamptz, occurred_at timestamptz NOT NULL DEFAULT now(), correlation_id uuid NOT NULL,
  CHECK(source_location_id <> destination_location_id), CHECK(serial_item_id IS NULL OR quantity = 1)
);
CREATE INDEX stock_movements_serial_timeline_idx ON stock_movements(organization_id, serial_item_id, occurred_at, id) WHERE serial_item_id IS NOT NULL;
CREATE INDEX stock_movements_reference_idx ON stock_movements(organization_id, reference_type, reference_id);
CREATE TABLE stock_balances (
  organization_id uuid NOT NULL REFERENCES organizations(id), product_id uuid NOT NULL REFERENCES products(id),
  location_id uuid NOT NULL REFERENCES locations(id), quantity numeric(18,3) NOT NULL DEFAULT 0 CHECK(quantity >= 0),
  version bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id, product_id, location_id)
);
CREATE INDEX stock_balances_product_location_idx ON stock_balances(organization_id, product_id, location_id) INCLUDE(quantity);
CREATE TABLE audit_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), actor_id uuid REFERENCES users(id), action text NOT NULL, entity_type text NOT NULL, entity_id uuid NOT NULL, data jsonb NOT NULL DEFAULT '{}', correlation_id uuid NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE outbox_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), topic text NOT NULL, aggregate_type text NOT NULL, aggregate_id uuid NOT NULL, payload jsonb NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz);
CREATE INDEX outbox_unpublished_idx ON outbox_events(occurred_at) WHERE published_at IS NULL;

CREATE FUNCTION reject_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
CREATE TRIGGER stock_movements_immutable BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
