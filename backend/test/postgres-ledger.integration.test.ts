import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresMovementLedger } from '../src/inventory/postgres-ledger.js';

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('PostgreSQL movement transaction', () => {
  const pool = new pg.Pool({ connectionString: url });
  const ledger = new PostgresMovementLedger(pool);
  const ids = {
    org: randomUUID(),
    warehouse: randomUUID(),
    supplier: randomUUID(),
    receiving: randomUUID(),
    rackA: randomUUID(),
    rackB: randomUUID(),
    user: randomUUID(),
    device: randomUUID(),
    product: randomUUID(),
    serialProduct: randomUUID(),
    serialItem: randomUUID(),
  };

  beforeAll(async () => {
    await pool.query(`INSERT INTO organizations(id,code,name) VALUES($1,$2,'Integration')`, [
      ids.org,
      `I-${ids.org}`,
    ]);
    await pool.query(
      `INSERT INTO warehouses(id,organization_id,code,name) VALUES($1,$2,'W','Warehouse')`,
      [ids.warehouse, ids.org],
    );
    await pool.query(
      `INSERT INTO locations(id,organization_id,warehouse_id,type,code,name,tracks_balance)
      VALUES($1,$2,$3,'SUPPLIER','SUP','Supplier',false),($4,$2,$3,'RECEIVING','REC','Receiving',true),
        ($5,$2,$3,'RACK','RACK-A','Rack A',true),($6,$2,$3,'RACK','RACK-B','Rack B',true)`,
      [ids.supplier, ids.org, ids.warehouse, ids.receiving, ids.rackA, ids.rackB],
    );
    await pool.query(
      `INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,'Test','x')`,
      [ids.user, ids.org, `${ids.user}@test.local`],
    );
    await pool.query(
      `INSERT INTO devices(id,organization_id,user_id,fingerprint) VALUES($1,$2,$3,$4)`,
      [ids.device, ids.org, ids.user, ids.device],
    );
    await pool.query(
      `INSERT INTO products(id,organization_id,sku,name) VALUES($1,$2,$3,'Product')`,
      [ids.product, ids.org, ids.product],
    );
    await pool.query(
      `INSERT INTO products(id,organization_id,sku,name,serial_required) VALUES($1,$2,$3,'Serialized product',true)`,
      [ids.serialProduct, ids.org, ids.serialProduct],
    );
  });
  afterAll(async () => {
    await pool.end();
  });

  it('accepts an external inbound movement and deduplicates ten retries', async () => {
    const command = {
      idempotencyKey: randomUUID(),
      organizationId: ids.org,
      productId: ids.product,
      sourceLocationId: ids.supplier,
      destinationLocationId: ids.receiving,
      quantity: 25,
      reasonCode: 'RECEIPT',
      actorId: ids.user,
      deviceId: ids.device,
      clientOccurredAt: new Date().toISOString(),
      correlationId: randomUUID(),
    };
    const results = await Promise.all(Array.from({ length: 10 }, () => ledger.execute(command)));
    expect(new Set(results.map((item) => item.id)).size).toBe(1);
    const movements = await pool.query(
      'SELECT count(*)::int count FROM stock_movements WHERE organization_id=$1',
      [ids.org],
    );
    const balance = await pool.query(
      'SELECT quantity FROM stock_balances WHERE organization_id=$1 AND location_id=$2',
      [ids.org, ids.receiving],
    );
    expect(movements.rows[0].count).toBe(1);
    expect(Number(balance.rows[0].quantity)).toBe(25);
  });

  it('rejects a movement for a serial-controlled product when serial identity is omitted', async () => {
    const idempotencyKey = randomUUID();
    await expect(
      ledger.execute({
        idempotencyKey,
        organizationId: ids.org,
        productId: ids.serialProduct,
        sourceLocationId: ids.supplier,
        destinationLocationId: ids.receiving,
        quantity: 1,
        reasonCode: 'RECEIPT',
        actorId: ids.user,
        deviceId: ids.device,
        clientOccurredAt: new Date().toISOString(),
        correlationId: randomUUID(),
      }),
    ).rejects.toThrow('SERIAL_REQUIRED');
    const residue = await pool.query(
      `SELECT
       (SELECT count(*) FROM sync_commands WHERE organization_id=$1 AND idempotency_key=$2)::int commands,
       (SELECT count(*) FROM stock_movements WHERE organization_id=$1 AND product_id=$3 AND serial_item_id IS NULL)::int movements`,
      [ids.org, idempotencyKey, ids.serialProduct],
    );
    expect(residue.rows[0]).toEqual({ commands: 0, movements: 0 });
  });

  it('allows only one of two concurrent moves for the same serial', async () => {
    await pool.query(
      `INSERT INTO serial_items(id,organization_id,product_id,serial_number,current_location_id)
       VALUES($1,$2,$3,'SERIAL-CONCURRENT-1',$4)`,
      [ids.serialItem, ids.org, ids.serialProduct, ids.supplier],
    );
    await expect(
      pool.query(
        `INSERT INTO serial_items(organization_id,product_id,serial_number,current_location_id)
         VALUES($1,$2,'SERIAL-CONCURRENT-1',$3)`,
        [ids.org, ids.serialProduct, ids.supplier],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    const base = {
      organizationId: ids.org,
      productId: ids.serialProduct,
      serialItemId: ids.serialItem,
      quantity: 1,
      actorId: ids.user,
      deviceId: ids.device,
      clientOccurredAt: new Date().toISOString(),
    };
    await ledger.execute({
      ...base,
      idempotencyKey: randomUUID(),
      sourceLocationId: ids.supplier,
      destinationLocationId: ids.receiving,
      reasonCode: 'RECEIPT',
      correlationId: randomUUID(),
    });
    const attempts = await Promise.allSettled([
      ledger.execute({
        ...base,
        idempotencyKey: randomUUID(),
        sourceLocationId: ids.receiving,
        destinationLocationId: ids.rackA,
        reasonCode: 'PUT_AWAY',
        correlationId: randomUUID(),
      }),
      ledger.execute({
        ...base,
        idempotencyKey: randomUUID(),
        sourceLocationId: ids.receiving,
        destinationLocationId: ids.rackB,
        reasonCode: 'PUT_AWAY',
        correlationId: randomUUID(),
      }),
    ]);
    expect(attempts.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((item) => item.status === 'rejected')).toHaveLength(1);
    const serial = await pool.query(
      'SELECT current_location_id,version FROM serial_items WHERE id=$1',
      [ids.serialItem],
    );
    expect([ids.rackA, ids.rackB]).toContain(serial.rows[0].current_location_id);
    expect(serial.rows[0].version).toBe(2);
    const movements = await pool.query(
      'SELECT count(*)::int count FROM stock_movements WHERE serial_item_id=$1',
      [ids.serialItem],
    );
    expect(movements.rows[0].count).toBe(2);
  });
});
