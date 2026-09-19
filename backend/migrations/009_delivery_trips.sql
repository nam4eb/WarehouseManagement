CREATE TABLE trip_orders (
  trip_id uuid NOT NULL REFERENCES trips(id),
  picking_task_id uuid NOT NULL UNIQUE REFERENCES picking_tasks(id),
  PRIMARY KEY(trip_id,picking_task_id)
);

CREATE TABLE trip_manifest_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id),
  picking_task_line_id uuid NOT NULL UNIQUE REFERENCES picking_task_lines(id),
  product_id uuid NOT NULL REFERENCES products(id),
  source_location_id uuid NOT NULL REFERENCES locations(id),
  customer_location_id uuid NOT NULL REFERENCES locations(id),
  planned_quantity numeric(18,3) NOT NULL CHECK(planned_quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trip_manifest_lines_trip_idx ON trip_manifest_lines(trip_id);
