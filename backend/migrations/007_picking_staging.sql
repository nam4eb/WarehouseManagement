CREATE TYPE sales_order_status AS ENUM ('DRAFT','RELEASED','ALLOCATED','COMPLETED','CANCELLED');
CREATE TYPE picking_task_status AS ENUM ('OPEN','PICKING','COMPLETED','CANCELLED');

CREATE TABLE sales_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id), customer_location_id uuid NOT NULL REFERENCES locations(id),
  order_number text NOT NULL, status sales_order_status NOT NULL DEFAULT 'RELEASED',
  created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,order_number)
);
CREATE TABLE sales_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sales_order_id uuid NOT NULL REFERENCES sales_orders(id),
  product_id uuid NOT NULL REFERENCES products(id), ordered_quantity numeric(18,3) NOT NULL CHECK(ordered_quantity>0),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(sales_order_id,product_id)
);
CREATE TABLE picking_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id), sales_order_id uuid NOT NULL UNIQUE REFERENCES sales_orders(id),
  staging_location_id uuid NOT NULL REFERENCES locations(id), status picking_task_status NOT NULL DEFAULT 'OPEN',
  version integer NOT NULL DEFAULT 0, assigned_to uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE TABLE picking_task_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), picking_task_id uuid NOT NULL REFERENCES picking_tasks(id),
  sales_order_line_id uuid NOT NULL REFERENCES sales_order_lines(id), product_id uuid NOT NULL REFERENCES products(id),
  required_quantity numeric(18,3) NOT NULL CHECK(required_quantity>0), UNIQUE(picking_task_id,sales_order_line_id)
);
CREATE INDEX picking_tasks_status_idx ON picking_tasks(organization_id,warehouse_id,status,created_at);
CREATE INDEX picking_task_lines_task_idx ON picking_task_lines(picking_task_id);
