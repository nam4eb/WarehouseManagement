CREATE TYPE receipt_status AS ENUM ('DRAFT','RECEIVING','CONFIRMED','CANCELLED');

CREATE TABLE purchase_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  supplier_location_id uuid NOT NULL REFERENCES locations(id),
  receiving_location_id uuid NOT NULL REFERENCES locations(id),
  reference_number text NOT NULL,
  status receipt_status NOT NULL DEFAULT 'DRAFT',
  version integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  UNIQUE(organization_id,reference_number)
);

CREATE TABLE purchase_receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES purchase_receipts(id),
  product_id uuid NOT NULL REFERENCES products(id),
  expected_quantity numeric(18,3) NOT NULL CHECK(expected_quantity>0),
  condition_code text NOT NULL DEFAULT 'NEW',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(receipt_id,product_id,condition_code)
);

CREATE INDEX purchase_receipts_status_idx ON purchase_receipts(organization_id,warehouse_id,status,created_at);
CREATE INDEX purchase_receipt_lines_receipt_idx ON purchase_receipt_lines(receipt_id);
