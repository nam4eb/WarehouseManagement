import bcrypt from 'bcryptjs';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const password = process.env.DEMO_ADMIN_PASSWORD ?? 'Demo-Wms-Change-Me-2026!';
const ids = {
  org: '00000000-0000-4000-8000-000000000001',
  warehouse: '00000000-0000-4000-8000-000000000010',
  supplier: '00000000-0000-4000-8000-000000000015',
  receiving: '00000000-0000-4000-8000-000000000016',
  rack: '00000000-0000-4000-8000-000000000017',
  staging: '00000000-0000-4000-8000-000000000011',
  trip: '00000000-0000-4000-8000-000000000012',
  customer: '00000000-0000-4000-8000-000000000013',
  quarantine: '00000000-0000-4000-8000-000000000014',
  user: '00000000-0000-4000-8000-000000000020',
  manager: '00000000-0000-4000-8000-000000000024',
  shipper: '00000000-0000-4000-8000-000000000025',
  device: '00000000-0000-4000-8000-000000000021',
  vehicle: '00000000-0000-4000-8000-000000000023',
  role: '00000000-0000-4000-8000-000000000022',
  managerRole: '00000000-0000-4000-8000-000000000026',
  shipperRole: '00000000-0000-4000-8000-000000000027',
  product: '00000000-0000-4000-8000-000000000030',
  openingMovement: '00000000-0000-4000-8000-000000000031',
};
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO organizations(id,code,name) VALUES($1,'DEMO','WMS Demo') ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name`,
    [ids.org],
  );
  await client.query(
    `INSERT INTO warehouses(id,organization_id,code,name) VALUES($1,$2,'BKK','Bangkok Demo Warehouse') ON CONFLICT(id) DO NOTHING`,
    [ids.warehouse, ids.org],
  );
  for (const [id, type, locationCode, locationName] of [
    [ids.supplier, 'SUPPLIER', 'SUPPLIER-DEMO', 'Demo supplier'],
    [ids.receiving, 'RECEIVING', 'RECEIVING-DEMO', 'Demo receiving dock'],
    [ids.rack, 'RACK', 'RACK-DEMO', 'Demo storage rack'],
    [ids.staging, 'OUTBOUND_STAGING', 'STAGING', 'Outbound staging'],
    [ids.trip, 'TRIP', 'TRIP-DEMO', 'Demo truck custody'],
    [ids.customer, 'CUSTOMER', 'CUSTOMER-DEMO', 'Demo customer'],
    [ids.quarantine, 'RETURN_QUARANTINE', 'RETURN-QA', 'Return quarantine'],
  ])
    await client.query(
      `INSERT INTO locations(id,organization_id,warehouse_id,type,code,name,tracks_balance)
       VALUES($1,$2,$3,$4,$5,$6,($4::location_type NOT IN ('SUPPLIER','RETURN_TO_VENDOR'))) ON CONFLICT(id) DO NOTHING`,
      [id, ids.org, ids.warehouse, type, locationCode, locationName],
    );
  await client.query(
    `UPDATE locations SET address_line='Sukhumvit Road, Bangkok',latitude=13.730800,longitude=100.541800
     WHERE id=$1 AND address_line IS NULL`,
    [ids.customer],
  );
  const passwordHash = await bcrypt.hash(password, 12);
  await client.query(
    `INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,'admin@demo.local','Demo Admin',$3)
    ON CONFLICT(id) DO UPDATE SET password_hash=EXCLUDED.password_hash`,
    [ids.user, ids.org, passwordHash],
  );
  await client.query(
    `INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES
      ($1,$3,'manager@demo.local','Demo Warehouse Manager',$4),
      ($2,$3,'shipper@demo.local','Demo Shipper',$4)
     ON CONFLICT(id) DO UPDATE SET password_hash=EXCLUDED.password_hash`,
    [ids.manager, ids.shipper, ids.org, passwordHash],
  );
  await client.query(
    `INSERT INTO devices(id,organization_id,user_id,fingerprint) VALUES($1,$2,$3,'demo-device-warehouse-01') ON CONFLICT(id) DO NOTHING`,
    [ids.device, ids.org, ids.user],
  );
  await client.query(
    `INSERT INTO devices(organization_id,user_id,fingerprint) VALUES
      ($1,$2,'demo-device-manager-01'),($1,$3,'demo-device-shipper-01') ON CONFLICT DO NOTHING`,
    [ids.org, ids.manager, ids.shipper],
  );
  await client.query(
    `INSERT INTO vehicles(id,organization_id,registration) VALUES($1,$2,'DEMO-TRUCK-01') ON CONFLICT(id) DO NOTHING`,
    [ids.vehicle, ids.org],
  );
  await client.query(
    `INSERT INTO roles(id,organization_id,code,name) VALUES($1,$2,'SUPER_ADMIN','Super Admin')
     ON CONFLICT(id) DO UPDATE SET code='SUPER_ADMIN',name='Super Admin'`,
    [ids.role, ids.org],
  );
  await client.query(
    `INSERT INTO roles(organization_id,code,name) VALUES
      ($1,'WAREHOUSE_MANAGER','Quản lý kho bãi'),($1,'SHIPPER','Shipper')
     ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name`,
    [ids.org],
  );
  for (const [permission, description] of [
    ['inventory.read', 'Read inventory'],
    ['inventory.move', 'Move inventory'],
    ['catalog.manage', 'Manage master data'],
    ['identity.manage', 'Manage users, roles, and devices'],
    ['audit.read', 'Read append-only audit trail'],
    ['inbound.manage', 'Create and manage receipts'],
    ['inbound.receive', 'Receive and put away stock'],
    ['inbound.confirm', 'Confirm completed receipts'],
    ['outbound.manage', 'Create sales orders and picking tasks'],
    ['outbound.pick', 'Pick and stage stock'],
    ['delivery.exception.approve', 'Approve unresolved delivery custody exceptions'],
    ['delivery.read', 'Read assigned delivery trips and supporting locations'],
    ['delivery.execute', 'Execute assigned delivery workflows'],
  ])
    await client.query(
      `INSERT INTO permissions(code,description) VALUES($1,$2) ON CONFLICT(code) DO UPDATE SET description=EXCLUDED.description`,
      [permission, description],
    );
  await client.query(
    `INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=ANY($2) ON CONFLICT DO NOTHING`,
    [
      ids.role,
      [
        'inventory.read',
        'inventory.move',
        'catalog.manage',
        'identity.manage',
        'audit.read',
        'inbound.manage',
        'inbound.receive',
        'inbound.confirm',
        'outbound.manage',
        'outbound.pick',
        'delivery.exception.approve',
        'delivery.read',
        'delivery.execute',
      ],
    ],
  );
  await client.query(
    `INSERT INTO role_permissions(role_id,permission_id)
     SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code=ANY($2::text[])
       WHERE r.organization_id=$1 AND r.code='WAREHOUSE_MANAGER' UNION ALL
     SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code=ANY($3::text[])
       WHERE r.organization_id=$1 AND r.code='SHIPPER' ON CONFLICT DO NOTHING`,
    [
      ids.org,
      [
        'inventory.read',
        'inventory.move',
        'catalog.manage',
        'audit.read',
        'inbound.manage',
        'inbound.receive',
        'inbound.confirm',
        'outbound.manage',
        'outbound.pick',
        'delivery.read',
        'delivery.execute',
        'delivery.exception.approve',
      ],
      ['delivery.read', 'delivery.execute'],
    ],
  );
  await client.query(
    `INSERT INTO user_roles(user_id,role_id,warehouse_id) VALUES($1,$2,NULL) ON CONFLICT ON CONSTRAINT user_roles_scope_unique DO NOTHING`,
    [ids.user, ids.role],
  );
  await client.query(
    `INSERT INTO user_roles(user_id,role_id,warehouse_id)
     SELECT $1::uuid,id,$4::uuid FROM roles WHERE organization_id=$3 AND code='WAREHOUSE_MANAGER' UNION ALL
     SELECT $2::uuid,id,$4::uuid FROM roles WHERE organization_id=$3 AND code='SHIPPER'
     ON CONFLICT ON CONSTRAINT user_roles_scope_unique DO NOTHING`,
    [ids.manager, ids.shipper, ids.org, ids.warehouse],
  );
  await client.query(
    `UPDATE trips SET driver_user_id=$1 WHERE organization_id=$2 AND driver_user_id IS NULL`,
    [ids.shipper, ids.org],
  );
  await client.query(
    `INSERT INTO products(id,organization_id,sku,name,serial_required) VALUES($1,$2,'TV-DEMO','Demo television',false) ON CONFLICT(id) DO NOTHING`,
    [ids.product, ids.org],
  );
  await client.query(
    `INSERT INTO product_barcodes(organization_id,product_id,barcode) VALUES($1,$2,'893000000001') ON CONFLICT DO NOTHING`,
    [ids.org, ids.product],
  );
  await client.query(
    `WITH inserted AS (
       INSERT INTO stock_movements(id,organization_id,product_id,source_location_id,destination_location_id,
         quantity,reason_code,actor_id,device_id,client_occurred_at,correlation_id)
       VALUES($1,$2,$3,$4,$5,25,'DEMO_OPENING_RECEIPT',$6,$7,now(),$8)
       ON CONFLICT(id) DO NOTHING RETURNING 1
     ) INSERT INTO stock_balances(organization_id,product_id,location_id,quantity)
       SELECT $2,$3,$5,25 FROM inserted ON CONFLICT DO NOTHING`,
    [
      ids.openingMovement,
      ids.org,
      ids.product,
      ids.supplier,
      ids.staging,
      ids.user,
      ids.device,
      '00000000-0000-4000-8000-000000000032',
    ],
  );
  await client.query('COMMIT');
  console.log('Demo seeded: DEMO / admin@demo.local / demo-device-warehouse-01');
  console.log('Use DEMO_ADMIN_PASSWORD; staging starts with 25 units.');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
