INSERT INTO permissions(code,description) VALUES
  ('delivery.read','Read assigned delivery trips and supporting locations'),
  ('delivery.execute','Execute assigned delivery trip actions, POD, and stop outcomes')
ON CONFLICT(code) DO UPDATE SET description=EXCLUDED.description;

UPDATE roles SET code='SUPER_ADMIN',name='Super Admin' WHERE code='ADMIN'
  AND NOT EXISTS(SELECT 1 FROM roles existing WHERE existing.organization_id=roles.organization_id AND existing.code='SUPER_ADMIN');

INSERT INTO roles(organization_id,code,name)
SELECT id,'SUPER_ADMIN','Super Admin' FROM organizations ON CONFLICT DO NOTHING;
INSERT INTO roles(organization_id,code,name)
SELECT id,'WAREHOUSE_MANAGER','Quản lý kho bãi' FROM organizations ON CONFLICT DO NOTHING;
INSERT INTO roles(organization_id,code,name)
SELECT id,'SHIPPER','Shipper' FROM organizations ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='SUPER_ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code=ANY(ARRAY[
  'inventory.read','inventory.move','catalog.manage','audit.read','inbound.manage','inbound.receive',
  'inbound.confirm','outbound.manage','outbound.pick','delivery.read','delivery.execute',
  'delivery.exception.approve']) WHERE r.code='WAREHOUSE_MANAGER'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code=ANY(ARRAY['delivery.read','delivery.execute'])
WHERE r.code='SHIPPER' ON CONFLICT DO NOTHING;
