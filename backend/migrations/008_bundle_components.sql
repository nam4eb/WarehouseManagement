ALTER TABLE products ADD COLUMN is_bundle boolean NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN attributes jsonb NOT NULL DEFAULT '{}';
ALTER TABLE product_components ADD COLUMN component_role text NOT NULL DEFAULT 'ITEM';
ALTER TABLE picking_task_lines DROP CONSTRAINT picking_task_lines_picking_task_id_sales_order_line_id_key;
ALTER TABLE picking_task_lines ADD CONSTRAINT picking_task_lines_component_unique
  UNIQUE(picking_task_id,sales_order_line_id,product_id);
CREATE INDEX product_components_bundle_idx ON product_components(bundle_product_id,component_role);
ALTER TABLE product_components ADD CONSTRAINT product_components_role_unique UNIQUE(bundle_product_id,component_role);
