import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const result = await client.query(
    `WITH ledger AS (
       SELECT m.organization_id,m.product_id,m.destination_location_id location_id,sum(m.quantity) quantity
       FROM stock_movements m JOIN locations l ON l.id=m.destination_location_id AND l.tracks_balance GROUP BY 1,2,3
       UNION ALL
       SELECT m.organization_id,m.product_id,m.source_location_id,-sum(m.quantity)
       FROM stock_movements m JOIN locations l ON l.id=m.source_location_id AND l.tracks_balance GROUP BY 1,2,3
     ), expected AS (
       SELECT organization_id,product_id,location_id,sum(quantity) quantity FROM ledger GROUP BY 1,2,3
     )
     SELECT COALESCE(e.organization_id,b.organization_id) organization_id,
       COALESCE(e.product_id,b.product_id) product_id,COALESCE(e.location_id,b.location_id) location_id,
       COALESCE(e.quantity,0) ledger_quantity,COALESCE(b.quantity,0) projected_quantity
     FROM expected e FULL JOIN stock_balances b USING(organization_id,product_id,location_id)
     WHERE COALESCE(e.quantity,0)<>COALESCE(b.quantity,0)`,
  );
  if (result.rowCount) {
    console.error(JSON.stringify(result.rows, null, 2));
    process.exitCode = 1;
  } else console.log('Stock balance projection matches the immutable ledger.');
} finally {
  await client.end();
}
