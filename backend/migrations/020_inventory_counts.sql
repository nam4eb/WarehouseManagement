ALTER TYPE location_type ADD VALUE IF NOT EXISTS 'INVENTORY_ADJUSTMENT';

CREATE TYPE inventory_count_status AS ENUM (
  'DRAFT','IN_PROGRESS','SUBMITTED','RECOUNT_REQUIRED','APPROVED','ADJUSTED','CANCELLED'
);
CREATE TYPE inventory_adjustment_status AS ENUM ('PENDING_APPROVAL','APPROVED','APPLIED','REJECTED','CANCELLED');

CREATE TABLE inventory_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  location_id uuid NOT NULL REFERENCES locations(id),
  status inventory_count_status NOT NULL DEFAULT 'DRAFT',
  blind boolean NOT NULL DEFAULT true,
  recount_number integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  submitted_by uuid REFERENCES users(id),
  submitted_at timestamptz,
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_counts_status_idx ON inventory_counts(organization_id,warehouse_id,status,created_at DESC);

CREATE TABLE inventory_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL REFERENCES inventory_counts(id),
  product_id uuid NOT NULL REFERENCES products(id),
  expected_quantity_snapshot numeric(18,3) NOT NULL CHECK(expected_quantity_snapshot >= 0),
  counted_quantity numeric(18,3) CHECK(counted_quantity >= 0),
  counted_by uuid REFERENCES users(id),
  counted_at timestamptz,
  UNIQUE(count_id,product_id)
);

CREATE TABLE inventory_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  count_id uuid NOT NULL REFERENCES inventory_counts(id),
  count_line_id uuid NOT NULL UNIQUE REFERENCES inventory_count_lines(id),
  product_id uuid NOT NULL REFERENCES products(id),
  location_id uuid NOT NULL REFERENCES locations(id),
  variance numeric(18,3) NOT NULL CHECK(variance <> 0),
  status inventory_adjustment_status NOT NULL DEFAULT 'PENDING_APPROVAL',
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  movement_id uuid UNIQUE REFERENCES stock_movements(id),
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_adjustments_status_idx ON inventory_adjustments(organization_id,status,created_at DESC);

INSERT INTO permissions(code,description) VALUES
  ('inventory.count','Create and execute blind inventory counts'),
  ('inventory.adjust.approve','Approve or reject inventory adjustments created by another user')
ON CONFLICT(code) DO UPDATE SET description=EXCLUDED.description;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='SUPER_ADMIN'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code=ANY(ARRAY['inventory.count','inventory.adjust.approve'])
WHERE r.code='WAREHOUSE_MANAGER' ON CONFLICT DO NOTHING;

INSERT INTO locations(organization_id,warehouse_id,type,code,name,tracks_balance)
SELECT organization_id,id,'INVENTORY_ADJUSTMENT','INVENTORY-ADJUSTMENT','Inventory adjustment clearing',false
FROM warehouses ON CONFLICT(warehouse_id,code) DO NOTHING;

