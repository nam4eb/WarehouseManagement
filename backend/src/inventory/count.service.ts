import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { DATABASE_POOL } from '../database/database.module.js';
import { PostgresMovementLedger } from './postgres-ledger.js';

@Injectable()
export class InventoryCountService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: pg.Pool,
    private readonly ledger: PostgresMovementLedger,
  ) {}

  async list(organizationId: string, warehouseIds: string[]) {
    const all = warehouseIds.includes('*');
    const result = await this.pool.query(
      `SELECT c.id,c.warehouse_id,w.code warehouse_code,c.location_id,l.code location_code,c.status,c.blind,
       c.recount_number,c.created_by,c.submitted_at,c.version,c.created_at,
       count(cl.id)::int line_count,count(cl.counted_quantity)::int counted_count,
       count(a.id) FILTER(WHERE a.status='PENDING_APPROVAL')::int pending_adjustments
       FROM inventory_counts c JOIN warehouses w ON w.id=c.warehouse_id JOIN locations l ON l.id=c.location_id
       LEFT JOIN inventory_count_lines cl ON cl.count_id=c.id
       LEFT JOIN inventory_adjustments a ON a.count_line_id=cl.id
       WHERE c.organization_id=$1 AND ($2::boolean OR c.warehouse_id=ANY($3::uuid[]))
       GROUP BY c.id,w.code,l.code ORDER BY c.created_at DESC`,
      [organizationId, all, all ? [] : warehouseIds],
    );
    return result.rows;
  }

  async detail(organizationId: string, warehouseIds: string[], countId: string) {
    const all = warehouseIds.includes('*');
    const count = await this.pool.query(
      `SELECT c.*,w.code warehouse_code,l.code location_code FROM inventory_counts c
       JOIN warehouses w ON w.id=c.warehouse_id JOIN locations l ON l.id=c.location_id
       WHERE c.id=$1 AND c.organization_id=$2 AND ($3::boolean OR c.warehouse_id=ANY($4::uuid[]))`,
      [countId, organizationId, all, all ? [] : warehouseIds],
    );
    if (!count.rows[0]) throw new NotFoundException('Inventory count not found');
    const revealExpected = !['DRAFT', 'IN_PROGRESS', 'RECOUNT_REQUIRED'].includes(count.rows[0].status);
    const lines = await this.pool.query(
      `SELECT cl.id,cl.product_id,p.sku,p.name,cl.counted_quantity,cl.counted_by,cl.counted_at,
       CASE WHEN $2 THEN cl.expected_quantity_snapshot ELSE NULL END expected_quantity,
       CASE WHEN $2 AND cl.counted_quantity IS NOT NULL THEN cl.counted_quantity-cl.expected_quantity_snapshot ELSE NULL END variance,
       a.id adjustment_id,a.status adjustment_status,a.approved_by,a.movement_id
       FROM inventory_count_lines cl JOIN products p ON p.id=cl.product_id
       LEFT JOIN inventory_adjustments a ON a.count_line_id=cl.id AND a.status<>'CANCELLED'
       WHERE cl.count_id=$1 ORDER BY p.sku`,
      [countId, revealExpected],
    );
    return { ...count.rows[0], lines: lines.rows };
  }

  async create(input: {
    organizationId: string;
    warehouseIds: string[];
    actorId: string;
    warehouseId: string;
    locationId: string;
    productIds?: string[];
  }) {
    if (!input.warehouseIds.includes('*') && !input.warehouseIds.includes(input.warehouseId))
      throw new ConflictException('WAREHOUSE_SCOPE_VIOLATION');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const location = await client.query(
        `SELECT id FROM locations WHERE id=$1 AND organization_id=$2 AND warehouse_id=$3 AND tracks_balance=true`,
        [input.locationId, input.organizationId, input.warehouseId],
      );
      if (!location.rows[0]) throw new ConflictException('COUNT_LOCATION_NOT_FOUND');
      const count = await client.query<{ id: string }>(
        `INSERT INTO inventory_counts(organization_id,warehouse_id,location_id,created_by)
         VALUES($1,$2,$3,$4) RETURNING id`,
        [input.organizationId, input.warehouseId, input.locationId, input.actorId],
      );
      const inserted = await client.query(
        `INSERT INTO inventory_count_lines(count_id,product_id,expected_quantity_snapshot)
         SELECT $1,b.product_id,b.quantity FROM stock_balances b
         WHERE b.organization_id=$2 AND b.location_id=$3 AND b.quantity<>0
           AND ($4::uuid[] IS NULL OR b.product_id=ANY($4::uuid[])) RETURNING id`,
        [count.rows[0]!.id, input.organizationId, input.locationId, input.productIds ?? null],
      );
      if (!inserted.rowCount) throw new ConflictException('COUNT_HAS_NO_PRODUCTS');
      await this.audit(client, input.organizationId, input.actorId, 'inventory.count.created', count.rows[0]!.id);
      await client.query('COMMIT');
      return this.detail(input.organizationId, input.warehouseIds, count.rows[0]!.id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async start(organizationId: string, warehouseIds: string[], countId: string, actorId: string) {
    const all = warehouseIds.includes('*');
    const result = await this.pool.query(
      `UPDATE inventory_counts SET status='IN_PROGRESS',version=version+1
       WHERE id=$1 AND organization_id=$2 AND status IN ('DRAFT','RECOUNT_REQUIRED')
         AND ($3::boolean OR warehouse_id=ANY($4::uuid[])) RETURNING id`,
      [countId, organizationId, all, all ? [] : warehouseIds],
    );
    if (!result.rows[0]) throw new ConflictException('COUNT_CANNOT_START');
    await this.audit(this.pool, organizationId, actorId, 'inventory.count.started', countId);
    return this.detail(organizationId, warehouseIds, countId);
  }

  async recordLine(
    organizationId: string,
    warehouseIds: string[],
    countId: string,
    productId: string,
    countedQuantity: number,
    actorId: string,
  ) {
    const all = warehouseIds.includes('*');
    const result = await this.pool.query(
      `UPDATE inventory_count_lines cl SET counted_quantity=$5,counted_by=$6,counted_at=now()
       FROM inventory_counts c WHERE cl.count_id=c.id AND c.id=$1 AND c.organization_id=$2
       AND c.status='IN_PROGRESS' AND ($3::boolean OR c.warehouse_id=ANY($4::uuid[]))
       AND cl.product_id=$7 RETURNING cl.id`,
      [countId, organizationId, all, all ? [] : warehouseIds, countedQuantity, actorId, productId],
    );
    if (!result.rows[0]) throw new ConflictException('COUNT_LINE_NOT_EDITABLE');
    return this.detail(organizationId, warehouseIds, countId);
  }

  async submit(organizationId: string, warehouseIds: string[], countId: string, actorId: string) {
    const all = warehouseIds.includes('*');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const count = await client.query<{ id: string; created_by: string }>(
        `SELECT id,created_by FROM inventory_counts WHERE id=$1 AND organization_id=$2 AND status='IN_PROGRESS'
         AND ($3::boolean OR warehouse_id=ANY($4::uuid[])) FOR UPDATE`,
        [countId, organizationId, all, all ? [] : warehouseIds],
      );
      if (!count.rows[0]) throw new ConflictException('COUNT_CANNOT_SUBMIT');
      const missing = await client.query(
        'SELECT 1 FROM inventory_count_lines WHERE count_id=$1 AND counted_quantity IS NULL LIMIT 1',
        [countId],
      );
      if (missing.rows[0]) throw new ConflictException('COUNT_LINES_INCOMPLETE');
      const adjustments = await client.query(
        `INSERT INTO inventory_adjustments(organization_id,count_id,count_line_id,product_id,location_id,variance,reason,created_by)
         SELECT $2,cl.count_id,cl.id,cl.product_id,c.location_id,cl.counted_quantity-cl.expected_quantity_snapshot,
          'Blind cycle count variance', $3
         FROM inventory_count_lines cl JOIN inventory_counts c ON c.id=cl.count_id
         WHERE cl.count_id=$1 AND cl.counted_quantity<>cl.expected_quantity_snapshot RETURNING id`,
        [countId, organizationId, actorId],
      );
      const status = adjustments.rowCount ? 'SUBMITTED' : 'ADJUSTED';
      await client.query(
        `UPDATE inventory_counts SET status=$2,submitted_by=$3,submitted_at=now(),version=version+1 WHERE id=$1`,
        [countId, status, actorId],
      );
      await this.audit(client, organizationId, actorId, 'inventory.count.submitted', countId, {
        adjustmentCount: adjustments.rowCount,
      });
      await client.query('COMMIT');
      return this.detail(organizationId, warehouseIds, countId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async requestRecount(organizationId: string, warehouseIds: string[], countId: string, actorId: string) {
    const all = warehouseIds.includes('*');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE inventory_counts SET status='RECOUNT_REQUIRED',recount_number=recount_number+1,version=version+1
         WHERE id=$1 AND organization_id=$2 AND status='SUBMITTED'
         AND ($3::boolean OR warehouse_id=ANY($4::uuid[])) RETURNING id`,
        [countId, organizationId, all, all ? [] : warehouseIds],
      );
      if (!result.rows[0]) throw new ConflictException('COUNT_CANNOT_RECOUNT');
      await client.query(
        `UPDATE inventory_adjustments SET status='CANCELLED',version=version+1
         WHERE count_id=$1 AND status='PENDING_APPROVAL'`,
        [countId],
      );
      await client.query(
        'UPDATE inventory_count_lines SET counted_quantity=NULL,counted_by=NULL,counted_at=NULL WHERE count_id=$1',
        [countId],
      );
      await this.audit(client, organizationId, actorId, 'inventory.count.recount_requested', countId);
      await client.query('COMMIT');
      return this.detail(organizationId, warehouseIds, countId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async approveAdjustment(input: {
    organizationId: string;
    warehouseIds: string[];
    adjustmentId: string;
    actorId: string;
    deviceId: string;
  }) {
    const all = input.warehouseIds.includes('*');
    const claimed = await this.pool.query<{
      id: string;
      count_id: string;
      product_id: string;
      location_id: string;
      variance: string;
      created_by: string;
      clearing_location_id: string;
    }>(
      `UPDATE inventory_adjustments a SET status='APPROVED',approved_by=$3,approved_at=now(),version=version+1
       FROM inventory_counts c,
         LATERAL (SELECT id clearing_location_id FROM locations WHERE warehouse_id=c.warehouse_id
           AND type='INVENTORY_ADJUSTMENT' LIMIT 1) clearing
       WHERE a.id=$1 AND a.organization_id=$2 AND a.count_id=c.id AND a.status='PENDING_APPROVAL'
         AND a.created_by<>$3 AND ($4::boolean OR c.warehouse_id=ANY($5::uuid[]))
       RETURNING a.id,a.count_id,a.product_id,a.location_id,a.variance::text,a.created_by,clearing.clearing_location_id`,
      [input.adjustmentId, input.organizationId, input.actorId, all, all ? [] : input.warehouseIds],
    );
    const adjustment = claimed.rows[0];
    if (!adjustment) throw new ConflictException('MAKER_CHECKER_OR_ADJUSTMENT_STATE_VIOLATION');
    const varianceValue = Number(adjustment.variance);
    try {
      const movement = await this.ledger.execute({
        organizationId: input.organizationId,
        productId: adjustment.product_id,
        sourceLocationId: varianceValue > 0 ? adjustment.clearing_location_id : adjustment.location_id,
        destinationLocationId:
          varianceValue > 0 ? adjustment.location_id : adjustment.clearing_location_id,
        quantity: Math.abs(varianceValue),
        reasonCode: 'CYCLE_COUNT_ADJUSTMENT',
        referenceType: 'inventory_adjustment',
        referenceId: adjustment.id,
        actorId: input.actorId,
        deviceId: input.deviceId,
        clientOccurredAt: new Date().toISOString(),
        correlationId: randomUUID(),
        idempotencyKey: adjustment.id,
      });
      await this.pool.query(
        `UPDATE inventory_adjustments SET status='APPLIED',movement_id=$2,version=version+1 WHERE id=$1`,
        [adjustment.id, movement.id],
      );
      await this.pool.query(
        `UPDATE inventory_counts c SET status='ADJUSTED',version=version+1 WHERE c.id=$1
         AND NOT EXISTS(SELECT 1 FROM inventory_adjustments a WHERE a.count_id=c.id AND a.status<>'APPLIED' AND a.status<>'CANCELLED')`,
        [adjustment.count_id],
      );
      return { adjustmentId: adjustment.id, movementId: movement.id, status: 'APPLIED' };
    } catch (error) {
      await this.pool.query(
        `UPDATE inventory_adjustments SET status='PENDING_APPROVAL',approved_by=NULL,approved_at=NULL,version=version+1
         WHERE id=$1 AND status='APPROVED'`,
        [adjustment.id],
      );
      throw error;
    }
  }

  private audit(
    executor: Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>,
    organizationId: string,
    actorId: string,
    action: string,
    entityId: string,
    data: object = {},
  ) {
    return executor.query(
      `INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,data,correlation_id)
       VALUES($1,$2,$3,'inventory_count',$4,$5,$6)`,
      [organizationId, actorId, action, entityId, JSON.stringify(data), randomUUID()],
    );
  }
}

