import { randomUUID } from 'node:crypto';
import pg from 'pg';

if (process.env.CONFIRM_PROJECTION_REBUILD !== '1')
  throw new Error('Set CONFIRM_PROJECTION_REBUILD=1 to rebuild');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('wms.stock_balances.rebuild'))");
  await client.query(`CREATE TEMP TABLE rebuilt_balances ON COMMIT DROP AS
    WITH deltas AS (
      SELECT m.organization_id,m.product_id,m.destination_location_id location_id,m.quantity
      FROM stock_movements m JOIN locations l ON l.id=m.destination_location_id AND l.tracks_balance
      UNION ALL
      SELECT m.organization_id,m.product_id,m.source_location_id,-m.quantity
      FROM stock_movements m JOIN locations l ON l.id=m.source_location_id AND l.tracks_balance)
    SELECT organization_id,product_id,location_id,sum(quantity)::numeric(18,3) quantity
    FROM deltas GROUP BY 1,2,3 HAVING sum(quantity)<>0`);
  const negative = await client.query('SELECT * FROM rebuilt_balances WHERE quantity<0 LIMIT 20');
  if (negative.rowCount)
    throw new Error(`Ledger produces negative balances: ${JSON.stringify(negative.rows)}`);
  const count = await client.query<{ count: string }>(
    'SELECT count(*) count FROM rebuilt_balances',
  );
  await client.query('DELETE FROM stock_balances');
  await client.query(`INSERT INTO stock_balances(organization_id,product_id,location_id,quantity,version,updated_at)
    SELECT organization_id,product_id,location_id,quantity,1,now() FROM rebuilt_balances`);
  const organizations = await client.query<{ id: string }>('SELECT id FROM organizations');
  for (const organization of organizations.rows)
    await client.query(
      `INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,data,correlation_id)
     VALUES($1,NULL,'inventory.projection.rebuilt','organization',$1,$2,$3)`,
      [
        organization.id,
        JSON.stringify({ balanceRows: Number(count.rows[0]!.count) }),
        randomUUID(),
      ],
    );
  await client.query('COMMIT');
  console.log(`Rebuilt ${count.rows[0]!.count} balance rows from the immutable ledger.`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
